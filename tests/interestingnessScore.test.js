import { describe, it, expect } from 'vitest';
import {
    SCORE_CONFIG,
    scoreSingleIC,
    scoreCandidate,
    ruleUsageDiversity,
    applyConfirmation,
} from '../src/core/analysis/InterestingnessScore.js';
import fixtures from './fixtures/exploreEvalFixtures.json';

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

// --- v2.3: spatial structure terms -------------------------------------------

/** Homogeneous churn: high activity but spatially random (no structure, no heterogeneity). */
function uniformChurn() {
    return {
        finalRatio: 0.9,
        finalActiveCount: Math.round(0.9 * NUM_CELLS),
        numCells: NUM_CELLS,
        changed: { mean: 4000, variance: 64000000, fano: 16000, cv: 2.0 },
        blockEntropy: { mean: 0.4, variance: 0.01, spatialVariance: 0.001 },
        spatialOrder: { mean: 0.0, last: 0.0 },
        sigma: 1.0,
        ruleUsageDelta: uniformDelta(120),
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
        icLabel: 'sparse',
    };
}

/** Structured critical: lower activity but clearly spatially organized + heterogeneous. */
function structuredCritical() {
    return {
        finalRatio: 0.3,
        finalActiveCount: Math.round(0.3 * NUM_CELLS),
        numCells: NUM_CELLS,
        changed: { mean: 1500, variance: 2250000, fano: 1500, cv: 1.0 },
        blockEntropy: { mean: 0.4, variance: 0.01, spatialVariance: 0.05 },
        spatialOrder: { mean: 0.5, last: 0.5 },
        sigma: 1.0,
        ruleUsageDelta: uniformDelta(80),
        extinct: false,
        saturated: false,
        cycle: { detected: false, period: 0 },
        icLabel: 'chaos',
    };
}

describe('scoreSingleIC — spatial structure (v2)', () => {
    it('a spatially-structured critical burst outranks homogeneous churn', () => {
        const structured = scoreSingleIC(structuredCritical()).score;
        const churn = scoreSingleIC(uniformChurn()).score;
        expect(structured).toBeGreaterThan(churn);
    });

    it('exposes spatial components + a spatialUsed flag when the metrics are present', () => {
        const c = scoreSingleIC(structuredCritical()).components;
        expect(c.spatialUsed).toBe(true);
        expect(c.spatialStructure).toBeGreaterThan(0.5); // 0.5 / (0.5 + 0.12)
        expect(c.spatialHeterogeneity).toBeGreaterThan(0.5);
    });

    it('deviation in EITHER direction from random mixing counts as structure', () => {
        const pos = scoreSingleIC({ ...structuredCritical(), spatialOrder: { mean: 0.4, last: 0.4 } }).components.spatialStructure;
        const neg = scoreSingleIC({ ...structuredCritical(), spatialOrder: { mean: -0.4, last: -0.4 } }).components.spatialStructure;
        expect(pos).toBeCloseTo(neg, 10);
        expect(pos).toBeGreaterThan(0);
    });

    it('marks spatial terms unused and renormalizes when the v2.1 metrics are absent (v1 entries)', () => {
        const m = structuredCritical();
        delete m.spatialOrder;
        m.blockEntropy = { mean: 0.4, variance: 0.01 }; // no spatialVariance
        const r = scoreSingleIC(m);
        expect(r.components.spatialUsed).toBe(false);
        expect(r.components.spatialStructure).toBe(0);
        expect(r.components.spatialHeterogeneity).toBe(0);
        // Dropping the spatial weights must not zero the score — it scores on the remaining terms.
        expect(r.score).toBeGreaterThan(0);
    });
});

// --- v2.8: temporal entropy variance (Wuensche complex-rule discriminator) ---

