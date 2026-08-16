// NB: deliberately NOT `// @ts-check`, matching `EmbedSim.js` — the wasm binding's typed-array
// views and the `?url` import would need casts and a declaration for no real safety. `ca.d.ts` is
// the checked surface hosts actually compile against.

/**
 * `@hexlife/embed/ca` — the **k-state** cellular automaton runtime.
 *
 * This is a second engine, not a generalization of the first. `<hexlife-world>`, `EmbedSim`,
 * `HXW1` world codes, share links and Explorer are binary and stay binary: their determinism
 * contract (seed 12345 => checksum 231200078 at tick 100) is load-bearing, and putting `k` into
 * that tick loop would put every future k-state edit on their code path. So `HexCA` drives a
 * separate `WorldK` struct that shares the neighbour table and nothing else. See
 * `docs/KSTATE-PLAN.md`, and `hexlife-wasm/src/worldk.rs` for the engine itself.
 *
 * ## Which backend
 *
 * `'neighborhood'` is the direct generalization of HexLife's rule space — anisotropic, radius 1,
 * a dense `k⁷` lookup indexed by the centre and all six neighbours. It is capped at
 * {@link MAX_NEIGHBORHOOD_STATES} because that table is 16 KB at k=4, 273 KB at k=6 and 268 MB at k=16.
 *
 * `'block'` rewrites a whole 3-cell triangle at once from a `k³` table. Use it when the model has
 * to conserve something, because **a radius-1 synchronous CA cannot conserve mass at any k**: two
 * water cells sitting diagonally above one empty cell each independently see "empty below me" and
 * vacate while the empty cell fills once — two in, one out. Preventing that needs the losing cell
 * to see its competitor, two cells away, and radius 2 on hex is 18 neighbours (a k¹⁹ table). Block
 * partitioning makes arbitration internal, so a rule that permutes multisets is exactly
 * conservative with no bookkeeping. This is the lattice-gas approach; FHP is the hex precedent.
 *
 * ## Why this lattice
 *
 * A hex grid has one neighbour class — six neighbours, all equidistant, six-fold symmetry — where a
 * square grid has two, and the resulting anisotropy is not cosmetic. Six-fold symmetry is sufficient
 * for a lattice gas to recover isotropic hydrodynamics in the continuum limit and four-fold is not,
 * which is why square-lattice CAs grow diamond-shaped fronts where physics wants circles. Hex cell
 * centres also form a triangular lattice, where site percolation has `p_c = 1/2` **exactly** (the
 * square lattice's ≈0.5927 has no closed form) — so "pack the grid with obstacles at density p and
 * ask whether fluid gets through" has an analytic answer here and nowhere else common. The engine
 * test `site_percolation_transition_sits_at_one_half` uses it as a validation of the wrap and the
 * neighbour table, not just as a demo.
 *
 * Note the pairing: the *lattice* is isotropic while the rule space is anisotropic by construction
 * (position within the neighbourhood is part of the rule index). That is the right way round for
 * physical simulation — isotropy by default, symmetry broken only where the physics says so.
 */

import { WorldK } from '../core/wasm-engine/hexlife_wasm.js';
import {
    initEmbedWasm,
    refreshAllWasmViews,
    refreshWasmViewsAfterAllocation,
    registerViewOwner,
    unregisterViewOwner,
    wasmExportsOrThrow,
} from './EmbedSim.js';

// The `HXK1.` world code. A distinct prefix rather than an `HXW1` version bump, so a deployed
// binary decoder rejects a k-state payload outright instead of half-reading one — see `CaCodec.js`.
// Re-exported from here because this is the DOM-free entry: a Node host can validate a pasted code
// without touching the element, exactly as `@hexlife/embed/api` does for `HXW1`.
export {
    backendTag,
    caRuleShape,
    decodeCaCode,
    encodeCaCode,
    isCaCode,
    isValidCaGeometry,
    CA_PALETTE_NONE,
    CA_PALETTE_RGB,
} from '../core/CaCodec.js';

