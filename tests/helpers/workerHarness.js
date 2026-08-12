import { vi } from 'vitest';

/**
 * Boots `WorldWorker.js` inside vitest with a fake `self` and a fake Wasm engine, so the worker's
 * real tick loop, command queue and message plumbing can be driven and observed.
 *
 * Written for #40 §8.1, which asks that "the worker posts zero SPACETIME_LAYER messages while the
 * mode is off" be a test rather than a claim. Grepping the source for an `if` proves the gate was
 * written; only running the loop proves it holds — including through `runTickBatch`, which runs many
 * ticks per STATE_UPDATE and is exactly where a layer stream goes wrong.
 *
 * The fake `World` is a faithful stand-in for the *shape* the worker depends on — buffers in a
 * single linear-memory `ArrayBuffer`, reachable by pointer, double-buffered with an internal swap —
 * not for the CA rules. Evolution correctness is pinned by the Rust tests and by the headless
 * tick-for-tick check; what this harness pins is the plumbing around it.
 */

const RULESET_BYTES = 128;
const USAGE_BYTES = 128 * 4;

/** A deterministic stand-in for the Rust `World`, laid out in one ArrayBuffer like the real one. */
class FakeWorld {
    constructor(cols, rows, memory) {
        this.numCells = cols * rows;
        this.memory = memory;
        // Offsets into the shared "linear memory". Usage counters are u32, so keep them aligned.
        let offset = 64;
        const take = (bytes) => { const at = offset; offset += bytes + ((4 - bytes % 4) % 4); return at; };
        this.statePtr = take(this.numCells);
        this.nextStatePtr = take(this.numCells);
        this.rulePtr = take(this.numCells);
        this.nextRulePtr = take(this.numCells);
        this.rulesetPtr = take(RULESET_BYTES);
        this.usagePtr = take(USAGE_BYTES);
        this.renderLayerPtr = take(this.numCells);
        this.renderLayerEnabled = false;
        this.tick = 0;
        this.probing = false;
    }

    _view(pointer) {
        return new Uint8Array(this.memory.buffer, pointer, this.numCells);
    }

    state_ptr() { return this.statePtr; }
    next_state_ptr() { return this.nextStatePtr; }
    rule_indices_ptr() { return this.rulePtr; }
    next_rule_indices_ptr() { return this.nextRulePtr; }
    ruleset_ptr() { return this.rulesetPtr; }
    rule_usage_counters_ptr() { return this.usagePtr; }
    render_layer_ptr() { return this.renderLayerPtr; }
    num_cells() { return this.numCells; }

    set_render_layer_enabled(enabled) { this.renderLayerEnabled = !!enabled; }

    pack_render_layer() {
        if (!this.renderLayerEnabled) return;
        const state = this._view(this.statePtr);
        const rules = this._view(this.rulePtr);
        const out = this._view(this.renderLayerPtr);
        for (let i = 0; i < this.numCells; i++) {
            out[i] = ((rules[i] & 0x7f) << 1) | (state[i] & 1);
        }
    }

    /**
     * A deterministic "evolution": shift the state one cell and stamp the tick into the rule
     * indices, then swap the buffers exactly as the real engine does. Enough for the worker's
     * checksum, active-count and buffer-swap bookkeeping to behave, and cheap enough to run
     * thousands of ticks in a unit test.
     */
    run_tick() {
        this.tick++;
        const state = this._view(this.statePtr);
        const next = this._view(this.nextStatePtr);
        const nextRules = this._view(this.nextRulePtr);
        let active = 0;
        for (let i = 0; i < this.numCells; i++) {
            const value = state[(i + 1) % this.numCells];
            next[i] = value;
            active += value;
            nextRules[i] = (i + this.tick) & 0x7f;
        }
        [this.statePtr, this.nextStatePtr] = [this.nextStatePtr, this.statePtr];
        [this.rulePtr, this.nextRulePtr] = [this.nextRulePtr, this.rulePtr];
        this.lastActive = active;
        return active;
    }

    active_count() { return this.lastActive ?? 0; }
    last_changed_count() { return 1; }
    checksum_state() {
        const state = this._view(this.statePtr);
        let h = 2166136261;
        for (let i = 0; i < this.numCells; i++) { h ^= state[i]; h = Math.imul(h, 16777619); }
        return h | 0;
    }
    block_entropy() { return 0.5; }
    block_entropy_stats() { return new Float64Array([0.5, 0.01]); }
    spatial_order() { return 0; }
    change_spatial_order() { return 0; }
    compute_active_centroid() {}
    centroid_col_angle() { return 0; }
    centroid_row_angle() { return 0; }
    centroid_col_concentration() { return 0; }
    centroid_row_concentration() { return 0; }
    start_probe() { this.probing = true; }
    stop_probe() { this.probing = false; }
    probe_hamming() { return 0; }
    restore_tick_observables() {}
}

/**
 * Import a fresh copy of the worker module with `self` and the Wasm engine faked out.
 * @returns {Promise<{posted: object[], send: Function, typeCounts: Function, reset: Function}>}
 */
export async function bootWorker({ cols = 16, rows = 12, initialIsEnabled = true } = {}) {
    const memory = { buffer: new ArrayBuffer(1 << 20) };
    let world = null;

    vi.doMock('../../src/core/wasm-engine/hexlife_wasm.js', () => ({
        // `init()` resolves to the Wasm module namespace, whose `memory` the worker views over.
        default: async () => ({ memory }),
        World: class {
            constructor(c, r) {
                world = new FakeWorld(c, r, memory);
                return world;
            }
        },
    }));

    const posted = [];
    const listeners = {};
    globalThis.self = {
        postMessage: (message, transfers) => posted.push({ message, transfers }),
        set onmessage(fn) { listeners.onmessage = fn; },
        get onmessage() { return listeners.onmessage; },
    };

    vi.resetModules();
    await import('../../src/core/WorldWorker.js');

    const send = async (type, data) => {
        await listeners.onmessage({ data: { type, data } });
    };

    await send('INIT', {
        worldIndex: 0,
        config: { GRID_COLS: cols, GRID_ROWS: rows, NUM_CELLS: cols * rows },
        initialSpeed: 30,
        initialRulesetBuffer: new Uint8Array(RULESET_BYTES).fill(1).buffer,
        initialIsEnabled,
        initialEntropySamplingEnabled: false,
        initialEntropySampleRate: 10,
        initialState: { mode: 'density', params: { density: 0.35 } },
        seed: 12345,
    });

    return {
        posted,
        send,
        get world() { return world; },
        typeCounts() {
            const counts = {};
            for (const { message } of posted) {
                counts[message.type] = (counts[message.type] || 0) + 1;
            }
            return counts;
        },
        messagesOfType(type) {
            return posted.filter(({ message }) => message.type === type).map(({ message }) => message);
        },
        reset() { posted.length = 0; },
    };
}
