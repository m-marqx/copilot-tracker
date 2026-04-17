import { expect } from 'chai';
import * as vscode from 'vscode';
import { createStatusBarItem, initStatusBarMode, updateStatusBar } from '../statusBar';
import { calculatePacing, classifyStatus } from '../pacing';
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

describe('statusBar – integration tests', () => {
  describe('full lifecycle: create → init → update', () => {
    it('should produce a valid display in pacer mode', () => {
      vscode.workspace._clearConfig();
      const item = createStatusBarItem();
      initStatusBarMode();
      updateStatusBar(item, makeUsageData());

      expect(item.text).to.include('$(copilot)');
      expect(item.tooltip).to.be.a('string');
      expect(item.tooltip!.toString().length).to.be.greaterThan(0);
    });

    it('should produce a valid display in classic mode', () => {
      vscode.workspace._setConfig('copilot-premium-tracker.statusBarMode', 'classic');
      const item = createStatusBarItem();
      initStatusBarMode();
      updateStatusBar(item, makeUsageData());

      expect(item.text).to.include('$(copilot)');
      expect(item.text).to.include('%');
    });
  });

  describe('mode switching', () => {
    it('should switch from pacer to classic mode and update output', () => {
      const item = createStatusBarItem();

      vscode.workspace._clearConfig();
      initStatusBarMode();
      updateStatusBar(item, makeUsageData());
      const pacerText = item.text;
      expect(pacerText).to.include('│');

      vscode.workspace._setConfig('copilot-premium-tracker.statusBarMode', 'classic');
      initStatusBarMode();
      updateStatusBar(item, makeUsageData());
      const classicText = item.text;
      expect(classicText).to.include('%');

      expect(pacerText).to.not.equal(classicText);
    });
  });

  describe('consistency with real pacing calculations', () => {
    it('should display status consistent with calculatePacing output', () => {
      vscode.workspace._clearConfig();
      initStatusBarMode();

      const data = makeUsageData({ totalUsage: 50, limit: 300, remaining: 250 });
      const pacing = calculatePacing(50, 300, new Date(), 250);
      const status = classifyStatus(pacing);

      const item = createStatusBarItem();
      updateStatusBar(item, data);

      if (status === 'ahead' || status === 'on-track') {
        expect(item.backgroundColor).to.be.undefined;
      }

      expect(item.tooltip).to.include('50 / 300');
    });

    it('should show error background when calculatePacing indicates exhausted', () => {
      vscode.workspace._clearConfig();
      initStatusBarMode();

      const data = makeUsageData({ totalUsage: 300, limit: 300, remaining: 0 });
      const item = createStatusBarItem();
      updateStatusBar(item, data);

      expect(item.backgroundColor).to.be.instanceOf(vscode.ThemeColor);
      expect((item.backgroundColor as any).id).to.include('error');
    });

    it('should show overage cost from real pacing calculation', () => {
      vscode.workspace._clearConfig();
      initStatusBarMode();

      const data = makeUsageData({ totalUsage: 350, limit: 300, remaining: 0 });
      const pacing = calculatePacing(350, 300);

      const item = createStatusBarItem();
      updateStatusBar(item, data);

      expect(item.text).to.include('over');
      expect(item.tooltip).to.include(`${pacing.overageRequests}`);
    });
  });

  describe('UsageData shape compatibility', () => {
    it('should handle UsageData with all optional fields present', () => {
      const data = makeUsageData({
        lastFetchedAt: Date.now(),
        resetAt: '2026-05-01T00:00:00Z',
        dailyUsage: 15,
      });

      const item = createStatusBarItem();
      initStatusBarMode();
      updateStatusBar(item, data);

      expect(item.text).to.be.a('string');
      expect(item.tooltip).to.include('Quota resets');
      expect(item.tooltip).to.include("Today's usage: 15");
    });

    it('should handle UsageData with no optional fields', () => {
      const data: UsageData = {
        totalUsage: 100,
        limit: 300,
        remaining: 200,
        billedTotal: 0,
        models: [],
        dateRange: 'Apr 1 – Apr 16',
        dataSource: 'manual',
      };

      const item = createStatusBarItem();
      initStatusBarMode();
      updateStatusBar(item, data);

      expect(item.text).to.be.a('string');
      expect(item.tooltip).to.not.include('Quota resets');
      expect(item.tooltip).to.not.include("Today's usage");
    });
  });
});
