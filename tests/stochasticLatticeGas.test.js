import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {neighborIndex} from '../public/embed-concept-models.js';
import {
    MIXING_STATES,
    mixingChamber,
    mixingGasRule,
    mixingMembraneSites,
} from '../public/embed-stochastic-rules.js';
import {
    BACKEND_LATTICE_GAS,
    compileGasRule,
    GAS_STATES,
    hexGasCollide,
    initStochasticEngine,
    isConservativeGasRule,
    StochasticWorld,
} from '../src/embed/stochastic.js';

/**
 * Conserved hexagonal lattice gas.
 *
 * Species conservation here is exact rather than statistical: it is checked entry by entry at rule
 * load and then again over long runs, because a gas that quietly leaks mass looks perfectly fine on
 * screen. The closed-chamber tests exist for the same reason — the canonical neighbor table is
 * toroidal, so "finite" is a property of the wall buffer and has to be proved, not assumed.
 */

const MIXING_PARAMS = {density: 24, scatter: 7};

beforeAll(async () => {
    const wasmPath = new URL('../src/core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initStochasticEngine();
});

function gasWorld({rows, columns, seed = 0x6A5C_0111, scatter = 0, channels = null, walls = null}) {
    return new StochasticWorld({
        rows,
        columns,
        seed,
        backend: BACKEND_LATTICE_GAS,
        rule: compileGasRule({scatter}),
        channels,
        walls,
    });
}

function unpack(config) {
    return Array.from({length: 6}, (_, direction) => (config >>> (2 * direction)) & 3);
}

/** Sum of unit velocity vectors over every occupied channel, in the canonical direction order. */
const DIRECTION_VECTORS = Array.from({length: 6}, (_, direction) => {
    const angle = (Math.PI / 3) * direction;
    return [Math.cos(angle), Math.sin(angle)];
});

function totalMomentum(world) {
    const channels = world.snapshotChannels();
    let x = 0;
    let y = 0;
    for (let index = 0; index < world.numCells; index++) {
        for (let direction = 0; direction < 6; direction++) {
            if (channels[index * 6 + direction] !== 0) {
                x += DIRECTION_VECTORS[direction][0];
                y += DIRECTION_VECTORS[direction][1];
            }
        }
    }
    return [x, y];
}

describe('lattice-gas collision table', () => {
    it('conserves both species for every one of the 4,096 compiled entries', () => {
        const rule = compileGasRule({scatter: 0.07});
        expect(rule).toHaveLength(12 + 4096 * 8);
        expect(isConservativeGasRule(rule)).toBe(true);

        let checked = 0;
        for (let config = 0; config < 4096; config++) {
            const channels = unpack(config);
            if (channels.includes(3)) continue;
            checked++;
            const outcome = hexGasCollide([...channels]);
            const outcomes = Array.isArray(outcome) ? [outcome] : [outcome.primary, outcome.alternate];
            for (const result of outcomes) {
                for (const species of [1, 2]) {
                    expect(result.filter((value) => value === species)).toHaveLength(
                        channels.filter((value) => value === species).length,
                    );
                }
            }
        }
        expect(checked).toBe(3 ** 6);
    });

    it('is sixfold rotation-equivariant', () => {
        const rotate = (channels, step) => Array.from(
            {length: 6},
            (_, direction) => channels[(direction - step + 12) % 6],
        );
        for (let config = 0; config < 4096; config++) {
            const channels = unpack(config);
            if (channels.includes(3)) continue;
            const base = hexGasCollide([...channels]);
            for (let step = 1; step < 6; step++) {
                const rotatedInput = hexGasCollide(rotate(channels, step));
                if (Array.isArray(base)) {
                    expect(rotatedInput).toEqual(rotate(base, step));
                } else {
                    expect(rotatedInput.primary).toEqual(rotate(base.primary, step));
                    expect(rotatedInput.alternate).toEqual(rotate(base.alternate, step));
                    expect(rotatedInput.probability).toBe(base.probability);
                }
            }
        }
    });

    it('refuses a table that creates or destroys a particle', () => {
        const leaky = compileGasRule({collide: (channels) => (channels[0] ? [0, 0, 0, 0, 0, 0] : channels)});
        expect(isConservativeGasRule(leaky)).toBe(false);
        expect(() => gasWorld({rows: 8, columns: 8}).setRule(leaky)).toThrow(/conserve both species/);
        expect(isConservativeGasRule(new Uint8Array(16))).toBe(false);
    });
});

describe('lattice-gas streaming, walls, and conservation', () => {
    it('reflects a particle back along the exact opposite channel at every wall', () => {
        const [rows, columns] = [8, 8];
        for (let direction = 0; direction < 6; direction++) {
            const channels = new Uint8Array(rows * columns * 6);
            const walls = new Uint8Array(rows * columns);
            const origin = 4 * columns + 4;
            const target = neighborIndex(origin, direction, rows, columns, true);
            walls[target] = 1;
            channels[origin * 6 + direction] = 1;
            const world = gasWorld({rows, columns, channels, walls});
            world.tick();
            const after = world.snapshotChannels();
            const opposite = (direction + 3) % 6;
            expect([...after.subarray(origin * 6, origin * 6 + 6)], `direction ${direction}`)
                .toEqual([0, 0, 0, 0, 0, 0].map((_, slot) => (slot === opposite ? 1 : 0)));
            expect(world.speciesCount(1)).toBe(1);
            world.dispose();
        }
    });

    it('streams onto the torus when nothing walls it in, and never across a closed rim', () => {
        const [rows, columns] = [12, 12];
        const open = new Uint8Array(rows * columns * 6);
        // Column 0, heading west along direction 3, must reappear at the far column.
        open[(6 * columns + 0) * 6 + 3] = 1;
        const torus = gasWorld({rows, columns, channels: open});
        torus.tick();
        expect(torus.snapshotChannels().findIndex((species) => species !== 0)).not.toBe(-1);
        expect(torus.speciesCount(1)).toBe(1);
        torus.dispose();

        const {channels, walls} = mixingChamber(rows, columns, MIXING_PARAMS);
        const closed = gasWorld({rows, columns, channels, walls, scatter: 0.07});
        const seamColumns = [0, columns - 1];
        const seamRows = [0, rows - 1];
        for (let tick = 0; tick < 200; tick++) {
            closed.tick();
            const live = closed.snapshotChannels();
            for (const row of seamRows) {
                for (let column = 0; column < columns; column++) {
                    const index = row * columns + column;
                    expect(live.subarray(index * 6, index * 6 + 6).some(Boolean)).toBe(false);
                }
            }
            for (const column of seamColumns) {
                for (let row = 0; row < rows; row++) {
                    const index = row * columns + column;
                    expect(live.subarray(index * 6, index * 6 + 6).some(Boolean)).toBe(false);
                }
            }
        }
        closed.dispose();
    });

    it('keeps both species exactly closed on their own side until the membrane opens', () => {
        const [rows, columns] = [60, 70];
        const {channels, walls} = mixingChamber(rows, columns, MIXING_PARAMS);
        const world = new StochasticWorld({
            rows,
            columns,
            seed: 0x6A5C_0111,
            backend: BACKEND_LATTICE_GAS,
            rule: mixingGasRule(MIXING_PARAMS),
            channels,
            walls,
        });
        const amber = world.speciesCount(1);
        const cyan = world.speciesCount(2);
        expect(amber).toBeGreaterThan(1000);
        expect(cyan).toBeGreaterThan(1000);

        const middle = Math.floor(columns / 2);
        const crossed = () => {
            const live = world.snapshotChannels();
            let wrongSide = 0;
            for (let index = 0; index < world.numCells; index++) {
                const column = index % columns;
                if (column === middle) continue;
                const expected = column < middle ? 1 : 2;
                for (let direction = 0; direction < 6; direction++) {
                    const species = live[index * 6 + direction];
                    if (species !== 0 && species !== expected) wrongSide++;
                }
            }
            return wrongSide;
        };

        for (let tick = 0; tick < 250; tick++) world.tick();
        expect(crossed()).toBe(0);
        expect(world.speciesCount(1)).toBe(amber);
        expect(world.speciesCount(2)).toBe(cyan);
        expect([...world.census()][GAS_STATES.mixed]).toBe(0);

        for (const site of mixingMembraneSites(rows, columns)) world.setWall(site, false);
        for (let tick = 0; tick < 400; tick++) world.tick();
        expect(crossed()).toBeGreaterThan(0);
        expect(world.speciesCount(1)).toBe(amber);
        expect(world.speciesCount(2)).toBe(cyan);
        expect([...world.census()][MIXING_STATES.mixed]).toBeGreaterThan(0);
        world.dispose();
    });

    it('conserves momentum exactly on an unforced torus and drifts nowhere with scattering on', () => {
        const [rows, columns] = [32, 32];
        const channels = new Uint8Array(rows * columns * 6);
        let value = 0x1234_5678;
        for (let slot = 0; slot < channels.length; slot++) {
            value = (Math.imul(value ^ (value >>> 15), 0x2545_F491) + 0x9E37_79B9) | 0;
            const sample = (value >>> 8) % 100;
            if (sample < 24) channels[slot] = (sample & 1) + 1;
        }
        const unforced = gasWorld({rows, columns, channels, scatter: 0});
        const [x0, y0] = totalMomentum(unforced);
        for (let tick = 0; tick < 300; tick++) unforced.tick();
        const [x1, y1] = totalMomentum(unforced);
        expect(x1).toBeCloseTo(x0, 6);
        expect(y1).toBeCloseTo(y0, 6);
        unforced.dispose();

        const thermal = gasWorld({rows, columns, channels, scatter: 0.3});
        const particles = thermal.speciesCount(1) + thermal.speciesCount(2);
        for (let tick = 0; tick < 600; tick++) thermal.tick();
        const [x2, y2] = totalMomentum(thermal);
        // ±60° at equal probability is chirality-free, so the drift stays inside the random walk's
        // own scale rather than growing with a preferred direction.
        expect(Math.hypot(x2, y2)).toBeLessThan(6 * Math.sqrt(particles));
        expect(thermal.speciesCount(1) + thermal.speciesCount(2)).toBe(particles);
        thermal.dispose();
    });

    it('conserves both species and allocates nothing across a long run', () => {
        const [rows, columns] = [40, 40];
        const {channels, walls} = mixingChamber(rows, columns, {density: 60, scatter: 12});
        const world = gasWorld({rows, columns, channels, walls, scatter: 0.12});
        const amber = world.speciesCount(1);
        const cyan = world.speciesCount(2);
        const memoryBefore = world.state.buffer.byteLength;
        for (let tick = 0; tick < 20_000; tick++) {
            world.tick();
            if (tick % 2_000 === 0) {
                expect(world.speciesCount(1)).toBe(amber);
                expect(world.speciesCount(2)).toBe(cyan);
            }
        }
        expect(world.speciesCount(1)).toBe(amber);
        expect(world.speciesCount(2)).toBe(cyan);
        expect(world.state.buffer.byteLength).toBe(memoryBefore);
        expect([...world.census()].reduce((sum, count) => sum + count, 0)).toBe(rows * columns);
        world.dispose();
    });

    it('resets to a byte-identical world and refuses neighborhood calls', () => {
        const [rows, columns] = [24, 24];
        const {channels, walls} = mixingChamber(rows, columns, MIXING_PARAMS);
        const world = gasWorld({rows, columns, channels, walls, scatter: 0.07});
        const start = {
            state: [...world.state],
            channels: [...world.snapshotChannels()],
            checksum: world.checksum(),
            auxiliary: world.auxiliaryChecksum(),
        };
        for (let tick = 0; tick < 120; tick++) world.tick();
        expect(world.checksum()).not.toBe(start.checksum);
        world.reset();
        expect(world.generation).toBe(0n);
        expect([...world.state]).toEqual(start.state);
        expect([...world.snapshotChannels()]).toEqual(start.channels);
        expect(world.auxiliaryChecksum()).toBe(start.auxiliary);

        expect(() => world.setCell(0, 1)).toThrow(/lattice-gas backend/);
        expect(() => world.setInitialState(new Uint8Array(rows * columns))).toThrow(/lattice-gas backend/);
        world.dispose();

        const neighborhood = new StochasticWorld({rows: 8, columns: 8, seed: 1});
        expect(() => neighborhood.setWall(0, true)).toThrow(/neighborhood backend/);
        expect(() => neighborhood.setInitialGasState(null, null)).toThrow(/neighborhood backend/);
        expect(() => neighborhood.setRule(compileGasRule({}))).toThrow(/HSN1/);
        neighborhood.dispose();
    });
});
