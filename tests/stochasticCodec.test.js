import {readFile} from 'node:fs/promises';
import {beforeAll, describe, expect, it} from 'vitest';
import {
    mixingChamber,
    mixingGasRule,
    wildfireStochasticRule,
} from '../public/embed-stochastic-rules.js';
import {
    BACKEND_LATTICE_GAS,
    createStochasticWorldFromCode,
    decodeStochasticCode,
    encodeStochasticCode,
    initStochasticEngine,
    isStochasticCode,
    isValidStochasticGeometry,
    MAX_STOCHASTIC_STATES,
    StochasticWorld,
    STOCHASTIC_BACKEND_LATTICE_GAS,
    STOCHASTIC_BACKEND_NEIGHBORHOOD,
} from '../src/embed/stochastic.js';

/**
 * `HXS1` must resume an identical **next tick**, not merely an identical frame. Every case here
 * therefore compares the trajectories after resuming, not the restored state alone: a code that
 * dropped the generation or the ages would still redraw correctly and then diverge immediately.
 */

const WILDFIRE_PARAMS = {
    forest: 78,
    spread: 18,
    wind: 'east',
    windBoost: 2,
    burnTicks: 2,
    ashTicks: 20,
    regrowth: 5,
};

beforeAll(async () => {
    const wasmPath = new URL('../src/core/stochastic-wasm/hexlife_stochastic_wasm_bg.wasm', import.meta.url);
    const bytes = await readFile(wasmPath);
    globalThis.fetch = async () => ({
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    await initStochasticEngine();
});

function scatter(seed, index) {
    let value = (seed ^ Math.imul(index + 1, 0x85EB_CA6B)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7FEB_352D);
    return (value ^ (value >>> 15)) >>> 0;
}

function wildfireWorld(rows, columns) {
    const cells = new Uint8Array(rows * columns);
    for (let row = 1; row < rows - 1; row++) {
        for (let column = 1; column < columns - 1; column++) {
            const index = row * columns + column;
            if (scatter(0x3F17, index) % 100 < WILDFIRE_PARAMS.forest) cells[index] = 1;
        }
    }
    for (let row = 2; row < rows - 2; row++) if (row % 3 !== 0) cells[row * columns + 3] = 2;
    return new StochasticWorld({
        rows,
        columns,
        seed: 0xF1AE_2026n,
        rule: wildfireStochasticRule(WILDFIRE_PARAMS),
        cells,
    });
}

describe('HXS1 world codes', () => {
    it('recognizes its own prefix and refuses every other paste without throwing', async () => {
        expect(isStochasticCode('HXS1.abc')).toBe(true);
        expect(isStochasticCode('HXS1.')).toBe(false);
        expect(isStochasticCode('HXK1.abc')).toBe(false);
        expect(isStochasticCode(42)).toBe(false);
        for (const bad of ['HXS1.@@@@', 'HXS1.AAAA', `HXS1.${'A'.repeat(400)}`]) {
            await expect(decodeStochasticCode(bad)).resolves.toBeNull();
        }
        expect(await decodeStochasticCode('not a code')).toBeNull();
    });

    it('validates geometry independently of the engine', () => {
        expect(isValidStochasticGeometry(60, 70, 4, STOCHASTIC_BACKEND_NEIGHBORHOOD)).toBe(true);
        expect(isValidStochasticGeometry(60, 71, 4, STOCHASTIC_BACKEND_NEIGHBORHOOD)).toBe(false);
        expect(isValidStochasticGeometry(60, 70, 1, STOCHASTIC_BACKEND_NEIGHBORHOOD)).toBe(false);
        expect(isValidStochasticGeometry(60, 70, MAX_STOCHASTIC_STATES + 1, STOCHASTIC_BACKEND_NEIGHBORHOOD))
            .toBe(false);
        expect(isValidStochasticGeometry(60, 70, 5, STOCHASTIC_BACKEND_LATTICE_GAS)).toBe(true);
        expect(isValidStochasticGeometry(60, 70, 4, STOCHASTIC_BACKEND_LATTICE_GAS)).toBe(false);
    });

    it('resumes a mid-run neighborhood world to an identical next tick', async () => {
        const [rows, columns] = [40, 44];
        const source = wildfireWorld(rows, columns);
        for (let tick = 0; tick < 37; tick++) source.tick();

        const code = await source.code({speed: 12});
        expect(isStochasticCode(code)).toBe(true);
        const decoded = await decodeStochasticCode(code);
        expect(decoded.backend).toBe(STOCHASTIC_BACKEND_NEIGHBORHOOD);
        expect(decoded.speed).toBe(12);
        expect(decoded.generation).toBe(37n);
        expect(decoded.seed).toBe(0xF1AE_2026n);

        const resumed = (await createStochasticWorldFromCode(code)).world;
        expect(resumed.generation).toBe(37n);
        expect([...resumed.state]).toEqual([...source.state]);
        expect([...resumed.snapshotElapsedAges()]).toEqual([...source.snapshotElapsedAges()]);
        expect(resumed.checksum()).toBe(source.checksum());
        expect(resumed.auxiliaryChecksum()).toBe(source.auxiliaryChecksum());

        // The load-bearing part: the *next* tick, and the forty after it.
        for (let tick = 0; tick < 40; tick++) {
            source.tick();
            resumed.tick();
            expect(resumed.checksum(), `tick ${tick}`).toBe(source.checksum());
            expect(resumed.auxiliaryChecksum(), `tick ${tick}`).toBe(source.auxiliaryChecksum());
            expect([...resumed.state], `tick ${tick}`).toEqual([...source.state]);
        }

        // A code is the exact world it was taken from, so resetting returns to that world.
        resumed.reset();
        expect(resumed.generation).toBe(37n);
        source.dispose();
        resumed.dispose();
    });

    it('resumes a lattice-gas world with its channels, walls, and open membrane intact', async () => {
        const [rows, columns] = [30, 36];
        const params = {density: 24, scatter: 7};
        const {channels, walls} = mixingChamber(rows, columns, params);
        const source = new StochasticWorld({
            rows,
            columns,
            seed: 0x6A5C_0111n,
            backend: BACKEND_LATTICE_GAS,
            rule: mixingGasRule(params),
            channels,
            walls,
        });
        const middle = Math.floor(columns / 2);
        for (let row = 10; row < 20; row++) source.setWall(row * columns + middle, false);
        for (let tick = 0; tick < 55; tick++) source.tick();

        const palette = Uint8Array.from([11, 17, 24, 240, 173, 95, 87, 199, 255, 210, 167, 255, 96, 106, 120]);
        const code = await source.code({palette, speed: 26});
        const decoded = await decodeStochasticCode(code);
        expect(decoded.backend).toBe(STOCHASTIC_BACKEND_LATTICE_GAS);
        expect([...decoded.palette]).toEqual([...palette]);

        const resumed = (await createStochasticWorldFromCode(code)).world;
        expect(resumed.generation).toBe(55n);
        expect([...resumed.snapshotChannels()]).toEqual([...source.snapshotChannels()]);
        expect([...resumed.snapshotWalls()]).toEqual([...source.snapshotWalls()]);
        expect(resumed.speciesCount(1)).toBe(source.speciesCount(1));
        expect(resumed.speciesCount(2)).toBe(source.speciesCount(2));

        for (let tick = 0; tick < 40; tick++) {
            source.tick();
            resumed.tick();
            expect(resumed.checksum(), `tick ${tick}`).toBe(source.checksum());
            expect(resumed.auxiliaryChecksum(), `tick ${tick}`).toBe(source.auxiliaryChecksum());
        }
        source.dispose();
        resumed.dispose();
    });

    it('refuses a payload whose declared regions do not add up', async () => {
        const source = wildfireWorld(12, 14);
        const code = await source.code();
        source.dispose();

        // Truncating the base64url payload must be a "no", never a half-read world.
        expect(await decodeStochasticCode(code.slice(0, code.length - 12))).toBeNull();

        await expect(encodeStochasticCode({
            backend: STOCHASTIC_BACKEND_NEIGHBORHOOD,
            rows: 12,
            columns: 14,
            states: 4,
            seed: 1,
            generation: 0,
            rule: new Uint8Array(8),
            cells: new Uint8Array(12 * 14 - 1),
        })).rejects.toThrow(/cells/);
        await expect(encodeStochasticCode({
            backend: STOCHASTIC_BACKEND_NEIGHBORHOOD,
            rows: 12,
            columns: 13,
            states: 4,
            seed: 1,
            generation: 0,
            rule: new Uint8Array(8),
            cells: new Uint8Array(12 * 13),
        })).rejects.toThrow(/geometry/);
    });
});