describe('scoreSingleIC — temporal entropy variance (v2.8)', () => {
    it('a high-temporal-variance burst out-scores an otherwise-identical flat one', () => {
        const base = structuredCritical();
        const swinging = scoreSingleIC({ ...base, blockEntropy: { ...base.blockEntropy, variance: 0.02 } });
        const flat = scoreSingleIC({ ...base, blockEntropy: { ...base.blockEntropy, variance: 0.0 } });
        expect(swinging.components.temporalEntropyVariance)
            .toBeGreaterThan(flat.components.temporalEntropyVariance);
        expect(swinging.score).toBeGreaterThan(flat.score);
    });

    it('exposes the temporal component + a temporalVarUsed flag when blockEntropy.variance is present', () => {
        const c = scoreSingleIC(structuredCritical()).components;
        expect(c.temporalVarUsed).toBe(true);
        expect(c.temporalEntropyVariance).toBeGreaterThan(0.5); // 0.01 / (0.01 + 0.005)
    });

    it('marks the term unused and renormalizes when blockEntropy.variance is absent (v1 entries)', () => {
        const m = structuredCritical();
        // Legacy metrics: no temporal variance (keep spatialVariance so other terms still count).
        m.blockEntropy = { mean: m.blockEntropy.mean, spatialVariance: m.blockEntropy.spatialVariance };
        const r = scoreSingleIC(m);
        expect(r.components.temporalVarUsed).toBe(false);
        expect(r.components.temporalEntropyVariance).toBe(0);
        // Dropping the temporal weight must not zero the score — it scores on the remaining terms.
        expect(r.score).toBeGreaterThan(0);
    });

    it('separates the real fixtures: gliders-chaos swings entropy far more than churn-sparse', () => {
        const g = scoreSingleIC({ ...fixtures.gliders_chaos_160, icLabel: 'chaos' }).components.temporalEntropyVariance;
        const c = scoreSingleIC({ ...fixtures.churn_sparse_160, icLabel: 'sparse' }).components.temporalEntropyVariance;
        expect(g).toBeGreaterThan(c);
    });
});

// --- v2.9: transport / mobility (active-cell centroid drift) -----------------

describe('scoreSingleIC — transport / mobility (v2.9)', () => {
    it('a mobile (high-transport) burst out-scores an otherwise-identical pinned one', () => {
        const base = structuredCritical();
        const moving = scoreSingleIC({ ...base, transport: { meanSpeed: 0.5 } });
        const pinned = scoreSingleIC({ ...base, transport: { meanSpeed: 0.0 } });
        expect(moving.components.transport).toBeGreaterThan(pinned.components.transport);
        expect(moving.score).toBeGreaterThan(pinned.score);
    });

    it('exposes the transport component + a transportUsed flag when transport.meanSpeed is present', () => {
        // At meanSpeed == halfSat the half-saturation reward is exactly 0.5.
        const c = scoreSingleIC({ ...structuredCritical(), transport: { meanSpeed: SCORE_CONFIG.transportHalfSat } }).components;
        expect(c.transportUsed).toBe(true);
        expect(c.transport).toBeCloseTo(0.5, 6);
    });

    it('half-saturation: a larger drift speed yields a larger but bounded ([0,1]) term', () => {
        const slow = scoreSingleIC({ ...structuredCritical(), transport: { meanSpeed: 0.05 } }).components.transport;
        const fast = scoreSingleIC({ ...structuredCritical(), transport: { meanSpeed: 2.0 } }).components.transport;
        expect(fast).toBeGreaterThan(slow);
        expect(fast).toBeLessThanOrEqual(1);
    });

    it('marks the term unused and renormalizes when transport.meanSpeed is absent (v1 entries)', () => {
        const r = scoreSingleIC(structuredCritical()); // no transport field at all
        expect(r.components.transportUsed).toBe(false);
        expect(r.components.transport).toBe(0);
        // Dropping the transport weight must not zero the score — it scores on the remaining terms.
        expect(r.score).toBeGreaterThan(0);
    });
});

// --- v3.0: open-endedness / perceptual novelty (foundation-model trajectory novelty) -----------

