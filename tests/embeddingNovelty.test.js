import { describe, it, expect } from 'vitest';
import {
    norm,
    l2normalize,
    dot,
    cosineSimilarity,
    cosineDistance,
    meanVector,
    trajectoryNovelty,
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
