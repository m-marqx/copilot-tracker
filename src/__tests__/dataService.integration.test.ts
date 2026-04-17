import { expect } from 'chai';
import { MockMemento, MockSecretStorage } from './__mocks__/vscode';
import { DataService, UsageData } from '../dataService';
import { calculatePacing, classifyStatus, getPacingProgress } from '../pacing';

describe('dataService – integration tests', () => {
  let globalState: MockMemento;
  let secrets: MockSecretStorage;
  let ds: DataService;

  beforeEach(() => {
    globalState = new MockMemento();
    secrets = new MockSecretStorage();
    ds = new DataService(globalState as any, secrets as any);
  });

  describe('UsageData → pacing pipeline', () => {
    it('should produce valid pacing from default usage data', () => {
      const data = ds.getUsageData();
      const pacing = calculatePacing(data.totalUsage, data.limit, new Date(), data.remaining);
      expect(pacing.usedRequests).to.equal(0);
      expect(pacing.monthlyLimit).to.equal(300);
      const status = classifyStatus(pacing);
      expect(status).to.equal('ahead');
    });

    it('should produce valid pacing after adding models', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 100, billedRequests: 20, grossAmount: 0, billedAmount: 0.80 });
      await ds.addModel({ model: 'GPT-4o', includedRequests: 80, billedRequests: 5, grossAmount: 0, billedAmount: 0.20 });
      const data = ds.getUsageData();

      expect(data.totalUsage).to.equal(180);
      expect(data.billedTotal).to.equal(1.00);

      const pacing = calculatePacing(data.totalUsage, data.limit, new Date(), data.remaining);
      const progress = getPacingProgress(data.totalUsage, data.limit);
      expect(progress).to.equal(0.6);
      expect(pacing.remaining).to.equal(120);
    });
  });

  describe('limit change affects UsageData.remaining', () => {
    it('should update remaining when limit changes', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 100, billedRequests: 0, grossAmount: 0, billedAmount: 0 });

      await ds.setLimit(300);
      let data = ds.getUsageData();
      expect(data.remaining).to.equal(200);

      await ds.setLimit(150);
      data = ds.getUsageData();
      expect(data.remaining).to.equal(50);

      await ds.setLimit(50);
      data = ds.getUsageData();
      expect(data.remaining).to.equal(0);
    });
  });

  describe('resetData clears all state', () => {
    it('should reset everything and produce fresh UsageData', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 100, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      await ds.setLimit(500);
      await ds.setUsername('octocat');

      await ds.resetData();
      const data = ds.getUsageData();
      expect(data.totalUsage).to.equal(0);
      expect(data.limit).to.equal(300);
      expect(data.models).to.be.empty;
      expect(ds.getUsername()).to.be.undefined;
      expect(ds.getCachedDailyBilling()).to.be.empty;
      expect(ds.getCachedPremiumBilling()).to.be.empty;
    });
  });

  describe('model CRUD cycle', () => {
    it('should add, update, and remove a model', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      expect(ds.getModels()).to.have.lengthOf(1);
      expect(ds.getUsageData().totalUsage).to.equal(50);

      await ds.addModel({ model: 'Claude', includedRequests: 75, billedRequests: 5, grossAmount: 0, billedAmount: 0.20 });
      expect(ds.getModels()).to.have.lengthOf(1);
      expect(ds.getUsageData().totalUsage).to.equal(75);

      await ds.removeModel('Claude');
      expect(ds.getModels()).to.have.lengthOf(0);
      expect(ds.getUsageData().totalUsage).to.equal(0);
    });
  });

  describe('billing token lifecycle', () => {
    it('should set, read, and clear billing token', async () => {
      expect(await ds.getBillingToken()).to.be.undefined;

      await ds.setBillingToken('github_pat_XXXX');
      expect(await ds.getBillingToken()).to.equal('github_pat_XXXX');

      await ds.clearBillingToken();
      expect(await ds.getBillingToken()).to.be.undefined;
    });
  });
});
