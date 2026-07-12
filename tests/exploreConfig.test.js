import { describe, it, expect } from 'vitest';
import { EXPLORE_CONFIG, IC_SUITE } from '../src/core/AutoExploreService.js';
import { CYCLE_DETECTION_MAX_PERIOD } from '../src/core/config.js';
import { FIND_THRESHOLD_MIN, FIND_THRESHOLD_MAX } from '../src/core/analysis/ScoringPresets.js';

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

    // v3.1: the default threshold must sit inside the advanced slider's clamp range, or the UI
    // could never represent (or share-links could silently alter) the default behavior.
    it('findThreshold lies within the advanced-slider bounds', () => {
        expect(EXPLORE_CONFIG.findThreshold).toBeGreaterThanOrEqual(FIND_THRESHOLD_MIN);
        expect(EXPLORE_CONFIG.findThreshold).toBeLessThanOrEqual(FIND_THRESHOLD_MAX);
    });
});

// The worker registers the cluster strategy under the key 'clusters' (plural). A cluster IC declared
// with mode 'cluster' silently falls back to density-1.0 (a saturated, instantly-killed grid), so the
// cluster ICs MUST use 'clusters' to actually place clusters. Lock that in.
describe('IC_SUITE initial conditions', () => {
    it('every IC uses a worker-recognised mode (density or clusters)', () => {
        for (const ic of IC_SUITE) {
            expect(['density', 'clusters']).toContain(ic.initialState.mode);
        }
    });

    it('includes the chaos / sparse / seed / clusters conditions', () => {
        const labels = IC_SUITE.map((ic) => ic.label);
        expect(labels).toEqual(expect.arrayContaining(['chaos', 'sparse', 'seed', 'clusters']));
    });

    it('cluster-based ICs declare a positive cluster count', () => {
        for (const ic of IC_SUITE.filter((c) => c.initialState.mode === 'clusters')) {
            expect(ic.initialState.params.count).toBeGreaterThan(0);
        }
    });
});
