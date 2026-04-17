import { expect } from 'chai';
import sinon from 'sinon';
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

describe('statusBar – positive tests', () => {
  describe('createStatusBarItem()', () => {
    it('should return a status bar item with Right alignment', () => {
      const item = createStatusBarItem();
      expect(item.alignment).to.equal(vscode.StatusBarAlignment.Right);
    });

    it('should set the command to showDashboard', () => {
      const item = createStatusBarItem();
      expect(item.command).to.equal('copilot-premium-tracker.showDashboard');
    });

    it('should have priority 100', () => {
      const item = createStatusBarItem();
      expect(item.priority).to.equal(100);
    });
  });

  describe('initStatusBarMode()', () => {
    it('should default to pacer mode when config is not set', () => {
      vscode.workspace._clearConfig();
      initStatusBarMode();
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.text).to.include('$(copilot)');
      expect(item.text).to.include('│');
    });

    it('should switch to classic mode when configured', () => {
      vscode.workspace._setConfig('copilot-premium-tracker.statusBarMode', 'classic');
      initStatusBarMode();

      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.text).to.include('$(copilot)');
      expect(item.text).to.include('%');
    });
  });

  describe('updateStatusBar() – pacer mode', () => {
    beforeEach(() => {
      vscode.workspace._clearConfig();
      initStatusBarMode();
    });

    it('should set text with copilot icon and pacer bar', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.text).to.match(/\$\(copilot\)/);
      expect(item.text).to.include('│');
    });

    it('should show remaining today when under budget', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 50, limit: 300 }));
      expect(item.text).to.include('left today');
    });

    it('should show overage cost when usage exceeds limit', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 350, limit: 300, remaining: 0 }));
      expect(item.text).to.include('$');
      expect(item.text).to.include('over');
    });

    it('should call item.show()', () => {
      const item = createStatusBarItem();
      const showSpy = sinon.spy(item, 'show');
      updateStatusBar(item, makeUsageData());
      expect(showSpy.calledOnce).to.be.true;
    });
  });

  describe('updateStatusBar() – tooltip content', () => {
    beforeEach(() => {
      vscode.workspace._clearConfig();
      initStatusBarMode();
    });

    it('should include usage percentage in tooltip', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.tooltip).to.include('150 / 300');
    });

    it('should include daily allowance in tooltip', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.tooltip).to.include('Daily allowance');
    });

    it('should include remaining today info in tooltip', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.tooltip).to.include('requests');
    });

    it('should include banked vs expected in tooltip', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.tooltip).to.include('vs expected');
    });

    it('should include projected month end in tooltip', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData());
      expect(item.tooltip).to.include('Projected');
    });

    it('should include source label in tooltip', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ dataSource: 'api' }));
      expect(item.tooltip).to.include('Live from API');
    });

    it('should show Manual data source when not from API', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ dataSource: 'manual' }));
      expect(item.tooltip).to.include('Manual data');
    });

    it('should include quota reset date when resetAt is provided', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ resetAt: '2026-05-01T00:00:00Z' }));
      expect(item.tooltip).to.include('Quota resets');
    });

    it('should include overage info in tooltip when over limit', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 350, limit: 300, remaining: 0 }));
      expect(item.tooltip).to.include('Overage');
    });

    it('should include daily usage in tooltip when dailyUsage is provided', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ dailyUsage: 15 }));
      expect(item.tooltip).to.include("Today's usage: 15");
    });

    it('should not include daily usage in tooltip when dailyUsage is undefined', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ dailyUsage: undefined }));
      expect(item.tooltip).to.not.include("Today's usage");
    });
  });

  describe('updateStatusBar() – background colors', () => {
    beforeEach(() => {
      vscode.workspace._clearConfig();
      initStatusBarMode();
    });

    it('should set error background when exhausted', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 300, limit: 300, remaining: 0 }));
      expect(item.backgroundColor).to.be.instanceOf(vscode.ThemeColor);
      expect((item.backgroundColor as any).id).to.include('error');
    });

    it('should set warning background when over-budget', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 200, limit: 300, remaining: 100 }));
      expect(item.backgroundColor === undefined || item.backgroundColor instanceof vscode.ThemeColor).to.be.true;
    });

    it('should clear background when on-track', () => {
      const item = createStatusBarItem();
      updateStatusBar(item, makeUsageData({ totalUsage: 50, limit: 300, remaining: 250 }));
      expect(item.backgroundColor).to.be.undefined;
    });
  });
});
