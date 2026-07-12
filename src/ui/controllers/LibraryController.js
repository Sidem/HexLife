import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { rulesetName } from '../../utils/utils.js';
import { encodePack, mergeRulesets } from '../../services/LibraryPackCodec.js';

/** Current personal-ruleset entry schema. v2 adds the paired initial condition + thumbnail. */
export const RULESET_SCHEMA_VERSION = 2;

/**
 * Bring a stored ruleset entry up to the current schema. Legacy entries (no `schemaVersion`) keep
 * working — the v2 fields default to empty/`null`, so they behave exactly as before until a save
 * pairs an initial condition or bakes a thumbnail. Pure; safe to map over the loaded array.
 * @param {object} entry
 * @returns {object}
 */
export function normalizeRulesetEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    return {
        initialState: null,
        seed: null,
        thumb: null,
        ...entry,
        // Coerce any stray/absent tags to an array so the UI/search can rely on the shape.
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        schemaVersion: RULESET_SCHEMA_VERSION,
    };
}

export class LibraryController {
    constructor() {
        this.libraryData = null;
        this.userLibrary = [];
        this.userPatterns = [];
        // In-memory pattern clipboard for the Ctrl+C / Ctrl+V copy-paste workflow.
        // {cells: Array<[number, number]>, originParity: number} | null
        this.patternClipboard = null;
    }

