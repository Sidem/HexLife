import { describe, it, expect, beforeEach } from 'vitest';
import * as PersistenceService from '../src/services/PersistenceService.js';

// PersistenceService touches localStorage only inside its functions (never at import time), so a
// simple Map-backed stub makes the embedding-gallery namespacing (v3.1) testable in the node env.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
};

const GALLERY_KEY = 'hexLifeExplorer_embeddingGallery';
const DEFAULT_MODEL = 'Xenova/clip-vit-base-patch16';
const OTHER_MODEL = 'Xenova/clip-vit-large-patch14';
const entries = [{ hex: 'A'.repeat(32), score: 0.5, cell: 'c1' }];

describe('embedding gallery persistence — model namespacing (v3.1)', () => {
    beforeEach(() => store.clear());

    it('round-trips entries under the model that wrote them', () => {
        PersistenceService.saveEmbeddingGallery(entries, DEFAULT_MODEL);
        expect(PersistenceService.loadEmbeddingGallery(DEFAULT_MODEL)).toEqual(entries);
    });

    it('self-invalidates on a model mismatch (cells are not comparable across models)', () => {
        PersistenceService.saveEmbeddingGallery(entries, DEFAULT_MODEL);
        expect(PersistenceService.loadEmbeddingGallery(OTHER_MODEL)).toEqual([]);
    });

    it('skips the check when no expected model is given (legacy call sites)', () => {
        PersistenceService.saveEmbeddingGallery(entries, DEFAULT_MODEL);
        expect(PersistenceService.loadEmbeddingGallery()).toEqual(entries);
    });

    it('treats a legacy plain-array blob as the pre-v3.1 default model\'s', () => {
        store.set(GALLERY_KEY, JSON.stringify(entries));
        expect(PersistenceService.loadEmbeddingGallery(DEFAULT_MODEL)).toEqual(entries);
        expect(PersistenceService.loadEmbeddingGallery(OTHER_MODEL)).toEqual([]);
    });

    it('returns [] for an empty or malformed blob', () => {
        expect(PersistenceService.loadEmbeddingGallery(DEFAULT_MODEL)).toEqual([]);
        store.set(GALLERY_KEY, JSON.stringify({ modelId: DEFAULT_MODEL })); // no entries field
        expect(PersistenceService.loadEmbeddingGallery(DEFAULT_MODEL)).toEqual([]);
    });
});
