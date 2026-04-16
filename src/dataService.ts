import * as vscode from 'vscode';
import {
  CopilotQuota,
  DailyBillingUsageItem,
  fetchCopilotInternalQuota,
  fetchCopilotBusinessQuota,
  fetchBillingUsage,
  fetchPremiumBillingUsage,
  fetchUsername,
  resolveToken,
  TokenExpiredError,
  RateLimitError,
  isBillingPermissionError,
} from './api';
import { COST_PER_PREMIUM_REQUEST } from './pacing';

export interface UsageModel {
  model: string;
  includedRequests: number;
  billedRequests: number;
  grossAmount: number;
  billedAmount: number;
}

export interface UsageData {
  totalUsage: number;
  limit: number;
  remaining: number;
  billedTotal: number;
  models: UsageModel[];
  dateRange: string;
  dataSource: 'api' | 'manual';
  lastFetchedAt?: number;
  resetAt?: string;
}

const STORAGE_KEY_MODELS = 'copilotTracker.models';
const STORAGE_KEY_LIMIT = 'copilotTracker.limit';
const STORAGE_KEY_USERNAME = 'copilotTracker.username';
const DEFAULT_LIMIT = 300;

const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const BILLING_TOKEN_KEY = 'copilotTracker.billingToken';

export class DataService {
  private cachedQuota: CopilotQuota | null = null;
  private cachedPremiumBillingItems: DailyBillingUsageItem[] = [];
  private lastFetchedAt = 0;
  private lastBillingFetchedAt = 0;
  private lastError: string | null = null;
  private fetchInFlight: Promise<CopilotQuota | null> | null = null;
  private billingInFlight: Promise<DailyBillingUsageItem[]> | null = null;
  private billingItemsInFlight: Promise<void> | null = null;
  private _billingTokenNeeded = false;
  private _billingTokenNoticeConsumed = false;
  private _noTokenAvailable = false;
  private _noTokenNoticeConsumed = false;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly secrets?: vscode.SecretStorage,
  ) {}

  /**
   * Fetches usage data from the GitHub API.
   *
   * Strategy (inspired by copilot-pacer & copilot_tracer_extension):
   * 1. Try internal Individual API (/copilot_internal/v2/token)
   * 2. Try internal Business API (/copilot_internal/user)
   * 3. Fall back to billing API (/users/{user}/settings/billing/usage/summary)
   */
  async fetchFromApi(interactive: boolean = false): Promise<CopilotQuota | null> {
    if (this.cachedQuota && Date.now() - this.lastFetchedAt < MIN_FETCH_INTERVAL_MS) {
      return this.cachedQuota;
    }

    // Coalesce concurrent callers into the same in-flight request
    if (this.fetchInFlight) { return this.fetchInFlight; }

    this.fetchInFlight = this.doFetchFromApi(interactive);
    try {
      return await this.fetchInFlight;
    } finally {
      this.fetchInFlight = null;
    }
  }

  private async doFetchFromApi(interactive: boolean): Promise<CopilotQuota | null> {
    const token = await resolveToken(interactive);
    if (!token) {
      this._noTokenAvailable = true;
      return null;
    }
    this._noTokenAvailable = false;
    this._noTokenNoticeConsumed = false;

    // Try internal Individual endpoint first
    try {
      const quota = await fetchCopilotInternalQuota(token);
      if (quota) {
        await this.applyQuota(quota);
        this.fetchAllBillingItems().catch(() => {});
        return quota;
      }
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
    }

    // Try internal Business/Enterprise endpoint
    try {
      const quota = await fetchCopilotBusinessQuota(token);
      if (quota) {
        await this.applyQuota(quota);
        this.fetchAllBillingItems().catch(() => {});
        return quota;
      }
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
    }

    // Fallback to billing API (requires username)
    try {
      const username = await this.resolveUsername(token);

      const billingToken = await this.getBillingToken() ?? token;
      const { usedRequests } = await fetchBillingUsage(billingToken, username);
      const limit = this.getLimit();
      const quota: CopilotQuota = {
        used: usedRequests,
        remaining: Math.max(0, limit - usedRequests),
        quota: limit,
        resetAt: '',
      };
      await this.applyQuota(quota);
      return quota;
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
      if (isBillingPermissionError(e)) { this._billingTokenNeeded = true; }
      this.lastError = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  private async applyQuota(quota: CopilotQuota): Promise<void> {
    this.cachedQuota = quota;
    this.lastFetchedAt = Date.now();
    this.lastError = null;
    this._billingTokenNeeded = false;
    this._billingTokenNoticeConsumed = false;
    if (quota.quota > 0) {
      await this.globalState.update(STORAGE_KEY_LIMIT, quota.quota);
    }
  }

  getUsageData(): UsageData {
    const models = this.getModels();
    const limit = this.getLimit();

    let totalUsage: number;
    let remaining: number;
    let dataSource: 'api' | 'manual';

    // Single-pass aggregation for manual totals and billed total
    let manualTotal = 0;
    let billedTotal = 0;
    for (const m of models) {
      manualTotal += m.includedRequests;
      billedTotal += m.billedAmount;
    }

    if (this.cachedQuota) {
      totalUsage = this.cachedQuota.used;
      remaining = this.cachedQuota.remaining;
      dataSource = 'api';
    } else {
      totalUsage = manualTotal;
      remaining = Math.max(0, limit - totalUsage);
      dataSource = 'manual';
    }

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

    return {
      totalUsage,
      limit,
      remaining,
      billedTotal,
      models,
      dateRange: `${fmt(monthStart)} – ${fmt(now)}`,
      dataSource,
      lastFetchedAt: this.lastFetchedAt || undefined,
      resetAt: this.cachedQuota?.resetAt || undefined,
    };
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /** Bypass the min-fetch-interval check for one immediate refresh. */
  forceRefresh(): void {
    this.lastFetchedAt = 0;
    this.lastBillingFetchedAt = 0;
    // Do NOT null in-flight promises — that would bypass coalescing
    // and spawn parallel duplicate API requests.
    // The next call after the current request completes will see
    // lastFetchedAt = 0 and trigger a fresh fetch.
  }

  private async fetchAllBillingItems(): Promise<void> {
    if (Date.now() - this.lastBillingFetchedAt < MIN_FETCH_INTERVAL_MS) { return; }

    // Coalesce concurrent callers into the same in-flight request
    if (this.billingItemsInFlight) { return this.billingItemsInFlight; }

    this.billingItemsInFlight = this.doFetchAllBillingItems();
    try {
      return await this.billingItemsInFlight;
    } finally {
      this.billingItemsInFlight = null;
    }
  }

  private async doFetchAllBillingItems(): Promise<void> {
    try {
      await this.fetchBillingRange();
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
      this.lastError = 'Failed to fetch billing details';
    }
  }

  async getBillingToken(): Promise<string | undefined> {
    return this.secrets?.get(BILLING_TOKEN_KEY);
  }

  private async resolveUsername(token: string): Promise<string> {
    let username = this.getUsername();
    if (!username) {
      username = await fetchUsername(token);
      await this.setUsername(username);
    }
    return username;
  }

  async setBillingToken(token: string): Promise<void> {
    if (!token || (!token.startsWith('github_pat_') && !token.startsWith('ghp_'))) {
      throw new Error('Invalid token format. Expected a GitHub token starting with "github_pat_" or "ghp_".');
    }
    await this.secrets?.store(BILLING_TOKEN_KEY, token);
    this._billingTokenNoticeConsumed = false;
  }

  async clearBillingToken(): Promise<void> {
    await this.secrets?.delete(BILLING_TOKEN_KEY);
    this._billingTokenNoticeConsumed = false;
  }

  /**
   * Fetches premium billing usage and returns all usage items.
   * Returns cached data if available and recent; otherwise fetches fresh.
   */
  async fetchBillingRange(force: boolean = false): Promise<DailyBillingUsageItem[]> {
    if (!force && this.lastBillingFetchedAt > 0
        && Date.now() - this.lastBillingFetchedAt < MIN_FETCH_INTERVAL_MS) {
      return this.cachedPremiumBillingItems;
    }

    // Coalesce concurrent callers into the same in-flight request
    if (this.billingInFlight) { return this.billingInFlight; }

    this.billingInFlight = this.doFetchBillingRange();
    try {
      return await this.billingInFlight;
    } finally {
      this.billingInFlight = null;
    }
  }

  private async doFetchBillingRange(): Promise<DailyBillingUsageItem[]> {
    // Always resolve username via OAuth token to avoid caching billing PAT's identity
    const oauthToken = await resolveToken(false);
    if (!oauthToken) { throw new Error('No token available for billing API'); }

    const billingToken = await this.getBillingToken() ?? oauthToken;
    const username = await this.resolveUsername(oauthToken);

    try {
      const items = await fetchPremiumBillingUsage(billingToken, username);
      this._billingTokenNeeded = false;
      this._billingTokenNoticeConsumed = false;
      this.cachedPremiumBillingItems = items;
      return items;
    } catch (e) {
      if (isBillingPermissionError(e)) { this._billingTokenNeeded = true; }
      throw e;
    } finally {
      this.lastBillingFetchedAt = Date.now();
    }
  }

  /** Returns cached premium billing items (if any) without fetching. */
  getCachedPremiumBilling(): DailyBillingUsageItem[] {
    return this.cachedPremiumBillingItems;
  }

  isBillingTokenNeeded(): boolean {
    return this._billingTokenNeeded;
  }

  /** Returns true once per new billing-token-needed event, then suppresses until reset. */
  shouldShowBillingTokenNotice(): boolean {
    if (this._billingTokenNeeded && !this._billingTokenNoticeConsumed) {
      this._billingTokenNoticeConsumed = true;
      return true;
    }
    return false;
  }

  isNoTokenAvailable(): boolean {
    return this._noTokenAvailable;
  }

  /** Returns true once per new no-token event, then suppresses until reset. */
  shouldShowNoTokenNotice(): boolean {
    if (this._noTokenAvailable && !this._noTokenNoticeConsumed) {
      this._noTokenNoticeConsumed = true;
      return true;
    }
    return false;
  }

  getModels(): UsageModel[] {
    return this.globalState.get<UsageModel[]>(STORAGE_KEY_MODELS, []);
  }

  getLimit(): number {
    return this.globalState.get<number>(STORAGE_KEY_LIMIT, DEFAULT_LIMIT);
  }

  getUsername(): string | undefined {
    return this.globalState.get<string>(STORAGE_KEY_USERNAME);
  }

  async setUsername(username: string): Promise<void> {
    await this.globalState.update(STORAGE_KEY_USERNAME, username);
  }

  async addModel(model: UsageModel): Promise<void> {
    const entry = { ...model };
    entry.grossAmount = parseFloat(
      ((entry.includedRequests + entry.billedRequests) * COST_PER_PREMIUM_REQUEST).toFixed(2),
    );
    const models = this.getModels();
    const existing = models.findIndex(
      (m) => m.model.toLowerCase() === entry.model.toLowerCase(),
    );
    if (existing >= 0) {
      models[existing] = entry;
    } else {
      models.push(entry);
    }
    await this.globalState.update(STORAGE_KEY_MODELS, models);
  }

  async removeModel(modelName: string): Promise<void> {
    const models = this.getModels().filter(
      (m) => m.model.toLowerCase() !== modelName.toLowerCase(),
    );
    await this.globalState.update(STORAGE_KEY_MODELS, models);
  }

  async setLimit(limit: number): Promise<void> {
    await this.globalState.update(STORAGE_KEY_LIMIT, limit);
  }

  async resetData(): Promise<void> {
    await this.globalState.update(STORAGE_KEY_MODELS, []);
    await this.globalState.update(STORAGE_KEY_LIMIT, DEFAULT_LIMIT);
    await this.globalState.update(STORAGE_KEY_USERNAME, undefined);
    this.cachedQuota = null;
    this.cachedPremiumBillingItems = [];
    this.lastFetchedAt = 0;
    this.lastBillingFetchedAt = 0;
    this.lastError = null;
  }
}