/** Backend tags, matching `worldk.rs`. */
const BACKEND_NEIGHBORHOOD = 0;
const BACKEND_BLOCK = 1;

/** @type {Record<string, number>} */
const BACKEND_TAGS = {
    neighborhood: BACKEND_NEIGHBORHOOD,
    block: BACKEND_BLOCK,
};

/**
 * State cap for the `'neighborhood'` backend. The dense table is `k⁷`: 16 KB at k=4 (fits L1),
 * 273 KB at k=6 (lives in L2), 2 MB at k=8 (a cache miss per cell).
 *
 * The table is sized from the world's own `k`, so raising this cap costs a k=2 or k=4 world nothing
 * — only a world that asks for the larger `k` pays for it.
 */
export const MAX_NEIGHBORHOOD_STATES = 6;

/** State cap for the `'block'` backend, whose table is `k³` — 4096 entries at k=16. */
export const MAX_BLOCK_STATES = 16;

/** The block partition cycles through this many phases; see {@link HexCA.phase}. */
export const BLOCK_PHASES = 3;

/** Hard cap on ticks simulated per `advance()` call — the same anti-spiral guard `EmbedSim` uses. */
const MAX_TICKS_PER_FRAME = 4;

/**
 * Initialize the shared wasm engine. Idempotent, and it is the **same** instance and the same
 * linear memory `<hexlife-world>` uses — which is exactly why the view registry below exists.
 *
 * @returns {Promise<void>}
 */
export async function initEngine() {
    await initEmbedWasm();
}

/**
 * Convert a wasm-bindgen rejection into a real `Error`.
 *
 * `WorldK` returns `Result<_, String>`, which wasm-bindgen throws as a bare JS string. Hosts
 * reasonably expect `instanceof Error`, so every boundary crossing in this file goes through here.
 *
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function rethrowAsError(fn) {
    try {
        return fn();
    } catch (cause) {
        if (cause instanceof Error) throw cause;
        throw new Error(String(cause));
    }
}

/**
 * @param {number} states
 * @param {number} max
 * @param {string} label
 */
function assertStates(states, max, label) {
    if (!Number.isInteger(states) || states < 2 || states > max) {
        throw new RangeError(`${label}: states must be an integer in 2..${max}, received ${states}.`);
    }
}

// --- rule construction -------------------------------------------------------
// Both builders materialize the whole lookup ONCE by calling the developer's function k⁷ or k³
// times at load. A per-cell JS callback is never an option: the boundary crossing would dominate
// the tick by orders of magnitude, which is the entire reason these are tables and not closures.

/**
 * Build the dense anisotropic rule for the `'neighborhood'` backend.
 *
 * `fn` is called once per `(centre, neighbours)` combination — `k⁷` times, at most 279936 — and must
 * return the centre cell's next state. `neighbours` is a fresh 6-entry array in canonical neighbour
 * order, so the rule can depend on *which* neighbour holds what: that anisotropy is the point, and
 * it is how you express gravity on an otherwise isotropic lattice.
 *
 * @param {number} states `k`, in `2..MAX_NEIGHBORHOOD_STATES`.
 * @param {(centre: number, neighbours: number[]) => number} fn
 * @returns {Uint8Array} `k⁷` entries, ready for {@link HexCA#setRule}.
 */
export function ruleFromTable(states, fn) {
    assertStates(states, MAX_NEIGHBORHOOD_STATES, 'ruleFromTable');
    if (typeof fn !== 'function') throw new TypeError('ruleFromTable: fn must be a function.');

    const k = states;
    const size = k ** 7;
    const rule = new Uint8Array(size);
    for (let index = 0; index < size; index++) {
        // Same decomposition as the engine's index: centre in the k⁶ place, neighbour j in the kʲ.
        let rest = index;
        const neighbours = new Array(6);
        for (let j = 0; j < 6; j++) {
            neighbours[j] = rest % k;
            rest = (rest - neighbours[j]) / k;
        }
        const centre = rest;
        const value = fn(centre, neighbours);
        if (!Number.isInteger(value) || value < 0 || value >= k) {
            throw new RangeError(
                `ruleFromTable: fn returned ${value} for centre ${centre}, which is not a state below k = ${k}.`,
            );
        }
        rule[index] = value;
    }
    return rule;
}