describe('scoreSingleIC — open-endedness / perceptual novelty (v3.0)', () => {
    it('a higher-novelty trajectory out-scores an otherwise-identical low-novelty one', () => {
        const base = structuredCritical();
        const novel = scoreSingleIC({ ...base, embedding: { openEndedness: 0.4 } });
        const still = scoreSingleIC({ ...base, embedding: { openEndedness: 0.01 } });
        expect(novel.components.openEndedness).toBeGreaterThan(still.components.openEndedness);
        expect(novel.score).toBeGreaterThan(still.score);
    });

    it('exposes the openEndedness component + flag at the half-saturation point', () => {
        const c = scoreSingleIC({ ...structuredCritical(), embedding: { openEndedness: SCORE_CONFIG.openEndednessHalfSat } }).components;
        expect(c.openEndednessUsed).toBe(true);
        expect(c.openEndedness).toBeCloseTo(0.5, 6);
    });

    it('half-saturation: a larger novelty yields a larger but bounded ([0,1]) term', () => {
        const lo = scoreSingleIC({ ...structuredCritical(), embedding: { openEndedness: 0.02 } }).components.openEndedness;
        const hi = scoreSingleIC({ ...structuredCritical(), embedding: { openEndedness: 1.5 } }).components.openEndedness;
        expect(hi).toBeGreaterThan(lo);
        expect(hi).toBeLessThanOrEqual(1);
    });

    it('marks the term unused and renormalizes when no embedding is present (the default, off)', () => {
        const r = scoreSingleIC(structuredCritical()); // no embedding field at all
        expect(r.components.openEndednessUsed).toBe(false);
        expect(r.components.openEndedness).toBe(0);
        expect(r.score).toBeGreaterThan(0);
    });

    it('OFF-PATH IDENTITY: adding the (absent) term does not change a model-free score', () => {
        // The embedding-off score must be byte-identical to the statistical pipeline. Since the
        // openEndedness weight is ADDED without touching the other eight, scoring metrics with no
        // `embedding` field renormalizes over exactly the same eight terms ⇒ same number.
        const m = structuredCritical();
        const withUndefined = scoreSingleIC({ ...m, embedding: undefined }).score;
        const without = scoreSingleIC(m).score;
        expect(withUndefined).toBe(without);
    });

    it('a hard kill still zeroes the score regardless of a high novelty', () => {
        const r = scoreSingleIC({ ...dying(), embedding: { openEndedness: 1.0 } });
        expect(r.killed).toBe(true);
        expect(r.score).toBe(0);
        expect(r.components.openEndedness).toBe(0);
    });
});

describe('Score v2 — real fixtures (the central F1/F4 regression)', () => {
    const glidersChaos = scoreSingleIC({ ...fixtures.gliders_chaos_160, icLabel: 'chaos' }).score;
    const churnSparse = scoreSingleIC({ ...fixtures.churn_sparse_160, icLabel: 'sparse' }).score;

    it('gliders-chaos out-ranks churn-sparse by ≥0.10', () => {
        expect(glidersChaos - churnSparse).toBeGreaterThanOrEqual(0.10);
    });

    it('both fixtures score in a discriminating mid-range (ceiling check, F4)', () => {
        expect(glidersChaos).toBeGreaterThan(churnSparse);
        expect(glidersChaos).toBeLessThan(1);
        expect(churnSparse).toBeGreaterThan(0);
    });

    it('the gliders sparse-healed / saturated-seed ICs are killed, chaos carries the candidate', () => {
        expect(scoreSingleIC(fixtures.gliders_seed_160).killReason).toBe('saturated');
        // sparse IC: σ=0 (no spread) but alive with structure — not necessarily killed, just weaker.
        const cand = scoreCandidate([
            fixtures.gliders_chaos_160, fixtures.gliders_sparse_160, fixtures.gliders_seed_160,
        ]);
        expect(cand.winningIC).toBe(0); // chaos IC is the best
    });
});

