// NB: deliberately NOT `// @ts-check`, matching `WorldWorker.js` / `renderer.js`, the two modules
// this pair mirrors. The JSDoc below is for readers and editor hints; opting in to the checker here
// would require a declaration for the `?url` wasm import and a pile of WebGL non-null casts next
// door, for no real safety on code this concrete.

/**
 * `EmbedSim` — the single-world simulation runtime behind `<hexlife-world>` (#25) and the Reddit
 * Devvit post (#26). It is the app's `WorldWorker` with everything the embed doesn't need removed:
 * no worker, no stats/entropy, no history ring, no cycle detection. Brush invert is available
 * for interactive hosts (Devvit Live Specimen draw).
 *
 * **What it must NOT do is more important than what it does.** The embed's whole selling point is
 * that identical `(ruleset, seed, density, rows)` reproduces a *byte-identical* tick sequence with
 * the main app — "this embed IS the recording". That holds only because both sides run the same
 * wasm `run_tick` over a grid derived by the same `deriveGridDimensions` and filled by the same
 * `mulberry32` + `DensityStrategy`. So this module imports those four things from `src/core/` and
 * reimplements none of them. It also must not import `config.js` (mutable live globals + an
 * import-time side effect) or `utils.js` (34 KB grab-bag that itself imports config) — hence the
 * Phase 0 extraction into `rng.js` / `rulesetHex.js` / `gridMath.js`.
 */

import init, { World } from '../core/wasm-engine/hexlife_wasm.js';
// eslint-disable-next-line import/no-unresolved
import wasmUrl from '../core/wasm-engine/hexlife_wasm_bg.wasm?url';
import { mulberry32 } from '../core/rng.js';
import { hexToRuleset } from '../core/rulesetHex.js';
import { deriveGridDimensions } from '../core/gridMath.js';
import { DensityStrategy } from '../core/initialStateStrategies/DensityStrategy.js';
import { ClusterStrategy } from '../core/initialStateStrategies/ClusterStrategy.js';
import { collectBrushCells, getHexLine } from '../core/hexBrush.js';

/** Rule-index sentinel meaning "initial state, no rule has fired here yet" (see fragment.glsl). */
const RULE_INDEX_INITIAL = 255;

/**
 * Hard cap on ticks simulated per animation frame. Without it, a `speed` higher than the device can
 * sustain makes each frame owe more ticks than the last — the classic spiral of death. Capping means
 * the *visual* rate degrades gracefully on a weak GPU instead of the page locking up.
 */
const MAX_TICKS_PER_FRAME = 4;

const densityStrategy = new DensityStrategy();

/**
 * The initial-state generators a world code can carry (WorldCodec `generator.mode`). These are the
 * SAME strategy classes the worker runs, so a generator-driven post reseeds exactly as the app would.
 * Both are pure (no `config.js`), which is why the embed can import them.
 */
const generatorStrategies = {
    density: densityStrategy,
    clusters: new ClusterStrategy(),
};

// --- wasm singleton ----------------------------------------------------------
// wasm-bindgen keeps ONE module-level instance, so every EmbedSim on the page shares one wasm
// instance and therefore one linear memory. See the registry below for why that matters.

/** @type {any} */
let wasmExports = null;
/** @type {Promise<any> | null} */
let initPromise = null;

/** Matches a base64 `data:` URI, however the bundler spelled the media type. */
const DATA_URI_RE = /^data:[^,]*;base64,(.*)$/s;

/**
 * Resolve the wasm import into raw bytes.
 *
 * The import is a *URL*, and which kind depends on the bundler: a real path under the dev server /
 * the app build, or an inlined base64 `data:` URI once Vite's lib build (#25 Phase 3) or Devvit's
 * esbuild (#26) inlines the binary into the single output file. Both must work from one code path —
 * the embed ships as one self-contained file and the Devvit webview may not fetch anything at all.
 *
 * A `data:` URI is decoded **here rather than handed to `fetch()`**: fetching a data URI is subject
 * to the host page's CSP `connect-src`, and a Reddit webview's CSP is not ours to widen. `atob` is
 * subject to nothing. (Feeding the URL straight to wasm-bindgen is also out: its default path uses
 * `instantiateStreaming`, whose MIME check rejects data URIs.)
 *
 * @param {string} url
 * @returns {Promise<ArrayBuffer|Uint8Array>}
 */
