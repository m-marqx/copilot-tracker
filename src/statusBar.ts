import * as vscode from 'vscode';
import { UsageData } from './dataService';
import { calculatePacing, classifyStatus, generatePacerBar } from './pacing';

export function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    'copilotPremiumTracker',
    vscode.StatusBarAlignment.Right,
    100
  );
  item.command = 'copilot-premium-tracker.showDashboard';
  item.name = 'Copilot Premium Tracker';
  return item;
}

let cachedMode: 'pacer' | 'classic' = 'pacer';

export function initStatusBarMode(): void {
  const config = vscode.workspace.getConfiguration('copilot-premium-tracker');
  const mode = config.get<string>('statusBarMode', 'pacer');
  cachedMode = mode === 'classic' ? 'classic' : 'pacer';
}

function getStatusBarMode(): 'pacer' | 'classic' {
  return cachedMode;
}

export function updateStatusBar(item: vscode.StatusBarItem, data: UsageData, now: Date = new Date()): void {
  const { totalUsage, limit, remaining } = data;
  const pacing = calculatePacing(totalUsage, limit, now, remaining);
  const status = classifyStatus(pacing);
  const mode = getStatusBarMode();

  if (mode === 'pacer') {
    renderPacerMode(item, data, pacing);
  } else {
    renderClassicMode(item, data, pacing);
  }

  // Color based on status (shared)
  if (status === 'exhausted' || pacing.overageCost > 0) {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (status === 'over-budget') {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    item.backgroundColor = undefined;
  }

  // Rich tooltip (shared, includes remaining-today)
  const usedPct = ((totalUsage / limit) * 100).toFixed(1);
  const targetPct = Math.round((pacing.dayOfMonth / pacing.daysInMonth) * 100);
  const formattedPacingBanked = pacing.banked.toFixed(1);
  const bankedStr = pacing.banked >= 0
    ? `+${formattedPacingBanked} saved`
    : `${formattedPacingBanked} overspent`;
  const sourceLabel = data.dataSource === 'api' ? 'Live from API' : 'Manual data';
  const remainTodayStr = pacing.remainingToday > 0
    ? `~${Math.floor(pacing.remainingToday)} requests left today`
    : `Over today's budget by ~${Math.abs(Math.floor(pacing.endOfTodayQuota - pacing.usedRequests))} requests`;

  const tooltipLines = [
    `Copilot Premium: ${totalUsage} / ${limit} (${usedPct}%)`,
    `Daily allowance: ${pacing.dailyAllowance.toFixed(1)} requests/day`,
    remainTodayStr,
    ...(data.dailyUsage !== undefined ? [`Today's usage: ${data.dailyUsage}`] : []),
    `${bankedStr} vs expected`,
    `Projected: ~${pacing.projectedEnd.toFixed(1)} by month end`,
    `Day ${pacing.dayOfMonth}/${pacing.daysInMonth} \u00b7 ${pacing.daysRemaining} days left`,
    `Source: ${sourceLabel}`,
    `Actual vs target: ${usedPct}% used vs ${targetPct}% target`,
  ];
  if (data.resetAt) {
    const resetLabel = new Date(data.resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    tooltipLines.push(`Quota resets: ${resetLabel}`);
  }
  if (pacing.overageCost > 0) {
    tooltipLines.splice(3, 0, `\ud83d\udcb0 Overage: ${pacing.overageRequests} requests ($${pacing.overageCost.toFixed(2)})`);
  }
  item.tooltip = tooltipLines.join('\n');

  item.show();
}

function renderPacerMode(
  item: vscode.StatusBarItem,
  data: UsageData,
  pacing: ReturnType<typeof calculatePacing>,
): void {
  const bar = generatePacerBar(pacing);

  if (pacing.overageCost > 0) {
    item.text = `$(copilot) ${bar} $${pacing.overageCost.toFixed(2)} over`;
  } else if (pacing.remainingToday > 0) {
    item.text = `$(copilot) ${bar} ~${Math.floor(pacing.remainingToday)} left today`;
  } else {
    const debt = Math.abs(Math.floor(pacing.endOfTodayQuota - pacing.usedRequests));
    item.text = `$(copilot) ${bar} -${debt} behind`;
  }
}

function renderClassicMode(
  item: vscode.StatusBarItem,
  data: UsageData,
  pacing: ReturnType<typeof calculatePacing>,
): void {
  const { totalUsage, limit } = data;

  // Daily pacing progress from PacingResult (0–1, clamped)
  const dailyProgress = pacing.baseDailyBudget > 0
    ? Math.min(Math.max(0, (totalUsage - pacing.startOfTodayQuota) / pacing.baseDailyBudget), 1)
    : 0;
  const filledCount = Math.round(dailyProgress * 10);
  const emptyCount = 10 - filledCount;
  const bar = '\u2588'.repeat(filledCount) + '\u2591'.repeat(emptyCount);

  const actualPct = ((totalUsage / limit) * 100).toFixed(1);
  const targetPct = Math.round((pacing.dayOfMonth / pacing.daysInMonth) * 100);

  item.text = `$(copilot) [${bar}] ${actualPct}% / ${targetPct}%`;
}
