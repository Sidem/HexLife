/**
 * The 128×2 RGBA colour table every embed renderer samples, resolved from whichever form the host
 * specified its palette in.
 *
 * Extracted from `EmbedRenderer` when `@hexlife/embed/spacetime` arrived, because that entry draws
 * the *same* bytes through the *same* table — the spacetime voxel byte is literally a LUT index —
 * and two copies of this precedence order would be two subtly different palettes for one world.
 * There is one table, and both renderers build it here.
 */

import { generateColorLUT, rotateHue } from '../utils/ruleVizUtils.js';
import { PRESET_PALETTES } from '../core/colorPalettes.js';
import { precomputeSymmetryGroups } from '../core/Symmetry.js';

/** Bytes in the table: 128 rules × 2 states × RGBA. */
export const LUT_BYTES = 128 * 2 * 4;

/**
 * The symmetry tables `generateColorLUT` needs for the symmetry-keyed palettes (the
 * `symmetryGradient` preset and `mode: 'symmetry'`). The app threads these in from WorldManager;
 * the embed just recomputes them — `precomputeSymmetryGroups` is pure, ~100 lines, and runs over 64
 * bitmasks, so *transmitting* them (or refusing the palettes that need them) was never worth it.
 * Computed once at module load and shared by every renderer in the bundle.
 */
const SYMMETRY_DATA = precomputeSymmetryGroups();

/**
 * Build the table a host asked for.
 *
 * Precedence: a decoded world's `colorSettings`, then a baked `lut`, then a `customGradient` pair,
 * then the `palette` preset name.
 *
 * @param {{palette?: string, customGradient?: object|null, colorSettings?: object|null,
 *   lut?: Uint8Array|null, flickerProof?: boolean, hueShift?: number|null}} options
 * @param {string} [label='HexLife'] Prefix for the unknown-preset warning, so the message names the
 *   thing the host actually wrote.
 * @returns {Uint8Array} `LUT_BYTES` bytes, row 0 = state off, row 1 = state on.
 */
export function resolveEmbedLUT({
    palette = 'default',
    customGradient = null,
    colorSettings = null,
    lut = null,
    flickerProof = false,
    hueShift = null,
} = {}, label = 'HexLife') {
    if (colorSettings) {
        const settings = hueShift === null ? colorSettings : { ...colorSettings, hueShift };
        return generateColorLUT(settings, SYMMETRY_DATA);
    }
    if (lut && lut.length === LUT_BYTES) {
        if (!hueShift) return lut;
        const shifted = new Uint8Array(lut);
        for (let i = 0; i < shifted.length; i += 4) {
            const rgb = rotateHue([shifted[i], shifted[i + 1], shifted[i + 2]], hueShift);
            shifted[i] = rgb[0]; shifted[i + 1] = rgb[1]; shifted[i + 2] = rgb[2];
        }
        return shifted;
    }
    if (customGradient) {
        return generateColorLUT({ mode: 'gradient', customGradient, hueShift: hueShift || 0 }, SYMMETRY_DATA);
    }
    let activePreset = palette;
    if (!PRESET_PALETTES[activePreset]) {
        if (activePreset !== 'default') {
            console.warn(`${label}: unknown palette "${palette}", using "default".`);
        }
        activePreset = 'default';
    }
    // `flickerProofPresets` blacks out the two entries that make a palette strobe — rule 0 firing
    // a birth and rule 127 firing a death — so a cell that is about to change does not flash a
    // full-brightness frame first. It is the explorer's "Prevent birth/death flash", and it only
    // means anything in preset mode: the branches above are a host's own colors, and silently
    // rewriting two of them is not ours to do.
    return generateColorLUT(
        { mode: 'preset', activePreset, flickerProofPresets: !!flickerProof, hueShift: hueShift || 0 },
        SYMMETRY_DATA,
    );
}
