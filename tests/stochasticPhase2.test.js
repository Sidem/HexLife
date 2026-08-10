import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {createOutbreakModel, createWildfireModel} from '../public/embed-concept-models.js';
import {
    compileStochasticRule,
    independentNeighborChance,
    initStochasticEngine,
    RNG_LEGACY_DEMO_V0,
    RNG_PHILOX_V1,
    StochasticWorld,
} from '../src/embed/stochastic.js';
import oracles from './fixtures/stochastic/js-oracles.json';

beforeAll(async () => {
    const wasmPath = new URL('../src/core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initStochasticEngine();
});

function wildfireRule(params) {
    const windy = {east: [0, 1], west: [3, 4], north: [5], south: [2]}[params.wind] || [];
    const directionChance = Array.from({length: 6}, (_, direction) => {
        const boost = windy.includes(direction) ? Number(params.windBoost) : 1;
        return Math.min(0.95, params.spread / 100 * boost);
    });
    return compileStochasticRule({
        states: 4,
        rng: RNG_LEGACY_DEMO_V0,
        transitions: [
            {
                from: 1,
                neighborState: 2,
                probabilityByMask: independentNeighborChance(directionChance),
                to: 2,
                stream: 101,
            },
            {from: 2, minAge: params.burnTicks, probability: 1, to: 3},
            {from: 3, minAge: params.ashTicks, probability: params.regrowth / 100, to: 1, stream: 103},
        ],
    });
}

function outbreakRule(params) {
    return compileStochasticRule({
        states: 4,
        rng: RNG_LEGACY_DEMO_V0,
        transitions: [
            {
                from: 0,
                neighborState: 1,
                probabilityByMask: independentNeighborChance(params.infection / 100),
                to: 1,
                stream: 307,
            },
            {from: 1, minAge: params.infectiousTicks, probability: 1, to: 2},
            {from: 2, minAge: params.immunityTicks, probability: 1, to: 0},
            {
                from: 3,
                neighborState: 1,
                probabilityByMask: independentNeighborChance(
                    params.infection / 100 * (1 - params.efficacy / 100),
                ),
                to: 1,
                stream: 307,
            },
        ],
    });
}

function census(cells, states = 4) {
    const counts = new Array(states).fill(0);
    for (const state of cells) counts[state]++;
    return counts;
}

function oracleAt(id, generation) {
    return oracles.fixtures.find((fixture) => fixture.id === id).generations
        .find((entry) => entry.generation === generation);
}

function expectWorldMatchesModel(world, model, oracleId = null) {
    expect([...world.state]).toEqual([...model.cells]);
    expect([...world.snapshotElapsedAges()]).toEqual([...model.age]);
    expect([...world.census()]).toEqual(census(model.cells));
    if (oracleId && oracles.selectedGenerations.includes(model.generation)) {
        const oracle = oracleAt(oracleId, model.generation);
        expect(world.checksum()).toBe(oracle.visibleChecksum);
        expect(world.auxiliaryChecksum()).toBe(oracle.auxiliaryChecksum);
        expect([...world.census()].slice(0, oracle.census.length)).toEqual(oracle.census);
    }
}

describe('stochastic neighborhood rule compiler', () => {
    it('materializes monotonic independent-exposure masks in canonical direction order', () => {
        const probabilities = independentNeighborChance(0.12);
        expect(probabilities[0]).toBe(0);
        expect(probabilities[1]).toBeCloseTo(0.12, 15);
        expect(probabilities[0b11]).toBeCloseTo(1 - 0.88 ** 2, 15);
        expect(probabilities[0b111111]).toBeGreaterThan(probabilities[0b111]);

        const directional = independentNeighborChance([0.1, 0.2, 0, 0, 0, 0]);
        expect(directional[1]).toBeCloseTo(0.1, 15);
        expect(directional[2]).toBeCloseTo(0.2, 15);
    });

    it('canonicalizes row order and refuses ambiguous or invalid rules', () => {
        const rows = [
            {from: 2, to: 0, minAge: 10},
            {from: 0, to: 1, probability: 0.2, stream: 'infection'},
        ];
        const forward = compileStochasticRule({states: 3, transitions: rows, rng: RNG_PHILOX_V1});
        const reverse = compileStochasticRule({states: 3, transitions: rows.toReversed(), rng: RNG_PHILOX_V1});
        expect(forward).toEqual(reverse);
        expect(() => compileStochasticRule({
            states: 3,
            transitions: [{from: 0, to: 1}, {from: 0, to: 2}],
        })).toThrow(/ambiguous priority/);
        expect(() => compileStochasticRule({
            states: 3,
            transitions: [{from: 0, to: 1, probability: Number.NaN}],
        })).toThrow(/probability/);
        expect(() => compileStochasticRule({
            states: 3,
            transitions: [{from: 0, to: 1, probability: 0.2}],
        })).toThrow(/stable stream/);
    });
});

describe('WorldStochastic dense differential parity', () => {
    it('matches every Wildfire cell and age through generation 80', () => {
        const params = {
            forest: 78,
            spread: 18,
            wind: 'none',
            windBoost: 2,
            burnTicks: 2,
            ashTicks: 20,
            regrowth: 5,
        };
        const model = createWildfireModel(60, 70);
        model.reset(params);
        const world = new StochasticWorld({
            rows: 60,
            columns: 70,
            seed: 0xF1AE_2026,
            rule: wildfireRule(params),
            cells: model.cells,
            elapsedAges: model.age,
        });
        expectWorldMatchesModel(world, model, 'wildfire-command');
        for (let generation = 0; generation < 80; generation++) {
            model.step();
            world.tick();
            expectWorldMatchesModel(world, model, 'wildfire-command');
        }
        world.dispose();
    });

    for (const intervention of [false, true]) {
        it(`matches every ${intervention ? 'intervention' : 'baseline'} Outbreak cell, age, and infection count`, () => {
            const params = {
                infection: 12,
                infectiousTicks: 6,
                immunityTicks: 36,
                coverage: 20,
                efficacy: 85,
            };
            const model = createOutbreakModel(54, 64, {intervention});
            model.reset(params);
            const world = new StochasticWorld({
                rows: 54,
                columns: 64,
                seed: 0x0B7B_EA4,
                rule: outbreakRule(params),
                cells: model.cells,
                elapsedAges: model.age,
            });
            const oracleId = intervention ? 'outbreak-intervention' : 'outbreak-baseline';
            expectWorldMatchesModel(world, model, oracleId);
            for (let generation = 0; generation < 80; generation++) {
                if (intervention && generation === 20) {
                    model.vaccinateRing();
                    world.setCells(model.cells, model.age);
                }
                model.step();
                world.tick();
                expectWorldMatchesModel(world, model, oracleId);
                const counts = world.transitionCounts();
                expect((counts[0] ?? 0) + (counts[3] ?? 0)).toBe(model.totalInfections);
            }
            world.dispose();
        });
    }
});
