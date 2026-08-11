import { describe, it, expect } from 'vitest';
import { generateThumbnailLUT, rotateHue, generateColorLUT, buildLogicPresetColors } from '../src/utils/ruleVizUtils.js';
import { precomputeSymmetryGroups, rotateBitmaskClockwise } from '../src/core/Symmetry.js';
import { PRESET_PALETTES } from '../src/core/colorPalettes.js';

// The baked-thumbnail LUT must be palette-independent and CVD-proof: pure grayscale (zero hue),
// luminance rising monotonically with rule index within each band, and a hard gap between the OFF
// band (row 0) and the ON band (row 1) so cell state always dominates rule identity.
describe('generateThumbnailLUT', () => {
    const lut = generateThumbnailLUT();
    const px = (outputState, ruleIndex) => {
        const i = (outputState * 128 + ruleIndex) * 4;
        return [lut[i], lut[i + 1], lut[i + 2], lut[i + 3]];
    };

    it('is a 128x2 RGBA buffer', () => {
        expect(lut).toBeInstanceOf(Uint8Array);
        expect(lut.length).toBe(128 * 2 * 4);
    });

    it('is pure grayscale with full alpha (hue-free ⇒ CVD-proof)', () => {
        for (let s = 0; s < 2; s++) {
            for (let r = 0; r < 128; r++) {
                const [red, green, blue, alpha] = px(s, r);
                expect(green).toBe(red);
                expect(blue).toBe(red);
                expect(alpha).toBe(255);
            }
        }
    });

    it('luminance rises monotonically with rule index in both bands', () => {
        for (let s = 0; s < 2; s++) {
            for (let r = 1; r < 128; r++) {
                expect(px(s, r)[0]).toBeGreaterThanOrEqual(px(s, r - 1)[0]);
            }
        }
    });

    it('every ON luminance sits strictly above every OFF luminance (state dominates rule identity)', () => {
        const maxOff = px(0, 127)[0];
        const minOn = px(1, 0)[0];
        expect(minOn).toBeGreaterThan(maxOff);
    });
});

// The Chroma Lab hue-shift slider rotates every chromatic color around the wheel while leaving
// achromatic pixels (blacks/grays/whites) untouched, so structure and black backgrounds are stable.
describe('rotateHue', () => {
    it('is a no-op at 0 degrees', () => {
        expect(rotateHue([200, 50, 10], 0)).toEqual([200, 50, 10]);
    });

    it('leaves achromatic colors (saturation 0) unchanged', () => {
        for (const gray of [[0, 0, 0], [128, 128, 128], [255, 255, 255]]) {
            expect(rotateHue(gray, 120)).toEqual(gray);
            expect(rotateHue(gray, 240)).toEqual(gray);
        }
    });

    it('rotates primary hues by 120 degrees (red -> green -> blue)', () => {
        expect(rotateHue([255, 0, 0], 120)).toEqual([0, 255, 0]);
        expect(rotateHue([0, 255, 0], 120)).toEqual([0, 0, 255]);
        expect(rotateHue([0, 0, 255], 120)).toEqual([255, 0, 0]);
    });

    it('wraps a full turn back to (near) the original', () => {
        expect(rotateHue([255, 0, 0], 360)).toEqual([255, 0, 0]);
    });
});

// The hueShift setting threads through the canvas LUT: chromatic outputs rotate, the flicker-proof
// black overrides stay black.
describe('generateColorLUT hueShift', () => {
    const base = { mode: 'preset', activePreset: 'default', flickerProofPresets: true };
    const px = (lut, outputState, ruleIndex) => {
        const i = (outputState * 128 + ruleIndex) * 4;
        return [lut[i], lut[i + 1], lut[i + 2]];
    };

    it('shifts chromatic ON cells but keeps the flicker-proof black cells black', () => {
        const shifted = generateColorLUT({ ...base, hueShift: 90 }, null);
        const unshifted = generateColorLUT({ ...base, hueShift: 0 }, null);
        // rule 0 / ON is forced black by the flicker guard — must stay black under any shift.
        expect(px(shifted, 1, 0)).toEqual([0, 0, 0]);
        // a chromatic ON cell must actually change hue.
        expect(px(shifted, 1, 40)).not.toEqual(px(unshifted, 1, 40));
    });
});

