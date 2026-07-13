import { describe, it, expect } from 'vitest';
import {
    CANONICAL_TAGS,
    CANONICAL_TAG_IDS,
    getTag,
    isCanonicalTag,
    tagLabel,
    normalizeTag,
} from '../src/core/tags.js';

describe('tags — canonical vocabulary', () => {
    it('every entry has id/label/description/promptText', () => {
        for (const t of CANONICAL_TAGS) {
            expect(typeof t.id).toBe('string');
            expect(t.id.length).toBeGreaterThan(0);
            expect(typeof t.label).toBe('string');
            expect(typeof t.description).toBe('string');
            expect(typeof t.promptText).toBe('string');
            expect(t.promptText.length).toBeGreaterThan(0);
        }
    });

    it('ids are unique and kebab-case', () => {
        const ids = CANONICAL_TAGS.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it('CANONICAL_TAG_IDS mirrors the array order', () => {
        expect(CANONICAL_TAG_IDS).toEqual(CANONICAL_TAGS.map(t => t.id));
    });

    it('includes the plan\'s starting set', () => {
        for (const id of ['gliders', 'ships', 'spirals', 'oscillators', 'still-life', 'growth',
            'decay', 'chaos', 'edge-of-chaos']) {
            expect(CANONICAL_TAG_IDS).toContain(id);
        }
    });

    it('getTag / isCanonicalTag / tagLabel', () => {
        expect(getTag('gliders')?.label).toBe('Gliders');
        expect(getTag('nope')).toBeUndefined();
        expect(isCanonicalTag('gliders')).toBe(true);
        expect(isCanonicalTag('my-custom')).toBe(false);
        expect(tagLabel('gliders')).toBe('Gliders');
        expect(tagLabel('my-custom')).toBe('my-custom'); // custom tags render as-is
    });

    it('normalizeTag lowercases, trims and hyphenates whitespace', () => {
        expect(normalizeTag('  Still Life ')).toBe('still-life'); // collapses onto the canonical id
        expect(normalizeTag('GLIDERS')).toBe('gliders');
        expect(normalizeTag('edge  of   chaos')).toBe('edge-of-chaos');
        expect(normalizeTag('   ')).toBe('');
        expect(normalizeTag(null)).toBe('');
    });
});
