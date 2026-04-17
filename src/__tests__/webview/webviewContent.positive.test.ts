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

describe('webviewContent – positive tests', () => {
  const nonce = 'test-nonce-12345';

  describe('getWebviewHtml()', () => {
    it('should return a complete HTML document', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('<!DOCTYPE html>');
      expect(html).to.include('<html');
      expect(html).to.include('</html>');
    });

    it('should include Content-Security-Policy with nonce', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include(`nonce-${nonce}`);
      expect(html).to.include('Content-Security-Policy');
    });

    it('should include nonce in script tag (CSS is external, no inline styles)', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.not.include('<style nonce=');
      expect(html).to.include(`<script nonce="${nonce}">`);
    });

    it('should include the title "Premium request analytics"', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('Premium request analytics');
    });

    it('should include refresh button', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('id="refreshBtn"');
      expect(html).to.include('Refresh');
    });

    it('should include daily allowance card', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('Daily Allowance');
      expect(html).to.include('/day');
    });

    it('should include usage card with progress bar', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('Included premium requests consumed');
      expect(html).to.include('progress-bar-fill');
    });

    it('should include remaining card', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('Remaining');
      expect(html).to.include('days left');
    });

    it('should include daily budget section', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('Daily rates');
      expect(html).to.include('Forecast');
      expect(html).to.include('Base rate');
      expect(html).to.include('Multiplier');
    });

    it('should include billing summary section', () => {
      const html = getWebviewHtml(makeUsageData(), makeMockWebview(), nonce);
      expect(html).to.include('Billing summary');
      expect(html).to.include('billingTable');
    });

    it('should render usage numbers from data', () => {
      const html = getWebviewHtml(makeUsageData({ totalUsage: 175 }), makeMockWebview(), nonce);
      expect(html).to.include('175');
    });

    it('should render limit input with current value', () => {
      const html = getWebviewHtml(makeUsageData({ limit: 500 }), makeMockWebview(), nonce);
      expect(html).to.include('value="500"');
    });

    it('should show Live badge for API data source', () => {
      const html = getWebviewHtml(makeUsageData({ dataSource: 'api' }), makeMockWebview(), nonce);
      expect(html).to.include('Live');
      expect(html).to.include('Live usage data from GitHub Copilot API');
    });

    it('should show Manual badge for manual data source', () => {
      const html = getWebviewHtml(makeUsageData({ dataSource: 'manual' }), makeMockWebview(), nonce);
      expect(html).to.include('Manual');
    });

    it('should show correct status emoji for ahead status', () => {
      const html = getWebviewHtml(makeUsageData({ totalUsage: 10, limit: 300, remaining: 290 }), makeMockWebview(), nonce);
      expect(html).to.include('🚀');
    });

    it('should show correct status emoji for exhausted status', () => {
      const html = getWebviewHtml(makeUsageData({ totalUsage: 300, limit: 300, remaining: 0 }), makeMockWebview(), nonce);
      expect(html).to.include('💀');
    });

    it('should show daily usage in Daily Rates section when available', () => {
      const html = getWebviewHtml(makeUsageData({ dailyUsage: 15 }), makeMockWebview(), nonce);
      expect(html).to.include("Today's usage (API)");
      expect(html).to.include('15');
    });

    it('should render daily usage inside the Daily Rates card, not Forecast', () => {
      const html = getWebviewHtml(makeUsageData({ dailyUsage: 42 }), makeMockWebview(), nonce);
      // Daily rates section comes first, Forecast second
      const dailyRatesStart = html.indexOf('Daily rates');
      const forecastStart = html.indexOf('Forecast');
      const dailyUsagePos = html.indexOf("Today's usage (API)");
      expect(dailyRatesStart).to.be.greaterThan(-1);
      expect(forecastStart).to.be.greaterThan(-1);
      expect(dailyUsagePos).to.be.greaterThan(dailyRatesStart);
      expect(dailyUsagePos).to.be.lessThan(forecastStart);
    });

    it('should show billed total when > 0', () => {
      const html = getWebviewHtml(makeUsageData({ billedTotal: 12.50 }), makeMockWebview(), nonce);
      expect(html).to.include('Billed total');
      expect(html).to.include('$12.50');
    });

    it('should show overage info when usage exceeds limit', () => {
      const html = getWebviewHtml(
        makeUsageData({ totalUsage: 350, limit: 300, remaining: 0 }),
        makeMockWebview(),
        nonce,
      );
      expect(html).to.include('Overage');
      expect(html).to.include('reqs');
    });
  });
});
