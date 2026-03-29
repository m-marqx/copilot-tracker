import * as vscode from 'vscode';
import { UsageData } from './dataService';
import { calculatePacing, classifyStatus, getDailyPacingProgress, getRecommendedPercentage } from './pacing';

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

export function updateStatusBar(item: vscode.StatusBarItem, data: UsageData): void {
  const { totalUsage, limit, remaining } = data;
  const pacing = calculatePacing(totalUsage, limit, new Date(new Date().getTime() + new Date().getTimezoneOffset() * 60000), remaining);
  const status = classifyStatus(pacing);

  const allowance = pacing.dailyAllowance;
  const mult = pacing.multiplier;

  // Daily pacing progress (0–1, clamped)
  const dailyProgress = getDailyPacingProgress(totalUsage, limit);
  const filledCount = Math.round(dailyProgress * 10);
  const emptyCount = 10 - filledCount;
  const bar = '█'.repeat(filledCount) + '░'.repeat(emptyCount);

  // Actual usage % (1 decimal)
  const actualPct = ((totalUsage / limit) * 100).toFixed(1);
  // Target usage % (0 decimals)
  const targetPct = Math.round(getRecommendedPercentage() * 100);

  item.text = `$(copilot) [${bar}] ${actualPct}% / ${targetPct}%`;

  // Color based on status
  if (status === 'exhausted' || pacing.overageCost > 0) {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (status === 'over-budget') {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    item.backgroundColor = undefined;
  }

  // Rich tooltip
  const usedPct = ((totalUsage / limit) * 100).toFixed(1);
  const formattedPacingBanked = pacing.banked.toFixed(1);
  const bankedStr = pacing.banked >= 0
    ? `+${formattedPacingBanked} saved`
    : `${formattedPacingBanked} overspent`;
  const sourceLabel = data.dataSource === 'api' ? 'Live from API' : 'Manual data';

  item.tooltip = [
    `Copilot Premium: ${totalUsage} / ${limit} (${usedPct}%)`,
    `Daily allowance: ${allowance} requests/day`,
    `${bankedStr} vs expected`,
    `Projected: ~${pacing.projectedEnd.toFixed(1)} by month end`,
    `Day ${pacing.dayOfMonth}/${pacing.daysInMonth} · ${pacing.daysRemaining} days left`,
    `Source: ${sourceLabel}`,
    `actual vs target: ${actualPct}% used vs ${targetPct}% target`,
  ].join('\n');

  item.show();
}
