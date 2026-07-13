import { describe, it, expect } from 'vitest';
import { refitWeights, MIN_VOTES_FOR_REFIT } from '../src/core/analysis/WeightRefit.js';
import { WEIGHT_KEYS } from '../src/core/analysis/ScoringPresets.js';

/** Deterministic PRNG so the synthetic vote generation is reproducible (Date.now/Math.random-free). */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

const featureObj = (rng) => Object.fromEntries(WEIGHT_KEYS.map((k) => [k, rng()]));

/** Generate N Bradley–Terry votes from planted weights: P(a wins)=σ(scale·wᵀ(fa−fb)). */
function syntheticVotes(trueW, { n = 600, scale = 6, seed = 42 } = {}) {
    const rng = mulberry32(seed);
    const votes = [];
    for (let i = 0; i < n; i++) {
        const a = featureObj(rng);
        const b = featureObj(rng);
        let z = 0;
        for (const k of WEIGHT_KEYS) z += trueW[k] * (a[k] - b[k]);
        const p = sigmoid(scale * z);
        const winner = rng() < p ? 'a' : 'b';
        votes.push({ aHex: 'a', bHex: 'b', winner, aMetrics: a, bMetrics: b, aScore: 0, bScore: 0 });
    }
    return votes;
}

/** Cosine similarity between two weight vectors keyed by WEIGHT_KEYS. */
function cosine(u, v) {
    let dot = 0, nu = 0, nv = 0;
    for (const k of WEIGHT_KEYS) {
        const a = u[k] || 0, b = v[k] || 0;
        dot += a * b; nu += a * a; nv += b * b;
    }
    return dot / (Math.sqrt(nu) * Math.sqrt(nv) || 1);
}

describe('refitWeights guardrails', () => {
    it('refuses a refit below the minimum vote count', () => {
        const votes = syntheticVotes(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 1])), { n: MIN_VOTES_FOR_REFIT - 1 });
        const res = refitWeights(votes);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('not-enough-votes');
        expect(res.nUsed).toBe(MIN_VOTES_FOR_REFIT - 1);
    });

    it('excludes skips and featureless votes from the decisive count', () => {
        const good = syntheticVotes(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 1])), { n: 60 });
        const padded = [
            ...good,
            { aHex: 'a', bHex: 'b', winner: 'skip', aMetrics: {}, bMetrics: {} },
            { aHex: 'a', bHex: 'b', winner: 'a', aMetrics: null, bMetrics: {} },
        ];
        const res = refitWeights(padded);
        expect(res.nUsed).toBe(60);
    });
});

describe('refitWeights recovery', () => {
    it('recovers planted weights (direction) within tolerance', () => {
        // A clearly-structured objective: spatialStructure + transport dominate, others quiet.
        const trueW = {
            criticality: 0.2, entropyBand: 0.1, fluctuation: 0.05, ruleDiversity: 0.1,
            spatialStructure: 1.0, spatialHeterogeneity: 0.15, temporalEntropyVariance: 0.3,
            transport: 0.8, openEndedness: 0.1,
        };
        const res = refitWeights(syntheticVotes(trueW, { n: 800, seed: 7 }));
        expect(res.ok).toBe(true);
        // Fitted coefficient direction aligns with the planted weights.
        expect(cosine(res.rawCoef, trueW)).toBeGreaterThan(0.9);
        // The two dominant planted terms come back as the two strongest weights.
        const ranked = [...WEIGHT_KEYS].sort((x, y) => res.weightsPct[y] - res.weightsPct[x]);
        expect(ranked.slice(0, 2)).toEqual(expect.arrayContaining(['spatialStructure', 'transport']));
        expect(res.weightsPct.spatialStructure).toBe(100); // dominant term anchors the scale
        // The model fits the votes it generated.
        expect(res.accuracy).toBeGreaterThan(0.8);
    });

    it('produces a valid preset shape (all keys, 0–100, non-negative)', () => {
        const trueW = Object.fromEntries(WEIGHT_KEYS.map((k, i) => [k, i === 0 ? 1 : 0.2]));
        const res = refitWeights(syntheticVotes(trueW, { n: 400, seed: 11 }));
        expect(res.ok).toBe(true);
        expect(Object.keys(res.weightsPct).sort()).toEqual([...WEIGHT_KEYS].sort());
        for (const k of WEIGHT_KEYS) {
            expect(res.weightsPct[k]).toBeGreaterThanOrEqual(0);
            expect(res.weightsPct[k]).toBeLessThanOrEqual(100);
            expect(Number.isInteger(res.weightsPct[k])).toBe(true);
        }
    });
});
