export function getDaysInMonth(date: Date = new Date()): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function getRecommendedPercentage(date: Date = new Date()): number {
  const currentDay = date.getDate();
  const totalDays = getDaysInMonth(date);
  return currentDay / totalDays;
}

export function getPacingProgress(usage: number, limit: number, date: Date = new Date()): number {
  const recommended = getRecommendedPercentage(date);
  const target = recommended * limit;
  if (target === 0) {
    return 0;
  }
  return usage / target;
}

export function getDailyAllowance(limit: number, date: Date = new Date()): number {
  return limit / getDaysInMonth(date);
}

export function getStartOfDayBaseline(limit: number, date: Date = new Date()): number {
  const dailyAllowance = getDailyAllowance(limit, date);
  const currentDay = date.getDate();
  return dailyAllowance * (currentDay - 1);
}

export function getDailyPacingProgress(usage: number, limit: number, date: Date = new Date()): number {
  const dailyAllowance = getDailyAllowance(limit, date);
  const baseline = getStartOfDayBaseline(limit, date);

  if (dailyAllowance === 0) {
    return 0;
  }

  if (usage < baseline) {
    return 0;
  }

  const dayProgress = (usage - baseline) / dailyAllowance;
  return Math.min(dayProgress, 1);
}
