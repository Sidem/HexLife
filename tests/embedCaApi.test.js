import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
    BLOCK_PHASES,
    blockRuleFromTable,
    HexCA,
    initEngine,
    isConservative,
    isIsotropic,
    MAX_BLOCK_STATES,
    MAX_NEIGHBORHOOD_STATES,
    packBlock,
    ruleFromTable,
    unpackBlock,
} from '../src/embed/ca.js';

// The engine loader fetches its wasm by URL, which has no meaning under vitest's node environment.
// Serving the real binary off disk instead is what lets these tests exercise the ACTUAL `WorldK`
// rather than a mock — the JS layer's whole job is buffer-swap mirroring, view refresh and error
// translation, none of which a fake would catch.
beforeAll(async () => {
    const wasmPath = new URL('../src/core/wasm-engine/hexlife_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
    await initEngine();
});

/** `(s0, s1, s2) -> (s2, s0, s1)`: conservative and isotropic by construction. */
const rotation = (block) => [block[2], block[0], block[1]];

describe('@hexlife/embed/ca rule construction', () => {
    it('lays the dense table out the way the engine indexes it', () => {
        // At k=2 the k-state index `centre*k^6 + sum(nⱼ*kʲ)` collapses to `(centre << 6) | mask`,
        // i.e. HexLife's own 128-entry ruleset indexing — so this pins the neighbour ordering and
        // the digit places against a layout that is already load-bearing elsewhere.
        const rule = ruleFromTable(2, (centre, neighbours) => (centre ^ neighbours[3]));
        expect(rule).toHaveLength(128);
        for (let centre = 0; centre < 2; centre++) {
            for (let mask = 0; mask < 64; mask++) {
                const neighbour3 = (mask >> 3) & 1;
                expect(rule[(centre << 6) | mask]).toBe(centre ^ neighbour3);
            }
        }
    });

    it('builds a k^7 table for every allowed k and refuses the ones that would not fit', () => {
        expect(ruleFromTable(3, () => 0)).toHaveLength(3 ** 7);
        expect(ruleFromTable(MAX_NEIGHBORHOOD_STATES, () => 0)).toHaveLength(4 ** 7);
        expect(() => ruleFromTable(MAX_NEIGHBORHOOD_STATES + 1, () => 0)).toThrow(/states must be/);
        expect(() => ruleFromTable(1, () => 0)).toThrow(/states must be/);
        expect(() => ruleFromTable(3, () => 3)).toThrow(/not a state below k = 3/);
    });

    it('round-trips packed block triples and builds k^3 block rules', () => {
        for (const k of [2, 4, MAX_BLOCK_STATES]) {
            for (const block of [[0, 0, 0], [1, 0, k - 1], [k - 1, k - 1, k - 1]]) {
                expect(unpackBlock(k, packBlock(k, block))).toEqual(block);
            }
        }
        const rule = blockRuleFromTable(4, rotation);
        expect(rule).toHaveLength(64);
        expect(unpackBlock(4, rule[packBlock(4, [1, 2, 3])])).toEqual([3, 1, 2]);
        expect(() => blockRuleFromTable(4, () => [0, 1])).toThrow(/3-entry block/);
        expect(() => blockRuleFromTable(4, () => [0, 1, 4])).toThrow(/not a state below k = 4/);
        expect(() => blockRuleFromTable(MAX_BLOCK_STATES + 1, rotation)).toThrow(/states must be/);
    });

    it('reports conservation and isotropy rather than enforcing them', () => {
        const rotate = blockRuleFromTable(4, rotation);
        expect(isConservative(4, rotate)).toBe(true);
        expect(isIsotropic(4, rotate)).toBe(true);

        // Sorting the triple permutes the multiset, so it conserves — but it pins an orientation on
        // the block, which is exactly how a rule stops being isotropic. That pairing is the reason
        // the two checks are separate: breaking isotropy deliberately is how you get gravity.
        const sorted = blockRuleFromTable(4, (block) => [...block].sort((a, b) => b - a));
        expect(isConservative(4, sorted)).toBe(true);
        expect(isIsotropic(4, sorted)).toBe(false);

        // Copying s0 over s1 duplicates mass wherever they differ.
        const duplicating = blockRuleFromTable(4, (block) => [block[0], block[0], block[2]]);
        expect(isConservative(4, duplicating)).toBe(false);

        // A numeric comparator matters past k=10: [1, 10, 9] must not read as sorted.
        const identity16 = blockRuleFromTable(16, (block) => block);
        expect(isConservative(16, identity16)).toBe(true);
        expect(isConservative(16, blockRuleFromTable(16, ([, s1, s2]) => [1, s1, s2]))).toBe(false);

        expect(() => isConservative(4, new Uint16Array(10))).toThrow(/k\^3/);
    });
});

describe('@hexlife/embed/ca runtime', () => {
    it('refuses a block grid whose rows would seam the partition, and names a way out', () => {
        // The embed's own default of 64 rows fails this, which is precisely why it throws instead
        // of rounding: the grid you asked for would not be the grid you got.
        expect(() => new HexCA({states: 4, rows: 64, columns: 64, backend: 'block'}))
            .toThrow(/63.*66|66.*63/s);
        expect(() => new HexCA({states: 4, rows: 66, columns: 65, backend: 'block'}))
            .toThrow(/even/);
        // The neighborhood backend has no row constraint.
        const fine = new HexCA({states: 4, rows: 64, columns: 64});
        expect(fine.ruleLength).toBe(4 ** 7);
        fine.dispose();

        const block = new HexCA({states: 8, rows: 66, columns: 64, backend: 'block'});
        expect(block.ruleLength).toBe(8 ** 3);
        expect(() => new HexCA({states: 8, rows: 66, columns: 64})).toThrow(/states must be/);
        block.dispose();
    });

    it('mirrors the buffer swap so the state view tracks the current generation', () => {
        // The neighborhood backend swaps inside wasm; a JS layer that forgot to mirror it would
        // read the buffer that is now "next" and silently report the wrong generation.
        const columns = 32;
        const rows = 32;
        const ca = new HexCA({
            states: 2,
            rows,
            columns,
            // Centre-inverting: every cell flips every tick regardless of neighbours, so a missed
            // swap shows up immediately as a state that never changes (or changes twice).
            rule: ruleFromTable(2, (centre) => 1 - centre),
        });
        expect(ca.state.every((c) => c === 0)).toBe(true);
        ca.tick();
        expect(ca.state.every((c) => c === 1)).toBe(true);
        expect(ca.lastChangedCount).toBe(rows * columns);
        ca.tick();
        expect(ca.state.every((c) => c === 0)).toBe(true);
        expect(ca.generation).toBe(2);
        ca.dispose();
        expect(() => ca.tick()).toThrow(/disposed/);
    });

    it('advances the block partition phase and rewrites in place', () => {
        const ca = new HexCA({
            states: 4,
            rows: 66,
            columns: 64,
            backend: 'block',
            rule: blockRuleFromTable(4, rotation),
        });
        expect(ca.phase).toBe(0);
        for (let tick = 1; tick <= 2 * BLOCK_PHASES; tick++) {
            ca.tick();
            expect(ca.phase).toBe(tick % BLOCK_PHASES);
        }
        expect(ca.generation).toBe(2 * BLOCK_PHASES);
        ca.dispose();
    });

    it('conserves the census exactly under a conservative block rule', () => {
        // The claim the block backend exists for, checked from outside the engine.
        const rows = 66;
        const columns = 64;
        const cells = new Uint8Array(rows * columns);
        for (let i = 0; i < cells.length; i++) cells[i] = (i * 7 + (i % 13)) % 4;

        const ca = new HexCA({
            states: 4,
            rows,
            columns,
            backend: 'block',
            rule: blockRuleFromTable(4, rotation),
            cells,
        });
        const want = ca.census();
        expect([...want].reduce((a, b) => a + b, 0)).toBe(rows * columns);

        for (let tick = 0; tick < 200; tick++) ca.tick();
        expect([...ca.census()]).toEqual([...want]);
        expect(ca.lastChangedCount).toBeGreaterThan(0);
        ca.dispose();
    });

    it('carries neighbour ORDER across the boundary, so an anisotropic rule has a direction', () => {
        // The dense backend's whole point is that position within the neighbourhood is part of the
        // rule. Build gravity out of it — material vacates when the cell directly below is open and
        // arrives when the cell directly above holds something — and check the blob actually falls.
        // A scrambled neighbour ordering would still "run", just sideways or not at all.
        const DOWN = 5;
        const UP = 2;
        const rows = 48;
        const columns = 32;
        const ca = new HexCA({
            states: 2,
            rows,
            columns,
            rule: ruleFromTable(2, (centre, neighbours) => (
                centre === 1 ? neighbours[DOWN] : neighbours[UP]
            )),
        });
        // One solid row near the top. Straight-down-only gravity is conservative even at radius 1
        // (one source, one destination, no competition), so this also isolates the ordering claim
        // from the arbitration problem the block backend solves.
        const startRow = 4;
        const cells = new Uint8Array(rows * columns);
        cells.fill(1, startRow * columns, (startRow + 1) * columns);
        ca.setCells(cells);

        const rowOf = () => ca.state.findIndex((c) => c === 1) / columns;
        expect(rowOf()).toBe(startRow);
        for (let tick = 1; tick <= 10; tick++) {
            ca.tick();
            expect(rowOf()).toBe(startRow + tick);
        }
        expect([...ca.census()][1]).toBe(columns);
        ca.dispose();
    });

    it('settles into doing no work, and wakes again when written to', () => {
        // The activity tracker is the k-state answer to `World`'s uniformity scan, and its one
        // hazard is staleness: a write that the tracker does not see would be skipped over.
        const rows = 66;
        const columns = 64;
        const ca = new HexCA({
            states: 3,
            rows,
            columns,
            // Centre-preserving, so the world is frozen from tick 0.
            rule: ruleFromTable(3, (centre) => centre),
        });
        ca.tick();
        expect(ca.isSettled).toBe(true);
        ca.tick();
        expect(ca.chunkActivity.active).toBe(0);
        expect(ca.chunkActivity.total).toBeGreaterThan(0);

        ca.setCell(33 * columns + 33, 2);
        expect(ca.isSettled).toBe(false);
        ca.tick();
        expect(ca.chunkActivity.active).toBeGreaterThan(0);

        // A poke straight through the live view bypasses the tracker — the documented repair is an
        // explicit wake, and it has to work.
        for (let tick = 0; tick < 4; tick++) ca.tick();
        expect(ca.isSettled).toBe(true);
        ca.state[10 * columns + 10] = 1;
        ca.markAllDirty();
        expect(ca.isSettled).toBe(false);
        ca.dispose();
    });

    it('produces identical generations with chunk skipping on and off', () => {
        // Skipping is an optimization, so it must be invisible. Anything else is a correctness bug
        // that only shows up on grids large enough to have quiet regions.
        // Wide enough to have chunk columns the blob and the torus wrap between them cannot reach —
        // on a grid only a few chunks across, every chunk is in every other chunk's halo and the
        // fast path can never fire.
        const rows = 66;
        const columns = 256;
        const cells = new Uint8Array(rows * columns);
        for (let row = 20; row < 40; row++) {
            for (let col = 8; col < 40; col++) cells[row * columns + col] = (row * col) % 4;
        }
        const rule = blockRuleFromTable(4, rotation);
        const make = () => new HexCA({states: 4, rows, columns, backend: 'block', rule, cells});

        const fast = make();
        const dense = make();
        dense.setSkippingEnabled(false);
        let sawSkipping = false;
        for (let tick = 0; tick < 40; tick++) {
            fast.tick();
            dense.tick();
            expect(fast.checksum()).toBe(dense.checksum());
            if (fast.chunkActivity.active < fast.chunkActivity.total) sawSkipping = true;
        }
        expect(sawSkipping).toBe(true);
        expect([...fast.snapshotCells()]).toEqual([...dense.snapshotCells()]);
        fast.dispose();
        dense.dispose();
    });

    it('keeps a binary sim and a k-state world alive in the same linear memory', () => {
        // THE multi-instance trap: constructing a world allocates, which can grow the shared wasm
        // memory and detach every typed-array view on the page — including `<hexlife-world>`'s.
        // A page with a k-state widget below a binary one must not silently break the binary one.
        const first = new HexCA({
            states: 2,
            rows: 32,
            columns: 32,
            rule: ruleFromTable(2, (centre) => 1 - centre),
        });
        first.tick();
        expect(first.state.every((c) => c === 1)).toBe(true);

        // Allocate several more worlds, each large enough to force real growth.
        const others = [];
        for (let i = 0; i < 4; i++) {
            others.push(new HexCA({states: 4, rows: 66, columns: 128, backend: 'block'}));
        }
        // `first`'s view must have been rebuilt rather than left detached.
        expect(first.state.byteLength).toBe(32 * 32);
        first.tick();
        expect(first.state.every((c) => c === 0)).toBe(true);

        for (const world of others) world.dispose();
        first.dispose();
    });
});
