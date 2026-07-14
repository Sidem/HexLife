import { describe, it, expect, beforeEach } from 'vitest';
import * as PersistenceService from '../src/services/PersistenceService.js';

// Same Map-backed localStorage stub the embedding-gallery suite uses (PersistenceService only touches
// localStorage inside its functions, never at import time).
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
};

const KEY = 'hexLifeExplorer_savedStates';
const valid = { id: 'a', name: 'ember-drift @ 12', rows: 8, cols: 8, stateB64: 'AAAA', density: 0.4 };

describe('saved-starts persistence', () => {
    beforeEach(() => store.clear());

    it('round-trips entries', () => {
        expect(PersistenceService.saveSavedStates([valid])).toBe(true);
        expect(PersistenceService.loadSavedStates()).toEqual([valid]);
    });

    it('loads an empty library when nothing is stored', () => {
        expect(PersistenceService.loadSavedStates()).toEqual([]);
    });

    it('loads a malformed blob as an empty library', () => {
        store.set(KEY, 'not json at all');
        expect(PersistenceService.loadSavedStates()).toEqual([]);
        store.set(KEY, JSON.stringify({ nope: true }));
        expect(PersistenceService.loadSavedStates()).toEqual([]);
    });

    it('drops entries missing the fields a reset would need', () => {
        store.set(KEY, JSON.stringify([
            valid,
            { id: 'b', rows: 8, cols: 8 },                       // no payload
            { id: 'c', stateB64: 'AAAA' },                       // no dims
            { name: 'd', rows: 8, cols: 8, stateB64: 'AAAA' },   // no id
            null,
        ]));
        expect(PersistenceService.loadSavedStates()).toEqual([valid]);
    });
});
