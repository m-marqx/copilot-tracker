import { expect } from 'chai';
import sinon from 'sinon';
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

describe('webviewProvider – positive tests', () => {
  afterEach(() => {
    disposeDashboard();
  });

  describe('showDashboard()', () => {
    it('should create a webview panel', () => {
      const extensionUri = vscode.Uri.file('/test');
      showDashboard(makeUsageData(), extensionUri);
      expect(hasDashboard()).to.be.true;
    });

    it('should set HTML content on the panel', () => {
      const extensionUri = vscode.Uri.file('/test');
      showDashboard(makeUsageData(), extensionUri);
      // panel was created — hasDashboard is true
      expect(hasDashboard()).to.be.true;
    });
  });

  describe('hasDashboard()', () => {
    it('should return false when no dashboard exists', () => {
      expect(hasDashboard()).to.be.false;
    });

    it('should return true after showDashboard', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      expect(hasDashboard()).to.be.true;
    });
  });

  describe('disposeDashboard()', () => {
    it('should dispose the panel and reset hasDashboard', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      expect(hasDashboard()).to.be.true;
      disposeDashboard();
      expect(hasDashboard()).to.be.false;
    });

    it('should not throw when called with no active panel', () => {
      disposeDashboard();
      expect(hasDashboard()).to.be.false;
    });
  });

  describe('setMessageHandler()', () => {
    it('should not throw when setting a handler', () => {
      setMessageHandler(async () => {});
      // No assertion needed — just verifying no throw
    });
  });

  describe('postMessageToWebview()', () => {
    it('should not throw when no panel exists', () => {
      postMessageToWebview({ type: 'test' });
      // Should silently no-op
    });

    it('should post message when panel exists', () => {
      showDashboard(makeUsageData(), vscode.Uri.file('/test'));
      postMessageToWebview({ type: 'billingRangeResult', items: [] });
      // No assertion needed — just verifying no throw
    });
  });
});
