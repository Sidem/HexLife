import { EventBus, EVENTS } from '../../services/EventBus.js';

export class LibraryController {
    constructor() {
        this.libraryData = null;
    }

    init(libraryData) {
        this.libraryData = libraryData;
    }

    getLibraryData() {
        return this.libraryData;
    }

    loadRuleset(hexString, scope = 'all', autoReset = true) {
        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
            hexString,
            resetScopeForThisChange: autoReset ? scope : 'none'
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
} 