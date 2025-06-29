import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { PRESET_PALETTES } from '../../core/colorPalettes.js';

export class ColorController {
    constructor() {
        this.settings = PersistenceService.loadColorSettings();
        this.presets = PRESET_PALETTES;
    }

    getSettings() {
        return this.settings;
    }

    getPresets() {
        return this.presets;
    }

    #saveAndDispatch() {
        PersistenceService.saveColorSettings(this.settings);
        EventBus.dispatch(EVENTS.COLOR_SETTINGS_CHANGED, this.settings);
    }

    setMode(mode) {
        if (this.settings.mode === mode) return;
        this.settings.mode = mode;
        this.#saveAndDispatch();
    }

    applyPreset(presetName) {
        if (!this.presets[presetName]) return;
        this.settings.mode = 'preset';
        this.settings.activePreset = presetName;
        this.#saveAndDispatch();
    }

    setColorForGroup(groupType, groupKey, stateType, newColor) {
        if (groupType === 'neighbor_count') {
            if (!this.settings.customNeighborColors[groupKey]) {
                this.settings.customNeighborColors[groupKey] = { on: '#ffffff', off: '#333333' };
            }
            this.settings.customNeighborColors[groupKey][stateType] = newColor;
        } else if (groupType === 'symmetry') {
            if (!this.settings.customSymmetryColors[groupKey]) {
                this.settings.customSymmetryColors[groupKey] = { on: '#ffffff', off: '#333333' };
            }
            this.settings.customSymmetryColors[groupKey][stateType] = newColor;
        }
        this.settings.mode = groupType;
        this.#saveAndDispatch();
    }

    setBatchColors(groupType, groupKeys, stateType, newColor) {
        const targetObject = groupType === 'neighbor_count' 
            ? this.settings.customNeighborColors
            : this.settings.customSymmetryColors;

        for (const key of groupKeys) {
            if (!targetObject[key]) {
                 targetObject[key] = { on: '#ffffff', off: '#333333' };
            }
            targetObject[key][stateType] = newColor;
        }
        this.settings.mode = groupType;
        this.#saveAndDispatch();
    }
} 