describe('applyConfirmation (v2.4 helper)', () => {
    const passMetrics = { cycle: { detected: false, period: 0 } };
    const passIC = { score: 0.7, killed: false, killReason: null };

    it('passes a clean confirmation straight through', () => {
        const r = applyConfirmation(0.65, passIC, passMetrics);
        expect(r.rejected).toBe(false);
        expect(r.cyclic).toBe(null);
        expect(r.finalScore).toBeCloseTo(0.7, 10);
    });

    it('rejects a find that was hard-killed at confirmation', () => {
        const killedIC = { score: 0, killed: true, killReason: 'saturated' };
        const r = applyConfirmation(0.65, killedIC, { cycle: { detected: false, period: 0 } });
        expect(r.rejected).toBe(true);
        expect(r.finalScore).toBe(0);
        expect(r.cyclic).toBe(null);
    });

    it('penalizes + tags a long cycle (period ≤ confirmCycleMaxPeriod) instead of rejecting it', () => {
        const r = applyConfirmation(0.8, { score: 0.8, killed: false, killReason: null }, { cycle: { detected: true, period: 84 } });
        expect(r.rejected).toBe(false);
        expect(r.cyclic).toBe(84);
        expect(r.finalScore).toBeCloseTo(0.8 * SCORE_CONFIG.confirmCyclePenalty, 10);
    });

    it('does not tag a cycle longer than confirmCycleMaxPeriod', () => {
        const period = SCORE_CONFIG.confirmCycleMaxPeriod + 10;
        const r = applyConfirmation(0.8, { score: 0.8, killed: false, killReason: null }, { cycle: { detected: true, period } });
        expect(r.cyclic).toBe(null);
        expect(r.finalScore).toBeCloseTo(0.8, 10);
    });

    it('rejects a null/missing confirmation IC score (defensive)', () => {
        expect(applyConfirmation(0.5, null, passMetrics).rejected).toBe(true);
    });
});

// --- v3.1: uniform-chaos penalty + custom weights ------------------------------

describe('scoreSingleIC — uniform-chaos penalty (v3.1)', () => {
    it('penalizes high-coverage structureless churn (factor < 1)', () => {
        const r = scoreSingleIC(uniformChurn()); // finalRatio 0.9, spatialOrder ≈ 0
        expect(r.components.uniformUsed).toBe(true);
        expect(r.components.uniformFactor).toBeLessThan(1);
        expect(r.components.uniformFactor).toBeGreaterThan(0);
    });

    it('leaves low-coverage worlds untouched (factor exactly 1 below the coverage ramp)', () => {
        const r = scoreSingleIC(structuredCritical()); // finalRatio 0.3 < uniformCoverageMin
        expect(r.components.uniformUsed).toBe(true);
        expect(r.components.uniformFactor).toBe(1);
    });

    it('structure rescues a dense world: same coverage, more structure ⇒ milder factor', () => {
        const dense = uniformChurn();
        const structuredDense = scoreSingleIC({ ...dense, spatialOrder: { mean: 0.4, last: 0.4 } });
        const churn = scoreSingleIC(dense);
        expect(structuredDense.components.uniformFactor).toBeGreaterThan(churn.components.uniformFactor);
    });

    it('strength 0 reproduces the pre-v3.1 score exactly', () => {
        const cfg = { ...SCORE_CONFIG, uniformPenaltyStrength: 0 };
        const off = scoreSingleIC(uniformChurn(), cfg);
        const on = scoreSingleIC(uniformChurn());
        expect(off.components.uniformFactor).toBe(1);
        expect(on.score).toBeCloseTo(off.score * on.components.uniformFactor, 12);
    });

    it('is skipped (factor 1, unused) when spatialOrder is absent (legacy metrics)', () => {
        const m = uniformChurn();
        delete m.spatialOrder;
        const r = scoreSingleIC(m);
        expect(r.components.uniformUsed).toBe(false);
        expect(r.components.uniformFactor).toBe(1);
    });

    it('kill path reports a neutral factor', () => {
        const r = scoreSingleIC(exploding());
        expect(r.components.uniformFactor).toBe(1);
        expect(r.components.uniformUsed).toBe(false);
        expect(r.raw).toBeNull();
    });
});

