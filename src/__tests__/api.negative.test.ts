import { expect } from 'chai';
import {
  TokenExpiredError,
  RateLimitError,
  NotFoundError,
  isBillingPermissionError,
} from '../api';

describe('api – negative tests', () => {
  describe('error classes edge cases', () => {
    it('TokenExpiredError should have a stack trace', () => {
      const err = new TokenExpiredError();
      expect(err.stack).to.be.a('string');
      expect(err.stack!.length).to.be.greaterThan(0);
    });

    it('RateLimitError with NaN retryAfter keeps the value', () => {
      const err = new RateLimitError('msg', NaN);
      expect(err.retryAfter).to.be.NaN;
    });

    it('RateLimitError with 0 retryAfter', () => {
      const err = new RateLimitError('msg', 0);
      expect(err.retryAfter).to.equal(0);
    });

    it('NotFoundError with empty URL', () => {
      const err = new NotFoundError('');
      expect(err.message).to.include('not found');
    });
  });

  describe('isBillingPermissionError() edge cases', () => {
    it('should return false for a plain string', () => {
      expect(isBillingPermissionError('not an error')).to.be.false;
    });

    it('should return false for a number', () => {
      expect(isBillingPermissionError(404)).to.be.false;
    });

    it('should return false for generic Error', () => {
      expect(isBillingPermissionError(new Error('/settings/billing/'))).to.be.false;
    });

    it('should return true only for NotFoundError with billing path', () => {
      const billingErr = new NotFoundError('/users/x/settings/billing/premium_request/usage');
      expect(isBillingPermissionError(billingErr)).to.be.true;

      const otherErr = new NotFoundError('/users/x/repos');
      expect(isBillingPermissionError(otherErr)).to.be.false;
    });
  });
});
