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

function getGradientColor(factor, gradient) {
    if (!gradient || gradient.length === 0) return [128, 128, 128];
    if (gradient.length === 1) return gradient[0];
    const segment = Math.floor(factor * (gradient.length - 1));
    const segmentFactor = (factor * (gradient.length - 1)) - segment;
    return interpolateRgb(gradient[segment], gradient[segment + 1] || gradient[segment], segmentFactor);
}

/**
 * Creates a Uint8Array representing a 128x2 RGBA texture for rule colors.
 * Row 0: Inactive states
 * Row 1: Active states
 * @param {object} colorSettings - The color settings from ColorController
 * @param {object} symmetryData - Symmetry data from WorldManager
 * @returns {Uint8Array} The texture data.
 */
export function generateColorLUT(colorSettings, symmetryData, currentRuleset) {
    const width = 128;
    const height = 2;
    const data = new Uint8Array(width * height * 4);
    const { mode, activePreset, customGradient, customNeighborColors, customSymmetryColors } = colorSettings;

    for (let ruleIndex = 0; ruleIndex < width; ruleIndex++) {
        const outputState = currentRuleset[ruleIndex];
        let rgb;

        if (mode === 'preset') {
            const preset = PRESET_PALETTES[activePreset];
            if (activePreset === 'default' || !preset) {
                const hue = ((ruleIndex / 128.0) + 0.1667) % 1.0;
                rgb = hsvToRgb(hue, 1.0, outputState === 1 ? 1.0 : 0.075);
            } else {
                const factor = ruleIndex / (width - 1);
                const onGradient = preset.gradient.map(hexToRgb);
                const offGradient = preset.offGradient?.map(hexToRgb) || onGradient.map(c => c.map(ch => ch * 0.15));
                rgb = getGradientColor(factor, outputState === 1 ? onGradient : offGradient);
            }
        } else if (mode === 'gradient') {
            const factor = ruleIndex / (width - 1);
            const onGradient = customGradient.on.map(hexToRgb);
            const offGradient = customGradient.off.map(hexToRgb);
            rgb = getGradientColor(factor, outputState === 1 ? onGradient : offGradient);
        } else {
            const centerState = (ruleIndex >> 6) & 1;
            const neighborMask = ruleIndex & 0x3F;
            let colors;
            if (mode === 'neighbor_count') {
                const neighborCount = countSetBits(neighborMask);
                const key = `${centerState}-${neighborCount}`;
                colors = customNeighborColors[key];
            } else { // symmetry mode
                const canonical = symmetryData.bitmaskToCanonical.get(neighborMask);
                const key = `${centerState}-${canonical}`;
                colors = customSymmetryColors[key];
            }
            rgb = hexToRgb(colors ? colors[outputState === 1 ? 'on' : 'off'] : '#808080');
        }

        // Write color for this rule to both texture rows, as the output state is already factored in
        for (let state = 0; state < height; state++) {
            const dataIndex = (state * width + ruleIndex) * 4;
            data[dataIndex] = rgb[0];
            data[dataIndex + 1] = rgb[1];
            data[dataIndex + 2] = rgb[2];
            data[dataIndex + 3] = 255;
        }
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
        const preset = PRESET_PALETTES[activePreset];
        if (activePreset === 'default' || !preset) {
            const hue = ((ruleIndex / 128.0) + 0.1667) % 1.0;
            const saturation = 1.0;
            const value = outputState === 1 ? 1.0 : 0.4;
            return hsvToRgb(hue, saturation, value);
        } else if (preset.logic === 'neighbor_count') {
            if (outputState === 0) return hexToRgb(preset.offColor);
            const neighborCount = countSetBits(neighborMask);
            const factor = (neighborCount / 6.0) * (centerState === 1 ? 1.0 : 0.8) + (centerState === 1 ? 0.0 : 0.1);
            return getGradientColor(Math.min(1, factor), preset.gradient.map(hexToRgb));
        } else if (preset.logic === 'symmetry') {
            if (outputState === 0) return hexToRgb(preset.offColor);
            const canonical = symmetryData.bitmaskToCanonical.get(neighborMask);
            const groupIndex = symmetryData.canonicalRepresentatives.findIndex(g => g.representative === canonical);
            const factor = (groupIndex / (symmetryData.canonicalRepresentatives.length - 1)) * (centerState === 1 ? 1.0 : 0.8) + (centerState === 1 ? 0.0 : 0.1);
            return getGradientColor(Math.min(1, factor), preset.gradient.map(hexToRgb));
        }
        const factor = ruleIndex / 127.0;
        const onGradient = preset.gradient.map(hexToRgb);
        const offGradient = preset.offGradient?.map(hexToRgb) || onGradient.map(c => c.map(ch => ch * 0.4));
        return getGradientColor(factor, outputState === 1 ? onGradient : offGradient);
    }
    if (mode === 'gradient') {
        const factor = ruleIndex / 127.0;
        const onGradient = customGradient.on.map(hexToRgb);
        const offGradient = customGradient.off.map(hexToRgb);
        return getGradientColor(factor, outputState === 1 ? onGradient : offGradient);
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
 * @param {number} outputState The output state of the rule (0 or 1)
 * @param {object} colorSettings The color settings from ColorController
 * @param {object} symmetryData Symmetry data from WorldManager
 * @returns {string} CSS color string
 */
export function getRuleIndexColor(ruleIndex, outputState, colorSettings, symmetryData) {
    let rgb;
    const { mode, activePreset, customGradient, customNeighborColors, customSymmetryColors } = colorSettings;
    const centerState = (ruleIndex >> 6) & 1; // Added for logic presets
    const neighborMask = ruleIndex & 0x3F; // Added for logic presets
    
    if (mode === 'preset') {
        const preset = PRESET_PALETTES[activePreset];
        if (activePreset === 'default' || !preset) {
            const hue = ((ruleIndex / 128.0) + 0.1667) % 1.0;
            rgb = hsvToRgb(hue, 1.0, outputState === 1 ? 1.0 : 0.4);
        } else if (preset.logic === 'neighbor_count') {
            if (outputState === 0) {
                 rgb = hexToRgb(preset.offColor);
            } else {
                const neighborCount = countSetBits(neighborMask);
                const factor = (neighborCount / 6.0) * (centerState === 1 ? 1.0 : 0.8) + (centerState === 1 ? 0.0 : 0.1);
                rgb = getGradientColor(Math.min(1, factor), preset.gradient.map(hexToRgb));
            }
        } else if (preset.logic === 'symmetry') {
            if (outputState === 0) {
                rgb = hexToRgb(preset.offColor);
            } else {
                const canonical = symmetryData.bitmaskToCanonical.get(neighborMask);
                const groupIndex = symmetryData.canonicalRepresentatives.findIndex(g => g.representative === canonical);
                const factor = (groupIndex / (symmetryData.canonicalRepresentatives.length - 1)) * (centerState === 1 ? 1.0 : 0.8) + (centerState === 1 ? 0.0 : 0.1);
                rgb = getGradientColor(Math.min(1, factor), preset.gradient.map(hexToRgb));
            }
        } else {
            const factor = ruleIndex / 127.0;
            const onGradient = preset.gradient.map(hexToRgb);
            const offGradient = preset.offGradient?.map(hexToRgb) || onGradient.map(c => c.map(ch => ch * 0.4));
            rgb = getGradientColor(factor, outputState === 1 ? onGradient : offGradient);
        }
    } else if (mode === 'gradient') {
        const factor = ruleIndex / 127.0;
        const onGradient = customGradient.on.map(hexToRgb);
        const offGradient = customGradient.off.map(hexToRgb);
        rgb = getGradientColor(factor, outputState === 1 ? onGradient : offGradient);
    } else {
        const centerState = (ruleIndex >> 6) & 1;
        const neighborMask = ruleIndex & 0x3F;
        let colors;
        if (mode === 'neighbor_count') {
            const neighborCount = countSetBits(neighborMask);
            const key = `${centerState}-${neighborCount}`;
            colors = customNeighborColors[key];
        } else { // symmetry mode
            const canonical = symmetryData.bitmaskToCanonical.get(neighborMask);
            const key = `${centerState}-${canonical}`;
            colors = customSymmetryColors[key];
        }
        rgb = hexToRgb(colors ? colors[outputState === 1 ? 'on' : 'off'] : '#808080');
    }
    
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

/**
 * Generates a 128x2 RGBA texture that visualizes a complete color palette,
 * with 'off' state colors in the top row and 'on' state colors in the bottom row.
 * This is independent of any specific ruleset's output states.
 * @param {object} colorSettings - The color settings from ColorController.
 * @param {object} symmetryData - Symmetry data from WorldManager.
 * @returns {Uint8Array} The texture data for visualization.
 */
export function generatePaletteVisualizationLUT(colorSettings, symmetryData) {
    const width = 128;
    const height = 2; // Row 0 for OFF, Row 1 for ON
    const data = new Uint8Array(width * height * 4);
    const { mode, activePreset, customNeighborColors, customSymmetryColors } = colorSettings;

    for (let ruleIndex = 0; ruleIndex < width; ruleIndex++) {
        // We will calculate the color for both OFF (0) and ON (1) states for each rule index.
        for (let outputState = 0; outputState < height; outputState++) {
            let rgb;

            if (mode === 'preset') {
                const preset = PRESET_PALETTES[activePreset];
                if (activePreset === 'default' || !preset) {
                    const hue = ((ruleIndex / 128.0) + 0.1667) % 1.0;
                    // For the visualization, we want both to be bright.
                    // We use a slightly lower value for OFF state to differentiate it subtly.
                    rgb = hsvToRgb(hue, 1.0, outputState === 1 ? 1.0 : 0.075);
                } else {
                    const factor = ruleIndex / (width - 1);
                    const onGradient = preset.gradient.map(hexToRgb);
                    // Use a brighter version of the off-gradient for visualization purposes
                    const offGradient = preset.offGradient?.map(hexToRgb) || onGradient.map(c => c.map(ch => ch * 0.5));
                    rgb = getGradientColor(factor, outputState === 1 ? onGradient : offGradient);
                }
            } else { // For 'neighbor_count' or 'symmetry'
                const centerState = (ruleIndex >> 6) & 1;
                const neighborMask = ruleIndex & 0x3F;
                let colors;
                if (mode === 'neighbor_count') {
                    const neighborCount = countSetBits(neighborMask);
                    const key = `${centerState}-${neighborCount}`;
                    colors = customNeighborColors[key];
                } else { // symmetry mode
                    const canonical = symmetryData.bitmaskToCanonical.get(neighborMask);
                    const key = `${centerState}-${canonical}`;
                    colors = customSymmetryColors[key];
                }
                // Here, we directly use the color defined for the specific output state.
                rgb = hexToRgb(colors ? colors[outputState === 1 ? 'on' : 'off'] : '#808080');
            }

            const dataIndex = (outputState * width + ruleIndex) * 4;
            data[dataIndex] = rgb[0];
            data[dataIndex + 1] = rgb[1];
            data[dataIndex + 2] = rgb[2];
            data[dataIndex + 3] = 255;
        }
    }
    return data;
}

/**
 * Converts a 128x2 RGBA LUT into a Base64 encoded PNG data URL.
 * @param {Uint8Array} lutData The 128x2 RGBA data.
 * @returns {string} The Base64 encoded PNG string.
 */
export function colorLUTtoBase64(lutData) {
    const width = 128;
    const height = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(lutData);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
}