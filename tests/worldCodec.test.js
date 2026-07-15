import { describe, it, expect } from 'vitest';
import {
    encodeWorldCode,
    decodeWorldCode,
    isWorldCode,
    isFlickerProofPalette,
    explorerUrlForRuleset,
} from '../src/core/WorldCodec.js';
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
        expect(back.brushSize).toBe(2); // default when not provided
        expect(Array.from(back.cells)).toEqual(Array.from(world.cells));
        expect(back.lut).toBeNull();
    });

    it('round-trips an explicit brush size', async () => {
        const world = { ...makeWorld(16), brushSize: 5 };
        const back = await decodeWorldCode(await encodeWorldCode(world));
        expect(back.brushSize).toBe(5);
    });

    it('clamps brush size to 0–40', async () => {
        expect((await decodeWorldCode(await encodeWorldCode({
            ...makeWorld(16), brushSize: 99,
        }))).brushSize).toBe(40);
        expect((await decodeWorldCode(await encodeWorldCode({
            ...makeWorld(16), brushSize: -3,
        }))).brushSize).toBe(0);
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

    it('round-trips a generator descriptor instead of cells', async () => {
        // A random-fill / clumps specimen ships its recipe, not one frozen draw. `cells` is dropped;
        // `generator` comes back verbatim so the embed can reseed a fresh state each start.
        const { rows, cols } = makeWorld(32);
        for (const generator of [
            { mode: 'density', params: { density: 0.42 } },
            { mode: 'clusters', params: { count: 5, density: 0.7, diameter: 20, eccentricity: 0.3 } },
        ]) {
            const code = await encodeWorldCode({ rows, cols, rulesetHex: RULESET, generator, colorSettings: COLOR_SETTINGS, speed: 30 });
            expect(isWorldCode(code)).toBe(true);
            const back = await decodeWorldCode(code);
            expect(back.cells).toBeNull();
            expect(back.generator).toEqual(generator);
            expect(back.rows).toBe(rows);
            expect(back.cols).toBe(cols);
            expect(back.speed).toBe(30);
        }
    });

    it('a packed-cells code decodes with a null generator', async () => {
        const back = await decodeWorldCode(await encodeWorldCode(makeWorld(16)));
        expect(back.generator).toBeNull();
        expect(back.cells).not.toBeNull();
    });

    it('refuses a generator with an unknown mode', async () => {
        const { rows, cols } = makeWorld(16);
        const bad = { rows, cols, rulesetHex: RULESET, colorSettings: COLOR_SETTINGS, generator: { mode: 'spiral', params: {} } };
        expect(await encodeWorldCode(bad)).toBeNull();
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

    describe('isFlickerProofPalette (Devvit autoplay gate)', () => {
        it('requires flickerProofPresets on preset modes', () => {
            expect(isFlickerProofPalette({ mode: 'preset', activePreset: 'default' })).toBe(false);
            expect(isFlickerProofPalette({
                mode: 'preset', activePreset: 'default', flickerProofPresets: true,
            })).toBe(true);
        });

        it('rejects gradient and baked LUTs', () => {
            expect(isFlickerProofPalette({
                mode: 'gradient', customGradient: { on: ['#f00'], off: ['#000'] },
            })).toBe(false);
            expect(isFlickerProofPalette(null, new Uint8Array(1024))).toBe(false);
            expect(isFlickerProofPalette(null)).toBe(false);
        });

        it('accepts neighbor/symmetry maps only when birth/death colors match', () => {
            expect(isFlickerProofPalette({
                mode: 'neighbor_count',
                customNeighborColors: {
                    '0-0': { on: '#000000', off: '#111' },
                    '1-6': { on: '#fff', off: '#000000' },
                },
            })).toBe(true);
            expect(isFlickerProofPalette({
                mode: 'neighbor_count',
                customNeighborColors: {
                    '0-0': { on: '#ffffff', off: '#111' },
                    '1-6': { on: '#fff', off: '#333333' },
                },
            })).toBe(false);
            expect(isFlickerProofPalette({
                mode: 'symmetry',
                customSymmetryColors: {
                    '0-0': { on: '#abc', off: '#000' },
                    '1-63': { on: '#fff', off: '#ABC' },
                },
            })).toBe(true);
        });

        it('survives round-trip: flag only present when true in the code', async () => {
            const withFlag = await decodeWorldCode(await encodeWorldCode({
                ...makeWorld(16),
                colorSettings: { mode: 'preset', activePreset: 'default', flickerProofPresets: true },
            }));
            const without = await decodeWorldCode(await encodeWorldCode({
                ...makeWorld(16),
                colorSettings: { mode: 'preset', activePreset: 'default' },
            }));
            expect(isFlickerProofPalette(withFlag.colorSettings)).toBe(true);
            expect(isFlickerProofPalette(without.colorSettings)).toBe(false);
        });
    });

    describe('explorerUrlForRuleset', () => {
        it('builds a ShareCodec r= deep-link', () => {
            const url = explorerUrlForRuleset(RULESET);
            expect(url).toBe(`https://sidem.github.io/HexLife/?r=${RULESET}`);
        });

        it('adds g= when rows differ from the embed default', () => {
            expect(explorerUrlForRuleset(RULESET, { rows: 192 }))
                .toBe(`https://sidem.github.io/HexLife/?r=${RULESET}&g=192`);
            expect(explorerUrlForRuleset(RULESET, { rows: 64 }))
                .toBe(`https://sidem.github.io/HexLife/?r=${RULESET}`);
        });
    });
});
