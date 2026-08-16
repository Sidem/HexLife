import {describe, expect, it, vi} from 'vitest';
import {createDensityState, packCells, unpackCells} from '../src/embed/sim.js';
import {EmbedSim} from '../src/embed/EmbedSim.js';

describe('@hexlife/embed/sim', () => {
    it('applies explicit cells and multi-tick stepping on the shared runtime methods', () => {
        const fake = {
            state: Uint8Array.of(1, 0, 0),
            nextState: new Uint8Array(3),
            ruleIndices: new Uint8Array(3),
            nextRuleIndices: new Uint8Array(3),
            activeCount: 1,
            numCells: 3,
            tickCount: 0,
            world: {run_tick: () => 2},
        };
        expect(EmbedSim.prototype.setCells.call(fake, [{index: 1, value: 1}, {index: 0, value: 0}])).toBe(2);
        expect([...fake.state]).toEqual([0, 1, 0]);
        EmbedSim.prototype.tick.call(fake, 2);
        expect(fake.tickCount).toBe(2);
        expect(fake.activeCount).toBe(2);
    });

    it('round-trips strict LSB-first packed cells', () => {
        const cells = Uint8Array.of(1, 0, 1, 1, 0, 0, 0, 1, 1);
        const packed = packCells(cells);
        expect([...packed]).toEqual([0b10001101, 0b00000001]);
        expect(unpackCells(packed, cells.length)).toEqual(cells);
        expect(() => unpackCells(Uint8Array.of(0, 0b10000000), 9)).toThrow(/padding/);
    });

    it('batches ticks into one native call and mirrors buffer parity once', () => {
        const state = Uint8Array.of(0);
        const nextState = Uint8Array.of(1);
        const ruleIndices = Uint8Array.of(2);
        const nextRuleIndices = Uint8Array.of(3);
        const runTicks = vi.fn(() => 1);
        const fake = {
            state,
            nextState,
            ruleIndices,
            nextRuleIndices,
            activeCount: 0,
            tickCount: 0,
            world: {run_ticks: runTicks, last_changed_count: () => 0},
        };
        EmbedSim.prototype.tick.call(fake, 4);
        expect(runTicks).toHaveBeenCalledOnce();
        expect(runTicks).toHaveBeenCalledWith(4);
        expect(fake.state).toBe(state);
        expect(fake.tickCount).toBe(4);
        expect(fake.isSettled).toBe(true);

        EmbedSim.prototype.tick.call(fake, 3);
        expect(fake.state).toBe(nextState);
        expect(fake.ruleIndices).toBe(nextRuleIndices);
        expect(fake.tickCount).toBe(7);
    });

    it('creates canonical deterministic density states without Wasm', () => {
        expect([...createDensityState({rows: 2, columns: 4, seed: 42, density: 0.5})])
            .toEqual([0, 1, 0, 0, 1, 0, 1, 0]);
        expect([...createDensityState({rows: 2, columns: 4, seed: 0, density: 0.5})])
            .toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
        expect([...createDensityState({rows: 2, columns: 4, seed: 42, density: 0})])
            .toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
        expect([...createDensityState({rows: 2, columns: 4, seed: 42, density: 1})])
            .toEqual([1, 1, 1, 1, 1, 1, 0, 1]);
    });

    it('validates density-state dimensions, seed, and density', () => {
        expect(() => createDensityState({rows: 0, columns: 4, seed: 1})).toThrow(/rows and columns/);
        expect(() => createDensityState({rows: 2, columns: 4, seed: 1.5})).toThrow(/seed/);
        expect(() => createDensityState({rows: 2, columns: 4, seed: 1, density: 2})).toThrow(/density/);
    });

    it('rejects non-binary cells and out-of-range edits', () => {
        expect(() => packCells(Uint8Array.of(0, 2))).toThrow(/0 or 1/);
        const fake = {state: new Uint8Array(2), ruleIndices: new Uint8Array(2), activeCount: 0, numCells: 2};
        expect(() => EmbedSim.prototype.setCells.call(fake, [{index: 2, value: 1}])).toThrow(/outside/);
    });
});
