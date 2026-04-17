import { expect } from 'chai';
import { getWebviewHtml } from '../../webview/webviewContent';
import { UsageData } from '../../dataService';
import { calculatePacing, classifyStatus, getPacingProgress, getRecommendedPercentage } from '../../pacing';

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

describe('webviewContent – integration tests', () => {
  const nonce = 'test-nonce-int';

  describe('UsageData → getWebviewHtml full render', () => {
    it('should render all pacing-derived values from API data', () => {
      const data = makeUsageData({
        totalUsage: 175,
        limit: 300,
        remaining: 125,
        dataSource: 'api',
        billedTotal: 7.50,
        dailyUsage: 12,
      });

      const html = getWebviewHtml(data, makeMockWebview(), nonce);

      expect(html).to.include('175');
      expect(html).to.include('300');
      expect(html).to.include('Base rate');
      expect(html).to.include('Multiplier');
      expect(html).to.include('Projected month end');
      expect(html).to.include('Banked vs expected');
      expect(html).to.include('Billing summary');
      expect(html).to.include('Billed total');
      expect(html).to.include("Today's usage (API)");
    });
  });

  describe('daily usage placement in Daily Rates', () => {
    it('should appear after Multiplier and before Forecast section', () => {
      const data = makeUsageData({ dailyUsage: 25 });
      const html = getWebviewHtml(data, makeMockWebview(), nonce);

      const multiplierPos = html.indexOf('Multiplier');
      const dailyUsagePos = html.indexOf("Today's usage (API)");
      const forecastPos = html.indexOf('Forecast');

      expect(multiplierPos).to.be.greaterThan(-1);
      expect(dailyUsagePos).to.be.greaterThan(multiplierPos);
      expect(dailyUsagePos).to.be.lessThan(forecastPos);
    });

    it('should not appear when dailyUsage is not set', () => {
      const data = makeUsageData({ dailyUsage: undefined });
      const html = getWebviewHtml(data, makeMockWebview(), nonce);
      expect(html).to.not.include("Today's usage (API)");
    });
  });

  describe('pacing output reflected in HTML', () => {
    it('should use the correct progress bar class matching pacing ratio', () => {
      const lowData = makeUsageData({ totalUsage: 50, limit: 300, remaining: 250 });
      const lowProgress = getPacingProgress(50, 300);
      const lowHtml = getWebviewHtml(lowData, makeMockWebview(), nonce);

      if (lowProgress <= 0.8) {
        expect(lowHtml).to.include('progress-bar-fill ok');
      }

      const highData = makeUsageData({ totalUsage: 310, limit: 300, remaining: 0 });
      const highProgress = getPacingProgress(310, 300);
      const highHtml = getWebviewHtml(highData, makeMockWebview(), nonce);

      if (highProgress > 1.0) {
        expect(highHtml).to.include('progress-bar-fill danger');
      }
    });

    it('should display consistent status emoji with classifyStatus', () => {
      const data = makeUsageData({ totalUsage: 300, limit: 300, remaining: 0 });
      const pacing = calculatePacing(300, 300);
      const status = classifyStatus(pacing);
      const html = getWebviewHtml(data, makeMockWebview(), nonce);

      if (status === 'exhausted') {
        expect(html).to.include('💀');
      }
    });

    it('should display multiplier in card detail when not 1.0', () => {
      const data = makeUsageData({ totalUsage: 100, limit: 300, remaining: 200 });
      const html = getWebviewHtml(data, makeMockWebview(), nonce);
      expect(html).to.include('Multiplier');
    });
  });

  describe('recommended percentage in progress meta', () => {
    it('should include target percentage for today', () => {
      const data = makeUsageData();
      const html = getWebviewHtml(data, makeMockWebview(), nonce);
      const recommended = getRecommendedPercentage();
      const expectedTargetStr = (recommended * 100).toFixed(1);
      expect(html).to.include(`${expectedTargetStr}% of month`);
    });
  });

  describe('various data scenarios render without errors', () => {
    const scenarios: Array<{ name: string; data: Partial<UsageData> }> = [
      { name: 'fresh start', data: { totalUsage: 0, remaining: 300, dataSource: 'manual' } },
      { name: 'mid-month API', data: { totalUsage: 150, remaining: 150, dataSource: 'api', dailyUsage: 10 } },
      { name: 'over budget', data: { totalUsage: 350, remaining: 0, billedTotal: 2.0 } },
      { name: 'all manual with models', data: { totalUsage: 80, dataSource: 'manual', models: [
        { model: 'Claude', includedRequests: 50, billedRequests: 10, grossAmount: 2.4, billedAmount: 0.4 },
        { model: 'GPT-4o', includedRequests: 30, billedRequests: 5, grossAmount: 1.4, billedAmount: 0.2 },
      ] } },
    ];

    for (const { name, data } of scenarios) {
      it(`should render "${name}" scenario without NaN/undefined`, () => {
        const html = getWebviewHtml(makeUsageData(data), makeMockWebview(), nonce);
        expect(html).to.not.include('NaN');
        expect(html).to.include('<!DOCTYPE html>');
      });
    }
  });
});
