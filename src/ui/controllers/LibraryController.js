import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class LibraryController {
    constructor() {
        this.libraryData = null;
        this.userLibrary = [];
    }

    init(libraryData) {
        this.libraryData = libraryData;
        this.userLibrary = PersistenceService.loadUserRulesets();
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