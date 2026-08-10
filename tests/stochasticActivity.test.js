import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
    outbreakStochasticRule,
    wildfireStochasticRule,
} from '../public/embed-stochastic-rules.js';
import {
    compileStochasticRule,
    initStochasticEngine,
    RNG_PHILOX_V1,
    StochasticWorld,
} from '../src/embed/stochastic.js';

/**
 * Exact temporal activity skipping, through real Wasm.
 *
 * Every case here runs two worlds from an identical start — one skipping, one forced onto the dense
 * reference path — and compares *everything observable* after every single tick. Comparing final
 * frames would hide a stream that silently shifted by one generation, which is the failure mode the
 * plan calls out as the reason deterministic dirty-chunk logic is unsound for a stochastic engine.
 */

const WILDFIRE_PARAMS = {
    forest: 78,
    spread: 18,
    wind: 'none',
    windBoost: 2,
    burnTicks: 2,
    ashTicks: 20,
    regrowth: 5,
};

const OUTBREAK_PARAMS = {
    infection: 12,
    infectiousTicks: 6,
    immunityTicks: 36,
    coverage: 20,
    efficacy: 85,
};

beforeAll(async () => {
    const wasmPath = new URL('../src/core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initStochasticEngine();
});

/** Deterministic scatter that does not borrow the engine's own counter RNG. */
function scatter(seed, index) {
    let value = (seed ^ Math.imul(index + 1, 0x85EB_CA6B)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7FEB_352D);
    return (value ^ (value >>> 15)) >>> 0;
}

function pair({rows, columns, seed, rule, cells, elapsedAges = null}) {
    const options = {rows, columns, seed, rule, cells, elapsedAges};
    const skipped = new StochasticWorld(options);
    const dense = new StochasticWorld(options);
    dense.setSkippingEnabled(false);
    return {skipped, dense};
}

function observe(world) {
    return {
        generation: world.generation,
        changed: world.lastChangedCount,
        state: [...world.state],
        ages: [...world.snapshotElapsedAges()],
        census: [...world.census()],
        counts: [...world.transitionCounts()],
        checksum: world.checksum(),
        auxiliary: world.auxiliaryChecksum(),
    };
}

function stepAndCompare({skipped, dense}, ticks, label) {
    for (let tick = 0; tick < ticks; tick++) {
        skipped.tick();
        dense.tick();
        expect(observe(skipped), `${label} tick ${tick + 1}`).toEqual(observe(dense));
    }
}

function wildfireStart(rows, columns) {
    const cells = new Uint8Array(rows * columns);
    for (let row = 1; row < rows - 1; row++) {
        for (let column = 1; column < columns - 1; column++) {
            const index = row * columns + column;
            if (scatter(0x3F17, index) % 100 < WILDFIRE_PARAMS.forest) cells[index] = 1;
        }
    }
    for (let row = 2; row < rows - 2; row++) if (row % 3 !== 0) cells[row * columns + 3] = 2;
    return cells;
}

function outbreakStart(rows, columns, {vaccinate}) {
    const cells = new Uint8Array(rows * columns);
    if (vaccinate) {
        for (let index = 0; index < cells.length; index++) {
            if (scatter(0x2211, index) % 100 < OUTBREAK_PARAMS.coverage) cells[index] = 3;
        }
    }
    for (const [rowRatio, columnRatio] of [[0.32, 0.35], [0.57, 0.62], [0.72, 0.24]]) {
        cells[Math.floor(rows * rowRatio) * columns + Math.floor(columns * columnRatio)] = 1;
    }
    return cells;
}

describe('exact stochastic activity skipping', () => {
    it('reproduces the dense wildfire trajectory tick by tick', () => {
        const worlds = pair({
            rows: 60,
            columns: 70,
            seed: 0xF1AE_2026,
            rule: wildfireStochasticRule(WILDFIRE_PARAMS),
            cells: wildfireStart(60, 70),
        });
        stepAndCompare(worlds, 120, 'wildfire');
        expect(worlds.skipped.generation).toBe(120n);
        worlds.skipped.dispose();
        worlds.dense.dispose();
    });

    for (const vaccinate of [false, true]) {
        it(`reproduces the dense ${vaccinate ? 'intervention' : 'baseline'} outbreak trajectory tick by tick`, () => {
            const worlds = pair({
                rows: 54,
                columns: 64,
                seed: 0x0B7B_EA4,
                rule: outbreakStochasticRule(OUTBREAK_PARAMS),
                cells: outbreakStart(54, 64, {vaccinate}),
            });
            stepAndCompare(worlds, 90, 'outbreak');
            worlds.skipped.dispose();
            worlds.dense.dispose();
        });
    }

    it('stays identical across single-cell writes, bulk interventions, and skip toggling', () => {
        const [rows, columns] = [54, 64];
        const worlds = pair({
            rows,
            columns,
            seed: 0x0B7B_EA4,
            rule: outbreakStochasticRule(OUTBREAK_PARAMS),
            cells: outbreakStart(rows, columns, {vaccinate: true}),
        });
        stepAndCompare(worlds, 20, 'before intervention');

        for (const world of [worlds.skipped, worlds.dense]) world.setCell(31 * columns + 31, 1);
        stepAndCompare(worlds, 15, 'after setCell');

        const ring = worlds.dense.snapshotCells();
        const ages = worlds.dense.snapshotElapsedAges();
        for (let index = 0; index < ring.length; index++) {
            if (ring[index] === 0 && scatter(0x77AA, index) % 100 < 30) ring[index] = 3;
        }
        for (const world of [worlds.skipped, worlds.dense]) world.setCells(ring, ages);
        stepAndCompare(worlds, 45, 'after setCells');

        worlds.skipped.setSkippingEnabled(false);
        expect(worlds.skipped.skippingEnabled).toBe(false);
        stepAndCompare(worlds, 5, 'skipping off');
        worlds.skipped.setSkippingEnabled(true);
        stepAndCompare(worlds, 25, 'skipping back on');

        for (const world of [worlds.skipped, worlds.dense]) world.reset();
        stepAndCompare(worlds, 10, 'after reset');
        worlds.skipped.dispose();
        worlds.dense.dispose();
    });

    it('sleeps a settled hazard-free world completely and wakes a deadline on its exact tick', () => {
        const settled = new StochasticWorld({
            rows: 60,
            columns: 70,
            seed: 7,
            rule: wildfireStochasticRule({...WILDFIRE_PARAMS, spread: 100, regrowth: 0}),
            cells: wildfireStart(60, 70),
        });
        for (let tick = 0; tick < 200; tick++) settled.tick();
        expect(settled.activeChunkCount()).toBe(0);
        expect(settled.chunkCount()).toBeGreaterThan(1);
        settled.dispose();

        const timer = new StochasticWorld({
            rows: 32,
            columns: 32,
            seed: 1,
            rule: compileStochasticRule({
                states: 2,
                rng: RNG_PHILOX_V1,
                transitions: [{from: 0, to: 1, minAge: 9, probability: 1}],
            }),
            cells: new Uint8Array(1024),
        });
        expect(timer.tick()).toBe(0);
        expect(timer.activeChunkCount()).toBe(timer.chunkCount());
        for (let tick = 2; tick < 9; tick++) {
            expect(timer.tick(), `tick ${tick}`).toBe(0);
            expect(timer.activeChunkCount(), `tick ${tick}`).toBe(0);
        }
        expect(timer.tick()).toBe(1024);
        expect(timer.generation).toBe(9n);
        timer.dispose();
    });

    it('keeps a p=0 row dormant and a p=1 self-loop permanently awake', () => {
        const never = new StochasticWorld({
            rows: 32,
            columns: 32,
            seed: 1,
            rule: compileStochasticRule({
                states: 2,
                rng: RNG_PHILOX_V1,
                transitions: [{from: 0, to: 1, probability: 0}],
            }),
            cells: new Uint8Array(1024),
        });
        for (let tick = 0; tick < 10; tick++) expect(never.tick()).toBe(0);
        expect(never.activeChunkCount()).toBe(0);
        never.dispose();

        // `to === from` changes no visible state, so a pure change-propagation gate would sleep it.
        const selfLoop = new StochasticWorld({
            rows: 32,
            columns: 32,
            seed: 1,
            rule: compileStochasticRule({
                states: 2,
                rng: RNG_PHILOX_V1,
                transitions: [{from: 0, to: 0, probability: 1}],
            }),
            cells: new Uint8Array(1024),
        });
        for (let tick = 0; tick < 10; tick++) expect(selfLoop.tick()).toBe(0);
        expect(selfLoop.activeChunkCount()).toBe(selfLoop.chunkCount());
        expect(selfLoop.transitionCounts()[0]).toBe(10 * 1024);
        selfLoop.dispose();
    });

    it('leaves most of a large grid asleep around a sparse front', () => {
        const [rows, columns] = [256, 256];
        const cells = new Uint8Array(rows * columns).fill(1);
        cells[128 * columns + 128] = 2;
        const world = new StochasticWorld({
            rows,
            columns,
            seed: 0xBEEF,
            rule: wildfireStochasticRule({
                ...WILDFIRE_PARAMS,
                spread: 25,
                burnTicks: 3,
                ashTicks: 65535,
                regrowth: 0,
            }),
            cells,
        });
        for (let tick = 0; tick < 30; tick++) world.tick();
        expect(world.activeChunkCount() * 2).toBeLessThan(world.chunkCount());
        world.dispose();
    });

    it('never grows the isolated Wasm memory across a long run', async () => {
        const world = new StochasticWorld({
            rows: 60,
            columns: 70,
            seed: 0xF1AE_2026,
            rule: wildfireStochasticRule(WILDFIRE_PARAMS),
            cells: wildfireStart(60, 70),
        });
        const before = world.state.buffer.byteLength;
        for (let tick = 0; tick < 20_000; tick++) world.tick();
        expect(world.state.buffer.byteLength).toBe(before);
        expect(world.state).toHaveLength(60 * 70);
        world.dispose();
    });

    it('rebases epochs without moving any observable age', () => {
        const world = new StochasticWorld({
            rows: 32,
            columns: 32,
            seed: 5,
            rule: compileStochasticRule({
                states: 2,
                rng: RNG_PHILOX_V1,
                transitions: [{from: 0, to: 1, minAge: 40_000, probability: 1}],
            }),
            cells: new Uint8Array(1024),
            elapsedAges: new Uint16Array(1024).fill(65_535),
        });
        const before = world.auxiliaryChecksum();
        expect(world.snapshotElapsedAges()[0]).toBe(65_535);
        world.rebaseEpochs();
        expect(world.snapshotElapsedAges()[0]).toBe(65_535);
        expect(world.auxiliaryChecksum()).toBe(before);
        world.dispose();
    });
});
