import * as vscode from 'vscode';
import {
  CopilotQuota,
  BillingUsageItem,
  DailyBillingUsageItem,
  fetchCopilotInternalQuota,
  fetchCopilotBusinessQuota,
  fetchBillingUsage,
  fetchDailyBillingUsage,
  fetchUsername,
  resolveToken,
  TokenExpiredError,
  RateLimitError,
} from './api';

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
  billingItems: BillingUsageItem[];
}

const STORAGE_KEY_MODELS = 'copilotTracker.models';
const STORAGE_KEY_LIMIT = 'copilotTracker.limit';
const STORAGE_KEY_USERNAME = 'copilotTracker.username';
const DEFAULT_LIMIT = 300;
export const COST_PER_REQUEST = 0.04;

const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const BILLING_TOKEN_KEY = 'copilotTracker.billingToken';

export class DataService {
  private cachedQuota: CopilotQuota | null = null;
  private cachedBillingItems: BillingUsageItem[] = [];
  private lastFetchedAt = 0;
  private lastError: string | null = null;

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

    const token = await resolveToken(interactive);
    if (!token) { return null; }

    // Try internal Individual endpoint first
    try {
      const quota = await fetchCopilotInternalQuota(token);
      if (quota) {
        this.cachedQuota = quota;
        this.lastFetchedAt = Date.now();
        this.lastError = null;
        if (quota.quota > 0) {
          await this.globalState.update(STORAGE_KEY_LIMIT, quota.quota);
        }
        // Also fetch billing details (non-blocking)
        this.fetchBillingItems(token).catch(() => {});
        return quota;
      }
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
    }

    // Try internal Business/Enterprise endpoint
    try {
      const quota = await fetchCopilotBusinessQuota(token);
      if (quota) {
        this.cachedQuota = quota;
        this.lastFetchedAt = Date.now();
        this.lastError = null;
        if (quota.quota > 0) {
          await this.globalState.update(STORAGE_KEY_LIMIT, quota.quota);
        }
        // Also fetch billing details (non-blocking)
        this.fetchBillingItems(token).catch(() => {});
        return quota;
      }
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
    }

    // Fallback to billing API (requires username)
    try {
      let username = this.getUsername();
      if (!username) {
        username = await fetchUsername(token);
        await this.setUsername(username);
      }

      const billingToken = await this.getBillingToken() ?? token;
      const { usedRequests, items } = await fetchBillingUsage(billingToken, username);
      this.cachedBillingItems = items;
      const limit = this.getLimit();
      const quota: CopilotQuota = {
        used: usedRequests,
        remaining: Math.max(0, limit - usedRequests),
        quota: limit,
        resetAt: '',
      };
      this.cachedQuota = quota;
      this.lastFetchedAt = Date.now();
      this.lastError = null;
      return quota;
    } catch (e) {
      if (e instanceof TokenExpiredError || e instanceof RateLimitError) { throw e; }
      this.lastError = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  getUsageData(): UsageData {
    const models = this.getModels();
    const limit = this.getLimit();

    let totalUsage: number;
    let remaining: number;
    let dataSource: 'api' | 'manual';

    if (this.cachedQuota) {
      totalUsage = this.cachedQuota.used;
      remaining = this.cachedQuota.remaining;
      dataSource = 'api';
    } else {
      totalUsage = models.reduce((sum, m) => sum + m.includedRequests, 0);
      remaining = Math.max(0, limit - totalUsage);
      dataSource = 'manual';
    }

    const billedTotal = models.reduce((sum, m) => sum + m.billedAmount, 0);

    const now = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return {
      totalUsage: parseFloat(totalUsage.toFixed(2)),
      limit,
      remaining: parseFloat(remaining.toFixed(2)),
      billedTotal: parseFloat(billedTotal.toFixed(2)),
      models,
      dateRange: `${fmt(monthStart)} – ${fmt(now)}`,
      dataSource,
      lastFetchedAt: this.lastFetchedAt || undefined,
      billingItems: this.cachedBillingItems,
    };
  }

  getLastError(): string | null {
    return this.lastError;
  }

  clearCache(): void {
    this.cachedQuota = null;
    this.cachedBillingItems = [];
    this.lastFetchedAt = 0;
  }

  /** Bypass the min-fetch-interval check without discarding cached data. */
  forceRefresh(): void {
    this.lastFetchedAt = 0;
  }

  private async fetchBillingItems(token: string): Promise<void> {
    try {
      const billingToken = await this.getBillingToken() ?? token;
      let username = this.getUsername();
      if (!username) {
        username = await fetchUsername(token);
        await this.setUsername(username);
      }
      const { items } = await fetchBillingUsage(billingToken, username);
      this.cachedBillingItems = items;
    } catch {
      // Non-blocking — billing details are optional
    }
  }

  async getBillingToken(): Promise<string | undefined> {
    return this.secrets?.get(BILLING_TOKEN_KEY);
  }

  async setBillingToken(token: string): Promise<void> {
    await this.secrets?.store(BILLING_TOKEN_KEY, token);
  }

  async clearBillingToken(): Promise<void> {
    await this.secrets?.delete(BILLING_TOKEN_KEY);
  }

  /**
   * Fetches daily billing data for each day in [startDate, endDate]
   * and aggregates usage items by model.
   */
  async fetchBillingRange(
    startDate: string,
    endDate: string,
  ): Promise<DailyBillingUsageItem[]> {
    const token = await this.getBillingToken() ?? await resolveToken(false);
    if (!token) { throw new Error('No token available for billing API'); }

    let username = this.getUsername();
    if (!username) {
      username = await fetchUsername(token);
      await this.setUsername(username);
    }

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      throw new Error('Invalid date range');
    }

    const aggregated = new Map<string, DailyBillingUsageItem>();
    const current = new Date(start);

    while (current <= end) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      const day = current.getDate();

      try {
        const resp = await fetchDailyBillingUsage(token, username, year, month, day);
        for (const item of resp.usageItems) {
          const key = `${item.sku}::${item.model}`;
          const existing = aggregated.get(key);
          if (existing) {
            existing.grossQuantity += item.grossQuantity;
            existing.grossAmount += item.grossAmount;
            existing.discountQuantity += item.discountQuantity;
            existing.discountAmount += item.discountAmount;
            existing.netQuantity += item.netQuantity;
            existing.netAmount += item.netAmount;
          } else {
            aggregated.set(key, { ...item });
          }
        }
      } catch {
        // Skip days that fail (e.g. future dates, 404s)
      }

      current.setDate(current.getDate() + 1);
    }

    return Array.from(aggregated.values());
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
    model.grossAmount = parseFloat(
      ((model.includedRequests + model.billedRequests) * COST_PER_REQUEST).toFixed(2),
    );
    const models = this.getModels();
    const existing = models.findIndex(
      (m) => m.model.toLowerCase() === model.model.toLowerCase(),
    );
    if (existing >= 0) {
      models[existing] = model;
    } else {
      models.push(model);
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
    this.cachedBillingItems = [];
    this.lastFetchedAt = 0;
    this.lastError = null;
  }
}
