/**
 * Utility functions for creating rule visualizations.
 * These functions are shared between RulesetEditor and RuleRankPanel components.
 */

/**
 * Converts HSV color values to RGB
 * @param {number} h Hue (0-1)
 * @param {number} s Saturation (0-1)
 * @param {number} v Value (0-1)
 * @returns {object} RGB values {r, g, b} in 0-1 range
 */
function hsvToRgb(h, s, v) {
    // Port of the GLSL hsv2rgb function
    const K = [1.0, 2.0/3.0, 1.0/3.0, 3.0];
    const p = [
        Math.abs((h + K[0]) % 1.0 * 6.0 - K[3]),
        Math.abs((h + K[1]) % 1.0 * 6.0 - K[3]),
        Math.abs((h + K[2]) % 1.0 * 6.0 - K[3])
    ].map(val => Math.max(0, Math.min(1, val - 1)));
    
    return {
        r: v * (K[0] * (1 - s) + p[0] * s),
        g: v * (K[0] * (1 - s) + p[1] * s),
        b: v * (K[0] * (1 - s) + p[2] * s)
    };
}

/**
 * Calculates the color for a hexagon based on rule index and state, matching the fragment shader logic.
 * @param {number} ruleIndex The rule index (0-127)
 * @param {number} state The cell state (0 or 1)
 * @returns {string} CSS color string
 */
export function getRuleIndexColor(ruleIndex, state) {
    const hueOffset = 0.1667; // Offset for yellow (60.0 / 360.0)
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
    
    const rgb = hsvToRgb(hue, saturation, value);
    
    // Convert to 0-255 range and create CSS color string
    const r = Math.round(rgb.r * 255);
    const g = Math.round(rgb.g * 255);
    const b = Math.round(rgb.b * 255);
    
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Creates a DOM element for visualizing a single cellular automaton rule.
 * @param {object} options - The configuration for the visualization.
 * @param {number} options.ruleIndex - The rule index (0-127).
 * @param {number} options.outputState - The output of the rule (0 or 1).
 * @param {number} [options.usagePercent=0] - The usage percentage of the rule.
 * @param {number} [options.normalizedUsage=0] - The usage normalized from 0.0 to 1.0.
 * @param {number} [options.rawUsageCount=0] - The raw invocation count.
 * @param {boolean} [options.showUsageOverlay=false] - Whether to show usage overlay.
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
        
    // Add the usage overlay if requested
    if (showUsageOverlay && normalizedUsage > 0) {
        const usageOverlay = document.createElement('div');
        usageOverlay.className = 'rule-usage-overlay';
        usageOverlay.style.opacity = normalizedUsage * 0.8; // Max 80% opacity
        viz.appendChild(usageOverlay);
    }

    return viz;
} 