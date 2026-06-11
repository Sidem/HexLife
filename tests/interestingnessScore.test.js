import { describe, it, expect } from 'vitest';
import {
    SCORE_CONFIG,
    scoreSingleIC,
    scoreCandidate,
    ruleUsageDiversity,
} from '../src/core/analysis/InterestingnessScore.js';

// --- Synthetic candidates ----------------------------------------------------
// Each helper returns an EvalMetrics-shaped object (the subset the score reads).
// We assert ORDERING (critical above every degenerate regime), not absolute values,
// per the Phase 3 design notes.

const NUM_CELLS = 16384;

/** A near-critical burst: σ≈1, mid-band entropy, large fluctuations, broad rule usage. */
function noisyCritical() {
    return {
        finalRatio: 0.32,
        finalActiveCount: Math.round(0.32 * NUM_CELLS),
        numCells: NUM_CELLS,
        changed: { mean: 600, variance: 480000, fano: 800, cv: 1.15 },
        blockEntropy: { mean: 0.4, variance: 0.01 },
        sigma: 1.02,
        ruleUsageDelta: uniformDelta(110), // most rules exercised
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
        icLabel: 'chaos',
    };
}

/** Extinct: everything died. */
function dying() {
    return {
        finalRatio: 0,
        finalActiveCount: 0,
        numCells: NUM_CELLS,
        changed: { mean: 0, variance: 0, fano: 0, cv: 0 },
        blockEntropy: { mean: 0.02, variance: 0 },
        sigma: 0,
        ruleUsageDelta: spikeDelta(),
        extinct: true,
        saturated: false,
        cycle: { detected: false, period: 0 },
        icLabel: 'chaos',
    };
}

/** Exploding / saturated: grid filled solid. */
function exploding() {
    return {
        finalRatio: 0.999,
        finalActiveCount: NUM_CELLS,
        numCells: NUM_CELLS,
        changed: { mean: 20, variance: 40, fano: 2, cv: 0.3 },
        blockEntropy: { mean: 0.05, variance: 0 },
        sigma: 8.0,
        ruleUsageDelta: spikeDelta(),
        extinct: false,
        saturated: true,
        cycle: { detected: false, period: 0 },
        icLabel: 'chaos',
    };
}

/** Frozen: alive but nothing changes (fixed point). */
function frozen() {
    return {
        finalRatio: 0.18,
        finalActiveCount: Math.round(0.18 * NUM_CELLS),
        numCells: NUM_CELLS,
        changed: { mean: 0, variance: 0, fano: 0, cv: 0 },
        blockEntropy: { mean: 0.3, variance: 0 },
        sigma: 0.0,
        ruleUsageDelta: uniformDelta(40),
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
        icLabel: 'seed',
    };
}

/** Period-2 blinker: cycle detected with a short period. */
function periodTwo() {
    return {
        finalRatio: 0.12,
        finalActiveCount: Math.round(0.12 * NUM_CELLS),
        numCells: NUM_CELLS,
        changed: { mean: 50, variance: 2500, fano: 50, cv: 1.0 },
        blockEntropy: { mean: 0.35, variance: 0.02 },
        sigma: 1.0,
        ruleUsageDelta: uniformDelta(60),
        extinct: false,
        saturated: false,
        cycle: { detected: true, period: 2 },
        icLabel: 'seed',
    };
}

/** Pure noise: alive, but spread runs away (σ≫1), entropy near-maximal, steady turnover (low CV). */
function pureNoise() {
    return {
        finalRatio: 0.5,
        finalActiveCount: Math.round(0.5 * NUM_CELLS),
        numCells: NUM_CELLS,
        changed: { mean: 8000, variance: 16000, fano: 2, cv: 0.016 },
        blockEntropy: { mean: 0.92, variance: 0.001 },
        sigma: 4.5,
        ruleUsageDelta: uniformDelta(128),
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
        icLabel: 'chaos',
    };
}

/** A 128-bin usage delta with the first `k` bins equally used and the rest zero. */
function uniformDelta(k) {
    const d = new Uint32Array(128);
    for (let i = 0; i < k; i++) d[i] = 1000;
    return d;
}

