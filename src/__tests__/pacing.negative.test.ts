import { expect } from 'chai';
import {
  calculatePacing,
  classifyStatus,
  generatePacerBar,
  getDaysInMonth,
  getPacingProgress,
  getRecommendedPercentage,
} from '../pacing';

describe('pacing – negative tests', () => {
  describe('calculatePacing() edge cases', () => {
    it('should handle 0 usage and 0 limit without NaN', () => {
      const result = calculatePacing(0, 0);
      for (const val of Object.values(result)) {
        expect(val).to.not.be.NaN;
      }
    });

    it('should handle usage exceeding limit gracefully', () => {
      const result = calculatePacing(999, 300);
      expect(result.remaining).to.equal(0);
      expect(result.overageRequests).to.equal(699);
    });

    it('should handle first day of month (dayOfMonth = 1)', () => {
      const date = new Date(Date.UTC(2026, 0, 1, 0, 1));
      const result = calculatePacing(0, 300, date);
      expect(result.dayOfMonth).to.equal(1);
      expect(result.avgDailyUsage).to.equal(0);
      for (const val of Object.values(result)) {
        expect(val).to.not.be.NaN;
      }
    });

    it('should handle last day of month', () => {
      const date = new Date(Date.UTC(2026, 0, 31, 23, 59));
      const result = calculatePacing(250, 300, date);
      expect(result.daysRemaining).to.equal(1);
    });

    it('should clamp remaining to 0 when usage exceeds limit without remainingTotal', () => {
      const result = calculatePacing(500, 300);
      expect(result.remaining).to.equal(0);
    });

    it('should handle very small fractional time (midnight start)', () => {
      const date = new Date(Date.UTC(2026, 3, 15, 0, 0));
      const result = calculatePacing(100, 300, date);
      expect(result.timeOfDayProgress).to.equal(0);
    });

    it('should handle multiplier when baseDailyBudget is 0', () => {
      const result = calculatePacing(0, 0);
      expect(result.multiplier).to.equal(1);
    });
  });

  describe('getPacingProgress() edge cases', () => {
    it('should return 0 when limit is 0', () => {
      expect(getPacingProgress(100, 0)).to.equal(0);
    });

    it('should handle negative used (should not happen but be safe)', () => {
      const result = getPacingProgress(-10, 300);
      expect(result).to.be.a('number');
      expect(result).to.be.lessThan(0);
    });
  });

  describe('getRecommendedPercentage() edge cases', () => {
    it('should return close to 1.0 on last day', () => {
      const date = new Date(Date.UTC(2026, 3, 30)); // April 30
      expect(getRecommendedPercentage(date)).to.equal(1.0);
    });
  });

  describe('classifyStatus() edge cases', () => {
    it('should return exhausted even with small banked positive', () => {
      // remaining = 0 takes priority
      const result = calculatePacing(300, 300);
      expect(classifyStatus(result)).to.equal('exhausted');
    });
  });

  describe('generatePacerBar() edge cases', () => {
    it('should handle width of 1', () => {
      const pacing = calculatePacing(150, 300);
      const bar = generatePacerBar(pacing, 1);
      expect(bar).to.have.lengthOf(1);
    });

    it('should handle 0 usage', () => {
      const pacing = calculatePacing(0, 300);
      const bar = generatePacerBar(pacing);
      expect(bar).to.have.lengthOf(12);
      expect(bar).to.not.include('█');
    });

    it('should handle full usage (100%)', () => {
      const date = new Date(Date.UTC(2026, 3, 15));
      const pacing = calculatePacing(300, 300, date);
      const bar = generatePacerBar(pacing);
      expect(bar).to.include('█');
    });
  });
});
