import { describe, it, expect } from 'vitest';
import {
    norm,
    l2normalize,
    dot,
    cosineSimilarity,
    cosineDistance,
    meanVector,
    trajectoryNovelty,
    historicalNovelty,
} from '../src/core/analysis/EmbeddingNovelty.js';

describe('vector math', () => {
    it('norm computes the L2 length', () => {
        expect(norm([3, 4])).toBeCloseTo(5, 10);
        expect(norm(new Float32Array([0, 0]))).toBe(0);
    });

    it('l2normalize returns a unit vector, or null for an unusable direction', () => {
        const u = l2normalize([3, 4]);
        expect(norm(u)).toBeCloseTo(1, 6);
        expect(l2normalize([0, 0])).toBeNull();
        expect(l2normalize([])).toBeNull();
        expect(l2normalize(null)).toBeNull();
    });

    it('dot uses the shorter length defensively', () => {
        expect(dot([1, 2, 3], [4, 5])).toBe(1 * 4 + 2 * 5);
    });

    it('cosineSimilarity is 1 for parallel, 0 for orthogonal, -1 for opposite', () => {
        expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1, 10); // scale-invariant
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
        expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
    });

    it('cosineSimilarity is 0 when either vector is a near-zero direction', () => {
        expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    });

    it('cosineDistance = 1 - similarity, in [0, 2]', () => {
        expect(cosineDistance([1, 0], [1, 0])).toBeCloseTo(0, 10);
        expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1, 10);
        expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 10);
    });
});

describe('meanVector', () => {
    it('averages componentwise', () => {
        const m = meanVector([[1, 2], [3, 4]]);
        expect(Array.from(m)).toEqual([2, 3]);
    });

    it('skips unusable (near-zero) vectors', () => {
        const m = meanVector([[2, 0], [0, 0], [4, 0]]);
        expect(Array.from(m)).toEqual([3, 0]); // mean of the two usable vectors
    });

    it('returns null when nothing usable remains', () => {
        expect(meanVector([])).toBeNull();
        expect(meanVector([[0, 0], [0, 0]])).toBeNull();
        expect(meanVector(null)).toBeNull();
    });
});

describe('trajectoryNovelty', () => {
    it('is 0 for fewer than two embeddings', () => {
        expect(trajectoryNovelty([])).toBe(0);
        expect(trajectoryNovelty([[1, 0]])).toBe(0);
    });

    it('is ~0 for a static trajectory (no perceptual change)', () => {
        expect(trajectoryNovelty([[1, 0], [2, 0], [3, 0]])).toBeCloseTo(0, 10);
    });

    it('rises as consecutive frames differ more', () => {
        const still = trajectoryNovelty([[1, 0], [1, 0.01], [1, 0.02]]);
        const moving = trajectoryNovelty([[1, 0], [0, 1], [-1, 0]]); // 90° steps ⇒ distance 1 each
        expect(moving).toBeGreaterThan(still);
        expect(moving).toBeCloseTo(1, 6);
    });

    it('is the MEAN consecutive cosine distance', () => {
        // steps: [1,0]→[0,1] = 1, [0,1]→[0,1] = 0  ⇒ mean 0.5
        expect(trajectoryNovelty([[1, 0], [0, 1], [0, 1]])).toBeCloseTo(0.5, 6);
    });

    it('skips unusable frames and only counts steps between two usable ones', () => {
        // The zero frame breaks the chain: only [1,0]→[0,1] (=1) is counted.
        expect(trajectoryNovelty([[1, 0], [0, 1], [0, 0], [1, 0]])).toBeCloseTo(1, 6);
    });

    it('accepts Float32Array embeddings', () => {
        const a = new Float32Array([1, 0, 0]);
        const b = new Float32Array([0, 1, 0]);
        expect(trajectoryNovelty([a, b])).toBeCloseTo(1, 6);
    });
});

// --- #37 Stage 1 --------------------------------------------------------------------------------
// `historicalNovelty` is the scored `openEndedness` input since v3.3. The point of the change is that
// it is anti-chaos where `trajectoryNovelty` (perceptual VELOCITY) is pro-chaos, so most cases below
// assert BOTH reductions: the fix is only real if the two disagree on revisiting trajectories.

/** A deterministic ± jitter, so "random-ish" cases stay reproducible. */
function jitter(i) {
    const x = Math.sin((i + 1) * 12.9898) * 43758.5453;
    return (x - Math.floor(x)) - 0.5; // in [-0.5, 0.5)
}

