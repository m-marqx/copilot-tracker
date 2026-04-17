import { expect } from 'chai';
import sinon from 'sinon';
import {
  TokenExpiredError,
  RateLimitError,
  NotFoundError,
  isBillingPermissionError,
} from '../api';

describe('api – positive tests', () => {
  describe('TokenExpiredError', () => {
    it('should have correct name and message', () => {
      const err = new TokenExpiredError();
      expect(err.name).to.equal('TokenExpiredError');
      expect(err.message).to.include('401');
    });

    it('should be instanceof Error', () => {
      const err = new TokenExpiredError();
      expect(err).to.be.instanceOf(Error);
    });
  });

  describe('RateLimitError', () => {
    it('should have correct name and default retryAfter', () => {
      const err = new RateLimitError('rate limited');
      expect(err.name).to.equal('RateLimitError');
      expect(err.retryAfter).to.equal(60);
    });

    it('should accept custom retryAfter', () => {
      const err = new RateLimitError('rate limited', 120);
      expect(err.retryAfter).to.equal(120);
    });

    it('should be instanceof Error', () => {
      const err = new RateLimitError('rate limited');
      expect(err).to.be.instanceOf(Error);
    });
  });

  describe('NotFoundError', () => {
    it('should include the URL in the message', () => {
      const err = new NotFoundError('/some/endpoint');
      expect(err.name).to.equal('NotFoundError');
      expect(err.message).to.include('/some/endpoint');
    });

    it('should be instanceof Error', () => {
      const err = new NotFoundError('/url');
      expect(err).to.be.instanceOf(Error);
    });
  });

  describe('isBillingPermissionError()', () => {
    it('should return true for NotFoundError with billing URL', () => {
      const err = new NotFoundError('/users/octocat/settings/billing/usage/summary');
      expect(isBillingPermissionError(err)).to.be.true;
    });

    it('should return false for NotFoundError without billing URL', () => {
      const err = new NotFoundError('/user');
      expect(isBillingPermissionError(err)).to.be.false;
    });

    it('should return false for non-NotFoundError', () => {
      expect(isBillingPermissionError(new Error('something'))).to.be.false;
    });

    it('should return false for null/undefined', () => {
      expect(isBillingPermissionError(null)).to.be.false;
      expect(isBillingPermissionError(undefined)).to.be.false;
    });
  });
});
