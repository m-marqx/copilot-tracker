import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  showDashboard,
  hasDashboard,
  disposeDashboard,
  setMessageHandler,
  postMessageToWebview,
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

describe('webviewProvider – integration tests', () => {
  afterEach(() => {
    disposeDashboard();
  });

  describe('full lifecycle: create → update → dispose', () => {
    it('should create, update, and dispose without errors', () => {
      const uri = vscode.Uri.file('/test');

      // Create
      expect(hasDashboard()).to.be.false;
      showDashboard(makeUsageData(), uri);
      expect(hasDashboard()).to.be.true;

      // Update with new data
      showDashboard(makeUsageData({ totalUsage: 200, remaining: 100 }), uri);
      expect(hasDashboard()).to.be.true;

      // Send message
      postMessageToWebview({ type: 'billingRangeResult', items: [] });

      // Dispose
      disposeDashboard();
      expect(hasDashboard()).to.be.false;
    });
  });

  describe('message handler lifecycle', () => {
    it('should set handler before and after show', () => {
      const uri = vscode.Uri.file('/test');
      setMessageHandler(async () => {});
      showDashboard(makeUsageData(), uri);
      setMessageHandler(async () => {});
      expect(hasDashboard()).to.be.true;
    });
  });

  describe('multiple show/dispose cycles', () => {
    it('should handle repeated open/close cycles', () => {
      const uri = vscode.Uri.file('/test');

      for (let i = 0; i < 3; i++) {
        showDashboard(makeUsageData({ totalUsage: i * 50 }), uri);
        expect(hasDashboard()).to.be.true;
        disposeDashboard();
        expect(hasDashboard()).to.be.false;
      }
    });
  });

  describe('postMessage with various data shapes', () => {
    it('should handle billingRangeResult with items', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      postMessageToWebview({
        type: 'billingRangeResult',
        items: [
          { product: 'copilot', sku: 'premium', model: 'claude', unitType: 'request',
            pricePerUnit: 0.04, grossQuantity: 50, grossAmount: 2.0,
            discountQuantity: 0, discountAmount: 0, netQuantity: 50, netAmount: 2.0 },
        ],
      });
      // No throw
    });

    it('should handle billingRangeResult with error', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      postMessageToWebview({
        type: 'billingRangeResult',
        items: [],
        error: 'No token available',
        tokenNeeded: true,
      });
      // No throw
    });
  });
});
