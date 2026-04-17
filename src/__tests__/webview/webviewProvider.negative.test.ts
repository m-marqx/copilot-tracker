import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  showDashboard,
  hasDashboard,
  disposeDashboard,
  postMessageToWebview,
  setMessageHandler,
} from '../../webview/webviewProvider';
import { UsageData } from '../../dataService';

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

describe('webviewProvider – negative tests', () => {
  afterEach(() => {
    disposeDashboard();
  });

  describe('showDashboard() edge cases', () => {
    it('should handle calling showDashboard twice (reveal existing)', () => {
      const uri = vscode.Uri.file('/test');
      showDashboard(makeUsageData(), uri);
      showDashboard(makeUsageData({ totalUsage: 200 }), uri);
      expect(hasDashboard()).to.be.true;
    });

    it('should handle UsageData with all zeros', () => {
      showDashboard(
        makeUsageData({ totalUsage: 0, limit: 0, remaining: 0, billedTotal: 0 }),
        vscode.Uri.file('/test'),
      );
      expect(hasDashboard()).to.be.true;
    });
  });

  describe('disposeDashboard() edge cases', () => {
    it('should be idempotent', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      disposeDashboard();
      disposeDashboard();
      disposeDashboard();
      expect(hasDashboard()).to.be.false;
    });
  });

  describe('postMessageToWebview() edge cases', () => {
    it('should silently no-op after dispose', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      disposeDashboard();
      postMessageToWebview({ type: 'test' });
      // No throw
    });

    it('should handle null message gracefully', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      postMessageToWebview(null);
      // No throw
    });
  });

  describe('setMessageHandler() edge cases', () => {
    it('should allow overwriting handler', () => {
      setMessageHandler(async () => { throw new Error('should not be called'); });
      setMessageHandler(async () => {});
      // No throw
    });
  });
});
