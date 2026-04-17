import { expect } from 'chai';
import {
  calculatePacing,
  classifyStatus,
  generatePacerBar,
  getDaysInMonth,
  getPacingProgress,
  getRecommendedPercentage,
  COST_PER_PREMIUM_REQUEST,
  PacingResult,
} from '../pacing';

describe('pacing – positive tests', () => {
  describe('getDaysInMonth()', () => {
    it('should return 31 for January', () => {
      expect(getDaysInMonth(new Date(Date.UTC(2026, 0, 15)))).to.equal(31);
    });

    it('should return 28 for February (non-leap year)', () => {
      expect(getDaysInMonth(new Date(Date.UTC(2026, 1, 10)))).to.equal(28);
    });

    it('should return 29 for February (leap year)', () => {
      expect(getDaysInMonth(new Date(Date.UTC(2028, 1, 10)))).to.equal(29);
    });

    it('should return 30 for April', () => {
      expect(getDaysInMonth(new Date(Date.UTC(2026, 3, 1)))).to.equal(30);
    });
  });

  describe('calculatePacing()', () => {
    it('should return all required PacingResult fields', () => {
      const result = calculatePacing(100, 300);
      const keys: Array<keyof PacingResult> = [
        'usedRequests', 'monthlyLimit', 'remaining', 'dayOfMonth', 'daysInMonth',
        'daysRemaining', 'baseDailyBudget', 'dailyAllowance', 'avgDailyUsage',
        'expectedByNow', 'banked', 'multiplier', 'projectedEnd', 'timeOfDayProgress',
        'overageRequests', 'overageCost', 'startOfTodayQuota', 'endOfTodayQuota',
        'remainingToday',
      ];
      for (const k of keys) {
        expect(result).to.have.property(k);
        expect(result[k]).to.be.a('number');
      }
    });

    it('should compute baseDailyBudget as limit / daysInMonth', () => {
      const date = new Date(Date.UTC(2026, 3, 15)); // April = 30 days
      const result = calculatePacing(0, 300, date);
      expect(result.baseDailyBudget).to.equal(10);
    });

    it('should compute remaining from limit - used when remainingTotal not provided', () => {
      const result = calculatePacing(100, 300);
      expect(result.remaining).to.equal(200);
    });

    it('should use provided remainingTotal when given', () => {
      const result = calculatePacing(100, 300, new Date(), 180);
      expect(result.remaining).to.equal(180);
    });

    it('should compute positive banked when under-used', () => {
      const date = new Date(Date.UTC(2026, 3, 15, 12, 0)); // April 15, noon
      const budget = 300 / 30; // 10 per day
      const expectedByNow = (14 + 0.5) * budget; // ~145
      const result = calculatePacing(50, 300, date);
      expect(result.banked).to.be.greaterThan(0);
    });

    it('should compute negative banked when over-used', () => {
      const date = new Date(Date.UTC(2026, 3, 5, 12, 0)); // April 5, noon
      // Expected by now ~ 4.5 * 10 = 45, but used 200
      const result = calculatePacing(200, 300, date);
      expect(result.banked).to.be.lessThan(0);
    });

    it('should compute overageRequests when over limit', () => {
      const result = calculatePacing(350, 300);
      expect(result.overageRequests).to.equal(50);
    });

    it('should compute overageCost correctly', () => {
      const result = calculatePacing(350, 300);
      expect(result.overageCost).to.equal(50 * COST_PER_PREMIUM_REQUEST);
    });

    it('should compute zero overageRequests when under limit', () => {
      const result = calculatePacing(100, 300);
      expect(result.overageRequests).to.equal(0);
      expect(result.overageCost).to.equal(0);
    });

    it('should compute multiplier as dailyAllowance / baseDailyBudget', () => {
      const date = new Date(Date.UTC(2026, 3, 15, 0, 0)); // April 15
      const result = calculatePacing(100, 300, date);
      expect(result.multiplier).to.be.a('number');
      expect(result.multiplier).to.be.greaterThan(0);
    });

    it('should compute daysRemaining as at least 1', () => {
      const lastDay = new Date(Date.UTC(2026, 3, 30)); // April 30
      const result = calculatePacing(100, 300, lastDay);
      expect(result.daysRemaining).to.be.greaterThanOrEqual(1);
    });

    it('should compute timeOfDayProgress between 0 and 1', () => {
      const result = calculatePacing(100, 300);
      expect(result.timeOfDayProgress).to.be.greaterThanOrEqual(0);
      expect(result.timeOfDayProgress).to.be.lessThanOrEqual(1);
    });
  });

  describe('getPacingProgress()', () => {
    it('should return 0.5 for 150/300', () => {
      expect(getPacingProgress(150, 300)).to.equal(0.5);
    });

    it('should return 1.0 for 300/300', () => {
      expect(getPacingProgress(300, 300)).to.equal(1.0);
    });

    it('should return > 1.0 for over-limit', () => {
      expect(getPacingProgress(350, 300)).to.be.greaterThan(1.0);
    });

    it('should return 0 when both are 0', () => {
      expect(getPacingProgress(0, 0)).to.equal(0);
    });
  });

  describe('getRecommendedPercentage()', () => {
    it('should return fraction of month elapsed', () => {
      const date = new Date(Date.UTC(2026, 3, 15)); // April 15
      expect(getRecommendedPercentage(date)).to.equal(15 / 30);
    });

    it('should return 1/31 on day 1 of January', () => {
      const date = new Date(Date.UTC(2026, 0, 1));
      expect(getRecommendedPercentage(date)).to.be.closeTo(1 / 31, 0.001);
    });
  });

  describe('classifyStatus()', () => {
    it('should return "exhausted" when remaining is 0', () => {
      const pacing = calculatePacing(300, 300);
      expect(classifyStatus(pacing)).to.equal('exhausted');
    });

    it('should return "ahead" when banked > baseDailyBudget', () => {
      const date = new Date(Date.UTC(2026, 3, 15, 12, 0));
      const pacing = calculatePacing(10, 300, date);
      expect(classifyStatus(pacing)).to.equal('ahead');
    });

    it('should return "on-track" for moderate usage', () => {
      // Use mid-month with usage proportional to expected
      const date = new Date(Date.UTC(2026, 3, 15, 12, 0));
      const expectedByNow = (14 + 0.5) * (300 / 30); // ~145
      const pacing = calculatePacing(Math.round(expectedByNow), 300, date);
      expect(classifyStatus(pacing)).to.equal('on-track');
    });

    it('should return "over-budget" when banked is negative but not exhausted', () => {
      const date = new Date(Date.UTC(2026, 3, 5, 12, 0));
      const pacing = calculatePacing(200, 300, date);
      expect(classifyStatus(pacing)).to.equal('over-budget');
    });
  });

  describe('generatePacerBar()', () => {
    it('should return a string of the specified width', () => {
      const pacing = calculatePacing(150, 300);
      const bar = generatePacerBar(pacing, 12);
      expect(bar).to.have.lengthOf(12);
    });

    it('should contain the today marker │', () => {
      const pacing = calculatePacing(150, 300);
      const bar = generatePacerBar(pacing);
      expect(bar).to.include('│');
    });

    it('should contain █ characters for used portion', () => {
      const pacing = calculatePacing(150, 300);
      const bar = generatePacerBar(pacing);
      expect(bar).to.include('█');
    });

    it('should contain ░ characters for remaining portion', () => {
      const pacing = calculatePacing(50, 300);
      const bar = generatePacerBar(pacing);
      expect(bar).to.include('░');
    });

    it('should work with custom width', () => {
      const pacing = calculatePacing(150, 300);
      const bar = generatePacerBar(pacing, 20);
      expect(bar).to.have.lengthOf(20);
    });
  });
});
