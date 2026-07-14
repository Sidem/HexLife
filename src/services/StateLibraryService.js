import * as DefaultPersistence from './PersistenceService.js';
import { EventBus, EVENTS } from './EventBus.js';

/** Soft cap on the library. At the cap we refuse and tell the user — never silently evict their data. */
export const MAX_ENTRIES = 40;

/**
 * "Saved Starts" library: captured cell grids the user can re-use as any world's initial state.
 *
 * CRUD only — the capture itself lives in WorldManager (it needs live proxy state). Every mutation
 * persists and announces itself with `SAVED_STATES_CHANGED` so open UI refreshes.
 *
 * A world *embeds* the entry's payload in its `initialState.params` rather than referencing it by
 * id (the worker has no localStorage, and deleting an entry must never break a world that uses it);
 * `buildInitialState` is the single place that shape is minted.
 */
export class StateLibraryService {
    /** @param {object} [persistence] Injectable for tests; defaults to the real PersistenceService. */
    constructor(persistence = DefaultPersistence) {
        this.persistence = persistence;
        this.entries = this.persistence.loadSavedStates();
    }

    getAll() {
        return this.entries;
    }

    getById(id) {
        return this.entries.find(e => e.id === id) || null;
    }

    /**
     * Add a captured entry.
     * @param {object} entry A full library entry (id/name/rows/cols/stateB64/density/…).
     * @returns {{entry: object|null, deduped: boolean, error?: string}} `entry` is the stored entry
     *   (the pre-existing one when deduped); `error` is set — and `entry` null — when the add was
     *   refused (cap reached, bad payload, failed write).
     */
    add(entry) {
        if (!entry || typeof entry.stateB64 !== 'string' || !entry.stateB64) {
            return { entry: null, deduped: false, error: 'Nothing to save — the captured state was empty.' };
        }

        // Capturing the same grid twice is one entry, not two.
        const existing = this.entries.find(e =>
            e.stateB64 === entry.stateB64 && e.rows === entry.rows && e.cols === entry.cols
        );
        if (existing) return { entry: existing, deduped: true };

        if (this.entries.length >= MAX_ENTRIES) {
            return {
                entry: null,
                deduped: false,
                error: `Saved-starts library is full (${MAX_ENTRIES}). Delete an entry before capturing another.`,
            };
        }

        this.entries = [entry, ...this.entries];
        if (!this._persist()) {
            this.entries = this.entries.filter(e => e !== entry);
            return { entry: null, deduped: false, error: 'Could not save — browser storage is full.' };
        }
        return { entry, deduped: false };
    }

    rename(id, name) {
        const entry = this.getById(id);
        const trimmed = (name || '').trim();
        if (!entry || !trimmed) return false;
        entry.name = trimmed;
        return this._persist();
    }

    remove(id) {
        const next = this.entries.filter(e => e.id !== id);
        if (next.length === this.entries.length) return false;
        this.entries = next;
        return this._persist();
    }

    /**
     * The `{ mode, params }` an entry becomes when assigned to a world. The payload travels with the
     * assignment (see the class docs), so `id`/`name` are provenance for the UI, not a live link.
     * @param {object} entry
     * @returns {{mode: 'saved', params: object}}
     */
    buildInitialState(entry) {
        return {
            mode: 'saved',
            params: {
                id: entry.id,
                name: entry.name,
                rows: entry.rows,
                cols: entry.cols,
                stateB64: entry.stateB64,
                density: entry.density,
            },
        };
    }

    _persist() {
        const ok = this.persistence.saveSavedStates(this.entries);
        EventBus.dispatch(EVENTS.SAVED_STATES_CHANGED, this.entries);
        return ok;
    }
}

/** App-wide instance. WorldManager (capture) and the modal (browse/manage) share it. */
export const stateLibraryService = new StateLibraryService();