async function loadWasmBytes(url) {
    const dataUri = DATA_URI_RE.exec(url);
    if (dataUri) {
        const binary = atob(dataUri[1]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    return (await fetch(url)).arrayBuffer();
}

/**
 * Initialize the wasm engine (idempotent; concurrent callers share one promise).
 *
 * @returns {Promise<any>} The wasm exports (notably `.memory`).
 */
export function initEmbedWasm() {
    if (wasmExports) return Promise.resolve(wasmExports);
    if (!initPromise) {
        initPromise = (async () => {
            const bytes = await loadWasmBytes(wasmUrl);
            wasmExports = await init({ module_or_path: bytes });
            return wasmExports;
        })();
    }
    return initPromise;
}

// --- cross-instance view detachment -----------------------------------------
// THE trap for a multi-instance embed. Every EmbedSim's typed arrays are *views* into the shared
// wasm linear memory. Constructing a `World` allocates, which can GROW that memory — and growing it
// **detaches every view held by every other live sim** on the page. A single-instance page never
// sees this; a page with two widgets, or one that adds a widget after scroll, silently breaks.
// So: keep a registry of live sims and rebuild all their views after ANY World construction.
// Beyond construction, the embed calls only non-allocating engine methods (`run_tick`, `*_ptr`,
// `checksum_state`), so nothing else can detach them.

/** @type {Set<EmbedSim>} */
const liveSims = new Set();

export class EmbedSim {
    /**
     * @param {object} opts
     * @param {string} opts.rulesetHex 32-char hex ruleset (same format as share links).
     * @param {number} [opts.rows=64] Grid rows; cols are derived (never passed in — see gridMath).
     * @param {number} [opts.cols] Explicit column count, overriding the derivation. **Only** for a
     *   world code (WorldCodec), which carries the exact grid its cells were captured on: the cell
     *   payload's length is the authority there, and a future change to `deriveGridDimensions` must
     *   not silently reshape an old post's grid.
     * @param {number} [opts.density=0.5] Initial fill density, 0–1. Ignored when `initialCells` is set.
     * @param {number|null} [opts.seed=null] mulberry32 seed. Null ⇒ nondeterministic (Math.random).
     * @param {Uint8Array|null} [opts.initialCells=null] The exact tick-0 grid (`rows*cols` entries).
     *   When present it replaces density+seed entirely — `reset()` replays these cells verbatim, which
     *   is what makes a world code reproduce *this* world rather than a statistically similar one.
     * @param {{mode: string, params: object}|null} [opts.generator=null] A `{mode, params}` initial-state
     *   generator (`'density'` / `'clusters'`) from a world code. When present (and `initialCells` is
     *   not), `reset()` produces a *fresh* state from it each time — so the in-post reset button varies.
     * @param {number} [opts.speed=10] Target ticks/second.
     */
    constructor({ rulesetHex, rows = 64, cols, density = 0.5, seed = null, initialCells = null, generator = null, speed = 10 }) {
        if (!wasmExports) {
            throw new Error('EmbedSim: await initEmbedWasm() before constructing a sim.');
        }

        const dims = deriveGridDimensions(rows);
        this.rows = dims.rows;
        this.cols = Number.isInteger(cols) && cols >= 2 ? cols : dims.cols;
        this.numCells = this.rows * this.cols;

        if (initialCells && initialCells.length !== this.numCells) {
            throw new Error(`EmbedSim: initialCells has ${initialCells.length} entries, expected ${this.numCells}.`);
        }
        /** @type {Uint8Array|null} A private copy: the caller's buffer is not ours to keep alive. */
        this.initialCells = initialCells ? new Uint8Array(initialCells) : null;
        /**
         * @type {{strategy: object, params: object}|null} A resolved initial-state generator, or null.
         *   Ignored when `initialCells` is set (an exact grid always wins). An unknown mode falls back
         *   to density, matching the worker's RESET_WORLD handling.
         */
        this.generator = (!this.initialCells && generator && generator.mode)
            ? { strategy: generatorStrategies[generator.mode] || densityStrategy, params: generator.params || {} }
            : null;
        // The shape DensityStrategy expects — the same three fields the worker passes as its config.
        this.gridConfig = { GRID_COLS: this.cols, GRID_ROWS: this.rows, NUM_CELLS: this.numCells };

        this.density = density;
        this.seed = seed;
        this.speed = speed;
        this.tickCount = 0;
        this.activeCount = 0;
        /** Fractional ticks owed, carried across frames so real TPS tracks `speed`. */
        this._accumulator = 0;

        this.world = new World(this.cols, this.rows);
        liveSims.add(this);
        // A World was just constructed: memory may have grown, so EVERY live sim (including this
        // one, which has no views yet) must (re)build its views.
        refreshAllViews();

        this.setRuleset(rulesetHex);
        this.reset(seed);
    }

    /** (Re)build the typed-array views over this world's buffers in wasm linear memory. */
    _refreshViews() {
        const mem = wasmExports.memory.buffer;
        const n = this.numCells;
        this.state = new Uint8Array(mem, this.world.state_ptr(), n);
        this.nextState = new Uint8Array(mem, this.world.next_state_ptr(), n);
        this.ruleIndices = new Uint8Array(mem, this.world.rule_indices_ptr(), n);
        this.nextRuleIndices = new Uint8Array(mem, this.world.next_rule_indices_ptr(), n);
        this.ruleset = new Uint8Array(mem, this.world.ruleset_ptr(), 128);
        this.ruleUsageCounters = new Uint32Array(mem, this.world.rule_usage_counters_ptr(), 128);
    }

    /**
     * @param {string} hex 32-char hex ruleset. An invalid string yields an all-zero (dead) ruleset
     *   rather than throwing — `hexToRuleset` already guarantees that, and the element layer is
     *   where a bad attribute becomes a visible error state.
     */
    setRuleset(hex) {
        this.rulesetHex = hex;
        this.ruleset.set(hexToRuleset(hex));
    }

    /**
     * Seed a fresh initial state. Mirrors the worker's RESET_WORLD exactly — the fill, the 255
     * rule-index sentinel, the zeroed next buffers, the zeroed usage counters — because any
     * divergence here shows up as a different tick-100 checksum than the app's.
     *
     * @param {number|null} [seed] mulberry32 seed; falsy ⇒ `Math.random` (nondeterministic), which
     *   is the same rule the worker applies. Ignored when the sim was given `initialCells`.
     */
    reset(seed = this.seed) {
        this.seed = seed;
        this.tickCount = 0;
        this._accumulator = 0;

        if (this.initialCells) {
            this.state.set(this.initialCells);
        } else if (this.generator) {
            // A world-code generator: reseed from its params. A falsy seed (the usual case — a post
            // carries no seed) means Math.random, so every reset yields a fresh arrangement.
            const rng = seed ? mulberry32(seed) : Math.random;
            this.generator.strategy.generate(this.state, this.generator.params, rng, this.gridConfig);
        } else {
            const rng = seed ? mulberry32(seed) : Math.random;
            densityStrategy.generate(this.state, { density: this.density }, rng, this.gridConfig);
        }

        this.ruleIndices.fill(RULE_INDEX_INITIAL);
        this.nextState.fill(0);
        this.nextRuleIndices.fill(0);
        this.ruleUsageCounters.fill(0);

        this.activeCount = this.state.reduce((sum, c) => sum + c, 0);
    }

    /**
     * Advance exactly one generation.
     *
     * `run_tick` swaps the current/next buffers *inside* wasm and returns the new generation's
     * active-cell count, so JS must mirror that swap on its view references or it would keep
     * reading the buffer that is now "next". This is the same dance as `WorldWorker.runTick`.
     *
     * @returns {number} Active cells in the new generation.
     */
    tick() {
        this.activeCount = this.world.run_tick();
        [this.state, this.nextState] = [this.nextState, this.state];
        [this.ruleIndices, this.nextRuleIndices] = [this.nextRuleIndices, this.ruleIndices];
        this.tickCount++;
        return this.activeCount;
    }

    /**
     * Accumulator-driven stepping: run however many whole ticks `dtMs` of wall-clock owes at the
     * current speed, capped. The remainder carries over, so the average rate tracks `speed` even
     * though frames don't line up with tick boundaries.
     *
     * @param {number} dtMs Milliseconds since the previous frame.
     * @returns {number} Ticks actually run this call.
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
        for (let i = 0; i < ticks; i++) this.tick();
        return ticks;
    }

    /**
     * @returns {number} Rolling hash of the current state buffer. This is the determinism
     *   cross-check hook: the app and the embed must report the same value at the same tick for
     *   the same `(ruleset, seed, density, rows)`.
     */
    checksum() {
        return this.world.checksum_state();
    }

    /**
     * Invert cells under a brush stroke (same semantics as the app's invert brush).
     * Cells already in `strokeAffected` are skipped so re-entering a painted cell mid-stroke
     * does not flip twice. Mutates `strokeAffected` by adding newly painted indices.
     *
     * @param {number} col0
     * @param {number} row0
     * @param {number} col1
     * @param {number} row1
     * @param {number} brushSize Neighborhood radius (0 = single cell).
     * @param {Set<number>} strokeAffected Per-stroke "already painted" set.
     * @returns {boolean} Whether any cell changed.
     */
    invertBrushLine(col0, row0, col1, row1, brushSize, strokeAffected) {
        if (!this.state || !this.ruleIndices) return false;
        const line = getHexLine(col0, row0, col1, row1);
        const neighborhood = new Set();
        const toFlip = [];
        for (const { col, row } of line) {
            collectBrushCells(col, row, brushSize, this.cols, this.rows, neighborhood);
            for (const idx of neighborhood) {
                if (strokeAffected.has(idx)) continue;
                strokeAffected.add(idx);
                toFlip.push(idx);
            }
        }
        if (toFlip.length === 0) return false;
        let changed = false;
        for (const idx of toFlip) {
            if (idx < 0 || idx >= this.numCells) continue;
            const prev = this.state[idx];
            const next = prev ? 0 : 1;
            if (next === prev) continue;
            this.state[idx] = next;
            this.ruleIndices[idx] = RULE_INDEX_INITIAL;
            this.activeCount += next ? 1 : -1;
            changed = true;
        }
        return changed;
    }

    /**
     * Invert an arbitrary set of cell indices, with no per-stroke bookkeeping.
     *
     * This is the exact inverse of `invertBrushLine` over the same set (inversion is self-inverse,
     * and a stroke set holds each index at most once), which is what makes "undo the marks a pinch
     * left behind" possible without snapshotting the whole grid.
     *
     * @param {Iterable<number>} indices
     * @returns {boolean} Whether any cell changed.
     */
    invertCells(indices) {
        if (!this.state || !this.ruleIndices) return false;
        let changed = false;
        for (const idx of indices) {
            if (idx < 0 || idx >= this.numCells) continue;
            const prev = this.state[idx];
            const next = prev ? 0 : 1;
            this.state[idx] = next;
            this.ruleIndices[idx] = RULE_INDEX_INITIAL;
            this.activeCount += next ? 1 : -1;
            changed = true;
        }
        return changed;
    }

    /**
     * A private copy of the current generation's cells.
     *
     * `state` is a *view* into wasm linear memory, so handing it to a caller hands them something
     * that can detach under them (any `new World(...)` on the page may grow the memory — see the
     * registry note above) and that keeps changing as the world ticks. A snapshot is neither: it is
     * the cells as they are right now, safe to hold. This is what makes "post exactly what is on
     * screen" possible.
     *
     * @returns {Uint8Array|null} Copy of the cells, or null once the sim has been freed.
     */
    snapshotCells() {
        return this.state ? new Uint8Array(this.state) : null;
    }

    /** Release the wasm World and unregister. Must be called on element disconnect, or it leaks. */
    free() {
        if (!this.world) return;
        liveSims.delete(this);
        this.world.free();
        this.world = null;
        this.state = this.nextState = this.ruleIndices = this.nextRuleIndices = null;
        this.ruleset = this.ruleUsageCounters = null;
    }
}

/** Rebuild every live sim's views. Call after ANY `new World(...)` — see the registry note above. */
function refreshAllViews() {
    for (const sim of liveSims) sim._refreshViews();
}