/**
 * Build the `k³` rule for the `'block'` backend.
 *
 * `fn` receives a block as an ordered triple in the partition's vertex order and returns the
 * rewritten triple. Both are plain 3-arrays of states.
 *
 * Nothing here enforces conservation or isotropy — check them with {@link isConservative} and
 * {@link isIsotropic} and decide. Non-conservative block rules are legitimate (reactions, sources,
 * sinks), and deliberately breaking isotropy is how you get gravity.
 *
 * @param {number} states `k`, in `2..MAX_BLOCK_STATES`.
 * @param {(block: number[]) => ArrayLike<number>} fn
 * @returns {Uint16Array} `k³` packed output triples, ready for {@link HexCA#setRule}.
 */
export function blockRuleFromTable(states, fn) {
    assertStates(states, MAX_BLOCK_STATES, 'blockRuleFromTable');
    if (typeof fn !== 'function') throw new TypeError('blockRuleFromTable: fn must be a function.');

    const k = states;
    const rule = new Uint16Array(k * k * k);
    for (let s0 = 0; s0 < k; s0++) {
        for (let s1 = 0; s1 < k; s1++) {
            for (let s2 = 0; s2 < k; s2++) {
                const out = fn([s0, s1, s2]);
                if (!out || out.length !== 3) {
                    throw new TypeError(
                        `blockRuleFromTable: fn must return a 3-entry block for [${s0}, ${s1}, ${s2}].`,
                    );
                }
                for (let v = 0; v < 3; v++) {
                    const value = out[v];
                    if (!Number.isInteger(value) || value < 0 || value >= k) {
                        throw new RangeError(
                            `blockRuleFromTable: fn returned ${value} at position ${v} for `
                            + `[${s0}, ${s1}, ${s2}], which is not a state below k = ${k}.`,
                        );
                    }
                }
                rule[s0 * k * k + s1 * k + s2] = out[0] * k * k + out[1] * k + out[2];
            }
        }
    }
    return rule;
}

/**
 * Decode one packed block triple.
 * @param {number} states
 * @param {number} packed
 * @returns {number[]} `[s0, s1, s2]`
 */
export function unpackBlock(states, packed) {
    const k = states;
    return [Math.floor(packed / (k * k)), Math.floor(packed / k) % k, packed % k];
}

/**
 * Encode one block triple.
 * @param {number} states
 * @param {ArrayLike<number>} block
 * @returns {number}
 */
export function packBlock(states, block) {
    const k = states;
    return block[0] * k * k + block[1] * k + block[2];
}

/** @param {number} states @param {ArrayLike<number>} rule */
function assertBlockRule(states, rule, label) {
    assertStates(states, MAX_BLOCK_STATES, label);
    const size = states ** 3;
    if (!rule || rule.length !== size) {
        throw new RangeError(`${label}: expected a k^3 = ${size} entry block rule.`);
    }
}

/**
 * Whether a block rule conserves the per-state census exactly — i.e. every input block's output is
 * a permutation of its input multiset. `O(k³)`, so it is cheap enough to run at load on every rule.
 *
 * This is the property no radius-1 rule can have (see the module docs), and the reason to reach for
 * the block backend at all. Report it; don't enforce it.
 *
 * @param {number} states
 * @param {ArrayLike<number>} blockRule
 * @returns {boolean}
 */
export function isConservative(states, blockRule) {
    assertBlockRule(states, blockRule, 'isConservative');
    // Numeric comparator, not the default lexicographic one: at k > 10 the states are multi-digit
    // and `[1, 10, 9]` would sort as `[1, 10, 9]`.
    const ascending = (a, b) => a - b;
    for (let index = 0; index < blockRule.length; index++) {
        const input = unpackBlock(states, index).sort(ascending);
        const output = unpackBlock(states, blockRule[index]).sort(ascending);
        if (input[0] !== output[0] || input[1] !== output[1] || input[2] !== output[2]) return false;
    }
    return true;
}

