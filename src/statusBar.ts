import * as vscode from 'vscode';
import { UsageData } from './dataService';
import { getDailyPacingProgress, getRecommendedPercentage } from './pacing';

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
  const { totalUsage, limit } = data;

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

  // Color thresholds based on overall pacing
  const overallPacing = totalUsage / (getRecommendedPercentage() * limit) || 0;

  if (overallPacing > 1.0) {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    item.tooltip = `Copilot Premium: Over pace! ${actualPct}% used vs ${targetPct}% target.`;
  } else if (overallPacing > 0.8) {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.tooltip = `Copilot Premium: Nearing pace limit. ${actualPct}% used vs ${targetPct}% target.`;
  } else {
    item.backgroundColor = undefined;
    item.tooltip = `Copilot Premium: ${actualPct}% used vs ${targetPct}% target. On track.`;
  }

  item.show();
}
