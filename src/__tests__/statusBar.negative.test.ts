import { expect } from 'chai';
import * as vscode from 'vscode';
import { createStatusBarItem, initStatusBarMode, updateStatusBar } from '../statusBar';
import { UsageData } from '../dataService';

function makeUsageData(overrides: Partial<UsageData> = {}): UsageData {
  return {
    totalUsage: 150,
    limit: 300,
    remaining: 150,
    billedTotal: 0,
    models: [],
    dateRange: 'Apr 1, 2026 – Apr 16, 2026',
    dataSource: 'api',
    lastFetchedAt: Date.now(),
    ...overrides,
  };
}

describe('statusBar – negative tests', () => {
  beforeEach(() => {
    vscode.workspace._clearConfig();
    initStatusBarMode();
  });

  describe('updateStatusBar() with edge-case data', () => {
    it('should handle zero limit without division by zero', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 0, limit: 0, remaining: 0 }));
      expect(item.text).to.be.a('string');
      expect(item.tooltip).to.be.a('string');
    });

    it('should handle zero usage with full remaining', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 0, limit: 300, remaining: 300 }));
      expect(item.text).to.include('left today');
    });

    it('should handle usage significantly exceeding limit', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 1000, limit: 300, remaining: 0 }));
      expect(item.text).to.include('over');
      expect(item.tooltip).to.include('Overage');
    });

    it('should handle very large numbers without crashing', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 999999, limit: 1000000, remaining: 1 }));
      expect(item.text).to.be.a('string');
    });
  });

  describe('initStatusBarMode() with invalid config', () => {
    it('should fall back to pacer mode when config is an invalid string', () => {
      vscode.workspace._setConfig('copilot-premium-tracker.statusBarMode', 'invalid');
      initStatusBarMode();

      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.text).to.include('│');
    });

    it('should fall back to pacer mode when config is undefined', () => {
      vscode.workspace._clearConfig();
      initStatusBarMode();

      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.text).to.include('│');
    });
  });

  describe('updateStatusBar() behind/over-today scenarios', () => {
    it('should show behind message when over today budget but under monthly limit', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 280, limit: 300, remaining: 20 }));
      expect(item.text).to.be.a('string');
      expect(item.text).to.match(/left today|behind/);
    });
  });

  describe('updateStatusBar() daily usage edge cases', () => {
    it('should handle dailyUsage of 0 in tooltip', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ dailyUsage: 0 }));
      expect(item.tooltip).to.include("Today's usage: 0");
    });
  });
});
