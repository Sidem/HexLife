import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { PRESET_PALETTES } from '../../core/colorPalettes.js';
import { DEFAULT_COLOR_SCHEMES } from '../../core/config.js';
import { hexToRgb, getGradientColor, buildLogicPresetColors } from '../../utils/ruleVizUtils.js';

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
            // A `logic` preset is not a preset here at all: it becomes the matching customization
            // mode, seeded with the table `buildLogicPresetColors` derives. That builder is also what
            // the embed renders these palettes through (`palette="neighborGradient"` never reaches
            // ColorController), so the two paths agree by construction rather than by two formulas
            // happening to match — which they did not. Seeded only when empty: once the user has
            // edited a group in Chroma Lab, the table is theirs.
            this.settings.mode = selectedPreset.logic;

            if (selectedPreset.logic === 'neighbor_count') {
                if (!this.settings.customNeighborColors || Object.keys(this.settings.customNeighborColors).length === 0) {
                    this.settings.customNeighborColors = buildLogicPresetColors(selectedPreset);
                }
            } else if (selectedPreset.logic === 'symmetry') {
                if (!this.settings.customSymmetryColors || Object.keys(this.settings.customSymmetryColors).length === 0) {
                    this.settings.customSymmetryColors = buildLogicPresetColors(selectedPreset);
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

    /**
     * Global hue rotation applied across every coloring mode (Chroma Lab's hue-shift slider). The
     * value is a degree offset in [0, 360); it's normalized here so the persisted setting stays in
     * range. Rotating the whole palette lets users steer away from an unwanted dominant hue (e.g.
     * the default's harsh red) without hand-editing individual colors.
     * @param {number} degrees
     */
    setHueShift(degrees) {
        const normalized = ((Math.round(Number(degrees) || 0) % 360) + 360) % 360;
        if (this.settings.hueShift === normalized) return;
        this.settings.hueShift = normalized;
        this.#saveAndDispatch();
    }

    /**
     * Set the free-form custom gradient (Chroma Lab "Gradient" tab) and switch to gradient mode:
     * all 128 rules are painted along the `on` ramp (active cells) / `off` ramp (inactive cells).
     * @param {{on: string[], off: string[], autoOff?: boolean}} gradient - Hex color stop lists
     *   (each ≥1 stop). `autoOff` records that the off ramp is auto-derived from the on ramp.
     */
    setCustomGradient({ on, off, autoOff }) {
        if (!Array.isArray(on) || on.length === 0 || !Array.isArray(off) || off.length === 0) return;
        this.settings.customGradient = { on: [...on], off: [...off], autoOff: autoOff !== false };
        this.settings.mode = 'gradient';
        this.#saveAndDispatch();
    }

    /**
     * Live-preview a palette WITHOUT persisting anything (Chroma Lab hover / picker drag). Merges
     * `partial` over the saved settings and dispatches COLOR_PREVIEW_CHANGED — only the renderer
     * listens, so the canvas retints while every UI surface keeps showing the saved settings.
     * Always pair with {@link endPreview}.
     * @param {object} partial - Color-settings fields to override for the preview.
     */
    previewSettings(partial) {
        this._previewActive = true;
        EventBus.dispatch(EVENTS.COLOR_PREVIEW_CHANGED, { ...this.settings, ...partial });
    }

    /** End a live preview and re-apply the saved settings to the canvas. No-op if none is active. */
    endPreview() {
        if (!this._previewActive) return;
        this._previewActive = false;
        EventBus.dispatch(EVENTS.COLOR_PREVIEW_CHANGED, null);
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