describe('historicalNovelty', () => {
    it('is 0 for fewer than two usable embeddings', () => {
        expect(historicalNovelty([])).toBe(0);
        expect(historicalNovelty([[1, 0]])).toBe(0);
        expect(historicalNovelty([[1, 0], [0, 0]])).toBe(0); // one usable frame ⇒ nothing to compare
    });

    it('is 0 for a frozen trajectory (the same look repeated)', () => {
        expect(historicalNovelty([[1, 0], [2, 0], [3, 0]])).toBeCloseTo(0, 10);
    });

    it('is ~0 for a period-2 oscillator while trajectoryNovelty is near its ceiling', () => {
        // THE discriminating case. A,B,A,B,… travels a full 90° every step (velocity = 1) but from the
        // third frame on, an identical state is already in the history (novelty = 1/3 · 1 + 0 + 0).
        const osc = [[1, 0], [0, 1], [1, 0], [0, 1], [1, 0], [0, 1]];
        expect(trajectoryNovelty(osc)).toBeCloseTo(1, 6);
        expect(historicalNovelty(osc)).toBeCloseTo(1 / 5, 6); // only frame 2 was ever new
        expect(historicalNovelty(osc)).toBeLessThan(trajectoryNovelty(osc) / 3);
    });

    it('stays low for thrash inside a two-anchor subspace (churn)', () => {
        // Random-ish wobble around two fixed directions: keeps moving forever, never leaves the
        // subspace. This is the perceptual signature of dense churn.
        const thrash = [];
        for (let i = 0; i < 20; i++) {
            const anchor = i % 2 === 0 ? [1, 0, 0] : [0, 1, 0];
            thrash.push([
                anchor[0] + 0.05 * jitter(i),
                anchor[1] + 0.05 * jitter(i + 100),
                anchor[2] + 0.05 * jitter(i + 200),
            ]);
        }
        // Not exactly 0: frame 1 is the first visit to the second anchor and IS novel, so the mean
        // carries a ~1/(n−1) floor. That floor shrinks as the run goes on — which is the intended
        // reading: exploring two looks is worth something once, and nothing thereafter.
        expect(historicalNovelty(thrash)).toBeLessThan(0.06);
        expect(historicalNovelty(thrash)).toBeLessThan(trajectoryNovelty(thrash) / 10);
    });

    it('is high for a developing trajectory of mutually near-orthogonal looks', () => {
        const developing = [
            [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1],
        ];
        expect(historicalNovelty(developing)).toBeCloseTo(1, 6); // every frame is new territory
    });

    it('ranks developing ≫ oscillator and ≫ thrash (the ordering the term exists for)', () => {
        const developing = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
        const osc = [[1, 0, 0, 0], [0, 1, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0]];
        const thrash = [];
        for (let i = 0; i < 8; i++) {
            const a = i % 2 === 0 ? 1 : 0;
            thrash.push([a + 0.05 * jitter(i), 1 - a + 0.05 * jitter(i + 50), 0, 0]);
        }
        // Under the OLD reduction these three are indistinguishable — that was the bug.
        for (const t of [developing, osc, thrash]) expect(trajectoryNovelty(t)).toBeGreaterThan(0.9);
        expect(historicalNovelty(developing)).toBeGreaterThan(historicalNovelty(osc) + 0.5);
        expect(historicalNovelty(developing)).toBeGreaterThan(historicalNovelty(thrash) + 0.5);
    });

    it('never exceeds trajectoryNovelty (min over earlier frames ≤ distance to the previous one)', () => {
        const cases = [
            [[1, 0], [0, 1], [-1, 0], [0, -1]],
            [[1, 0], [1, 0.01], [1, 0.02], [1, 0.03]],
            [[1, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]],
            [[1, 0], [0, 1], [0, 0], [1, 0], [0, 1]],
        ];
        for (const c of cases) {
            expect(historicalNovelty(c)).toBeLessThanOrEqual(trajectoryNovelty(c) + 1e-9);
        }
    });

    it('skips unusable frames without breaking the history (unlike the consecutive chain)', () => {
        // The zero frame contributes nothing and does not enter the history, but the frame after it is
        // still compared against everything before the gap — so the repeat of [1,0] scores 0, not 1.
        expect(historicalNovelty([[1, 0], [0, 1], [0, 0], [1, 0]])).toBeCloseTo(0.5, 6);
        // Contrast: trajectoryNovelty drops the pair entirely and reports the single surviving step.
        expect(trajectoryNovelty([[1, 0], [0, 1], [0, 0], [1, 0]])).toBeCloseTo(1, 6);
    });

    it('accepts Float32Array embeddings', () => {
        const a = new Float32Array([1, 0, 0]);
        const b = new Float32Array([0, 1, 0]);
        expect(historicalNovelty([a, b])).toBeCloseTo(1, 6);
    });
});
