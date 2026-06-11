import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { rulesetName } from '../../utils/utils.js';

export class LibraryController {
    constructor() {
        this.libraryData = null;
        this.userLibrary = [];
        this.userPatterns = [];
    }

    init(libraryData) {
        this.libraryData = libraryData;
        this.userLibrary = PersistenceService.loadUserRulesets();
        this.userPatterns = PersistenceService.loadUserPatterns();
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
            EventBus.dispatch(EVENTS.COMMAND_ENTER_PLACING_MODE, { cells: patternData.cells });
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
            EventBus.dispatch(EVENTS.COMMAND_ENTER_PLACING_MODE, { cells: patternData.cells });
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
     * @param {{name: string, description: string, hex: string, id?: string}} rulesetData 
     */
    saveUserRuleset(rulesetData) {
        const existingIndex = rulesetData.id ? this.userLibrary.findIndex(r => r.id === rulesetData.id) : -1;

        if (existingIndex > -1) {
            
            this.userLibrary[existingIndex] = { ...this.userLibrary[existingIndex], ...rulesetData };
        } else {
            
            const newRule = {
                id: String(Date.now()),
                createdAt: new Date().toISOString(),
                ...rulesetData
            };
            this.userLibrary.unshift(newRule);
        }

        PersistenceService.saveUserRulesets(this.userLibrary);
        EventBus.dispatch(EVENTS.USER_LIBRARY_CHANGED);
        EventBus.dispatch(EVENTS.USER_RULESET_SAVED, { ruleset: rulesetData });
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