describe('rule-aware preset palettes', () => {
    const symmetryData = precomputeSymmetryGroups();
    const px = (lut, outputState, ruleIndex) => {
        const i = (outputState * 128 + ruleIndex) * 4;
        return [lut[i], lut[i + 1], lut[i + 2]];
    };

    it('keys Neighbor Counts by center state plus live-neighbor count, not arrangement', () => {
        const lut = generateColorLUT({
            mode: 'preset', activePreset: 'neighborGradient', hueShift: 0,
        }, symmetryData);
        // Same count, different arrangement — one color.
        expect(px(lut, 1, 0b000011)).toEqual(px(lut, 1, 0b001001));
        // Different count — different color.
        expect(px(lut, 1, 0b000011)).not.toEqual(px(lut, 1, 0b000001));
        // The center bit is not a color channel; see the hue-per-group test below.
        expect(px(lut, 1, 0b000011)).toEqual(px(lut, 1, 0b1000011));
    });

    it('keys Symmetry Groups by center state plus C6 orbit', () => {
        const lut = generateColorLUT({
            mode: 'preset', activePreset: 'symmetryGradient', hueShift: 0,
        }, symmetryData);
        const mask = 0b001011;
        const rotated = rotateBitmaskClockwise(mask);
        // A rotation stays in the same orbit — one color.
        expect(px(lut, 1, mask)).toEqual(px(lut, 1, rotated));
        // A different orbit — different color.
        expect(px(lut, 1, mask)).not.toEqual(px(lut, 1, 0b000001));
        // The center bit is not a color channel; see the hue-per-group test below.
        expect(px(lut, 1, mask)).toEqual(px(lut, 1, mask | 0b1000000));
    });

    // The two rule-aware presets are reachable by two routes that used to compute them from two
    // different formulas: the app switches mode (ColorController.applyPreset seeds a per-group table
    // and renders in 'neighbor_count'/'symmetry' mode), while an embed with palette="neighborGradient"
    // has no ColorController and renders in 'preset' mode. The embed's ramp restarted per center
    // state, so all 128 ON entries disagreed with the app's. Both routes now read the preset's own
    // authored table; this is the lock that keeps them from drifting apart again.
    describe.each([
        ['neighborGradient', 'neighbor_count', 'customNeighborColors'],
        ['symmetryGradient', 'symmetry', 'customSymmetryColors'],
    ])('%s renders identically in the embed and the app', (activePreset, mode, customKey) => {
        const embedLut = hueShift => generateColorLUT({ mode: 'preset', activePreset, hueShift }, symmetryData);
        const appLut = hueShift => generateColorLUT({
            mode,
            [customKey]: buildLogicPresetColors(PRESET_PALETTES[activePreset]),
            hueShift,
        }, symmetryData);

        it('produces a byte-identical LUT', () => {
            expect(embedLut(0)).toEqual(appLut(0));
        });

        it('stays identical under a hue shift', () => {
            expect(embedLut(120)).toEqual(appLut(120));
        });

        it('hands out a copy, so editing the seed cannot rewrite the preset', () => {
            const seed = buildLogicPresetColors(PRESET_PALETTES[activePreset]);
            seed['0-1'].on = '#123456';
            expect(PRESET_PALETTES[activePreset].colors['0-1'].on).not.toBe('#123456');
            expect(buildLogicPresetColors(PRESET_PALETTES[activePreset])['0-1'].on).not.toBe('#123456');
        });

        it('paints OFF outputs black, which is also the birth/death flash guard', () => {
            const lut = embedLut(0);
            for (let ruleIndex = 0; ruleIndex < 128; ruleIndex++) {
                expect(px(lut, 0, ruleIndex)).toEqual([0, 0, 0]);
            }
            // rule 0 firing a birth is the other entry that would strobe.
            expect(px(lut, 1, 0)).toEqual([0, 0, 0]);
        });
    });

    // The authored tables encode the group in hue and deliberately leave the center bit uncolored,
    // so a rule reads as "which group fired". Only the empty neighborhood splits the two, where the
    // hue wheel closes: center-off is the flash-guard black, center-on the magenta it starts from.
    it('gives both center states one hue per group, except the empty neighborhood', () => {
        for (const [activePreset, groups] of [
            ['neighborGradient', [0, 1, 2, 3, 4, 5, 6]],
            ['symmetryGradient', [0, 1, 3, 5, 7, 9, 11, 13, 15, 21, 23, 27, 31, 63]],
        ]) {
            const { colors } = PRESET_PALETTES[activePreset];
            const hues = new Set();
            for (const group of groups) {
                if (group !== 0) expect(colors[`0-${group}`].on).toBe(colors[`1-${group}`].on);
                hues.add(colors[`0-${group}`].on);
            }
            expect(colors['0-0'].on).toBe('#000000');
            expect(colors['1-0'].on).not.toBe(colors['0-0'].on);
            // Every group is visually distinct — the whole point of these palettes.
            expect(hues.size).toBe(groups.length);
        }
    });
});
