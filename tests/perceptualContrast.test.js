import { describe, it, expect } from 'vitest';
import {
    noiseSimilarity,
    noiseFactor,
} from '../src/core/analysis/PerceptualContrast.js';

describe('noiseSimilarity', () => {
    it('takes the maximum prompt cosine for each frame, then averages frames', () => {
        const frames = [[1, 0], [0, 1]];
        const prompts = [
            [1, 0],
            [0.6, 0.8],
        ];
        expect(noiseSimilarity(frames, prompts)).toBeCloseTo((1 + 0.8) / 2, 6);
    });

    it('uses cosine rather than vector magnitude', () => {
        expect(noiseSimilarity([[10, 0]], [[2, 0]])).toBeCloseTo(1, 10);
    });

    it('ignores unusable vectors and returns null for empty usable input', () => {
        expect(noiseSimilarity([[0, 0], [1, 0]], [[0, 0], [1, 0]])).toBeCloseTo(1, 10);
        expect(noiseSimilarity([], [[1, 0]])).toBeNull();
        expect(noiseSimilarity([[1, 0]], [])).toBeNull();
        expect(noiseSimilarity([[0, 0]], [[1, 0]])).toBeNull();
        expect(noiseSimilarity([[1, 0]], [[0, 0]])).toBeNull();
        expect(noiseSimilarity(null, null)).toBeNull();
    });
});

describe('noiseFactor', () => {
    const config = { simMin: 0.2, simMax: 0.4, strength: 0.6 };

    it('is neutral below simMin and reaches the configured penalty at simMax', () => {
        expect(noiseFactor(-1, config)).toBe(1);
        expect(noiseFactor(0.2, config)).toBe(1);
        expect(noiseFactor(0.3, config)).toBeCloseTo(0.7, 10);
        expect(noiseFactor(0.4, config)).toBeCloseTo(0.4, 10);
        expect(noiseFactor(1, config)).toBeCloseTo(0.4, 10);
    });

    it('clamps strength and degrades neutrally for missing or invalid calibration', () => {
        expect(noiseFactor(0.5, { ...config, strength: 2 })).toBe(0);
        expect(noiseFactor(0.5, { ...config, strength: -1 })).toBe(1);
        expect(noiseFactor(null, config)).toBe(1);
        expect(noiseFactor(Number.NaN, config)).toBe(1);
        expect(noiseFactor(0.3, { ...config, simMax: 0.2 })).toBe(1);
    });
});
