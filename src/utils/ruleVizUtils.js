import { PRESET_PALETTES } from '../core/colorPalettes.js';
import { countSetBits } from '../core/Symmetry.js';

/**
 * Converts hex color to RGB array.
 * @param {string} hex - Hex color string (e.g., "#FF0000")
 * @returns {number[]} Array of RGB values [r, g, b] in the 0-255 range.
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}

/**
 * Interpolates between two RGB colors.
 * @param {number[]} color1 - First RGB color [r, g, b]
 * @param {number[]} color2 - Second RGB color [r, g, b]
 * @param {number} factor - Interpolation factor (0-1)
 * @returns {number[]} Interpolated RGB color [r, g, b]
 */
function interpolateRgb(color1, color2, factor) {
    const r = color1[0] + factor * (color2[0] - color1[0]);
    const g = color1[1] + factor * (color2[1] - color1[1]);
    const b = color1[2] + factor * (color2[2] - color1[2]);
    return [Math.round(r), Math.round(g), Math.round(b)];
}

/**
 * Converts HSV color values to an [r, g, b] array.
 * @param {number} h Hue (0-1)
 * @param {number} s Saturation (0-1)
 * @param {number} v Value (0-1)
 * @returns {number[]} Array of RGB values [r, g, b] in the 0-255 range.
 */
function hsvToRgb(h, s, v) {
    let r, g, b;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);

    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Creates a Uint8Array representing a 128x2 RGBA texture for rule colors.
 * Row 0: Inactive states
 * Row 1: Active states
 * @param {object} colorSettings - The color settings from ColorController
 * @param {object} symmetryData - Symmetry data from WorldManager
 * @returns {Uint8Array} The texture data.
 */
export function generateColorLUT(colorSettings, symmetryData) {
    const width = 128;
    const height = 2;
    const data = new Uint8Array(width * height * 4);
    const { mode, activePreset, customGradient, customNeighborColors, customSymmetryColors } = colorSettings;

    for (let ruleIndex = 0; ruleIndex < width; ruleIndex++) {
        // --- MODIFICATION START ---
        // Special handling for the default preset to create distinct colors for ON and OFF states.
        if (mode === 'preset' && (activePreset === 'default' || !PRESET_PALETTES[activePreset]?.gradient)) {
            const hue = ((ruleIndex / 128.0) + 0.1667) % 1.0;
            for (let outputState = 0; outputState < height; outputState++) {
                const saturation = 1.0;
                // Use high brightness for ON (active) states, and low brightness for OFF (inactive) states.
                const value = outputState === 1 ? 1.0 : 0.1;
                const rgb = hsvToRgb(hue, saturation, value);
                const dataIndex = (outputState * width + ruleIndex) * 4;
                data[dataIndex] = rgb[0];
                data[dataIndex + 1] = rgb[1];
                data[dataIndex + 2] = rgb[2];
                data[dataIndex + 3] = 255;
            }
        } else {
            // Existing logic for all other custom color modes (gradient, neighbor, symmetry).
            const centerState = (ruleIndex >> 6) & 1;
            const neighborMask = ruleIndex & 0x3F;
            let rgb;

            if (mode === 'gradient') {
                const gradient = customGradient.map(hexToRgb);
                const factor = ruleIndex / (width - 1);
                const segment = Math.floor(factor * (gradient.length - 1));
                const segmentFactor = (factor * (gradient.length - 1)) - segment;
                rgb = interpolateRgb(gradient[segment], gradient[segment + 1] || gradient[segment], segmentFactor);
            } else if (mode === 'neighbor_count') {
                const neighborCount = countSetBits(neighborMask);
                const key = `${centerState}-${neighborCount}`;
                rgb = hexToRgb(customNeighborColors[key] || '#808080');
            } else if (mode === 'symmetry') {
                const canonical = symmetryData.bitmaskToCanonical.get(neighborMask);
                const key = `${centerState}-${canonical}`;
                rgb = hexToRgb(customSymmetryColors[key] || '#808080');
            } else { // Fallback for other presets with gradients
                const gradient = PRESET_PALETTES[activePreset]?.gradient.map(hexToRgb) || [hexToRgb('#808080')];
                const factor = ruleIndex / (width - 1);
                const segment = Math.floor(factor * (gradient.length - 1));
                const segmentFactor = (factor * (gradient.length - 1)) - segment;
                rgb = interpolateRgb(gradient[segment], gradient[segment + 1] || gradient[segment], segmentFactor);
            }

            for (let state = 0; state < height; state++) {
                const dataIndex = (state * width + ruleIndex) * 4;
                data[dataIndex] = rgb[0];
                data[dataIndex + 1] = rgb[1];
                data[dataIndex + 2] = rgb[2];
                data[dataIndex + 3] = 255;
            }
        }
        // --- MODIFICATION END ---
    }
    return data;
}


/**
 * Generates a single rule color based on color settings.
 * @param {number} ruleIndex The rule index (0-127)
 * @param {number} outputState The output state of the rule (0 or 1).
 * @param {object} colorSettings The color settings from ColorController
 * @param {object} symmetryData Symmetry data from WorldManager
 * @returns {number[]} RGB color [r, g, b]
 */
