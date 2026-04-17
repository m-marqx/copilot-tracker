import { expect } from 'chai';
import { getWebviewHtml } from '../../webview/webviewContent';
import { UsageData } from '../../dataService';

function makeMockWebview(): any {
  return {
    cspSource: 'https://mock.csp',
    asWebviewUri: (uri: any) => uri,
  };
}

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

describe('webviewContent – negative tests', () => {
  const nonce = 'test-nonce-neg';

  describe('getWebviewHtml() edge cases', () => {
    it('should render without errors when totalUsage is 0', () => {
      const html = getWebviewHtml(
        makeUsageData({ totalUsage: 0, remaining: 300 }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.include('<!DOCTYPE html>');
      expect(html).to.include('0');
    });

    it('should render without errors when limit is 0', () => {
      const html = getWebviewHtml(
        makeUsageData({ totalUsage: 0, limit: 0, remaining: 0 }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.include('<!DOCTYPE html>');
    });

    it('should render without errors when models array is empty', () => {
      const html = getWebviewHtml(
        makeUsageData({ models: [] }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.include('<!DOCTYPE html>');
    });

    it('should handle missing optional fields (no resetAt, no dailyUsage)', () => {
      const data: UsageData = {
        totalUsage: 100,
        limit: 300,
        remaining: 200,
        billedTotal: 0,
        models: [],
        dateRange: 'Apr 1 – Apr 16',
        dataSource: 'manual',
      };
      const html = getWebviewHtml(data, makeMockWebview(), nonce);
      expect(html).to.include('<!DOCTYPE html>');
      expect(html).to.match(/id="dailyUsageRow"[^>]*style="display:none"/);
    });

    it('should handle very large numbers without NaN', () => {
      const html = getWebviewHtml(
        makeUsageData({ totalUsage: 999999, limit: 1000000, remaining: 1 }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.not.include('NaN');
      expect(html).to.not.include('undefined');
    });

    it('should handle lastFetchedAt = undefined', () => {
      const html = getWebviewHtml(
        makeUsageData({ lastFetchedAt: undefined }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.include('Never');
    });

    it('should hide daily usage row when dailyUsage is undefined', () => {
      const html = getWebviewHtml(
        makeUsageData({ dailyUsage: undefined }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.match(/id="dailyUsageRow"[^>]*style="display:none"/);
    });

    it('should hide billed total row when billedTotal is 0', () => {
      const html = getWebviewHtml(
        makeUsageData({ billedTotal: 0 }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.match(/id="billedTotalRow"[^>]*style="display:none"/);
    });

    it('should hide overage row when under limit', () => {
      const html = getWebviewHtml(
        makeUsageData({ totalUsage: 100, limit: 300 }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.match(/id="overageRow"[^>]*style="display:none"/);
    });
  });
});
