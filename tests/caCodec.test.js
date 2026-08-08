import { describe, it, expect } from 'vitest';
import {
    backendTag,
    caRuleShape,
    decodeCaCode,
    encodeCaCode,
    isCaCode,
    isValidCaGeometry,
    BACKEND_BLOCK,
    BACKEND_NEIGHBORHOOD,
} from '../src/core/CaCodec.js';
import { decodeWorldCode, encodeWorldCode, isWorldCode } from '../src/core/WorldCodec.js';
import { MAX_BLOCK_STATES, MAX_NEIGHBORHOOD_STATES } from '../src/embed/caAttrs.js';

/**
 * The `HXK1.` k-state world code.
 *
 * The load-bearing property is not the round-trip — it is the *mutual rejection* in the first block
 * below. `HXK1` exists as a distinct prefix rather than an `HXW1` version bump so that a binary
 * decoder already deployed in someone's page refuses a k-state payload outright instead of
 * half-reading one whose every region means something else. If those two tests ever stop passing,
 * the reason this codec exists has evaporated.
 */

const RULESET_HEX = '0123456789ABCDEF0123456789ABCDEF';

/** A small block world: 6 columns × 6 rows (even cols, rows % 3 == 0), k = 4. */
function blockWorld(overrides = {}) {
    const rows = 6;
    const cols = 6;
    const states = 4;
    // Cyclic rotation of the triple — conservative and isotropic, and cheap to spell inline.
    const rule = new Uint16Array(states ** 3);
    for (let s0 = 0; s0 < states; s0++) {
        for (let s1 = 0; s1 < states; s1++) {
            for (let s2 = 0; s2 < states; s2++) {
                rule[s0 * 16 + s1 * 4 + s2] = s2 * 16 + s0 * 4 + s1;
            }
        }
    }
    const cells = new Uint8Array(rows * cols);
    for (let i = 0; i < cells.length; i++) cells[i] = i % states;
    return { rows, cols, states, backend: 'block', rule, cells, speed: 20, ...overrides };
}

/** A small neighborhood world at k = 2, so the k⁷ table stays 128 entries. */
function neighborhoodWorld(overrides = {}) {
    const rows = 4;
    const cols = 6;
    const states = 2;
    const rule = new Uint8Array(states ** 7);
    for (let i = 0; i < rule.length; i++) rule[i] = i % states;
    const cells = new Uint8Array(rows * cols);
    for (let i = 0; i < cells.length; i++) cells[i] = i % states;
    return { rows, cols, states, backend: 'neighborhood', rule, cells, speed: 7, ...overrides };
}

describe('HXK1 is a distinct format, not a version of HXW1', () => {
    it('an HXW1 decoder refuses a k-state code outright', async () => {
        const code = await encodeCaCode(blockWorld());
        expect(code.startsWith('HXK1.')).toBe(true);
        // The whole argument for the prefix: this must be a "no" at the prefix check, before any
        // byte of a payload whose every region means something else is looked at.
        expect(isWorldCode(code)).toBe(false);
        expect(await decodeWorldCode(code)).toBeNull();
    });

    it('the k-state decoder refuses a binary world code', async () => {
        const worldCode = await encodeWorldCode({
            rows: 4,
            cols: 6,
            rulesetHex: RULESET_HEX,
            cells: new Uint8Array(24),
            colorSettings: { mode: 'preset', activePreset: 'default' },
        });
        expect(worldCode.startsWith('HXW1.')).toBe(true);
        expect(isCaCode(worldCode)).toBe(false);
        expect(await decodeCaCode(worldCode)).toBeNull();
    });
});

describe('encodeCaCode / decodeCaCode round-trip', () => {
    it('carries the block backend, its k^3 rule and the exact cells', async () => {
        const world = blockWorld();
        const decoded = await decodeCaCode(await encodeCaCode(world));
        expect(decoded).not.toBeNull();
        expect(decoded.rows).toBe(world.rows);
        expect(decoded.cols).toBe(world.cols);
        expect(decoded.states).toBe(4);
        expect(decoded.backend).toBe('block');
        expect(decoded.speed).toBe(20);
        // The exact type `HexCA#setRule` wants for this backend, so a decoded world needs no
        // conversion before it can be installed.
        expect(decoded.rule).toBeInstanceOf(Uint16Array);
        expect(Array.from(decoded.rule)).toEqual(Array.from(world.rule));
        expect(Array.from(decoded.cells)).toEqual(Array.from(world.cells));
        expect(decoded.palette).toBeNull();
    });

    it('carries the neighborhood backend and its k^7 rule as bytes', async () => {
        const world = neighborhoodWorld();
        const decoded = await decodeCaCode(await encodeCaCode(world));
        expect(decoded.backend).toBe('neighborhood');
        expect(decoded.rule).toBeInstanceOf(Uint8Array);
        expect(decoded.rule).toHaveLength(128);
        expect(Array.from(decoded.rule)).toEqual(Array.from(world.rule));
        expect(decoded.speed).toBe(7);
    });

    it('round-trips a palette, and only one of exactly k entries', async () => {
        const palette = [[1, 2, 3], [250, 0, 0], [0, 250, 0], [0, 0, 250]];
        const decoded = await decodeCaCode(await encodeCaCode(blockWorld({ palette })));
        expect(decoded.palette).toEqual(palette);

        // A palette that does not cover the states is a caller bug, not something to pad silently.
        expect(await encodeCaCode(blockWorld({ palette: [[1, 2, 3]] }))).toBeNull();
    });

    it('accepts a numeric backend tag as well as a name', async () => {
        expect(backendTag('block')).toBe(BACKEND_BLOCK);
        expect(backendTag(BACKEND_NEIGHBORHOOD)).toBe(BACKEND_NEIGHBORHOOD);
        expect(backendTag('nonsense')).toBeNull();
        const decoded = await decodeCaCode(await encodeCaCode(blockWorld({ backend: BACKEND_BLOCK })));
        expect(decoded.backend).toBe('block');
    });
});

