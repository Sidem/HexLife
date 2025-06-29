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

    setGradient(colors) {
        this.settings.mode = 'gradient';
        this.settings.customGradient = colors;
        this.#saveAndDispatch();
    }

    setNeighborColor(centerState, neighborCount, color) {
        this.settings.mode = 'neighbor_count';
        const key = `${centerState}-${neighborCount}`;
        this.settings.customNeighborColors[key] = color;
        this.#saveAndDispatch();
    }

    setSymmetryColor(centerState, canonicalBitmask, color) {
        this.settings.mode = 'symmetry';
        const key = `${centerState}-${canonicalBitmask}`;
        this.settings.customSymmetryColors[key] = color;
        this.#saveAndDispatch();
    }

    /**
     * Efficiently updates multiple colors at once and dispatches a single update event.
     * @param {'neighbor_count' | 'symmetry'} groupType - The type of group being updated.
     * @param {Array<{centerState: number, groupIdentifier: number, color: string}>} newColors - An array of color updates.
     */
    setBatchColors(groupType, newColors) {
        this.settings.mode = groupType;
        if (groupType === 'neighbor_count') {
            for (const { centerState, groupIdentifier, color } of newColors) {
                const key = `${centerState}-${groupIdentifier}`;
                this.settings.customNeighborColors[key] = color;
            }
        } else if (groupType === 'symmetry') {
            for (const { centerState, groupIdentifier, color } of newColors) {
                const key = `${centerState}-${groupIdentifier}`;
                this.settings.customSymmetryColors[key] = color;
            }
        }
        this.#saveAndDispatch();
    }
} 