/**
 * Whether a block rule is equivariant under rotating the block — `f(rot(b)) === rot(f(b))` for
 * every block, where `rot` is the cyclic shift of the triple, which is a 120° rotation of the
 * triangle. An isotropic rule cannot single out a direction.
 *
 * Worth checking deliberately: breaking this is how you get gravity, and it should be a decision
 * rather than an artefact of how you happened to order the vertices.
 *
 * @param {number} states
 * @param {ArrayLike<number>} blockRule
 * @returns {boolean}
 */
export function isIsotropic(states, blockRule) {
    assertBlockRule(states, blockRule, 'isIsotropic');
    /** @param {number[]} b */
    const rotate = (b) => [b[2], b[0], b[1]];
    for (let index = 0; index < blockRule.length; index++) {
        const rotatedInput = packBlock(states, rotate(unpackBlock(states, index)));
        const rotatedOutput = packBlock(states, rotate(unpackBlock(states, blockRule[index])));
        if (blockRule[rotatedInput] !== rotatedOutput) return false;
    }
    return true;
}

/**
 * A k-state hexagonal cellular automaton on a toroidal grid.
 *
 * Headless and DOM-free: it owns the cells and the stepping and nothing else, exactly as `EmbedSim`
 * does for the binary engine. Render it however you like — `state` is a live `Uint8Array` of state
 * values in `0..k`. (Note that HexLife's signature rule-index colouring does not survive `k > 2` —
 * the index needs 21 bits at k=8 — so colour by *state* from a k-entry palette instead.)
 */
export class HexCA {
    /**
     * @param {object} options
     * @param {number} options.states `k`. Capped by the backend — see {@link MAX_NEIGHBORHOOD_STATES}
     *   and {@link MAX_BLOCK_STATES}.
     * @param {number} options.rows Grid rows. **Block mode requires a multiple of 3** or the
     *   triangular partition has a seam at the row wrap; construction throws rather than silently
     *   simulating something wrong. 64 is not valid there; 63 and 66 are.
     * @param {number} options.columns Grid columns. Must be even, so the column wrap preserves the
     *   hex parity the neighbour table depends on.
     * @param {'neighborhood'|'block'} [options.backend='neighborhood']
     * @param {ArrayLike<number>} [options.rule] The rule table, from {@link ruleFromTable} or
     *   {@link blockRuleFromTable}. Omitted ⇒ an all-zero table, which is a world that dies at once.
     * @param {ArrayLike<number>} [options.cells] The exact tick-0 grid (`rows * columns` entries).
     *   Omitted ⇒ every cell 0.
     * @param {number} [options.speed=10] Target ticks/second for {@link HexCA#advance}.
     */
    constructor({ states, rows, columns, backend = 'neighborhood', rule = null, cells = null, speed = 10 }) {
        if (!(backend in BACKEND_TAGS)) {
            throw new RangeError(`HexCA: backend must be 'neighborhood' or 'block', received '${backend}'.`);
        }
        const tag = BACKEND_TAGS[backend];
        assertStates(states, tag === BACKEND_BLOCK ? MAX_BLOCK_STATES : MAX_NEIGHBORHOOD_STATES, 'HexCA');
        if (!Number.isInteger(rows) || !Number.isInteger(columns)) {
            throw new RangeError('HexCA: rows and columns must be integers.');
        }

        // Throws if the engine has not been initialized, before anything is allocated.
        this._wasm = wasmExportsOrThrow();

        this.states = states;
        this.rows = rows;
        this.columns = columns;
        this.numCells = rows * columns;
        this.backend = backend;
        this.speed = speed;
        /** Fractional ticks owed, carried across frames so the real rate tracks `speed`. */
        this._accumulator = 0;

        const previousBuffer = this._wasm.memory.buffer;
        this.world = rethrowAsError(() => new WorldK(columns, rows, states, tag));
        this._doubleBuffered = this.world.is_double_buffered();
        registerViewOwner(this);
        refreshWasmViewsAfterAllocation(previousBuffer, this);

        if (rule) this.setRule(rule);
        if (cells) this.setCells(cells);
    }

