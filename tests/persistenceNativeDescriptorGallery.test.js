import { beforeEach, describe, expect, it } from 'vitest';
import * as PersistenceService from '../src/services/PersistenceService.js';

const store = new Map();
globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
};

const NATIVE_KEY = 'hexLifeExplorer_nativeDescriptorGallery';
const LEGACY_KEY = 'hexLifeExplorer_embeddingGallery';
const entries = [{ hex: 'A'.repeat(32), score: 0.5, cellKey: '10101010' }];

describe('native descriptor persistence', () => {
    beforeEach(() => store.clear());

    it('round-trips entries only for the model that wrote them', () => {
        PersistenceService.saveNativeDescriptorGallery(entries, 'model-a');
        expect(PersistenceService.loadNativeDescriptorGallery('model-a')).toEqual(entries);
        expect(PersistenceService.loadNativeDescriptorGallery('model-b')).toEqual([]);
    });

    it('returns an empty archive for malformed data', () => {
        store.set(NATIVE_KEY, JSON.stringify({ modelId: 'model-a' }));
        expect(PersistenceService.loadNativeDescriptorGallery('model-a')).toEqual([]);
    });

    it('safely discards the obsolete CLIP-keyed archive during migration', () => {
        store.set(LEGACY_KEY, JSON.stringify({ modelId: 'legacy', entries }));
        expect(PersistenceService.loadNativeDescriptorGallery('model-a')).toEqual([]);
        expect(store.has(LEGACY_KEY)).toBe(false);
    });
});
