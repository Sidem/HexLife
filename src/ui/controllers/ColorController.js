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
        
        // This ensures that selecting ANY preset, including the new logic-based ones,
        // sets the mode to 'preset'. The rendering logic will handle the different
        // preset types based on the 'logic' key we defined in colorPalettes.js.
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

    applyGradientToSelection(orderedSwatchKeys, gradientColors) {
        if (!orderedSwatchKeys || orderedSwatchKeys.length === 0 || !gradientColors || gradientColors.length === 0) {
            return;
        }

        const mode = this.settings.mode; // 'neighbor_count' or 'symmetry'

        // Case 1: Only one color was selected, so just apply it to all.
        if (gradientColors.length === 1) {
            const groupKeys = orderedSwatchKeys.map(key => {
                const parts = key.split('-');
                const stateType = parts.pop();
                // The remaining parts form the groupKey, including the mode prefix.
                // We only need the part *after* the mode prefix for the data key.
                return parts.slice(1).join('-'); // e.g., from [symmetry, 0, 1] -> "0-1"
            });
            const stateTypes = orderedSwatchKeys.map(key => key.split('-').pop());
            
            const onKeys = groupKeys.filter((_, i) => stateTypes[i] === 'on');
            const offKeys = groupKeys.filter((_, i) => stateTypes[i] === 'off');

            if (onKeys.length > 0) this.setBatchColors(mode, onKeys, 'on', gradientColors[0]);
            if (offKeys.length > 0) this.setBatchColors(mode, offKeys, 'off', gradientColors[0]);
            return; // We called setBatchColors which already saves and dispatches
        }

        // Case 2: A gradient was selected.
        const rgbGradient = gradientColors.map(hex => {
             const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
             return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
        });
        
        const numSwatches = orderedSwatchKeys.length;
        
        orderedSwatchKeys.forEach((swatchKey, i) => {
            const factor = (numSwatches === 1) ? 0 : i / (numSwatches - 1);
            
            // Interpolate color
            const colorIndex = factor * (rgbGradient.length - 1);
            const segment = Math.floor(colorIndex);
            const segmentFactor = colorIndex - segment;
            const c1 = rgbGradient[segment];
            const c2 = rgbGradient[segment + 1] || c1;
            
            const r = Math.round(c1[0] + segmentFactor * (c2[0] - c1[0]));
            const g = Math.round(c1[1] + segmentFactor * (c2[1] - c1[1]));
            const b = Math.round(c1[2] + segmentFactor * (c2[2] - c1[2]));

            const newColorHex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;

            // Apply color to the individual swatch
            const parts = swatchKey.split('-');
            const stateType = parts.pop();
            // The remaining parts form the groupKey, including the mode prefix.
            // We only need the part *after* the mode prefix for the data key.
            const dataKey = parts.slice(1).join('-'); // e.g., from [symmetry, 0, 1] -> "0-1"
            
            const targetObject = mode === 'neighbor_count' 
                ? this.settings.customNeighborColors
                : this.settings.customSymmetryColors;

            if (!targetObject[dataKey]) {
                targetObject[dataKey] = { on: '#ffffff', off: '#333333' };
            }
            targetObject[dataKey][stateType] = newColorHex;
        });

        // Save and dispatch a single event after all colors have been calculated.
        this.#saveAndDispatch();
    }
} 