describe('the codec refuses worlds the engine would refuse', () => {
    it('rejects rows that are not a multiple of 3 in block mode', async () => {
        // The three-phase partition is seamless only if the sublattice residue survives the row
        // wrap. 64 — the binary element's own default — is exactly the trap this catches.
        expect(isValidCaGeometry(64, 76, 4, BACKEND_BLOCK)).toBe(false);
        expect(isValidCaGeometry(66, 76, 4, BACKEND_BLOCK)).toBe(true);
        // ...and it is not a constraint on the other backend.
        expect(isValidCaGeometry(64, 76, 4, BACKEND_NEIGHBORHOOD)).toBe(true);
        expect(await encodeCaCode(blockWorld({ rows: 4, cells: new Uint8Array(24) }))).toBeNull();
    });

    it('rejects odd columns, which would break the hex parity the neighbour table depends on', () => {
        expect(isValidCaGeometry(66, 75, 4, BACKEND_BLOCK)).toBe(false);
    });

    it('rejects a k above the backend cap', () => {
        expect(caRuleShape(MAX_NEIGHBORHOOD_STATES, BACKEND_NEIGHBORHOOD)).not.toBeNull();
        expect(caRuleShape(MAX_NEIGHBORHOOD_STATES + 1, BACKEND_NEIGHBORHOOD)).toBeNull();
        expect(caRuleShape(MAX_BLOCK_STATES, BACKEND_BLOCK)).not.toBeNull();
        expect(caRuleShape(MAX_BLOCK_STATES + 1, BACKEND_BLOCK)).toBeNull();
        expect(caRuleShape(1, BACKEND_BLOCK)).toBeNull();
        expect(caRuleShape(4, 99)).toBeNull();
    });

    it('derives the rule blob length rather than trusting a stored one', () => {
        expect(caRuleShape(4, BACKEND_NEIGHBORHOOD)).toEqual({ entries: 4 ** 7, bytesPerEntry: 1, bytes: 4 ** 7 });
        expect(caRuleShape(16, BACKEND_BLOCK)).toEqual({ entries: 4096, bytesPerEntry: 2, bytes: 8192 });
    });

    it('rejects a rule or cell array of the wrong length', async () => {
        expect(await encodeCaCode(blockWorld({ rule: new Uint16Array(63) }))).toBeNull();
        expect(await encodeCaCode(blockWorld({ cells: new Uint8Array(35) }))).toBeNull();
    });

    it('rejects out-of-range cells and rule entries at encode time', async () => {
        const badCells = blockWorld();
        badCells.cells = Uint8Array.from(badCells.cells);
        badCells.cells[0] = 9;                       // not a state below k = 4
        expect(await encodeCaCode(badCells)).toBeNull();

        const badRule = blockWorld();
        badRule.rule = Uint16Array.from(badRule.rule);
        badRule.rule[0] = 64;                        // not a packed triple below k^3
        expect(await encodeCaCode(badRule)).toBeNull();
    });
});

describe('decoding is total — a stranger pasted this', () => {
    it('returns null rather than throwing for every shape of garbage', async () => {
        for (const bad of ['', '   ', 'HXK1.', 'HXK1.!!!!', 'HXW1.abcdef', 'nonsense', 'HXK1.AAAA']) {
            expect(await decodeCaCode(bad)).toBeNull();
        }
        expect(await decodeCaCode(null)).toBeNull();
        expect(await decodeCaCode(42)).toBeNull();
    });

    it('rejects a truncated payload on an exact byte count', async () => {
        const code = await encodeCaCode(blockWorld());
        // Lopping base64 characters off the end changes the payload length, which cannot survive the
        // exact `header + palette + rule + cells` check even when it still inflates.
        for (const cut of [1, 2, 4, 8, 16]) {
            expect(await decodeCaCode(code.slice(0, code.length - cut))).toBeNull();
        }
    });

    it('tolerates surrounding whitespace, the way a paste arrives', async () => {
        const code = await encodeCaCode(blockWorld());
        expect(await decodeCaCode(`\n  ${code}  \n`)).not.toBeNull();
        expect(isCaCode(`  ${code}`)).toBe(true);
    });
});

describe('constants stay in step with the engine surface', () => {
    it('agrees with ca.js about the state caps', async () => {
        // `CaCodec.js` duplicates these rather than importing them, so it stays free of the wasm
        // binding and a Node host can validate a code without loading an engine. This is the pin
        // that keeps the duplication honest.
        const ca = await import('../src/embed/ca.js');
        expect(MAX_NEIGHBORHOOD_STATES).toBe(ca.MAX_NEIGHBORHOOD_STATES);
        expect(MAX_BLOCK_STATES).toBe(ca.MAX_BLOCK_STATES);
        expect(caRuleShape(ca.MAX_NEIGHBORHOOD_STATES, BACKEND_NEIGHBORHOOD)).not.toBeNull();
        expect(caRuleShape(ca.MAX_BLOCK_STATES, BACKEND_BLOCK)).not.toBeNull();
    });
});