export function generateSingleRuleColor(ruleIndex, outputState, colorSettings, symmetryData) {
    const { mode, activePreset, customGradient, customNeighborColors, customSymmetryColors } = colorSettings;
    const centerState = (ruleIndex >> 6) & 1;
    const neighborMask = ruleIndex & 0x3F;

    if (mode === 'preset') {
        // --- MODIFICATION START ---
        // Handle default preset separately to factor in the output state for brightness.
        if (activePreset === 'default' || !PRESET_PALETTES[activePreset]?.gradient) {
            const hue = ((ruleIndex / 128.0) + 0.1667) % 1.0;
            const saturation = 1.0;
            const value = outputState === 1 ? 1.0 : 0.4;
            return hsvToRgb(hue, saturation, value);
        }
        // --- MODIFICATION END ---
        const gradient = PRESET_PALETTES[activePreset].gradient.map(hexToRgb);
        const factor = ruleIndex / 127.0;
        const segment = Math.floor(factor * (gradient.length - 1));
        const segmentFactor = (factor * (gradient.length - 1)) - segment;
        return interpolateRgb(gradient[segment], gradient[segment + 1] || gradient[segment], segmentFactor);
    }
    if (mode === 'gradient') {
         const gradient = customGradient.map(hexToRgb);
         const factor = ruleIndex / 127.0;
         const segment = Math.floor(factor * (gradient.length - 1));
         const segmentFactor = (factor * (gradient.length - 1)) - segment;
         return interpolateRgb(gradient[segment], gradient[segment + 1] || gradient[segment], segmentFactor);
    }
    if (mode === 'neighbor_count') {
        const neighborCount = countSetBits(neighborMask);
        const key = `${centerState}-${neighborCount}`;
        return hexToRgb(customNeighborColors[key] || '#808080');
    }
    if (mode === 'symmetry') {
         const canonical = symmetryData.bitmaskToCanonical.get(neighborMask);
         const key = `${centerState}-${canonical}`;
         return hexToRgb(customSymmetryColors[key] || '#808080');
    }
    return [128, 128, 128];
}

/**
 * Returns a CSS color string for a given rule and state, for use in the UI.
 * This function now uses the centralized color generator.
 * @param {number} ruleIndex The rule index (0-127)
 * @param {number} state The cell state (0 or 1)
 * @param {object} colorSettings The color settings from ColorController
 * @param {object} symmetryData Symmetry data from WorldManager
 * @returns {string} CSS color string
 */
export function getRuleIndexColor(ruleIndex, state, colorSettings, symmetryData) {
    // --- MODIFICATION: Pass the state (outputState) to the color generator.
    const rgb = generateSingleRuleColor(ruleIndex, state, colorSettings, symmetryData);
    return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

/**
 * Creates a DOM element for visualizing a single cellular automaton rule,
 * or updates an existing one for performance.
 * @param {object} options - The configuration for the visualization.
 * @param {HTMLElement} [options.existingElement=null] - An optional existing element to update.
 * @param {object} colorSettings - The color settings from ColorController
 * @param {object} symmetryData - Symmetry data from WorldManager
 * @returns {HTMLElement} The complete div element for the rule visualization.
 */
export function createOrUpdateRuleVizElement({
    existingElement = null,
    ruleIndex,
    outputState,
    usagePercent = 0,
    normalizedUsage = 0,
    rawUsageCount = 0,
    showUsageOverlay = false
}, colorSettings, symmetryData) {
    const centerState = (ruleIndex >> 6) & 1;
    const neighborMask = ruleIndex & 0x3F;

    const viz = existingElement || document.createElement('div');
    if (!existingElement) {
        viz.className = 'rule-viz';
        let innerHTML = `<div class="hexagon center-hex"><div class="hexagon inner-hex"></div></div>`;
        for (let i = 0; i < 6; i++) {
            innerHTML += `<div class="hexagon neighbor-hex neighbor-${i}"></div>`;
        }
        viz.innerHTML = innerHTML;
    }

    viz.title = `Rule ${ruleIndex}: Center ${centerState}, N ${neighborMask.toString(2).padStart(6, '0')} -> Out ${outputState}\nUsage: ${usagePercent.toFixed(2)}% (${rawUsageCount} calls)`;
    viz.dataset.ruleIndex = ruleIndex;

    const centerHex = viz.querySelector('.center-hex');
    const innerHex = viz.querySelector('.inner-hex');

    centerHex.style.backgroundColor = centerState === 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
    innerHex.style.backgroundColor = getRuleIndexColor(ruleIndex, outputState, colorSettings, symmetryData);

    for (let n = 0; n < 6; n++) {
        const neighborHex = viz.querySelector(`.neighbor-${n}`);
        neighborHex.style.backgroundColor = (neighborMask >> n) & 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
    }

    let usageOverlay = viz.querySelector('.rule-usage-overlay');
    if (showUsageOverlay && normalizedUsage > 0) {
        if (!usageOverlay) {
            usageOverlay = document.createElement('div');
            usageOverlay.className = 'rule-usage-overlay';
            viz.appendChild(usageOverlay);
        }
        usageOverlay.style.opacity = normalizedUsage * 0.8;
    } else if (usageOverlay) {
        usageOverlay.remove();
    }

    return viz;
}