import { expect } from 'chai';
import {
  calculatePacing,
  classifyStatus,
  generatePacerBar,
  getPacingProgress,
  getRecommendedPercentage,
} from '../pacing';

describe('pacing – integration tests', () => {
  describe('calculatePacing → classifyStatus → generatePacerBar pipeline', () => {
    const scenarios = [
      { name: 'fresh start', used: 0, limit: 300 },
      { name: 'under budget', used: 50, limit: 300 },
      { name: 'on track', used: 150, limit: 300 },
      { name: 'over budget', used: 280, limit: 300 },
      { name: 'exhausted', used: 300, limit: 300 },
      { name: 'overage', used: 400, limit: 300 },
    ];

    for (const { name, used, limit } of scenarios) {
      it(`"${name}" scenario should produce valid pipeline output`, () => {
        const pacing = calculatePacing(used, limit);
        const status = classifyStatus(pacing);
        const bar = generatePacerBar(pacing);

        expect(['on-track', 'over-budget', 'ahead', 'exhausted']).to.include(status);
        expect(bar).to.have.lengthOf(12);
        expect(bar).to.include('│');
      });
    }
  });

  describe('getPacingProgress + getRecommendedPercentage consistency', () => {
    it('under-budget user: progress < recommended early in month', () => {
      const date = new Date(Date.UTC(2026, 3, 25)); // April 25
      const recommended = getRecommendedPercentage(date);
      const progress = getPacingProgress(50, 300);
      // 50/300 ≈ 0.167 should be less than 25/30 ≈ 0.833
      expect(progress).to.be.lessThan(recommended);
    });

    it('over-budget user: progress > recommended', () => {
      const date = new Date(Date.UTC(2026, 3, 5));
      const recommended = getRecommendedPercentage(date);
      const progress = getPacingProgress(280, 300);
      expect(progress).to.be.greaterThan(recommended);
    });
  });

  describe('banked calculation aligns with overage detection', () => {
    it('positive banked should never coexist with exhausted status', () => {
      const pacing = calculatePacing(50, 300);
      const status = classifyStatus(pacing);
      if (pacing.banked > 0) {
        expect(status).to.not.equal('exhausted');
      }
    });

    it('exhausted should always have remaining <= 0', () => {
      const pacing = calculatePacing(300, 300);
      const status = classifyStatus(pacing);
      expect(status).to.equal('exhausted');
      expect(pacing.remaining).to.equal(0);
    });
  });

  describe('month boundary calculations', () => {
    const months = [
      { month: 0, name: 'January', days: 31 },
      { month: 1, name: 'February', days: 28 },
      { month: 3, name: 'April', days: 30 },
    ];

    for (const { month, name, days } of months) {
      it(`${name} should have correct daysInMonth=${days}`, () => {
        const date = new Date(Date.UTC(2026, month, 15));
        const pacing = calculatePacing(100, 300, date);
        expect(pacing.daysInMonth).to.equal(days);
      });
    }
  });

  describe('overage cost accuracy', () => {
    it('should produce cost consistent with COST_PER_PREMIUM_REQUEST', () => {
      const pacing = calculatePacing(350, 300);
      expect(pacing.overageRequests).to.equal(50);
      expect(pacing.overageCost).to.equal(pacing.overageRequests * 0.04);
    });

    it('should produce zero cost when within limit', () => {
      const pacing = calculatePacing(200, 300);
      expect(pacing.overageRequests).to.equal(0);
      expect(pacing.overageCost).to.equal(0);
    });
  });
});