    init(libraryData) {
        this.libraryData = libraryData;
        this.userLibrary = PersistenceService.loadUserRulesets().map(normalizeRulesetEntry);
        this.userPatterns = PersistenceService.loadUserPatterns();

        EventBus.subscribe(EVENTS.COMMAND_COPY_PATTERN, () => {
            EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            EventBus.dispatch(EVENTS.COMMAND_START_PATTERN_CAPTURE, { mode: 'copy' });
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_PATTERN_CLIPBOARD, (data) => this.setPatternClipboard(data));
        EventBus.subscribe(EVENTS.COMMAND_PASTE_PATTERN, () => this.pasteClipboardPattern());
    }

    /**
     * Stores a captured pattern on the clipboard and notifies the user.
     * @param {{cells: Array<[number, number]>, originParity?: number}} data
     */
    setPatternClipboard(data) {
        if (!data || !Array.isArray(data.cells) || data.cells.length === 0) return;
        this.patternClipboard = { cells: data.cells, originParity: data.originParity ?? 0 };
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: `Copied ${data.cells.length} cells — Ctrl+V to paste.`,
            type: 'success'
        });
    }

    /** @returns {{cells: Array<[number, number]>, originParity: number}|null} */
    getPatternClipboard() {
        return this.patternClipboard;
    }

    /** Enters placing mode with the clipboard pattern, if any. */
    pasteClipboardPattern() {
        if (!this.patternClipboard) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'Nothing copied yet — Ctrl+C, then drag a box over active cells.',
                type: 'info'
            });
            return;
        }
        EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        EventBus.dispatch(EVENTS.COMMAND_ENTER_PLACING_MODE, {
            cells: this.patternClipboard.cells,
            originParity: this.patternClipboard.originParity
        });
    }

    getUserLibrary() {
        return [...this.userLibrary];
    }

    getLibraryData() {
        return this.libraryData;
    }

    loadRuleset(hexString, scope = 'all', autoReset = true) {
        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
            hexString: hexString,
            scope: scope,
            resetOnNewRule: autoReset
        });
    }

    placePattern(patternName) {
        if (!this.libraryData) return;
        const patternData = this.libraryData.patterns.find(p => p.name === patternName);
        if (patternData) {
            EventBus.dispatch(EVENTS.COMMAND_ENTER_PLACING_MODE, {
                cells: patternData.cells,
                originParity: patternData.originParity ?? 0
            });
        }
    }

    /**
     * Returns a copy of the user's personal pattern library.
     * @returns {Array<{id: string, name: string, cells: Array<[number, number]>, createdAt: string}>}
     */
    getUserPatterns() {
        return [...this.userPatterns];
    }

    /**
     * Adds (or updates, if `id` matches) a pattern in the user's personal pattern library.
     * @param {{name: string, cells: Array<[number, number]>, id?: string}} patternData
     */
    saveUserPattern(patternData) {
        const existingIndex = patternData.id ? this.userPatterns.findIndex(p => p.id === patternData.id) : -1;

        if (existingIndex > -1) {
            this.userPatterns[existingIndex] = { ...this.userPatterns[existingIndex], ...patternData };
        } else {
            const newPattern = {
                id: String(Date.now()),
                createdAt: new Date().toISOString(),
                ...patternData
            };
            this.userPatterns.unshift(newPattern);
        }

        PersistenceService.saveUserPatterns(this.userPatterns);
        EventBus.dispatch(EVENTS.USER_PATTERNS_CHANGED);
        EventBus.dispatch(EVENTS.USER_PATTERN_SAVED, { pattern: patternData });
    }

    /**
     * Deletes a pattern from the user's personal pattern library.
     * @param {string} patternId The ID of the pattern to delete.
     */
    deleteUserPattern(patternId) {
        this.userPatterns = this.userPatterns.filter(p => p.id !== patternId);
        PersistenceService.saveUserPatterns(this.userPatterns);
        EventBus.dispatch(EVENTS.USER_PATTERNS_CHANGED);
    }

    /**
     * Enters placing mode for one of the user's saved patterns.
     * @param {string} patternId The ID of the pattern to place.
     */
    placeUserPattern(patternId) {
        const patternData = this.userPatterns.find(p => p.id === patternId);
        if (patternData && Array.isArray(patternData.cells) && patternData.cells.length > 0) {
            // Make this the active clipboard pattern so Ctrl+V repeats the placement.
            this.patternClipboard = { cells: patternData.cells, originParity: patternData.originParity ?? 0 };
            EventBus.dispatch(EVENTS.COMMAND_ENTER_PLACING_MODE, {
                cells: patternData.cells,
                originParity: patternData.originParity ?? 0
            });
        }
    }

    getRulesets() {
        return this.libraryData ? this.libraryData.rulesets : [];
    }

    getPatterns() {
        return this.libraryData ? this.libraryData.patterns : [];
    }

    /**
     * Adds or updates a ruleset in the user's personal library.
     * @param {{name: string, description?: string, hex: string, id?: string, tags?: string[],
     *   initialState?: {mode: string, params: object}|null, seed?: number|null,
     *   thumb?: string|null}} rulesetData The `initialState`/`seed` pair the ruleset was generated
     *   from (optional), and an optional evolved-world `thumb` data-URL.
     */
    saveUserRuleset(rulesetData) {
        const existingIndex = rulesetData.id ? this.userLibrary.findIndex(r => r.id === rulesetData.id) : -1;

        if (existingIndex > -1) {
            // Merge over the existing entry (a rename/edit shouldn't drop a previously-paired IC or
            // thumbnail unless the caller explicitly supplies new ones), then re-normalize the shape.
            this.userLibrary[existingIndex] = normalizeRulesetEntry({ ...this.userLibrary[existingIndex], ...rulesetData });
        } else {
            this.userLibrary.unshift(normalizeRulesetEntry({
                id: String(Date.now()),
                createdAt: new Date().toISOString(),
                ...rulesetData
            }));
        }

        PersistenceService.saveUserRulesets(this.userLibrary);
        EventBus.dispatch(EVENTS.USER_LIBRARY_CHANGED);
        EventBus.dispatch(EVENTS.USER_RULESET_SAVED, { ruleset: rulesetData });
    }

    /**
     * Persist a freshly-baked thumbnail onto an existing personal entry (used by the lazy backfill).
     * No-op if the id is unknown. By default fires USER_LIBRARY_CHANGED so the open list re-renders;
     * pass `{ silent: true }` (the backfill path) to persist without a re-render — the caller updates
     * the single card's image directly, avoiding a re-render storm as each thumbnail lands.
     * @param {string} id
     * @param {string} thumb data-URL
     * @param {{silent?: boolean}} [opts]
     */
    setUserRulesetThumb(id, thumb, { silent = false } = {}) {
        const idx = this.userLibrary.findIndex(r => r.id === id);
        if (idx < 0 || !thumb) return;
        this.userLibrary[idx] = { ...this.userLibrary[idx], thumb };
        PersistenceService.saveUserRulesets(this.userLibrary);
        if (!silent) EventBus.dispatch(EVENTS.USER_LIBRARY_CHANGED);
    }

    /**
     * Serialize the entire personal library into a portable pack JSON string (schema-v2 entries,
     * volatile id/createdAt/schemaVersion stripped, oversized thumbs dropped by the codec).
     * @returns {string}
     */
    exportPackJSON() {
        return encodePack({ rulesets: this.userLibrary });
    }

    /**
     * Merge decoded pack rulesets into the personal library, deduping BY HEX (ids are re-minted, so
     * they can't be the identity). Adds happen in one batch: fresh ids/timestamps, a single persist,
     * and a single {@link EVENTS.USER_LIBRARY_CHANGED}. Idempotent — re-importing the same pack adds 0.
     * @param {object[]} decodedRulesets Already sanitized by {@link decodePack}.
     * @returns {{added: number, skipped: number}}
     */
    importRulesets(decodedRulesets) {
        const { toAdd, added, skipped } = mergeRulesets(this.userLibrary, decodedRulesets);
        if (toAdd.length) {
            const stamp = Date.now();
            const fresh = toAdd.map((entry, i) => normalizeRulesetEntry({
                ...entry,
                id: `${stamp}-${i}`,
                createdAt: new Date().toISOString(),
            }));
            // Newest-first, matching saveUserRuleset's unshift ordering.
            this.userLibrary = [...fresh, ...this.userLibrary];
            PersistenceService.saveUserRulesets(this.userLibrary);
            EventBus.dispatch(EVENTS.USER_LIBRARY_CHANGED);
        }
        return { added, skipped };
    }

    /**
     * Deletes a ruleset from the user's personal library.
     * @param {string} rulesetId The ID of the ruleset to delete.
     */
    deleteUserRuleset(rulesetId) {
        this.userLibrary = this.userLibrary.filter(r => r.id !== rulesetId);
        PersistenceService.saveUserRulesets(this.userLibrary);
        EventBus.dispatch(EVENTS.USER_LIBRARY_CHANGED);
    }

    /**
     * Resolves a human-friendly display name for a ruleset: the personal or public
     * library name if one exists, otherwise the deterministic derived mnemonic.
     * @param {string} hex The ruleset hex.
     * @returns {{name: string, isDerived: boolean}} The resolved name and whether it
     *          was auto-derived (vs a name the user/library assigned).
     */
    getDisplayName(hex) {
        const saved = this.userLibrary.find(r => r.hex === hex)?.name
            || this.libraryData?.rulesets.find(r => r.hex === hex)?.name;
        if (saved) return { name: saved, isDerived: false };
        return { name: rulesetName(hex), isDerived: true };
    }

    /**
     * Checks the status of a given ruleset hex.
     * @param {string} hex The ruleset hex to check.
     * @returns {{isPersonal: boolean, isPublic: boolean}}
     */
    getRulesetStatus(hex) {
        if (!hex || hex.length !== 32) return { isPersonal: false, isPublic: false };
        
        const isPersonal = this.userLibrary.some(r => r.hex === hex);
        if (isPersonal) return { isPersonal: true, isPublic: false };

        const isPublic = this.libraryData.rulesets.some(r => r.hex === hex);
        return { isPersonal: false, isPublic };
    }
} 