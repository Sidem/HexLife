import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateLibraryService, MAX_ENTRIES } from '../src/services/StateLibraryService.js';

// A tiny in-memory stand-in for PersistenceService's saved-states pair.
function fakePersistence(initial = [], { failWrites = false } = {}) {
    return {
        store: initial,
        loadSavedStates: vi.fn(function () { return Array.isArray(this.store) ? this.store : []; }),
        saveSavedStates: vi.fn(function (entries) {
            if (failWrites) return false;
            this.store = entries;
            return true;
        }),
    };
}

const entry = (id, b64 = 'AAAA', over = {}) => ({
    id, name: `start ${id}`, rows: 8, cols: 8, stateB64: b64, density: 0.5, ...over,
});

describe('StateLibraryService', () => {
    let persistence;
    let service;

    beforeEach(() => {
        persistence = fakePersistence();
        service = new StateLibraryService(persistence);
    });

    it('adds, persists and returns entries newest-first', () => {
        service.add(entry('a', 'AAAA'));
        const { entry: b, deduped } = service.add(entry('b', 'BBBB'));

        expect(deduped).toBe(false);
        expect(b.id).toBe('b');
        expect(service.getAll().map(e => e.id)).toEqual(['b', 'a']);
        expect(persistence.store.map(e => e.id)).toEqual(['b', 'a']);
        expect(service.getById('a').name).toBe('start a');
    });

    it('dedupes on identical stateB64 + dims instead of creating a second entry', () => {
        const { entry: first } = service.add(entry('a', 'AAAA'));
        const { entry: same, deduped } = service.add(entry('b', 'AAAA'));

        expect(deduped).toBe(true);
        expect(same).toBe(first);
        expect(service.getAll()).toHaveLength(1);
    });

    it('treats the same payload at different dims as a distinct entry', () => {
        service.add(entry('a', 'AAAA'));
        const { deduped } = service.add(entry('b', 'AAAA', { rows: 16, cols: 16 }));
        expect(deduped).toBe(false);
        expect(service.getAll()).toHaveLength(2);
    });

    it('refuses at the cap rather than evicting the user\'s data', () => {
        for (let i = 0; i < MAX_ENTRIES; i++) service.add(entry(`e${i}`, `payload-${i}`));
        const { entry: refused, error } = service.add(entry('overflow', 'payload-overflow'));

        expect(refused).toBeNull();
        expect(error).toMatch(/full/i);
        expect(service.getAll()).toHaveLength(MAX_ENTRIES);
    });

    it('renames and removes, persisting each time', () => {
        service.add(entry('a'));
        expect(service.rename('a', '  ember drift  ')).toBe(true);
        expect(service.getById('a').name).toBe('ember drift');
        expect(service.rename('a', '   ')).toBe(false);
        expect(service.rename('missing', 'x')).toBe(false);

        expect(service.remove('a')).toBe(true);
        expect(service.getAll()).toHaveLength(0);
        expect(persistence.store).toHaveLength(0);
        expect(service.remove('a')).toBe(false);
    });

    it('rolls the add back when the write fails (quota)', () => {
        const failing = new StateLibraryService(fakePersistence([], { failWrites: true }));
        const { entry: stored, error } = failing.add(entry('a'));
        expect(stored).toBeNull();
        expect(error).toMatch(/storage/i);
        expect(failing.getAll()).toHaveLength(0);
    });

    it('rejects an empty payload', () => {
        const { entry: stored, error } = service.add({ id: 'a', rows: 8, cols: 8, stateB64: '' });
        expect(stored).toBeNull();
        expect(error).toBeTruthy();
    });

    it('buildInitialState embeds the payload so a deleted entry cannot break a world', () => {
        const { entry: stored } = service.add(entry('a', 'AAAA'));
        const initialState = service.buildInitialState(stored);
        service.remove('a');

        expect(initialState).toEqual({
            mode: 'saved',
            params: { id: 'a', name: 'start a', rows: 8, cols: 8, stateB64: 'AAAA', density: 0.5 },
        });
    });

    it('loads a malformed stored blob as an empty library', () => {
        const bad = new StateLibraryService({
            loadSavedStates: () => [],   // PersistenceService already filters junk to []
            saveSavedStates: () => true,
        });
        expect(bad.getAll()).toEqual([]);
    });
});
