import { describe, it, expect } from 'vitest';
import {
    EMBEDDING_ARCHIVE_CONFIG,
    buildProjection,
    hashEmbedding,
    EmbeddingArchive,
} from '../src/core/analysis/EmbeddingArchive.js';

describe('buildProjection / hashEmbedding', () => {
    it('is deterministic for a given (dim, numBits, seed)', () => {
        const a = buildProjection(8, 6, 123);
        const b = buildProjection(8, 6, 123);
        expect(a.length).toBe(6);
        for (let i = 0; i < a.length; i++) expect(Array.from(a[i])).toEqual(Array.from(b[i]));
    });

    it('different seeds give different projections', () => {
        const a = buildProjection(8, 6, 1);
        const b = buildProjection(8, 6, 2);
        expect(Array.from(a[0])).not.toEqual(Array.from(b[0]));
    });

    it('hash length equals the number of planes and is all 0/1', () => {
        const planes = buildProjection(4, 8, 42);
        const key = hashEmbedding([1, -1, 0.5, -0.5], planes);
        expect(key).toHaveLength(8);
        expect(/^[01]+$/.test(key)).toBe(true);
    });

    it('a vector and its negation hash to complementary keys (sign flip)', () => {
        const planes = buildProjection(4, 8, 7);
        const v = [0.3, -0.7, 0.1, 0.9];
        const k = hashEmbedding(v, planes);
        const kNeg = hashEmbedding(v.map((x) => -x), planes);
        // dot(−v, plane) = −dot(v, plane); sign flips on every nonzero dot ⇒ complementary bits.
        for (let i = 0; i < k.length; i++) expect(kNeg[i]).not.toBe(k[i]);
    });
});

describe('EmbeddingArchive insertion', () => {
    it('skips a find with no usable embedding (graceful)', () => {
        const a = new EmbeddingArchive();
        expect(a.tryInsert({ hex: 'aa', score: 0.5, vector: null }).skipped).toBe(true);
        expect(a.tryInsert({ hex: 'aa', score: 0.5, vector: [] }).skipped).toBe(true);
        expect(a.size).toBe(0);
    });

    it('fills an empty perceptual cell and strips the raw vector when storing', () => {
        const a = new EmbeddingArchive();
        const res = a.tryInsert({ hex: 'aa', score: 0.5, vector: [1, 0, 0, 0] });
        expect(res.added).toBe(true);
        expect(a.size).toBe(1);
        const stored = a.getEntries()[0];
        expect(stored.hex).toBe('aa');
        expect(stored.cellKey).toBe(res.cellKey);
        expect(stored.vector).toBeUndefined(); // compact: no raw vector persisted
    });

    it('keeps only the best entry per cell', () => {
        const a = new EmbeddingArchive();
        const v = [1, 0, 0, 0];
        a.tryInsert({ hex: 'aa', score: 0.5, vector: v });
        const worse = a.tryInsert({ hex: 'bb', score: 0.3, vector: v });
        expect(worse.added).toBe(false);
        expect(worse.improved).toBe(false);
        const better = a.tryInsert({ hex: 'cc', score: 0.8, vector: v });
        expect(better.improved).toBe(true);
        expect(a.size).toBe(1);
        expect(a.getEntries()[0].hex).toBe('cc');
    });

    it('distinct directions land in distinct cells', () => {
        const a = new EmbeddingArchive();
        a.tryInsert({ hex: 'aa', score: 0.5, vector: [1, 1, 1, 1] });
        a.tryInsert({ hex: 'bb', score: 0.5, vector: [-1, -1, -1, -1] });
        expect(a.size).toBe(2);
    });
});

describe('EmbeddingArchive novelty', () => {
    it('an occupied cell with a better incumbent penalizes a different candidate', () => {
        const a = new EmbeddingArchive();
        const v = [1, 0, 0, 0];
        a.tryInsert({ hex: 'aa', score: 0.8, vector: v });
        expect(a.isOccupiedBetter(v, 0.5, 'bb')).toBe(true);
        expect(a.noveltyMultiplier(v, 0.5, 'bb')).toBe(EMBEDDING_ARCHIVE_CONFIG.occupiedNoveltyMultiplier);
    });

    it('self-exemption: the incumbent is never penalized against its own cell', () => {
        const a = new EmbeddingArchive();
        const v = [1, 0, 0, 0];
        a.tryInsert({ hex: 'aa', score: 0.8, vector: v });
        expect(a.isOccupiedBetter(v, 0.5, 'aa')).toBe(false);
        expect(a.noveltyMultiplier(v, 0.5, 'aa')).toBe(1);
    });

    it('an empty/better cell is not penalized', () => {
        const a = new EmbeddingArchive();
        const v = [1, 0, 0, 0];
        expect(a.noveltyMultiplier(v, 0.5, 'aa')).toBe(1); // empty
        a.tryInsert({ hex: 'aa', score: 0.3, vector: v });
        expect(a.noveltyMultiplier(v, 0.9, 'bb')).toBe(1); // candidate would improve the cell
    });

    it('a null/absent embedding is never penalized', () => {
        const a = new EmbeddingArchive();
        expect(a.noveltyMultiplier(null, 0.5, 'aa')).toBe(1);
    });
});

describe('EmbeddingArchive persistence round-trip', () => {
    it('re-seeds occupancy from compact entries by cellKey (no raw vector needed)', () => {
        const a = new EmbeddingArchive();
        a.tryInsert({ hex: 'aa', score: 0.5, vector: [1, 0, 0, 0] });
        a.tryInsert({ hex: 'bb', score: 0.7, vector: [-1, -1, 1, 1] });
        const dumped = a.getEntries();
        expect(dumped.every((e) => e.vector === undefined)).toBe(true);

        const b = new EmbeddingArchive();
        b.loadEntries(dumped);
        expect(b.size).toBe(a.size);
        expect(b.getEntries()[0].hex).toBe('bb'); // best-first preserved
    });

    it('loadEntries keeps the best per cell and ignores malformed rows', () => {
        const a = new EmbeddingArchive();
        a.loadEntries([
            { hex: 'aa', score: 0.4, cellKey: 'k1' },
            { hex: 'bb', score: 0.9, cellKey: 'k1' }, // same cell, better → wins
            { hex: 'cc', score: 0.5, cellKey: 'k2' },
            { nope: true },                            // malformed → ignored
            null,
        ]);
        expect(a.size).toBe(2);
        const k1 = a.getEntries().find((e) => e.cellKey === 'k1');
        expect(k1.hex).toBe('bb');
    });
});
