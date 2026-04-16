import axios, { AxiosResponse } from 'axios';
import * as vscode from 'vscode';

const GITHUB_API_BASE = 'https://api.github.com';

export class TokenExpiredError extends Error {
  constructor() {
    super('GitHub token is invalid or has been revoked (401)');
    this.name = 'TokenExpiredError';
  }
}

export class RateLimitError extends Error {
  retryAfter: number;
  constructor(message: string, retryAfter: number = 60) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class NotFoundError extends Error {
  constructor(url: string) {
    super(`GitHub resource not found: ${url}`);
    this.name = 'NotFoundError';
  }
}

export interface CopilotQuota {
  used: number;
  remaining: number;
  quota: number;
  resetAt: string;
}

export interface BillingUsageItem {
  sku: string;
  grossQuantity: number;
  netQuantity?: number;
  unitType?: string;
  pricePerUnit?: number;
}

export interface DailyBillingUsageItem {
  product: string;
  sku: string;
  model: string;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  grossAmount: number;
  discountQuantity: number;
  discountAmount: number;
  netQuantity: number;
  netAmount: number;
}

const axiosInstance = axios.create({
  baseURL: GITHUB_API_BASE,
  validateStatus: () => true,
});

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
  };
}

function throwOnHttpError(response: AxiosResponse, url: string): void {
  const { status } = response;
  if (status >= 200 && status < 300) { return; }
  if (status === 401) { throw new TokenExpiredError(); }
  if (status === 404) { throw new NotFoundError(url); }
  if (status === 429) {
    const retryHeader = response.headers['retry-after'] as string | undefined;
    const retryAfter = retryHeader ? parseInt(retryHeader, 10) : 60;
    throw new RateLimitError(
      'GitHub API rate limit exceeded (429)',
      isNaN(retryAfter) ? 60 : retryAfter,
    );
  }
  throw new Error(`GitHub API ${status}: ${url}`);
}

function handleRateLimit(response: AxiosResponse, url: string): void {
  if (response.status === 429) {
    const retryHeader = response.headers['retry-after'] as string | undefined;
    const retryAfter = retryHeader ? parseInt(retryHeader, 10) : 60;
    throw new RateLimitError(
      `Rate limited on ${url}`,
      isNaN(retryAfter) ? 60 : retryAfter,
    );
  }
}

/**
 * Fetches quota from the internal Copilot API for Individual plans.
 * Endpoint: GET /copilot_internal/v2/token
 *
 * This returns `limited_user_quotas.copilot_premium_interaction.storage`
 * with used/remaining/quota data.
 */
export async function fetchCopilotInternalQuota(
  token: string,
): Promise<CopilotQuota | null> {
  const url = `/copilot_internal/v2/token`;
  const response = await axiosInstance.get(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      'editor-version': 'vscode/1.90.0',
      'editor-plugin-version': 'copilot-tracker/1.0.0',
    },
  });

  handleRateLimit(response, url);
  if (response.status < 200 || response.status >= 300) { return null; }

  const data = response.data as Record<string, unknown>;
  const lq = data?.limited_user_quotas as Record<string, unknown> | undefined;
  if (!lq) { return null; }

  const cpi = lq?.copilot_premium_interaction as Record<string, unknown> | undefined;
  const storage = cpi?.storage as {
    quota?: number;
    remaining?: number;
    used?: number;
  } | undefined;
  if (!storage || storage.quota === undefined) { return null; }

  return {
    used: storage.used ?? 0,
    remaining: storage.remaining ?? 0,
    quota: storage.quota,
    resetAt: (cpi?.quota_reset_at as string) ?? '',
  };
}


export async function fetchCopilotBusinessQuota(
  token: string,
): Promise<CopilotQuota | null> {
  const url = `/copilot_internal/user`;
  const response = await axiosInstance.get(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
    },
  });

  handleRateLimit(response, url);
  if (response.status < 200 || response.status >= 300) { return null; }

  const data = response.data as {
    quota_reset_date?: string;
    quota_reset_date_utc?: string;
    quota_snapshots?: {
      premium_interactions?: {
        entitlement?: number;
        remaining?: number;
        quota_remaining?: number;
        unlimited?: boolean;
      };
    };
  };

  const pi = data?.quota_snapshots?.premium_interactions;
  if (!pi || pi.unlimited || pi.entitlement === undefined) { return null; }

  const quota = pi.entitlement;
  const remaining = pi.remaining ?? (pi.quota_remaining ?? 0);
  const used = quota - remaining;

  return {
    used,
    remaining,
    quota,
    resetAt: data.quota_reset_date_utc ?? data.quota_reset_date ?? '',
  };
}

/** Resolves the authenticated user's login name from the GitHub API. */
export async function fetchUsername(token: string): Promise<string> {
  const url = `/user`;
  const response = await axiosInstance.get(url, { headers: buildHeaders(token) });
  throwOnHttpError(response, url);
  return (response.data as { login: string }).login;
}

/**
 * Fetches usage from the billing API (PAT fallback for individual plans).
 * Endpoint: GET /users/{username}/settings/billing/usage/summary
 */
export async function fetchBillingUsage(
  token: string,
  username: string,
): Promise<{ usedRequests: number; items: BillingUsageItem[] }> {
  const url = `/users/${encodeURIComponent(username)}/settings/billing/usage/summary`;
  const response = await axiosInstance.get(url, { headers: buildHeaders(token) });
  throwOnHttpError(response, url);

  const data = response.data as { usageItems?: BillingUsageItem[] };
  const copilotItems = (data.usageItems ?? []).filter(
    (item) => item.sku === 'copilot_premium_request',
  );
  const usedRequests = copilotItems.reduce((sum, item) => sum + item.grossQuantity, 0);

  return { usedRequests, items: copilotItems };
}

/**
 * Resolves a GitHub token for API access.
 *
 * Strategy:
 * 1. Try VS Code's built-in GitHub authentication (no manual PAT needed).
 *    - silent mode for background refreshes
 *    - createIfNone for user-initiated refreshes
 * 2. Returns undefined if no session is available.
 */
export async function resolveToken(
  interactive: boolean,
): Promise<string | undefined> {
  try {
    let session = await vscode.authentication.getSession(
      'github',
      ['user:email'],
      { silent: true },
    );

    if (!session && interactive) {
      session = await vscode.authentication.getSession(
        'github',
        ['user:email'],
        { createIfNone: true },
      );
    }

    if (session) { return session.accessToken; }
  } catch {
    // VS Code auth unavailable or user cancelled
  }

  return undefined;
}

/**
 * Fetches billing usage from the premium_request/usage endpoint.
 * Endpoint: GET /users/{username}/settings/billing/premium_request/usage
 */
export async function fetchPremiumBillingUsage(
  token: string,
  username: string,
): Promise<DailyBillingUsageItem[]> {
  const url = `/users/${encodeURIComponent(username)}/settings/billing/premium_request/usage`;
  const response = await axiosInstance.get(url, {
    headers: buildHeaders(token),
  });
  throwOnHttpError(response, url);

  const data = response.data as { usageItems?: DailyBillingUsageItem[] };
  return data.usageItems ?? [];
}
