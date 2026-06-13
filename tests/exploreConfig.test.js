import { describe, it, expect } from 'vitest';
import { EXPLORE_CONFIG } from '../src/core/AutoExploreService.js';
import { CYCLE_DETECTION_MAX_PERIOD } from '../src/core/config.js';

// v2.4: the confirmation pass tags/penalizes cycles up to confirmCycleMaxPeriod. The worker can only
// *detect* a cycle whose period is ≤ CYCLE_DETECTION_MAX_PERIOD, so the explore threshold must stay
// within the worker's detection horizon — otherwise a cycler longer than the worker can see would
// silently pass as a non-cyclic find.
describe('EXPLORE_CONFIG ↔ worker cycle detection', () => {
    it('confirmCycleMaxPeriod stays within the worker detection horizon', () => {
        expect(EXPLORE_CONFIG.confirmCycleMaxPeriod).toBeLessThanOrEqual(CYCLE_DETECTION_MAX_PERIOD);
    });

    it('confirmCycleMaxPeriod is large enough to catch the period-84 reference trap', () => {
        expect(EXPLORE_CONFIG.confirmCycleMaxPeriod).toBeGreaterThanOrEqual(84);
    });

    it('the confirmation burst is longer than the screening burst', () => {
        expect(EXPLORE_CONFIG.confirmTicks).toBeGreaterThan(EXPLORE_CONFIG.evalTicks);
    });

    it('warmupTicks leaves a non-trivial measurement window in both bursts', () => {
        expect(EXPLORE_CONFIG.warmupTicks).toBeGreaterThanOrEqual(0);
        expect(EXPLORE_CONFIG.warmupTicks).toBeLessThan(EXPLORE_CONFIG.evalTicks);
    });

    // v2.7: the generation budget defaults to unlimited so existing behaviour is unchanged.
    it('maxGenerations defaults to 0 (unlimited)', () => {
        expect(EXPLORE_CONFIG.maxGenerations).toBe(0);
    });
});
