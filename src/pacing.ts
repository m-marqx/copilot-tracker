export interface PacingResult {
  usedRequests: number;
  monthlyLimit: number;
  remaining: number;
  dayOfMonth: number;
  daysInMonth: number;
  daysRemaining: number;
  baseDailyBudget: number;
  dailyAllowance: number;
  avgDailyUsage: number;
  expectedByNow: number;
  banked: number;
  multiplier: number;
  projectedEnd: number;
  timeOfDayProgress: number;
  overageRequests: number;
  overageCost: number;
}

export type UsageStatus = 'on-track' | 'over-budget' | 'ahead' | 'exhausted';

export const COST_PER_PREMIUM_REQUEST = 0.04;

export function getDaysInMonth(date: Date = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000)): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Enhanced pacing calculation inspired by copilot_tracer_extension.
 *
 * Calculates daily-budget metrics: daily allowance, multiplier,
 * banked/overspent requests, projected end-of-month, and time-of-day
 * adjusted averages.
 */
export function calculatePacing(
  usedRequests: number,
  monthlyLimit: number,
  now: Date = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000),
  remainingTotal?: number,
): PacingResult {
  const daysInMonth = getDaysInMonth(now);
  const dayOfMonth = now.getDate();
  const daysRemaining = Math.max(1, daysInMonth - dayOfMonth + 1);

  const baseDailyBudget = monthlyLimit / daysInMonth;
  const remaining = remainingTotal !== undefined
    ? remainingTotal
    : Math.max(0, monthlyLimit - usedRequests);
  const dailyAllowance = Math.max(0, remaining) / daysRemaining;

  // Time-of-day progress (0.0 at midnight, ~1.0 at end of day)
  const timeOfDayProgress = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);

  // Average daily usage (smoothly includes partial current day)
  const effectiveDaysElapsed = Math.max(0.1, dayOfMonth - 1 + timeOfDayProgress);
  const avgDailyUsage = usedRequests / effectiveDaysElapsed;

  // Expected usage by now (smooth intra-day)
  const expectedByNow = effectiveDaysElapsed * baseDailyBudget;
  const banked = expectedByNow - usedRequests; // positive = saved, negative = overspent

  const multiplier = baseDailyBudget > 0 ? dailyAllowance / baseDailyBudget : 1;
  const projectedEnd = dayOfMonth > 0
    ? (usedRequests / effectiveDaysElapsed) * daysInMonth
    : 0;

  const overageRequests = Math.max(0, usedRequests - monthlyLimit);
  const overageCost = overageRequests * COST_PER_PREMIUM_REQUEST;

  return {
    usedRequests,
    monthlyLimit,
    remaining,
    dayOfMonth,
    daysInMonth,
    daysRemaining,
    baseDailyBudget,
    dailyAllowance,
    avgDailyUsage,
    expectedByNow,
    banked,
    multiplier,
    projectedEnd,
    timeOfDayProgress,
    overageRequests,
    overageCost,
  };
}

/** Classify budget health based on daily pacing. */
export function classifyStatus(result: PacingResult): UsageStatus {
  const { remaining, banked, baseDailyBudget } = result;
  if (remaining <= 0) { return 'exhausted'; }
  if (banked < 0) { return 'over-budget'; }
  if (banked > baseDailyBudget) { return 'ahead'; }
  return 'on-track';
}

// Legacy helpers (kept for backward compat)

export function getRecommendedPercentage(date: Date = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000)): number {
  const currentDay = date.getDate();
  const totalDays = getDaysInMonth(date);
  return currentDay / totalDays;
}

export function getPacingProgress(usage: number, limit: number, date: Date = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000)): number {
  const recommended = getRecommendedPercentage(date);
  const target = recommended * limit;
  if (target === 0) { return 0; }
  return usage / target;
}

export function getDailyAllowance(limit: number, date: Date = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000)): number {
  return limit / getDaysInMonth(date);
}

export function getStartOfDayBaseline(limit: number, date: Date = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000)): number {
  const dailyAllowance = getDailyAllowance(limit, date);
  const currentDay = date.getDate();
  return dailyAllowance * (currentDay - 1);
}

export function getDailyPacingProgress(usage: number, limit: number, date: Date = new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000)): number {
  const dailyAllowance = getDailyAllowance(limit, date);
  const baseline = getStartOfDayBaseline(limit, date);
  if (dailyAllowance === 0) { return 0; }
  if (usage < baseline) { return 0; }
  const dayProgress = (usage - baseline) / dailyAllowance;
  return Math.min(dayProgress, 1);
}
