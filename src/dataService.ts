import * as vscode from 'vscode';
import {
  CopilotQuota,
  DailyBillingUsageItem,
  fetchCopilotInternalQuota,
  fetchCopilotBusinessQuota,
  fetchBillingUsage,
  fetchPremiumBillingUsage,
  fetchDailyPremiumBillingUsage,
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
  dailyUsage?: number;
}

const STORAGE_KEY_MODELS = 'copilotTracker.models';
const STORAGE_KEY_LIMIT = 'copilotTracker.limit';
const STORAGE_KEY_LIMIT_USER_SET = 'copilotTracker.limitUserSet';
const STORAGE_KEY_USERNAME = 'copilotTracker.username';
const STORAGE_KEY_WINNING_ENDPOINT = 'copilotTracker.winningEndpoint';
type EndpointKey = 'individual' | 'business' | 'billing';
const DEFAULT_LIMIT = 300;

const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const BILLING_TOKEN_KEY = 'copilotTracker.billingToken';

// Cached at module scope so `getUsageData` (called on every status-bar tick)
// doesn't rebuild the formatter twice per call. See PERFORMANCE_REVIEW M3.
const DATE_RANGE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export class DataService {
  private cachedQuota: CopilotQuota | null = null;
  private cachedPremiumBillingItems: DailyBillingUsageItem[] = [];
  private cachedDailyBillingItems: DailyBillingUsageItem[] = [];
  private lastFetchedAt = 0;
  private lastBillingFetchedAt = 0;
  private lastDailyBillingFetchedAt = 0;
  private lastError: string | null = null;
  private quotaInFlight: Promise<CopilotQuota | null> | null = null;
  private billingInFlight: Promise<DailyBillingUsageItem[]> | null = null;
  private dailyBillingInFlight: Promise<DailyBillingUsageItem[]> | null = null;
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
    if (this.quotaInFlight) { return this.quotaInFlight; }

    this.quotaInFlight = this.doFetchFromApi(interactive);
    try {
      return await this.quotaInFlight;
    } finally {
      this.quotaInFlight = null;
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

    // Prefer the endpoint that worked last time. Plan type rarely changes,
    // so re-probing the full chain on every refresh is wasted traffic.
    // See PERFORMANCE_REVIEW C2 / F2.
    const winner = this.globalState.get<EndpointKey>(STORAGE_KEY_WINNING_ENDPOINT);
    const order: EndpointKey[] = ['individual', 'business', 'billing'];
    if (winner) {
      order.sort((a, b) => (a === winner ? -1 : b === winner ? 1 : 0));
    }

    for (const step of order) {
      try {
        if (step === 'individual') {
          const quota = await fetchCopilotInternalQuota(token);
          if (quota) {
            await this.applyQuota(quota);
            await this.rememberWinningEndpoint('individual');
            this.kickOffBillingFetches(token);
            return quota;
          }
        } else if (step === 'business') {
          const quota = await fetchCopilotBusinessQuota(token);
          if (quota) {
            await this.applyQuota(quota);
            await this.rememberWinningEndpoint('business');
            this.kickOffBillingFetches(token);
            return quota;
          }
        } else {
          // Fallback to billing API (requires username).
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
          await this.rememberWinningEndpoint('billing');
          // Still kick off the premium billing details fetch for the dashboard.
          this.kickOffBillingFetches(token, username);
          return quota;
        }
      } catch (e) {
        if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
        if (step === 'billing' && isBillingPermissionError(e)) {
          this._billingTokenNeeded = true;
        }
        // Record the last error for surfacing in the UI, but keep probing
        // remaining endpoints so a flaky Individual endpoint doesn't block
        // a Business user's quota lookup.
        this.lastError = e instanceof Error ? e.message : String(e);
      }
    }

    return null;
  }

  private async rememberWinningEndpoint(key: EndpointKey): Promise<void> {
    if (this.globalState.get<EndpointKey>(STORAGE_KEY_WINNING_ENDPOINT) !== key) {
      await this.globalState.update(STORAGE_KEY_WINNING_ENDPOINT, key);
    }
  }

  private async applyQuota(quota: CopilotQuota): Promise<void> {
    this.cachedQuota = quota;
    this.lastFetchedAt = Date.now();
    this.lastError = null;
    this._billingTokenNeeded = false;
    this._billingTokenNoticeConsumed = false;
    // Only persist the API-reported limit when the user has not explicitly
    // overridden it (CODE_REVIEW H4). Also skip no-op writes (F10 / L4).
    const userSet = this.globalState.get<boolean>(STORAGE_KEY_LIMIT_USER_SET, false);
    if (!userSet && quota.quota > 0 && quota.quota !== this.getLimit()) {
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
    const fmt = (d: Date) => DATE_RANGE_FORMATTER.format(d);

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
      dailyUsage: this.cachedDailyBillingItems.length > 0
        ? this.cachedDailyBillingItems.reduce((sum, i) => sum + (i.grossQuantity ?? 0), 0)
        : undefined,
    };
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /** Bypass the min-fetch-interval check for one immediate refresh. */
  forceRefresh(): void {
    this.lastFetchedAt = 0;
    this.lastBillingFetchedAt = 0;
    this.lastDailyBillingFetchedAt = 0;
    // Do NOT null in-flight promises — that would bypass coalescing
    // and spawn parallel duplicate API requests.
    // The next call after the current request completes will see
    // lastFetchedAt = 0 and trigger a fresh fetch.
  }

  /**
   * Fire-and-forget kickoff for both billing calls. Relies on the per-call
   * coalescers (`billingInFlight` / `dailyBillingInFlight`) and MIN_FETCH_INTERVAL
   * to prevent duplicate traffic — no outer wrapper needed.
   *
   * Accepts the already-resolved OAuth token (and optionally the username)
   * from the caller to avoid re-awaiting `vscode.authentication.getSession`
   * and `GET /user` on every refresh. See PERFORMANCE_REVIEW C3 / F4.
   */
  private kickOffBillingFetches(oauthToken?: string, username?: string): void {
    this.fetchBillingRange(false, oauthToken, username).catch((e) => {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { return; }
      this.lastError = 'Failed to fetch billing details';
    });
    this.fetchDailyBilling(false, oauthToken, username).catch((e) => {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { return; }
    });
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
    // Invalidate cached username so we don't query billing for a previously
    // signed-in account after a token change. See CODE_REVIEW C6.
    await this.globalState.update(STORAGE_KEY_USERNAME, undefined);
    this._billingTokenNoticeConsumed = false;
  }

  async clearBillingToken(): Promise<void> {
    await this.secrets?.delete(BILLING_TOKEN_KEY);
    await this.globalState.update(STORAGE_KEY_USERNAME, undefined);
    this._billingTokenNoticeConsumed = false;
  }

  /**
   * Fetches premium billing usage and returns all usage items.
   * Returns cached data if available and recent; otherwise fetches fresh.
   */
  async fetchBillingRange(
    force: boolean = false,
    oauthToken?: string,
    username?: string,
  ): Promise<DailyBillingUsageItem[]> {
    if (!force && this.lastBillingFetchedAt > 0
        && Date.now() - this.lastBillingFetchedAt < MIN_FETCH_INTERVAL_MS) {
      return this.cachedPremiumBillingItems;
    }

    // Coalesce concurrent callers into the same in-flight request
    if (this.billingInFlight) { return this.billingInFlight; }

    this.billingInFlight = this.doFetchBillingRange(oauthToken, username);
    try {
      return await this.billingInFlight;
    } finally {
      this.billingInFlight = null;
    }
  }

  private async doFetchBillingRange(
    oauthToken?: string,
    username?: string,
  ): Promise<DailyBillingUsageItem[]> {
    // Prefer the caller-provided token/username (already resolved upstream)
    // to avoid duplicate auth/IPC round-trips per refresh.
    const token = oauthToken ?? await resolveToken(false);
    if (!token) { throw new Error('No token available for billing API'); }

    const billingToken = await this.getBillingToken() ?? token;
    const resolvedUsername = username ?? await this.resolveUsername(token);

    try {
      const items = await fetchPremiumBillingUsage(billingToken, resolvedUsername);
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

  /**
   * Fetches daily premium billing usage (current UTC day) and returns all usage items.
   * Returns cached data if available and recent; otherwise fetches fresh.
   */
  async fetchDailyBilling(
    force: boolean = false,
    oauthToken?: string,
    username?: string,
  ): Promise<DailyBillingUsageItem[]> {
    if (!force && this.lastDailyBillingFetchedAt > 0
        && Date.now() - this.lastDailyBillingFetchedAt < MIN_FETCH_INTERVAL_MS) {
      return this.cachedDailyBillingItems;
    }

    if (this.dailyBillingInFlight) { return this.dailyBillingInFlight; }

    this.dailyBillingInFlight = this.doFetchDailyBilling(oauthToken, username);
    try {
      return await this.dailyBillingInFlight;
    } finally {
      this.dailyBillingInFlight = null;
    }
  }

  private async doFetchDailyBilling(
    oauthToken?: string,
    username?: string,
  ): Promise<DailyBillingUsageItem[]> {
    const token = oauthToken ?? await resolveToken(false);
    if (!token) { throw new Error('No token available for daily billing API'); }

    const billingToken = await this.getBillingToken() ?? token;
    const resolvedUsername = username ?? await this.resolveUsername(token);

    try {
      const items = await fetchDailyPremiumBillingUsage(billingToken, resolvedUsername);
      this.cachedDailyBillingItems = items;
      return items;
    } catch (e) {
      if (isBillingPermissionError(e)) { this._billingTokenNeeded = true; }
      throw e;
    } finally {
      this.lastDailyBillingFetchedAt = Date.now();
    }
  }

  /** Returns cached daily billing items (if any) without fetching. */
  getCachedDailyBilling(): DailyBillingUsageItem[] {
    return this.cachedDailyBillingItems;
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
    // Only billed requests incur cost; `includedRequests` are covered by the
    // monthly allowance. See CODE_REVIEW C3.
    entry.grossAmount = parseFloat(
      (entry.billedRequests * COST_PER_PREMIUM_REQUEST).toFixed(2),
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
    // Mark the limit as user-set so `applyQuota` stops auto-overwriting it.
    await this.globalState.update(STORAGE_KEY_LIMIT_USER_SET, true);
  }

  async resetData(): Promise<void> {
    await this.globalState.update(STORAGE_KEY_MODELS, []);
    await this.globalState.update(STORAGE_KEY_LIMIT, DEFAULT_LIMIT);
    await this.globalState.update(STORAGE_KEY_LIMIT_USER_SET, undefined);
    await this.globalState.update(STORAGE_KEY_USERNAME, undefined);
    await this.globalState.update(STORAGE_KEY_WINNING_ENDPOINT, undefined);
    this.cachedQuota = null;
    this.cachedPremiumBillingItems = [];
    this.cachedDailyBillingItems = [];
    this.lastFetchedAt = 0;
    this.lastBillingFetchedAt = 0;
    this.lastDailyBillingFetchedAt = 0;
    this.lastError = null;
  }
}
