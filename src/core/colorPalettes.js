export const PRESET_PALETTES = {
    default: {
        name: 'Default Spectrum',
        // Special case handled in ruleVizUtils.js
    },
    volcanic: {
        name: 'Volcanic',
        gradient: ['#FF4500', '#FFD700', '#FFFFFF'],
        offGradient: ['#6a1a00', '#8B4513', '#a9a9a9']
    },
    bioluminescent: {
        name: 'Bio-Luminescent',
        gradient: ['#008080', '#46f0f0', '#aaffc3'],
        offGradient: ['#003333', '#006464', '#00a073']
    },
    monochrome: {
        name: 'Monochrome',
        gradient: ['#FFFFFF'],
        offGradient: ['#111111']
    },
    synthwave: {
        name: 'Synthwave',
        gradient: ['#FF00C1', '#00F0FF', '#FFFFFF'],
        offGradient: ['#60004d', '#006066', '#a9a9a9']
    },
    oceanic: {
        name: 'Oceanic',
        gradient: ['#0052D4', '#4364F7', '#6FB1FC'],
        offGradient: ['#001a44', '#15224f', '#243b52']
    },
    forest: {
        name: 'Forest',
        gradient: ['#134E5E', '#71B280', '#C3D6A2'],
        offGradient: ['#05181e', '#2a4a30', '#4c543f']
    },
    sunrise: {
        name: 'Sunrise',
        gradient: ['#FF512F', '#F09819', '#FFD200'],
        offGradient: ['#4d180e', '#5c3808', '#665300']
    },
    amethyst: {
        name: 'Amethyst',
        gradient: ['#673AB7', '#B39DDB', '#E1BEE7'],
        offGradient: ['#21123a', '#433c57', '#5a495c']
    },
    // Perceptually-uniform, colorblind-safe ramps (matplotlib's viridis / cividis families).
    // Rule identity is the app's primary information channel, so these are correctness options,
    // not decoration: luminance rises monotonically along the ramp, which every class of color
    // vision reads the same way. `cvdSafe` drives the badge in the Chroma Lab preset cards.
    viridis: {
        name: 'Viridis',
        cvdSafe: true,
        gradient: ['#440154', '#414487', '#2A788E', '#22A884', '#7AD151', '#FDE725'],
        offGradient: ['#12000f', '#101322', '#0b2229', '#0a2f26', '#233d18', '#4a430b']
    },
    cividis: {
        name: 'Cividis',
        cvdSafe: true,
        gradient: ['#00224E', '#35456C', '#666970', '#948E77', '#C8B866', '#FEE838'],
        offGradient: ['#000a18', '#0f1420', '#1e1f21', '#2b2a23', '#3b371e', '#4c4511']
    },
    // The two rule-aware presets. Unlike every entry above they are not a ramp sampled by rule index
    // — they are explicit tables over *rule structure*, keyed `${centerState}-${group}` where group
    // is a live-neighbor count (0-6) or a C6 orbit representative bitmask. Hand-tuned rather than
    // generated, which is why the colors are written out: a hue wheel walked once across the groups,
    // saturated so adjacent groups separate at a glance, on pure black so only the firing rule
    // carries ink.
    //
    // Center state is deliberately NOT a color channel here: `0-g` and `1-g` share a hue, because
    // what these palettes are for is reading which *group* fired, and splitting the wheel in two to
    // encode the center bit costs more discrimination between groups than the bit is worth. The one
    // exception is the empty neighborhood, where the two halves of the wheel close: center-off is
    // black (that entry is also the birth flash, see below) and center-on takes the magenta the
    // sweep starts from.
    //
    // OFF outputs are black throughout, which also satisfies the birth/death flash guard for free —
    // rule 0 firing a birth (`0-0` ON) and rule 127 firing a death (`1-6` / `1-63` OFF) are the two
    // entries that would otherwise strobe.
    neighborGradient: {
        name: 'Neighbor Counts',
        logic: 'neighbor_count', // Special key to identify this as a logic-based preset
        colors: {
            '0-0': { on: '#000000', off: '#000000' },
            '1-0': { on: '#ff00fe', off: '#000000' },
            '0-1': { on: '#ff002a', off: '#000000' },
            '1-1': { on: '#ff002a', off: '#000000' },
            '0-2': { on: '#ffaa00', off: '#000000' },
            '1-2': { on: '#ffaa00', off: '#000000' },
            '0-3': { on: '#3fff00', off: '#000000' },
            '1-3': { on: '#3fff00', off: '#000000' },
            '0-4': { on: '#00fed4', off: '#000000' },
            '1-4': { on: '#00fed4', off: '#000000' },
            '0-5': { on: '#0055ff', off: '#000000' },
            '1-5': { on: '#0055ff', off: '#000000' },
            '0-6': { on: '#7f00ff', off: '#000000' },
            '1-6': { on: '#7f00ff', off: '#000000' },
        }
    },
    symmetryGradient: {
        name: 'Symmetry Groups',
        logic: 'symmetry', // Special key to identify this as a logic-based preset
        colors: {
            '0-0': { on: '#000000', off: '#000000' },
            '1-0': { on: '#ff00fe', off: '#000000' },
            '0-1': { on: '#ff009c', off: '#000000' },
            '1-1': { on: '#ff009c', off: '#000000' },
            '0-3': { on: '#ff003b', off: '#000000' },
            '1-3': { on: '#ff003b', off: '#000000' },
            '0-5': { on: '#ff2700', off: '#000000' },
            '1-5': { on: '#ff2700', off: '#000000' },
            '0-7': { on: '#ff8900', off: '#000000' },
            '1-7': { on: '#ff8900', off: '#000000' },
            '0-9': { on: '#feeb00', off: '#000000' },
            '1-9': { on: '#feeb00', off: '#000000' },
            '0-11': { on: '#88ff00', off: '#000000' },
            '1-11': { on: '#88ff00', off: '#000000' },
            '0-13': { on: '#27ff31', off: '#000000' },
            '1-13': { on: '#27ff31', off: '#000000' },
            '0-15': { on: '#00ff93', off: '#000000' },
            '1-15': { on: '#00ff93', off: '#000000' },
            '0-21': { on: '#00fef5', off: '#000000' },
            '1-21': { on: '#00fef5', off: '#000000' },
            '0-23': { on: '#00a6ff', off: '#000000' },
            '1-23': { on: '#00a6ff', off: '#000000' },
            '0-27': { on: '#0044ff', off: '#000000' },
            '1-27': { on: '#0044ff', off: '#000000' },
            '0-31': { on: '#1d00ff', off: '#000000' },
            '1-31': { on: '#1d00ff', off: '#000000' },
            '0-63': { on: '#7f00ff', off: '#000000' },
            '1-63': { on: '#7f00ff', off: '#000000' },
        }
    }
};

/**
 * The presets a host UI can offer, in declaration order — the `palette` attribute takes `key`.
 *
 * A projection rather than the table itself: a picker needs a key and a label, and handing external
 * hosts the raw gradients would make every stop in every ramp a compatibility surface. `logic`
 * distinguishes the two presets that color by *rule structure* (neighbor count, symmetry group)
 * rather than by taste, so a host can group or omit them; `cvdSafe` marks the perceptually-uniform
 * ramps, which is the difference between an accessibility option and a decorative one.
 *
 * @returns {Array<{key: string, name: string, logic?: string, cvdSafe?: boolean}>}
 */
export function listPresetPalettes() {
    return Object.entries(PRESET_PALETTES).map(([key, preset]) => ({
        key,
        name: preset.name || key,
        ...(preset.logic ? { logic: preset.logic } : {}),
        ...(preset.cvdSafe ? { cvdSafe: true } : {}),
    }));
}
