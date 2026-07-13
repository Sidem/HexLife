import { describe, it, expect } from 'vitest';
import fixtures from './fixtures/exploreEvalFixtures.json';
import {
    suggestTagsFromStats,
    suggestTagsFromEmbedding,
    mergeSuggestions,
    MAX_SUGGESTIONS,
} from '../src/core/analysis/tagSuggestions.js';
import { isCanonicalTag } from '../src/core/tags.js';

describe('suggestTagsFromStats — reference fixtures', () => {
    it('gliders_chaos_160 suggests moving structures (gliders)', () => {
        const s = suggestTagsFromStats(fixtures.gliders_chaos_160);
        expect(s).toContain('gliders');
        expect(s).toContain('ships');
        expect(s).not.toContain('growth'); // sparse field, not a blanket
    });

    it('gliders_sparse_160 reads as mobile, not a still life despite low entropy', () => {
        const s = suggestTagsFromStats(fixtures.gliders_sparse_160);
        expect(s).toContain('gliders');
        expect(s).not.toContain('still-life');
    });

    it('churn_sparse_160 is a high-coverage chaotic blanket → growth + chaos', () => {
        const s = suggestTagsFromStats(fixtures.churn_sparse_160);
        expect(s).toContain('growth');
        expect(s).toContain('chaos');
        expect(s).not.toContain('gliders');
    });

    it('churn_sparse_600 detects the long cycle → oscillators', () => {
        const s = suggestTagsFromStats(fixtures.churn_sparse_600);
        expect(s).toContain('oscillators');
    });

    it('saturated blanket (gliders_seed_160) suggests no behaviour tags', () => {
        expect(suggestTagsFromStats(fixtures.gliders_seed_160)).toEqual([]);
    });

    it('every fixture suggestion is a canonical tag, capped at MAX_SUGGESTIONS', () => {
        for (const key of Object.keys(fixtures)) {
            if (key === '_meta') continue;
            const s = suggestTagsFromStats(fixtures[key]);
            expect(s.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
            for (const id of s) expect(isCanonicalTag(id)).toBe(true);
        }
    });
});

describe('suggestTagsFromStats — gallery-entry metric shape', () => {
    it('transport speed drives gliders/ships on a sparse field', () => {
        const s = suggestTagsFromStats({
            finalRatio: 0.03,
            blockEntropy: { mean: 0.2 },
            transport: { meanSpeed: 0.3 },
            sigma: 0.9,
            cyclic: null,
        });
        expect(s).toContain('gliders');
        expect(s).toContain('ships');
    });

    it('cyclic period (gallery shape) → oscillators', () => {
        expect(suggestTagsFromStats({ finalRatio: 0.2, cyclic: 30 })).toContain('oscillators');
    });

    it('extinct → decay only', () => {
        expect(suggestTagsFromStats({ extinct: true })).toEqual(['decay']);
        expect(suggestTagsFromStats({ finalRatio: 0 })).toEqual(['decay']);
    });

    it('very low entropy with no motion → still-life / mosaic', () => {
        const s = suggestTagsFromStats({ finalRatio: 0.3, blockEntropy: { mean: 0.05 } });
        expect(s).toContain('still-life');
        expect(s).toContain('mosaic');
    });

    it('non-object input is safe', () => {
        expect(suggestTagsFromStats(null)).toEqual([]);
        expect(suggestTagsFromStats(undefined)).toEqual([]);
    });
});

describe('suggestTagsFromEmbedding', () => {
    const bank = [
        { id: 'gliders', vector: [1, 0, 0] },
        { id: 'chaos', vector: [0, 1, 0] },
        { id: 'growth', vector: [0, 0, 1] },
    ];

    it('ranks the nearest tag first, filters below the floor', () => {
        const s = suggestTagsFromEmbedding([0.9, 0.1, 0], bank);
        expect(s[0]).toBe('gliders');
        expect(s).not.toContain('growth');
    });

    it('returns multiple tags in descending similarity order', () => {
        const s = suggestTagsFromEmbedding([0.8, 0.6, 0], bank);
        expect(s).toEqual(['gliders', 'chaos']);
    });

    it('respects the max cap and the floor', () => {
        const s = suggestTagsFromEmbedding([1, 1, 1], bank, { max: 2, floor: 0 });
        expect(s.length).toBe(2);
        expect(suggestTagsFromEmbedding([1, 1, 1], bank, { floor: 0.99 })).toEqual([]);
    });

    it('empty / missing inputs resolve to []', () => {
        expect(suggestTagsFromEmbedding(null, bank)).toEqual([]);
        expect(suggestTagsFromEmbedding([1, 0, 0], [])).toEqual([]);
        expect(suggestTagsFromEmbedding([1, 0, 0], null)).toEqual([]);
    });
});

describe('mergeSuggestions', () => {
    it('embedding suggestions win and lead, heuristics fill the rest', () => {
        expect(mergeSuggestions(['gliders'], ['chaos', 'growth'])).toEqual(['gliders', 'chaos', 'growth']);
    });

    it('dedupes across sources, order-preserving', () => {
        expect(mergeSuggestions(['gliders', 'chaos'], ['chaos', 'growth']))
            .toEqual(['gliders', 'chaos', 'growth']);
    });

    it('caps at max', () => {
        expect(mergeSuggestions(['a', 'b', 'c'], ['d', 'e'], 2)).toEqual(['a', 'b']);
    });

    it('handles empty sources', () => {
        expect(mergeSuggestions([], [])).toEqual([]);
        expect(mergeSuggestions(null, ['x'])).toEqual(['x']);
    });
});
