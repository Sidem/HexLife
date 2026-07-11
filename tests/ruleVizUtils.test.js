import { describe, it, expect } from 'vitest';
import { generateThumbnailLUT } from '../src/utils/ruleVizUtils.js';

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
