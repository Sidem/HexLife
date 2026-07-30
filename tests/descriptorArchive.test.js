import { describe, expect, it } from 'vitest';
import {
    DESCRIPTOR_ARCHIVE_CONFIG,
    DescriptorArchive,
    buildProjection,
    hashDescriptor,
} from '../src/core/analysis/DescriptorArchive.js';

describe('native descriptor hashing', () => {
    it('is deterministic and separates opposite descriptors', () => {
        const planes = buildProjection(32, 8, 123);
        const vector = Float32Array.from({ length: 32 }, (_, index) => index - 15);
        expect(hashDescriptor(vector, planes)).toBe(hashDescriptor(vector, planes));
        expect(hashDescriptor(vector, planes)).not.toBe(
            hashDescriptor(Float32Array.from(vector, (value) => -value), planes),
        );
    });
});

describe('DescriptorArchive', () => {
    it('keeps the best find per learned cell without persisting the raw descriptor', () => {
        const archive = new DescriptorArchive();
        const vector = new Float32Array(32).fill(1);
        expect(archive.tryInsert({ hex: 'low', score: 0.3, vector }).added).toBe(true);
        expect(archive.tryInsert({ hex: 'worse', score: 0.2, vector }).improved).toBe(false);
        expect(archive.tryInsert({ hex: 'best', score: 0.8, vector }).improved).toBe(true);
        expect(archive.getEntries()).toEqual([
            expect.objectContaining({ hex: 'best', score: 0.8 }),
        ]);
        expect(archive.getEntries()[0]).not.toHaveProperty('vector');
    });

    it('applies novelty pressure only for a different equal-or-better incumbent', () => {
        const archive = new DescriptorArchive();
        const vector = new Float32Array(32).fill(1);
        archive.tryInsert({ hex: 'incumbent', score: 0.7, vector });
        expect(archive.noveltyMultiplier(vector, 0.5, 'candidate'))
            .toBe(DESCRIPTOR_ARCHIVE_CONFIG.occupiedNoveltyMultiplier);
        expect(archive.noveltyMultiplier(vector, 0.7, 'incumbent')).toBe(1);
        expect(archive.noveltyMultiplier(null, 0.1, 'candidate')).toBe(1);
    });

    it('round-trips compact cells and self-heals duplicates', () => {
        const archive = new DescriptorArchive();
        archive.loadEntries([
            { hex: 'low', score: 0.2, cellKey: '10101010' },
            { hex: 'best', score: 0.9, cellKey: '10101010' },
            { hex: 'other', score: 0.4, cellKey: '01010101' },
            { hex: 'bad', score: Number.NaN, cellKey: '11111111' },
        ]);
        expect(archive.size).toBe(2);
        expect(archive.getEntries().map((entry) => entry.hex)).toEqual(['best', 'other']);
    });
});
