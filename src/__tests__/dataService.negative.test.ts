import { expect } from 'chai';
import { MockMemento, MockSecretStorage } from './__mocks__/vscode';
import { DataService } from '../dataService';

describe('dataService – negative tests', () => {
  let globalState: MockMemento;
  let secrets: MockSecretStorage;
  let ds: DataService;

  beforeEach(() => {
    globalState = new MockMemento();
    secrets = new MockSecretStorage();
    ds = new DataService(globalState as any, secrets as any);
  });

  describe('getUsageData() edge cases', () => {
    it('should handle zero limit gracefully', async () => {
      await ds.setLimit(0);
      const data = ds.getUsageData();
      expect(data.limit).to.equal(0);
      expect(data.remaining).to.equal(0);
    });

    it('should handle no models with default limit', () => {
      const data = ds.getUsageData();
      expect(data.totalUsage).to.equal(0);
      expect(data.models).to.be.an('array').that.is.empty;
    });

    it('should not produce NaN in any field', () => {
      const data = ds.getUsageData();
      for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'number') {
          expect(val, `${key} should not be NaN`).to.not.be.NaN;
        }
      }
    });
  });

  describe('setBillingToken() validation', () => {
    it('should reject empty token', async () => {
      try {
        await ds.setBillingToken('');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Invalid token format');
      }
    });

    it('should reject token with invalid prefix', async () => {
      try {
        await ds.setBillingToken('invalid_token_12345');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('Invalid token format');
      }
    });
  });

  describe('removeModel() edge cases', () => {
    it('should not throw when removing non-existent model', async () => {
      await ds.removeModel('NonExistent');
      expect(ds.getModels()).to.have.lengthOf(0);
    });
  });

  describe('getLastError()', () => {
    it('should return null when no error has occurred', () => {
      expect(ds.getLastError()).to.be.null;
    });
  });

  describe('DataService without secrets', () => {
    it('should work when secrets is undefined', () => {
      const dsNoSecrets = new DataService(globalState as any);
      const data = dsNoSecrets.getUsageData();
      expect(data).to.have.property('totalUsage');
    });

    it('should return undefined for getBillingToken when no secrets', async () => {
      const dsNoSecrets = new DataService(globalState as any);
      const token = await dsNoSecrets.getBillingToken();
      expect(token).to.be.undefined;
    });
  });

  describe('notice flag behavior', () => {
    it('shouldShowBillingTokenNotice should return false twice in a row initially', () => {
      expect(ds.shouldShowBillingTokenNotice()).to.be.false;
      expect(ds.shouldShowBillingTokenNotice()).to.be.false;
    });

    it('shouldShowNoTokenNotice should return false twice in a row initially', () => {
      expect(ds.shouldShowNoTokenNotice()).to.be.false;
      expect(ds.shouldShowNoTokenNotice()).to.be.false;
    });
  });
});
