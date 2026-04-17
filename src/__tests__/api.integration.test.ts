import { expect } from 'chai';
import {
  TokenExpiredError,
  RateLimitError,
  NotFoundError,
  isBillingPermissionError,
} from '../api';

describe('api – integration tests', () => {
  describe('error hierarchy', () => {
    it('all custom errors should extend Error', () => {
      const errors = [
        new TokenExpiredError(),
        new RateLimitError('rate limited'),
        new NotFoundError('/url'),
      ];
      for (const err of errors) {
        expect(err).to.be.instanceOf(Error);
        expect(err.name).to.be.a('string');
        expect(err.message).to.be.a('string');
      }
    });

    it('custom errors should be distinguishable by instanceof', () => {
      const tokenErr = new TokenExpiredError();
      const rateErr = new RateLimitError('msg');
      const notFoundErr = new NotFoundError('/url');

      expect(tokenErr).to.be.instanceOf(TokenExpiredError);
      expect(tokenErr).to.not.be.instanceOf(RateLimitError);
      expect(tokenErr).to.not.be.instanceOf(NotFoundError);

      expect(rateErr).to.be.instanceOf(RateLimitError);
      expect(rateErr).to.not.be.instanceOf(TokenExpiredError);

      expect(notFoundErr).to.be.instanceOf(NotFoundError);
      expect(notFoundErr).to.not.be.instanceOf(RateLimitError);
    });
  });

  describe('isBillingPermissionError in try-catch flow', () => {
    it('should correctly identify billing error in catch block', () => {
      try {
        throw new NotFoundError('/users/octocat/settings/billing/usage/summary');
      } catch (e) {
        expect(isBillingPermissionError(e)).to.be.true;
      }
    });

    it('should correctly reject non-billing error in catch block', () => {
      try {
        throw new TokenExpiredError();
      } catch (e) {
        expect(isBillingPermissionError(e)).to.be.false;
      }
    });

    it('should correctly reject generic error in catch block', () => {
      try {
        throw new Error('network failure');
      } catch (e) {
        expect(isBillingPermissionError(e)).to.be.false;
      }
    });
  });

  describe('RateLimitError retryAfter usage pattern', () => {
    it('should allow scheduling retry logic', () => {
      const err = new RateLimitError('rate limited', 30);
      const nextRetryMs = err.retryAfter * 1000;
      expect(nextRetryMs).to.equal(30_000);
    });
  });
});
