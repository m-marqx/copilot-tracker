/**
 * Regression tests for CODE_REVIEW L4.
 *
 * Covers:
 *  - `retry-after: 0` (and past-date / NaN / missing) does not produce a
 *    0-second retry → `parseRetryAfter`.
 *  - Clock jump keeps `computeNextRefreshDelay` above the hard floor.
 *  - Username cache is invalidated on `setBillingToken` / `clearBillingToken`
 *    (CODE_REVIEW C6).
 */
import { expect } from 'chai';
import { parseRetryAfter } from '../api';
import { computeNextRefreshDelay } from '../extension';
import { MockMemento, MockSecretStorage } from './__mocks__/vscode';
import { DataService } from '../dataService';

const BASE_MS = 10 * 60 * 1000;
const MAX_MS = 60 * 60 * 1000;
const MIN_MS = 30 * 1000;

describe('regressions – CODE_REVIEW L4', () => {
  describe('parseRetryAfter() — retry-after clamping', () => {
    it('clamps "0" to 1 second (prevents tight 429 re-fetch loop)', () => {
      expect(parseRetryAfter('0')).to.equal(1);
    });

    it('clamps a negative value to 1 second', () => {
      expect(parseRetryAfter('-5')).to.equal(1);
    });

    it('returns 60s default when header is missing', () => {
      expect(parseRetryAfter(undefined)).to.equal(60);
    });

    it('returns 60s default when header is non-numeric (e.g. HTTP-date)', () => {
      expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT')).to.equal(60);
    });

    it('passes through a valid numeric value unchanged', () => {
      expect(parseRetryAfter('30')).to.equal(30);
      expect(parseRetryAfter('120')).to.equal(120);
    });
  });

  describe('computeNextRefreshDelay() — clock-jump & floor', () => {
    it('returns at least MIN_REFRESH_DELAY_MS while rate-limited', () => {
      const now = 1_000_000;
      // 1 ms left on the rate-limit deadline → must clamp to floor.
      expect(
        computeNextRefreshDelay(now, now + 1, 0, BASE_MS, MAX_MS, MIN_MS),
      ).to.equal(MIN_MS);
    });

    it('returns base interval when not rate-limited and no failures', () => {
      const now = 1_000_000;
      expect(
        computeNextRefreshDelay(now, 0, 0, BASE_MS, MAX_MS, MIN_MS),
      ).to.equal(BASE_MS);
    });

    it('never returns a negative value after a clock jump past the deadline', () => {
      const now = 2_000_000;
      // Deadline is in the past — should NOT be `rateLimitedUntil - now`.
      const delay = computeNextRefreshDelay(now, now - 5_000, 0, BASE_MS, MAX_MS, MIN_MS);
      expect(delay).to.be.at.least(BASE_MS);
    });

    it('applies exponential backoff floored at MIN and capped at MAX', () => {
      const now = 1_000_000;
      // 1 failure → 2×base = 20 min, within bounds.
      expect(
        computeNextRefreshDelay(now, 0, 1, BASE_MS, MAX_MS, MIN_MS),
      ).to.equal(2 * BASE_MS);
      // 10 failures → would be huge; must cap at MAX.
      expect(
        computeNextRefreshDelay(now, 0, 10, BASE_MS, MAX_MS, MIN_MS),
      ).to.equal(MAX_MS);
    });
  });

  describe('DataService — username cache invalidation (CODE_REVIEW C6)', () => {
    let globalState: MockMemento;
    let secrets: MockSecretStorage;
    let ds: DataService;

    beforeEach(() => {
      globalState = new MockMemento();
      secrets = new MockSecretStorage();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ds = new DataService(globalState as any, secrets as any);
    });

    it('setBillingToken() clears the cached username', async () => {
      await ds.setUsername('old-user');
      expect(ds.getUsername()).to.equal('old-user');

      await ds.setBillingToken('github_pat_rotatedvalue');
      expect(ds.getUsername()).to.be.undefined;
    });

    it('clearBillingToken() clears the cached username', async () => {
      await ds.setUsername('old-user');
      expect(ds.getUsername()).to.equal('old-user');

      await ds.clearBillingToken();
      expect(ds.getUsername()).to.be.undefined;
    });

    it('setBillingToken() rejects invalid formats without touching the username cache', async () => {
      await ds.setUsername('old-user');
      try {
        await ds.setBillingToken('not-a-real-token');
        expect.fail('Should have thrown');
      } catch {
        // expected
      }
      expect(ds.getUsername()).to.equal('old-user');
    });
  });
});
