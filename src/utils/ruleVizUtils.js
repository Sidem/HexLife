/**
 * Utility functions for creating rule visualizations and colors.
 * These functions are shared between UI components and the WebGL renderer.
 */

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
 * Generates the precise color for a rule index and state, matching the shader logic.
 * @param {number} ruleIndex The rule index (0-127).
 * @param {number} state The cell state (0 or 1).
 * @returns {number[]} An array of [r, g, b] values (0-255).
 */
function generateRuleColor(ruleIndex, state) {
    const hueOffset = 0.1667; // Yellow offset
    const calculatedHue = ruleIndex / 128.0;
    const hue = (calculatedHue + hueOffset) % 1.0;

    let saturation, value;
    if (state === 1) {
        saturation = 1.0;
        value = 1.0;
    } else {
        saturation = 0.5;
        value = 0.15;
    }
    return hsvToRgb(hue, saturation, value);
}

/**
 * Creates a Uint8Array representing a 128x2 RGBA texture for rule colors.
 * Row 0: Inactive states
 * Row 1: Active states
 * @returns {Uint8Array} The texture data.
 */
export function generateColorLUT() {
    const width = 128;
    const height = 2;
    const data = new Uint8Array(width * height * 4);

    for (let state = 0; state < height; state++) { // 0 for inactive, 1 for active
        for (let ruleIndex = 0; ruleIndex < width; ruleIndex++) {
            const color = generateRuleColor(ruleIndex, state);
            const dataIndex = (state * width + ruleIndex) * 4;
            data[dataIndex] = color[0];     // R
            data[dataIndex + 1] = color[1]; // G
            data[dataIndex + 2] = color[2]; // B
            data[dataIndex + 3] = 255;      // A
        }
    }
    return data;
}


/**
 * Returns a CSS color string for a given rule and state, for use in the UI.
 * This function now uses the centralized color generator.
 * @param {number} ruleIndex The rule index (0-127)
 * @param {number} state The cell state (0 or 1)
 * @returns {string} CSS color string
 */
export function getRuleIndexColor(ruleIndex, state) {
    const [r, g, b] = generateRuleColor(ruleIndex, state);
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Creates a DOM element for visualizing a single cellular automaton rule.
 * (This function remains unchanged but now relies on the updated getRuleIndexColor)
 * @param {object} options - The configuration for the visualization.
 * @returns {HTMLElement} The complete div element for the rule visualization.
 */
export function createRuleVizElement({
    ruleIndex,
    outputState,
    usagePercent = 0,
    normalizedUsage = 0,
    rawUsageCount = 0,
    showUsageOverlay = false
}) {
    const centerState = (ruleIndex >> 6) & 1;
    const neighborMask = ruleIndex & 0x3F;

    const viz = document.createElement('div');
    viz.className = 'rule-viz';
    viz.title = `Rule ${ruleIndex}: Center ${centerState}, N ${neighborMask.toString(2).padStart(6, '0')} -> Out ${outputState}\nUsage: ${usagePercent.toFixed(2)}% (${rawUsageCount} calls)`;
    viz.dataset.ruleIndex = ruleIndex;

    const centerColor = centerState === 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
    const outputColor = getRuleIndexColor(ruleIndex, outputState);

    viz.innerHTML = `<div class="hexagon center-hex" style="background-color: ${centerColor};"><div class="hexagon inner-hex" style="background-color: ${outputColor};"></div></div>` +
        Array.from({ length: 6 }, (_, n) => {
            const neighborState = (neighborMask >> n) & 1;
            const neighborColor = neighborState === 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
            return `<div class="hexagon neighbor-hex neighbor-${n}" style="background-color: ${neighborColor};"></div>`;
        }).join('');


    if (showUsageOverlay && normalizedUsage > 0) {
        const usageOverlay = document.createElement('div');
        usageOverlay.className = 'rule-usage-overlay';
        usageOverlay.style.opacity = normalizedUsage * 0.8;
        viz.appendChild(usageOverlay);
    }

    return viz;
}