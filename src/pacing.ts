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
  startOfTodayQuota: number;
  endOfTodayQuota: number;
  remainingToday: number;
}

export type UsageStatus = 'on-track' | 'over-budget' | 'ahead' | 'exhausted';

export const COST_PER_PREMIUM_REQUEST = 0.04;

export function getDaysInMonth(date: Date = new Date()): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Enhanced pacing calculation inspired by copilot_tracer_extension.
 *
 * Calculates daily-budget metrics: daily allowance, multiplier,
 * banked/overspent requests, projected end-of-month, and time-of-day
 * adjusted averages.
 *
 * All date operations use UTC methods to ensure consistent pacing
 * regardless of the user's local timezone.
 */
export function calculatePacing(
  usedRequests: number,
  monthlyLimit: number,
  now: Date = new Date(),
  remainingTotal?: number,
): PacingResult {
  const daysInMonth = getDaysInMonth(now);
  const dayOfMonth = now.getUTCDate();
  const daysRemaining = Math.max(1, daysInMonth - dayOfMonth + 1);

  const baseDailyBudget = monthlyLimit / daysInMonth;
  const remaining = remainingTotal !== undefined
    ? remainingTotal
    : Math.max(0, monthlyLimit - usedRequests);
  const dailyAllowance = Math.max(0, remaining) / daysRemaining;

  // Time-of-day progress (0.0 at midnight UTC, ~1.0 at end of day)
  const timeOfDayProgress = (now.getUTCHours() * 60 + now.getUTCMinutes()) / (24 * 60);

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

  const startOfTodayQuota = (dayOfMonth - 1) * baseDailyBudget;
  const endOfTodayQuota = dayOfMonth * baseDailyBudget;
  const remainingToday = Math.max(0, endOfTodayQuota - usedRequests);

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
    startOfTodayQuota,
    endOfTodayQuota,
    remainingToday,
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

/**
 * Generates a ░█ pacer bar with a │ today-position marker.
 *
 * Layout: `████│░░░░░░░` — █ = used portion, ░ = remaining, │ = today marker
 *
 * - When usage is below today's marker: gap of ░ between █ and │
 * - When usage is past today's marker: █ extends beyond │
 * - When over monthly limit: all █ past the marker, with overage cost shown separately
 */
export function generatePacerBar(pacing: PacingResult, width: number = 12): string {
  const { usedRequests, monthlyLimit, dayOfMonth, daysInMonth } = pacing;

  const usedRatio = Math.min(usedRequests / Math.max(1, monthlyLimit), 1);
  const todayRatio = dayOfMonth / daysInMonth;

  const usedChars = Math.round(usedRatio * width);
  const todayPos = Math.min(width - 1, Math.round(todayRatio * (width - 1)));

  let bar = '';
  for (let i = 0; i < width; i++) {
    if (i === todayPos) {
      bar += '│';
    } else if (i < usedChars) {
      bar += '█';
    } else {
      bar += '░';
    }
  }

  return bar;
}