describe('scoreSingleIC — raw metric inputs (v3.1 explainer markers)', () => {
    it('exposes the raw inputs behind each term, null-gated on absence', () => {
        const r = scoreSingleIC(structuredCritical());
        expect(r.raw.sigma).toBe(1.0);
        expect(r.raw.blockEntropyMean).toBeCloseTo(0.4, 10);
        expect(r.raw.cv).toBe(1.0);
        expect(r.raw.spatialOrderMean).toBe(0.5);
        expect(r.raw.finalRatio).toBeCloseTo(0.3, 10);
        expect(r.raw.transportSpeed).toBeNull();   // no transport field
        expect(r.raw.openEndedness).toBeNull();    // embeddings off
    });
});

describe('Score v3.1 — real fixtures (the strengthened chaos regression)', () => {
    const glidersChaos = scoreSingleIC({ ...fixtures.gliders_chaos_160, icLabel: 'chaos' }).score;
    const churn = scoreSingleIC({ ...fixtures.churn_sparse_160, icLabel: 'sparse' });

    it('churn-sparse now screens BELOW the find threshold (0.45) with margin', () => {
        expect(churn.score).toBeLessThan(0.35);
    });

    it('the penalty actually bit on churn (coverage 0.917, structure ≈ 0.13)', () => {
        expect(churn.components.uniformFactor).toBeLessThan(0.7);
    });

    it('gliders-chaos is untouched by the penalty (coverage below the ramp)', () => {
        const cfg = { ...SCORE_CONFIG, uniformPenaltyStrength: 0 };
        const unpenalized = scoreSingleIC({ ...fixtures.gliders_chaos_160, icLabel: 'chaos' }, cfg).score;
        expect(glidersChaos).toBeCloseTo(unpenalized, 12);
    });

    it('the gliders−churn gap widened to ≥0.25 (was ≥0.10)', () => {
        expect(glidersChaos - churn.score).toBeGreaterThanOrEqual(0.25);
    });
});

describe('scoreSingleIC — custom weights (v3.1 sliders)', () => {
    it('is renormalization-invariant: scaling every weight leaves the score unchanged', () => {
        const scaled = Object.fromEntries(Object.entries(SCORE_CONFIG.weights).map(([k, v]) => [k, v * 7]));
        const a = scoreSingleIC(structuredCritical()).score;
        const b = scoreSingleIC(structuredCritical(), { ...SCORE_CONFIG, weights: scaled }).score;
        expect(b).toBeCloseTo(a, 12);
    });

    it('a zero weight removes the term\'s influence entirely', () => {
        const base = structuredCritical();
        const noSigmaWeight = { ...SCORE_CONFIG, weights: { ...SCORE_CONFIG.weights, criticality: 0 } };
        const goodSigma = scoreSingleIC({ ...base, sigma: 1.0 }, noSigmaWeight).score;
        const badSigma = scoreSingleIC({ ...base, sigma: 50 }, noSigmaWeight).score;
        expect(goodSigma).toBeCloseTo(badSigma, 12);
    });

    it('all-zero weights yield score 0 without NaN', () => {
        const zero = Object.fromEntries(Object.keys(SCORE_CONFIG.weights).map((k) => [k, 0]));
        const r = scoreSingleIC(structuredCritical(), { ...SCORE_CONFIG, weights: zero });
        expect(r.score).toBe(0);
        expect(Number.isNaN(r.score)).toBe(false);
    });

    it('maxing a single weight makes that term dominate the ranking', () => {
        const onlyStructure = {
            ...SCORE_CONFIG,
            weights: { ...Object.fromEntries(Object.keys(SCORE_CONFIG.weights).map((k) => [k, 0])), spatialStructure: 1 },
        };
        const structured = scoreSingleIC(structuredCritical(), onlyStructure).score;
        const churn = scoreSingleIC({ ...uniformChurn(), finalRatio: 0.3 }, onlyStructure).score; // low coverage: isolate the weight effect
        expect(structured).toBeGreaterThan(churn * 5);
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
