import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { PRESET_PALETTES } from '../../core/colorPalettes.js';
import { DEFAULT_COLOR_SCHEMES } from '../../core/config.js';
import { hexToRgb, getGradientColor } from '../../utils/ruleVizUtils.js';

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

        const selectedPreset = this.presets[presetName];

        if (selectedPreset.logic) {
            // If the preset has a 'logic' key, switch to that customization mode and generate custom colors from gradient only if not already set
            this.settings.mode = selectedPreset.logic;

            const gradient = selectedPreset.gradient.map(hexToRgb);
            const offColorHex = selectedPreset.offColor;

            if (selectedPreset.logic === 'neighbor_count') {
                if (!this.settings.customNeighborColors || Object.keys(this.settings.customNeighborColors).length === 0) {
                    const numGroups = 14;
                    this.settings.customNeighborColors = {};
                    for (let center = 0; center < 2; center++) {
                        for (let count = 0; count < 7; count++) {
                            const i = center * 7 + count;
                            const factor = i / (numGroups - 1);
                            const rgb = getGradientColor(factor, gradient);
                            const hex = `#${((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1).toLowerCase()}`;
                            const key = `${center}-${count}`;
                            this.settings.customNeighborColors[key] = { on: hex, off: offColorHex };
                        }
                    }
                    // Flicker-proof
                    this.settings.customNeighborColors['0-0'].on = '#000000';
                    this.settings.customNeighborColors['1-6'].off = '#000000';
                }
            } else if (selectedPreset.logic === 'symmetry') {
                if (!this.settings.customSymmetryColors || Object.keys(this.settings.customSymmetryColors).length === 0) {
                    const symmetryGroups = [0,1,3,5,7,9,11,13,15,21,23,27,31,63];
                    const numGroups = 28;
                    this.settings.customSymmetryColors = {};
                    for (let center = 0; center < 2; center++) {
                        for (let g = 0; g < symmetryGroups.length; g++) {
                            const i = center * 14 + g;
                            const factor = i / (numGroups - 1);
                            const rgb = getGradientColor(factor, gradient);
                            const hex = `#${((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1).toLowerCase()}`;
                            const key = `${center}-${symmetryGroups[g]}`;
                            this.settings.customSymmetryColors[key] = { on: hex, off: offColorHex };
                        }
                    }
                    // Flicker-proof
                    this.settings.customSymmetryColors['0-0'].on = '#000000';
                    this.settings.customSymmetryColors['1-63'].off = '#000000';
                }
            }
        } else {
            // For standard gradient presets, set the mode to 'preset'.
            this.settings.mode = 'preset';
            this.settings.activePreset = presetName;
        }
        
        this.#saveAndDispatch();
    }

    toggleFlickerProofPresets(value) {
        this.settings.flickerProofPresets = value;
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

    resetToDefaults(mode) {
        if (mode === 'neighbor_count') {
            // Use structuredClone for a deep copy to prevent reference issues
            this.settings.customNeighborColors = structuredClone(DEFAULT_COLOR_SCHEMES.customNeighborColors);
        } else if (mode === 'symmetry') {
            this.settings.customSymmetryColors = structuredClone(DEFAULT_COLOR_SCHEMES.customSymmetryColors);
        }
        
        // Save the updated settings and notify the UI
        this.#saveAndDispatch();
    }

    applyGradientToSelection(orderedSwatchKeys, gradientColors) {
        if (!orderedSwatchKeys || orderedSwatchKeys.length === 0 || !gradientColors || gradientColors.length === 0) {
            return;
        }

        const mode = this.settings.mode;
        const numSwatches = orderedSwatchKeys.length;
        const rgbGradient = gradientColors.map(hexToRgb);

        orderedSwatchKeys.forEach((swatchKey, i) => {
            const factor = numSwatches === 1 ? 0 : i / (numSwatches - 1);
            const rgb = getGradientColor(factor, rgbGradient);
            const newColorHex = `#${((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1).toUpperCase()}`;

            const parts = swatchKey.split('-');
            const stateType = parts.pop();
            const dataKey = parts.slice(1).join('-');

            const targetObject = mode === 'neighbor_count' 
                ? this.settings.customNeighborColors
                : this.settings.customSymmetryColors;

            if (!targetObject[dataKey]) {
                targetObject[dataKey] = { on: '#ffffff', off: '#333333' };
            }
            targetObject[dataKey][stateType] = newColorHex;
        });

        this.#saveAndDispatch();
    }
} 