/** A 128-bin usage delta concentrated in a single bin. */
function spikeDelta() {
    const d = new Uint32Array(128);
    d[0] = 100000;
    return d;
}

// -----------------------------------------------------------------------------

describe('ruleUsageDiversity', () => {
    it('is 0 for an all-zero or empty delta', () => {
        expect(ruleUsageDiversity(new Uint32Array(128))).toBe(0);
        expect(ruleUsageDiversity([])).toBe(0);
        expect(ruleUsageDiversity(undefined)).toBe(0);
    });

    it('is 0 when all usage is in one rule', () => {
        expect(ruleUsageDiversity(spikeDelta())).toBe(0);
    });

    it('is 1 when usage is perfectly uniform over all 128 rules', () => {
        expect(ruleUsageDiversity(uniformDelta(128))).toBeCloseTo(1, 10);
    });

    it('increases as more rules are exercised', () => {
        expect(ruleUsageDiversity(uniformDelta(8)))
            .toBeLessThan(ruleUsageDiversity(uniformDelta(64)));
    });
});

describe('scoreSingleIC — kill signals', () => {
    it('extinct → score 0, killed, reason extinct', () => {
        const r = scoreSingleIC(dying());
        expect(r.score).toBe(0);
        expect(r.killed).toBe(true);
        expect(r.killReason).toBe('extinct');
    });

    it('saturated → score 0, reason saturated', () => {
        const r = scoreSingleIC(exploding());
        expect(r.score).toBe(0);
        expect(r.killReason).toBe('saturated');
    });

    it('frozen → score 0, reason frozen', () => {
        const r = scoreSingleIC(frozen());
        expect(r.score).toBe(0);
        expect(r.killReason).toBe('frozen');
    });

    it('short cycle → score 0, reason short-cycle', () => {
        const r = scoreSingleIC(periodTwo());
        expect(r.score).toBe(0);
        expect(r.killReason).toBe('short-cycle');
    });

    it('a long cycle (period > shortCycleMaxPeriod) is NOT killed', () => {
        const m = periodTwo();
        m.cycle = { detected: true, period: SCORE_CONFIG.shortCycleMaxPeriod + 50 };
        const r = scoreSingleIC(m);
        expect(r.killed).toBe(false);
        expect(r.score).toBeGreaterThan(0);
    });
});

describe('scoreSingleIC — ordering (critical beats every degenerate regime)', () => {
    const critical = scoreSingleIC(noisyCritical()).score;

    it('critical scores strictly positive', () => {
        expect(critical).toBeGreaterThan(0);
    });

    it('critical > dying / exploding / frozen / period-2 (all 0)', () => {
        expect(critical).toBeGreaterThan(scoreSingleIC(dying()).score);
        expect(critical).toBeGreaterThan(scoreSingleIC(exploding()).score);
        expect(critical).toBeGreaterThan(scoreSingleIC(frozen()).score);
        expect(critical).toBeGreaterThan(scoreSingleIC(periodTwo()).score);
    });

    it('critical > pure noise (both alive, but noise is off-target on σ and entropy)', () => {
        expect(critical).toBeGreaterThan(scoreSingleIC(pureNoise()).score);
    });
});