    /** (Re)build the typed-array views over this world's buffers in wasm linear memory. */
    _refreshViews() {
        const mem = this._wasm.memory.buffer;
        this.state = new Uint8Array(mem, this.world.state_ptr(), this.numCells);
        this.nextState = this._doubleBuffered
            ? new Uint8Array(mem, this.world.next_state_ptr(), this.numCells)
            : null;
        this._census = new Uint32Array(mem, this.world.census_ptr(), this.states);
    }

    /** Entries the rule table for this world's backend must have (`k⁷` or `k³`). */
    get ruleLength() {
        return this.world.rule_len();
    }

    /**
     * Install the rule table. Backend-appropriate: a `k⁷` byte table for `'neighborhood'`, a `k³`
     * table of packed triples for `'block'`.
     *
     * @param {ArrayLike<number>} rule
     */
    setRule(rule) {
        this._assertLive();
        const previousBuffer = this._wasm.memory.buffer;
        rethrowAsError(() => {
            if (this._doubleBuffered) {
                this.world.set_neighborhood_rule(rule instanceof Uint8Array ? rule : Uint8Array.from(rule));
            } else {
                this.world.set_block_rule(rule instanceof Uint16Array ? rule : Uint16Array.from(rule));
            }
        });
        if (this._wasm.memory.buffer !== previousBuffer) refreshAllWasmViews();
    }

    /**
     * Replace every cell. This — not a poke through {@link HexCA#state} — is the supported bulk
     * write: it validates the states and wakes the activity tracker, so the region that changed is
     * actually recomputed.
     *
     * @param {ArrayLike<number>} cells `rows * columns` entries, each in `0..k`.
     */
    setCells(cells) {
        this._assertLive();
        const previousBuffer = this._wasm.memory.buffer;
        rethrowAsError(() => {
            this.world.set_cells(cells instanceof Uint8Array ? cells : Uint8Array.from(cells));
        });
        if (this._wasm.memory.buffer !== previousBuffer) refreshAllWasmViews();
    }

    /**
     * Set one cell, waking its neighbourhood.
     * @param {number} index
     * @param {number} value
     */
    setCell(index, value) {
        this._assertLive();
        rethrowAsError(() => this.world.set_cell(index, value));
    }

    /**
     * Fill every cell with one state.
     * @param {number} value
     */
    fill(value) {
        this._assertLive();
        rethrowAsError(() => this.world.fill(value));
    }

    /**
     * Force a full recomputation on the next tick.
     *
     * Only needed if you write through the {@link HexCA#state} view directly, which bypasses the
     * activity tracker — the methods above call this for you. When in doubt, call it: the cost is
     * one dense tick.
     */
    markAllDirty() {
        this._assertLive();
        this.world.mark_all_dirty();
    }

    /**
     * Turn the chunk-skipping fast path off (or back on). Results are identical either way — that
     * equality is what the engine's tests assert — so this is for benchmarking and for ruling the
     * fast path out while debugging a model.
     *
     * @param {boolean} enabled
     */
    setSkippingEnabled(enabled) {
        this._assertLive();
        this.world.set_skipping_enabled(Boolean(enabled));
    }

    /**
     * Alternate the block partition's handedness every tick.
     *
     * The up-triangle partition is left-handed — its odd slot always sits one column to the right —
     * which biases sideways transport. Alternating with the mirrored partition cancels that while
     * keeping gravity downward. Natively this is just a different odd slot on odd ticks, so it costs
     * no grid permutation and keeps chunk skipping, over the six-tick period its map cycle has.
     *
     * Off by default: existing block worlds and their `HXK1` codes are unaffected.
     *
     * @param {boolean} alternates
     */
    setBlockAlternates(alternates) {
        this._assertLive();
        this.world.set_block_alternates(Boolean(alternates));
    }

