import { expect } from 'chai';
import { MockMemento, MockSecretStorage } from './__mocks__/vscode';
import { DataService, UsageData } from '../dataService';

describe('dataService – positive tests', () => {
  let globalState: MockMemento;
  let secrets: MockSecretStorage;
  let ds: DataService;

  beforeEach(() => {
    globalState = new MockMemento();
    secrets = new MockSecretStorage();
    ds = new DataService(globalState as any, secrets as any);
  });

  describe('getUsageData() – manual mode', () => {
    it('should return default values when no data is set', () => {
      const data = ds.getUsageData();
      expect(data.totalUsage).to.equal(0);
      expect(data.limit).to.equal(300);
      expect(data.remaining).to.equal(300);
      expect(data.dataSource).to.equal('manual');
      expect(data.models).to.be.an('array').that.is.empty;
    });

    it('should reflect added models in totalUsage', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      await ds.addModel({ model: 'GPT-4o', includedRequests: 30, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      const data = ds.getUsageData();
      expect(data.totalUsage).to.equal(80);
      expect(data.remaining).to.equal(220);
    });

    it('should compute billedTotal from model billedAmount', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 10, grossAmount: 2.4, billedAmount: 0.40 });
      const data = ds.getUsageData();
      expect(data.billedTotal).to.equal(0.40);
    });

    it('should include dateRange string', () => {
      const data = ds.getUsageData();
      expect(data.dateRange).to.be.a('string');
      expect(data.dateRange).to.include('–');
    });

    it('should have dailyUsage undefined when no daily billing cached', () => {
      const data = ds.getUsageData();
      expect(data.dailyUsage).to.be.undefined;
    });
  });

  describe('model management', () => {
    it('should add a model', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      const models = ds.getModels();
      expect(models).to.have.lengthOf(1);
      expect(models[0].model).to.equal('Claude');
    });

    it('should update existing model (case-insensitive)', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      await ds.addModel({ model: 'claude', includedRequests: 75, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      const models = ds.getModels();
      expect(models).to.have.lengthOf(1);
      expect(models[0].includedRequests).to.equal(75);
    });

    it('should remove a model', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      await ds.removeModel('Claude');
      expect(ds.getModels()).to.have.lengthOf(0);
    });

    it('should remove model case-insensitively', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      await ds.removeModel('claude');
      expect(ds.getModels()).to.have.lengthOf(0);
    });

    it('should compute grossAmount on addModel', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 10, grossAmount: 0, billedAmount: 0.40 });
      const models = ds.getModels();
      // (50 + 10) * 0.04 = 2.40
      expect(models[0].grossAmount).to.equal(2.40);
    });
  });

  describe('limit management', () => {
    it('should return default limit of 300', () => {
      expect(ds.getLimit()).to.equal(300);
    });

    it('should update limit', async () => {
      await ds.setLimit(500);
      expect(ds.getLimit()).to.equal(500);
    });
  });

  describe('username management', () => {
    it('should return undefined when no username set', () => {
      expect(ds.getUsername()).to.be.undefined;
    });

    it('should store and return username', async () => {
      await ds.setUsername('octocat');
      expect(ds.getUsername()).to.equal('octocat');
    });
  });

  describe('billing token management', () => {
    it('should accept valid PAT token', async () => {
      await ds.setBillingToken('github_pat_XXXX');
      const token = await ds.getBillingToken();
      expect(token).to.equal('github_pat_XXXX');
    });

    it('should accept classic token', async () => {
      await ds.setBillingToken('ghp_XXXX');
      const token = await ds.getBillingToken();
      expect(token).to.equal('ghp_XXXX');
    });

    it('should clear billing token', async () => {
      await ds.setBillingToken('github_pat_XXXX');
      await ds.clearBillingToken();
      const token = await ds.getBillingToken();
      expect(token).to.be.undefined;
    });
  });

  describe('resetData()', () => {
    it('should clear all data back to defaults', async () => {
      await ds.addModel({ model: 'Claude', includedRequests: 50, billedRequests: 0, grossAmount: 0, billedAmount: 0 });
      await ds.setLimit(500);
      await ds.setUsername('octocat');
      await ds.resetData();

      expect(ds.getModels()).to.have.lengthOf(0);
      expect(ds.getLimit()).to.equal(300);
      expect(ds.getUsername()).to.be.undefined;
    });
  });

  describe('getCachedDailyBilling()', () => {
    it('should return empty array initially', () => {
      expect(ds.getCachedDailyBilling()).to.be.an('array').that.is.empty;
    });
  });

  describe('getCachedPremiumBilling()', () => {
    it('should return empty array initially', () => {
      expect(ds.getCachedPremiumBilling()).to.be.an('array').that.is.empty;
    });
  });

  describe('forceRefresh()', () => {
    it('should reset timing flags without throwing', () => {
      ds.forceRefresh();
      // Should not throw
      expect(ds.getLastError()).to.be.null;
    });
  });

  describe('notice flags', () => {
    it('isBillingTokenNeeded should be false initially', () => {
      expect(ds.isBillingTokenNeeded()).to.be.false;
    });

    it('shouldShowBillingTokenNotice should be false initially', () => {
      expect(ds.shouldShowBillingTokenNotice()).to.be.false;
    });

    it('isNoTokenAvailable should be false initially', () => {
      expect(ds.isNoTokenAvailable()).to.be.false;
    });

    it('shouldShowNoTokenNotice should be false initially', () => {
      expect(ds.shouldShowNoTokenNotice()).to.be.false;
    });
  });
});