describe('scoreSingleIC — criticality term', () => {
    it('peaks at σ=1 and falls off for σ far from 1', () => {
        const at1 = scoreSingleIC({ ...noisyCritical(), sigma: 1.0 }).components.criticality;
        const high = scoreSingleIC({ ...noisyCritical(), sigma: 10 }).components.criticality;
        const low = scoreSingleIC({ ...noisyCritical(), sigma: 0.1 }).components.criticality;
        expect(at1).toBeCloseTo(1, 6);
        expect(at1).toBeGreaterThan(high);
        expect(at1).toBeGreaterThan(low);
    });

    it('treats null σ (no probe) as unused, scoring on the remaining terms', () => {
        const r = scoreSingleIC({ ...noisyCritical(), sigma: null });
        expect(r.components.criticalityUsed).toBe(false);
        expect(r.score).toBeGreaterThan(0);
    });

    it('a no-probe critical-shaped burst scores at least as high as one penalized by σ', () => {
        // Dropping the criticality weight (null σ) should not be worse than keeping a
        // perfect σ=1 term — and should beat a burst with a bad σ.
        const noProbe = scoreSingleIC({ ...noisyCritical(), sigma: null }).score;
        const badSigma = scoreSingleIC({ ...noisyCritical(), sigma: 50 }).score;
        expect(noProbe).toBeGreaterThan(badSigma);
    });

    it('σ=0 and σ=∞ yield a zero criticality term', () => {
        expect(scoreSingleIC({ ...noisyCritical(), sigma: 0 }).components.criticality).toBe(0);
        expect(scoreSingleIC({ ...noisyCritical(), sigma: Infinity }).components.criticality).toBe(0);
    });
});

describe('scoreSingleIC — entropy band', () => {
    it('peaks near the target and is lower at the extremes', () => {
        const target = scoreSingleIC({ ...noisyCritical(), blockEntropy: { mean: SCORE_CONFIG.entropyTarget, variance: 0 } }).components.entropyBand;
        const tooHigh = scoreSingleIC({ ...noisyCritical(), blockEntropy: { mean: 0.95, variance: 0 } }).components.entropyBand;
        const tooLow = scoreSingleIC({ ...noisyCritical(), blockEntropy: { mean: 0.02, variance: 0 } }).components.entropyBand;
        expect(target).toBeCloseTo(1, 6);
        expect(target).toBeGreaterThan(tooHigh);
        expect(target).toBeGreaterThan(tooLow);
    });
});

describe('scoreCandidate — IC-suite aggregation', () => {
    it('returns one entry per IC, preserving order', () => {
        const r = scoreCandidate([dying(), noisyCritical(), frozen()]);
        expect(r.perIC).toHaveLength(3);
        expect(r.perIC[0].killReason).toBe('extinct');
        expect(r.perIC[2].killReason).toBe('frozen');
    });

    it('winningIC + perComponent describe the single best IC', () => {
        const r = scoreCandidate([dying(), noisyCritical(), frozen()]);
        expect(r.winningIC).toBe(1);
        expect(r.perComponent).toEqual(r.perIC[1].components);
    });

    it('is mostly driven by the best IC (soft-max), so one strong IC carries a candidate', () => {
        // A candidate that is degenerate on two ICs but critical on one should still
        // score well above a candidate degenerate on all three.
        const oneGoodIC = scoreCandidate([dying(), frozen(), noisyCritical()]).score;
        const allDead = scoreCandidate([dying(), frozen(), exploding()]).score;
        expect(allDead).toBe(0);
        expect(oneGoodIC).toBeGreaterThan(0.3 * scoreSingleIC(noisyCritical()).score);
    });

    it('gives a robustness bonus: critical on all ICs beats critical on one', () => {
        const allGood = scoreCandidate([noisyCritical(), noisyCritical(), noisyCritical()]).score;
        const oneGood = scoreCandidate([noisyCritical(), frozen(), dying()]).score;
        expect(allGood).toBeGreaterThan(oneGood);
    });

    it('empty IC suite → score 0, winningIC -1', () => {
        const r = scoreCandidate([]);
        expect(r.score).toBe(0);
        expect(r.winningIC).toBe(-1);
    });

    it('aggregated score stays within [0,1]', () => {
        const r = scoreCandidate([noisyCritical(), pureNoise(), frozen()]);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
    });
});

describe('SCORE_CONFIG is the single tuning surface', () => {
    it('an injected config with a wider criticality τ broadens the σ tolerance', () => {
        const cfg = { ...SCORE_CONFIG, criticalityTau: 2.0 };
        const wide = scoreSingleIC({ ...noisyCritical(), sigma: 6 }, cfg).components.criticality;
        const narrow = scoreSingleIC({ ...noisyCritical(), sigma: 6 }).components.criticality;
        expect(wide).toBeGreaterThan(narrow);
    });
});
