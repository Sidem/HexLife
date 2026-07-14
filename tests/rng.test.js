import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/core/rng.js';
import { deriveGridDimensions, GRID_SIZE_PRESETS, DEFAULT_GRID_SIZE_KEY } from '../src/core/gridMath.js';
import { hexToRuleset, rulesetToHex } from '../src/core/rulesetHex.js';
import { DensityStrategy } from '../src/core/initialStateStrategies/DensityStrategy.js';

/**
 * Determinism guards for the three primitives the embeddable widget (`src/embed/`) shares with the
 * app. A share link, an explore-search replay, the Daily Hex and every embed reproduce a run by
 * re-seeding these — so their outputs are a *public contract*, not an implementation detail.
 *
 * If one of these fails, the change under test silently invalidated every share link and embed in
 * existence. That is almost never what you want: fix the change, do not re-bless the values.
 */
describe('mulberry32 (canonical seeded PRNG)', () => {
    // Golden stream. Pinned 2026-07-14 from the implementation that shipped every existing share
    // link and explore-replay. These bytes ARE the contract.
    it('produces the pinned stream for seed 1', () => {
        const rng = mulberry32(1);
        const got = Array.from({ length: 5 }, () => rng());
        expect(got).toEqual([
            0.6270739405881613,
            0.002735721180215478,
            0.5274470399599522,
            0.9810509674716741,
            0.9683778982143849,
        ]);
    });

    it('is a pure function of the seed (same seed ⇒ same stream)', () => {
        const a = Array.from({ length: 32 }, mulberry32(12345));
        const b = Array.from({ length: 32 }, mulberry32(12345));
        expect(a).toEqual(b);
    });

    it('decorrelates adjacent seeds (the non-deterministic reset path uses baseSeed + worldIndex)', () => {
        const a = mulberry32(1000)();
        const b = mulberry32(1001)();
        expect(Math.abs(a - b)).toBeGreaterThan(0.01);
    });

    it('stays in [0, 1)', () => {
        const rng = mulberry32(0xdeadbeef);
        for (let i = 0; i < 1000; i++) {
            const v = rng();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('truncates the seed to int32, so any integer is accepted', () => {
        expect(() => mulberry32(-1)()).not.toThrow();
        expect(mulberry32(-1)()).toEqual(mulberry32(0xffffffff)());
    });
});

describe('deriveGridDimensions', () => {
    it('derives an even column count ≈ rows·2/√3 for every preset', () => {
        // Pinned: the embed must derive identical dims from the same `rows`, or a shared seed fills
        // a differently-shaped grid and the tick sequences diverge.
        expect(deriveGridDimensions(96)).toEqual({ rows: 96, cols: 112 });
        expect(deriveGridDimensions(192)).toEqual({ rows: 192, cols: 222 });
        expect(deriveGridDimensions(384)).toEqual({ rows: 384, cols: 444 });
        expect(deriveGridDimensions(576)).toEqual({ rows: 576, cols: 666 });
    });

    it('legacy default is 192 x 222 (42624 cells)', () => {
        const { rows, cols } = deriveGridDimensions(GRID_SIZE_PRESETS[DEFAULT_GRID_SIZE_KEY]);
        expect(rows * cols).toBe(42624);
    });

    it('always yields an even column count (seamless toroidal wrap)', () => {
        for (let rows = 2; rows <= 512; rows++) {
            expect(deriveGridDimensions(rows).cols % 2).toBe(0);
        }
    });

    it('falls back to the default preset for garbage input, and clamps to >= 2 rows', () => {
        expect(deriveGridDimensions(0).rows).toBe(GRID_SIZE_PRESETS[DEFAULT_GRID_SIZE_KEY]);
        expect(deriveGridDimensions(NaN).rows).toBe(GRID_SIZE_PRESETS[DEFAULT_GRID_SIZE_KEY]);
        expect(deriveGridDimensions(1).rows).toBe(2);
        expect(deriveGridDimensions(-50).rows).toBe(2);
    });
});

describe('seeded initial fill (PRNG + DensityStrategy together)', () => {
    it('produces the pinned grid for a fixed (seed, density)', () => {
        // The exact composition the worker's RESET_WORLD path performs. This is what an embed
        // replays to reproduce a run, so it is pinned end-to-end rather than per-component.
        const cells = new Uint8Array(64);
        new DensityStrategy().generate(cells, { density: 0.5 }, mulberry32(42), { GRID_COLS: 8, GRID_ROWS: 8 });
        expect(Array.from(cells)).toEqual([
            0, 1, 0, 0, 1, 0, 1, 0,
            0, 1, 1, 0, 0, 1, 1, 0,
            0, 0, 1, 1, 0, 1, 0, 1,
            1, 1, 1, 0, 0, 1, 1, 0,
            1, 0, 1, 1, 1, 1, 0, 0,
            1, 0, 1, 1, 0, 0, 0, 1,
            1, 1, 1, 0, 0, 0, 0, 1,
            0, 1, 0, 1, 1, 1, 1, 1,
        ]);
    });

    it('density 0 and 1 place a single opposite cell at the center', () => {
        const config = { GRID_COLS: 8, GRID_ROWS: 8 };
        const empty = new Uint8Array(64);
        new DensityStrategy().generate(empty, { density: 0 }, mulberry32(1), config);
        expect(empty.reduce((a, b) => a + b, 0)).toBe(1);
        expect(empty[4 * 8 + 4]).toBe(1);

        const full = new Uint8Array(64);
        new DensityStrategy().generate(full, { density: 1.0 }, mulberry32(1), config);
        expect(full.reduce((a, b) => a + b, 0)).toBe(63);
        expect(full[4 * 8 + 4]).toBe(0);
    });
});

describe('rulesetHex round-trip', () => {
    it('round-trips hex → ruleset → hex', () => {
        const hex = '0123456789ABCDEF0123456789ABCDEF';
        expect(rulesetToHex(hexToRuleset(hex))).toBe(hex);
    });

    it('returns a zeroed ruleset for malformed hex rather than throwing', () => {
        expect(hexToRuleset('nope').every(v => v === 0)).toBe(true);
        expect(hexToRuleset('').every(v => v === 0)).toBe(true);
        expect(hexToRuleset('ABC').every(v => v === 0)).toBe(true);
        expect(hexToRuleset(null).every(v => v === 0)).toBe(true);
    });

    it('is bit-order stable: rule index 0 is the high bit', () => {
        const r = hexToRuleset('80000000000000000000000000000000');
        expect(r[0]).toBe(1);
        expect(r.slice(1).every(v => v === 0)).toBe(true);
    });
});
