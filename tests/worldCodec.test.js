import { describe, it, expect } from 'vitest';
import { encodeWorldCode, decodeWorldCode, isWorldCode } from '../src/core/WorldCodec.js';
import { packCells } from '../src/utils/utils.js';
import { generateColorLUT } from '../src/utils/ruleVizUtils.js';
import { precomputeSymmetryGroups } from '../src/core/Symmetry.js';
import { deriveGridDimensions } from '../src/core/gridMath.js';

const RULESET = 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6';

const COLOR_SETTINGS = {
    mode: 'gradient',
    activePreset: 'default',
    customGradient: { on: ['#ff0000', '#00ff88'], off: ['#220033', '#003322'], autoOff: false },
    flickerProofPresets: true,
    hueShift: 137,
};

/** A deterministic pseudo-random world, so a failure is reproducible. */
function makeWorld(rows = 32, fill = 'random') {
    const { cols } = deriveGridDimensions(rows);
    const cells = new Uint8Array(rows * cols);
    if (fill === 'random') {
        let x = 1234567;
        for (let i = 0; i < cells.length; i++) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            cells[i] = (x >> 16) & 1;
        }
    } else if (fill === 'sparse') {
        for (let i = 0; i < cells.length; i += 97) cells[i] = 1;   // a drawn-pattern-ish grid
    }
    return { rows, cols, rulesetHex: RULESET, cells, colorSettings: COLOR_SETTINGS, speed: 20 };
}

function bakedLut() {
    const lut = new Uint8Array(128 * 2 * 4);
    for (let i = 0; i < 128 * 2; i++) {
        lut[i * 4] = i & 0xff;
        lut[i * 4 + 1] = (i * 7) & 0xff;
        lut[i * 4 + 2] = (255 - i) & 0xff;
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

describe('WorldCodec', () => {
    it('round-trips a world exactly', async () => {
        const world = makeWorld();
        const code = await encodeWorldCode(world);
        expect(isWorldCode(code)).toBe(true);

        const back = await decodeWorldCode(code);
        expect(back.rows).toBe(world.rows);
        expect(back.cols).toBe(world.cols);
        expect(back.rulesetHex).toBe(RULESET);
        expect(back.speed).toBe(20);
        expect(Array.from(back.cells)).toEqual(Array.from(world.cells));
        expect(back.lut).toBeNull();
    });

    it('reproduces the app\'s exact LUT from the transmitted color settings', async () => {
        // The whole point of shipping settings rather than 768 bytes of baked table: the decoder must
        // rebuild a byte-identical LUT — including the hue shift and the symmetry-keyed modes, whose
        // tables the embed recomputes rather than receives.
        const symmetryData = precomputeSymmetryGroups();
        for (const settings of [
            COLOR_SETTINGS,
            { mode: 'preset', activePreset: 'symmetryGradient', hueShift: 40 },
            { mode: 'symmetry', customSymmetryColors: { '0-0': { on: '#123456', off: '#654321' } }, hueShift: 0 },
        ]) {
            const world = { ...makeWorld(16), colorSettings: settings };
            const back = await decodeWorldCode(await encodeWorldCode(world));
            expect(Array.from(generateColorLUT(back.colorSettings, symmetryData)))
                .toEqual(Array.from(generateColorLUT(settings, symmetryData)));
        }
    });

    it('accepts a baked LUT when no settings are available', async () => {
        const lut = bakedLut();
        const world = { ...makeWorld(16), colorSettings: undefined, lut };
        const back = await decodeWorldCode(await encodeWorldCode(world));
        expect(back.colorSettings).toBeNull();
        expect(Array.from(back.lut)).toEqual(Array.from(lut));   // alpha reconstructed as 255
    });

    it('compresses a structured world far below the raw bit-packed size', async () => {
        const sparse = makeWorld(192, 'sparse');
        const random = makeWorld(192, 'random');
        const rawBytes = Math.ceil(sparse.cells.length / 8);

        const sparseCode = await encodeWorldCode(sparse);
        const randomCode = await encodeWorldCode(random);

        // A sparse/structured grid — the kind anyone actually wants to post — collapses.
        expect(sparseCode.length).toBeLessThan(rawBytes / 4);
        // A 50%-random grid does not, and cannot: that is information theory, not a missing
        // optimisation. It must still round-trip, and must not have *grown* (encode keeps the
        // smaller of deflated/raw).
        expect(randomCode.length).toBeLessThan(rawBytes * 1.4);
        expect(Array.from((await decodeWorldCode(sparseCode)).cells)).toEqual(Array.from(sparse.cells));
        expect(Array.from((await decodeWorldCode(randomCode)).cells)).toEqual(Array.from(random.cells));
    });

    it('is agnostic to grid size', async () => {
        for (const rows of [16, 96, 192]) {
            const world = makeWorld(rows);
            const back = await decodeWorldCode(await encodeWorldCode(world));
            expect(back.rows).toBe(rows);
            expect(Array.from(back.cells)).toEqual(Array.from(world.cells));
        }
    });

    it('packs cells the same way the save-file format does', async () => {
        // The codec reimplements the packing (it must not import config.js via utils.js); this pins
        // the two together, because a drift here would silently mirror every post's world.
        const world = makeWorld(16);
        const back = await decodeWorldCode(await encodeWorldCode(world));
        expect(Array.from(packCells(back.cells))).toEqual(Array.from(packCells(world.cells)));
    });

    it('normalizes the ruleset to uppercase hex', async () => {
        const world = { ...makeWorld(16), rulesetHex: RULESET.toLowerCase() };
        expect((await decodeWorldCode(await encodeWorldCode(world))).rulesetHex).toBe(RULESET);
    });

    it('refuses to encode a world whose parts disagree', async () => {
        const world = makeWorld(16);
        expect(await encodeWorldCode({ ...world, cells: new Uint8Array(5) })).toBeNull();
        expect(await encodeWorldCode({ ...world, rulesetHex: 'nope' })).toBeNull();
        expect(await encodeWorldCode({ ...world, rows: 0 })).toBeNull();
        // No palette at all in either form.
        expect(await encodeWorldCode({ ...world, colorSettings: undefined })).toBeNull();
    });

    it('rejects junk, foreign codes, and truncated pastes', async () => {
        expect(await decodeWorldCode(null)).toBeNull();
        expect(await decodeWorldCode('')).toBeNull();
        expect(await decodeWorldCode('hello')).toBeNull();
        expect(await decodeWorldCode('IC1.eyJtIjoiZGVuc2l0eSJ9')).toBeNull();
        expect(await decodeWorldCode('HXW1.AAAA')).toBeNull();

        // The realistic failure of a multi-kilobyte code in a text field: it arrives clipped.
        const code = await encodeWorldCode(makeWorld(16));
        expect(await decodeWorldCode(code.slice(0, code.length - 40))).toBeNull();
    });

    it('tolerates surrounding whitespace from a paste', async () => {
        const code = await encodeWorldCode(makeWorld(16));
        expect((await decodeWorldCode(`\n  ${code}  \n`)).rulesetHex).toBe(RULESET);
    });
});