    get blockAlternates() {
        return this.world ? this.world.block_alternates() : false;
    }

    /**
     * Advance exactly `count` generations.
     *
     * The neighborhood backend swaps its buffers inside wasm, so the JS views must mirror the swap;
     * the block backend rewrites disjoint blocks in place and has nothing to mirror.
     *
     * @param {number} [count=1]
     * @returns {number} Cells that changed on the final tick.
     */
    tick(count = 1) {
        this._assertLive();
        const ticks = Math.max(0, Math.floor(count));
        let changed = 0;
        if (ticks > 0) {
            changed = this.world.run_ticks(ticks);
            if (this._doubleBuffered && ticks % 2 === 1) {
                [this.state, this.nextState] = [this.nextState, this.state];
            }
        }
        return changed;
    }

    /**
     * Run however many whole ticks `dtMs` of wall-clock owes at the current speed, capped so a
     * speed the device cannot sustain degrades the visual rate instead of locking the page up.
     *
     * @param {number} dtMs
     * @returns {number} Ticks actually run.
     */
    advance(dtMs) {
        if (this.speed <= 0) return 0;
        this._accumulator += (dtMs / 1000) * this.speed;
        let ticks = Math.floor(this._accumulator);
        if (ticks <= 0) return 0;
        if (ticks > MAX_TICKS_PER_FRAME) {
            ticks = MAX_TICKS_PER_FRAME;
            // Drop the backlog rather than carrying it — carrying it is what spirals.
            this._accumulator = 0;
        } else {
            this._accumulator -= ticks;
        }
        this.tick(ticks);
        return ticks;
    }

    /** Generations elapsed since construction. */
    get generation() {
        return Number(this.world.tick_count());
    }

    /** The block-partition phase the next tick will use, in `0..BLOCK_PHASES`. */
    get phase() {
        return this.world.phase();
    }

    /** Cells that changed in the last tick. */
    get lastChangedCount() {
        return this.world.last_changed_count();
    }

    /**
     * Whether the world has reached a fixed point it can never leave.
     *
     * The rule is deterministic and time-invariant, so once a full partition cycle passes with no
     * change the configuration maps to itself forever. Hosts use this to stop scheduling frames at
     * all — a settled world is genuinely free, not merely cheap.
     */
    get isSettled() {
        return this.world.is_settled();
    }

    /**
     * Chunks recomputed on the last tick, and the total. The measured pay-off of the skipping path:
     * watch `active` fall as a model settles.
     *
     * @returns {{active: number, total: number}}
     */
    get chunkActivity() {
        return { active: this.world.active_chunk_count(), total: this.world.chunk_count() };
    }

    /**
     * Per-state occupancy of the current generation, freshly computed.
     *
     * This is how conservation is checked from outside: under a conservative block rule every entry
     * holds forever. Returns a copy, so it is safe to keep across ticks.
     *
     * @returns {Uint32Array} `k` counts.
     */
    census() {
        this._assertLive();
        this.world.compute_census();
        return new Uint32Array(this._census);
    }

    /**
     * Rolling hash of the current generation, using the same mixing constant as the binary engine.
     * @returns {number}
     */
    checksum() {
        return this.world.checksum_state();
    }

    /**
     * A private copy of the current cells.
     *
     * {@link HexCA#state} is a *view* into wasm linear memory: it can detach under you when
     * anything else on the page allocates, and it keeps changing as the world ticks. A snapshot is
     * neither.
     *
     * @returns {Uint8Array|null} Null once disposed.
     */
    snapshotCells() {
        return this.state ? new Uint8Array(this.state) : null;
    }

    /** Release the wasm world and unregister. Must be called or it leaks. */
    dispose() {
        if (!this.world) return;
        unregisterViewOwner(this);
        this.world.free();
        this.world = null;
        this.state = this.nextState = this._census = null;
    }

    _assertLive() {
        if (!this.world) throw new Error('HexCA: this world has been disposed.');
    }
}
