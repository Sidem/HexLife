/**
 * `@hexlife/embed/hcp` — the **HCP** k-state cellular automaton runtime.
 *
 * A fourth engine, in its own Wasm artifact. Root, `/sim`, `/ca`, `/stochastic`, `/solid` and
 * `/spacetime` never import this module. The lattice is hexagonal close packing; the v1 rule is a
 * 6-phase tetrahedral block of size `k^4`. DOM-free: works in Node and in workers.
 */

import {
    initSync,
    hcp_engine_version as wasmHcpEngineVersion,
    hcp_site_xyz as wasmHcpSiteXyz,
    WorldHcp,
} from '../core/hcp-wasm/hexlife_hcp_wasm.js';
// eslint-disable-next-line import/no-unresolved
import wasmUrl from '../core/hcp-wasm/hexlife_hcp_wasm_bg.wasm?url';

export {
    decodeHcpCode,
    encodeHcpCode,
    isHcpCode,
    isValidHcpGeometry,
    HCP_PALETTE_NONE,
    HCP_PALETTE_RGB,
    MAX_HCP_STATES,
    STACKING_HCP,
    XY_TORUS,
    XY_WALL,
    Z_OPEN,
    Z_TORUS,
} from '../core/HcpCodec.js';

export {
    coordsFromIndex,
    indexFromCoords,
    interlayerOffsets,
    latticeSpacing,
    layerSpacing,
    sitePosition,
} from './hcpCoords.js';

/** Phases the tetrahedral partition cycles through. */
export const BLOCK_PHASES = 6;
/** State cap: the table is `k^4` packed `u32`s (256 KB at k=16). */
export const MAX_BLOCK_STATES = 16;

const DATA_URI_RE = /^data:[^,]*;base64,(.*)$/s;
const MAX_TICKS_PER_FRAME = 4;

const STACKING_TAGS = {hcp: 0};
const XY_TAGS = {torus: 0, wall: 1};
const Z_TAGS = {open: 0, torus: 1};

/** @type {any} */
let wasmExports = null;
/** @type {Promise<any> | null} */
let initPromise = null;
/** @type {Set<{_refreshViews: () => void}>} */
const viewOwners = new Set();

/** @param {string} url */
async function loadWasmBytes(url) {
    const dataUri = DATA_URI_RE.exec(url);
    if (dataUri) {
        const binary = atob(dataUri[1]);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }
    return (await fetch(url)).arrayBuffer();
}

/** Initialize only the HCP Wasm artifact. Concurrent calls share one promise. */
export async function initHcpEngine() {
    if (wasmExports) return;
    if (!initPromise) {
        initPromise = (async () => {
            const bytes = await loadWasmBytes(wasmUrl);
            wasmExports = initSync({module: await WebAssembly.compile(bytes)});
        })();
    }
    await initPromise;
}

export function hcpEngineVersion() {
    if (!wasmExports) throw new Error('hcpEngineVersion: await initHcpEngine() first.');
    return wasmHcpEngineVersion();
}

export function hcpSiteXyz(col, row, layer, hexSize = 1) {
    if (!wasmExports) throw new Error('hcpSiteXyz: await initHcpEngine() first.');
    return Array.from(wasmHcpSiteXyz(col, row, layer, hexSize));
}

function refreshAllViews() {
    for (const owner of viewOwners) owner._refreshViews();
}

function refreshViewsAfterAllocation(previousBuffer, owner) {
    if (wasmExports.memory.buffer !== previousBuffer) refreshAllViews();
    else owner._refreshViews();
}

/** @template T @param {() => T} fn */
function rethrowAsError(fn) {
    try {
        return fn();
    } catch (cause) {
        if (cause instanceof Error) throw cause;
        throw new Error(String(cause));
    }
}

/** @param {number} states @param {number} max @param {string} label */
function assertStates(states, max, label) {
    if (!Number.isInteger(states) || states < 2 || states > max) {
        throw new RangeError(`${label}: states must be an integer in 2..${max}, received ${states}.`);
    }
}

/**
 * Pack one tet as the engine stores it: `a | b<<8 | c<<16 | apex<<24`.
 * @param {ArrayLike<number>} tet
 */
export function packTet(tet) {
    return (tet[0] & 0xff) | ((tet[1] & 0xff) << 8) | ((tet[2] & 0xff) << 16) | ((tet[3] & 0xff) << 24);
}

/** @param {number} packed @returns {number[]} */
export function unpackTet(packed) {
    return [packed & 0xff, (packed >>> 8) & 0xff, (packed >>> 16) & 0xff, (packed >>> 24) & 0xff];
}

/**
 * Build the `k^4` rule. `fn` sees geometric order: `[face0, face1, face2, apex=down]`.
 * @param {number} states
 * @param {(tet: number[]) => ArrayLike<number>} fn
 * @returns {Uint32Array}
 */
export function blockRuleFromTet(states, fn) {
    assertStates(states, MAX_BLOCK_STATES, 'blockRuleFromTet');
    if (typeof fn !== 'function') throw new TypeError('blockRuleFromTet: fn must be a function.');

    const k = states;
    const rule = new Uint32Array(k ** 4);
    let index = 0;
    for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
            for (let c = 0; c < k; c++) {
                for (let d = 0; d < k; d++) {
                    const out = fn([a, b, c, d]);
                    if (!out || out.length !== 4) {
                        throw new TypeError(
                            `blockRuleFromTet: fn must return a 4-entry tet for [${a}, ${b}, ${c}, ${d}].`,
                        );
                    }
                    for (let v = 0; v < 4; v++) {
                        const value = out[v];
                        if (!Number.isInteger(value) || value < 0 || value >= k) {
                            throw new RangeError(
                                `blockRuleFromTet: fn returned ${value} at slot ${v}, which is not a state below k = ${k}.`,
                            );
                        }
                    }
                    rule[index] = packTet(out);
                    index++;
                }
            }
        }
    }
    return rule;
}

/** @param {number} states @param {ArrayLike<number>} rule @param {string} label */
function assertTetRule(states, rule, label) {
    assertStates(states, MAX_BLOCK_STATES, label);
    const size = states ** 4;
    if (!rule || rule.length !== size) {
        throw new RangeError(`${label}: expected a k^4 = ${size} entry tet rule.`);
    }
}

function decodeIndex(states, index) {
    const k = states;
    const d = index % k;
    const c = Math.floor(index / k) % k;
    const b = Math.floor(index / (k * k)) % k;
    const a = Math.floor(index / (k * k * k));
    return [a, b, c, d];
}

/**
 * Multiset conservation over every `k^4` entry. Reported, never enforced.
 * @param {number} states
 * @param {ArrayLike<number>} rule
 */
export function isConservative(states, rule) {
    assertTetRule(states, rule, 'isConservative');
    const ascending = (a, b) => a - b;
    for (let index = 0; index < rule.length; index++) {
        const input = decodeIndex(states, index).sort(ascending);
        const output = unpackTet(rule[index]).sort(ascending);
        if (input.some((value, slot) => value !== output[slot])) return false;
    }
    return true;
}

/**
 * 3-fold isotropy about z: cycling the three face slots. Gravity rules fail this on purpose.
 * @param {number} states
 * @param {ArrayLike<number>} rule
 */
export function isIsotropic(states, rule) {
    assertTetRule(states, rule, 'isIsotropic');
    const rotate = (tet) => [tet[2], tet[0], tet[1], tet[3]];
    const k = states;
    const packIndex = (tet) => ((tet[0] * k + tet[1]) * k + tet[2]) * k + tet[3];
    for (let index = 0; index < rule.length; index++) {
        const rotatedInput = packIndex(rotate(decodeIndex(states, index)));
        const rotatedOutput = packTet(rotate(unpackTet(rule[index])));
        if (rule[rotatedInput] !== rotatedOutput) return false;
    }
    return true;
}

/**
 * A k-state CA on the hexagonal close-packed lattice.
 *
 * Headless and DOM-free. `state` is a live `Uint8Array` view into Wasm memory.
 */
export class HexHcp {
    /**
     * @param {object} options
     * @param {number} options.states
     * @param {number} options.layers
     * @param {number} options.rows
     * @param {number} options.columns
     * @param {ArrayLike<number>} [options.rule]
     * @param {ArrayLike<number>} [options.cells]
     * @param {'hcp'} [options.stacking]
     * @param {'torus'|'wall'} [options.xyBoundary]
     * @param {'open'|'torus'} [options.zBoundary]
     * @param {number} [options.speed]
     */
    constructor({
        states,
        layers,
        rows,
        columns,
        rule = null,
        cells = null,
        stacking = 'hcp',
        xyBoundary = 'torus',
        zBoundary = 'open',
        speed = 10,
    }) {
        if (!(stacking in STACKING_TAGS)) {
            throw new RangeError(`HexHcp: stacking must be 'hcp' in v1, received '${stacking}'.`);
        }
        if (!(xyBoundary in XY_TAGS)) {
            throw new RangeError(`HexHcp: xyBoundary must be 'torus' or 'wall', received '${xyBoundary}'.`);
        }
        if (!(zBoundary in Z_TAGS)) {
            throw new RangeError(`HexHcp: zBoundary must be 'open' or 'torus', received '${zBoundary}'.`);
        }
        assertStates(states, MAX_BLOCK_STATES, 'HexHcp');
        if (!Number.isInteger(layers) || !Number.isInteger(rows) || !Number.isInteger(columns)) {
            throw new RangeError('HexHcp: layers, rows and columns must be integers.');
        }
        if (!wasmExports) {
            throw new Error('HexHcp: await initHcpEngine() first.');
        }

        this.states = states;
        this.layers = layers;
        this.rows = rows;
        this.columns = columns;
        this.numCells = layers * rows * columns;
        this.stacking = stacking;
        this.xyBoundary = xyBoundary;
        this.zBoundary = zBoundary;
        this.speed = speed;
        this._accumulator = 0;
        this._wasm = wasmExports;

        const previousBuffer = this._wasm.memory.buffer;
        this.world = rethrowAsError(() => new WorldHcp(
            layers,
            rows,
            columns,
            states,
            STACKING_TAGS[stacking],
            XY_TAGS[xyBoundary],
            Z_TAGS[zBoundary],
        ));
        viewOwners.add(this);
        refreshViewsAfterAllocation(previousBuffer, this);

        if (rule) this.setRule(rule);
        if (cells) this.setCells(cells);
    }

    _refreshViews() {
        if (!this.world) return;
        const mem = this._wasm.memory.buffer;
        this.state = new Uint8Array(mem, this.world.state_ptr(), this.numCells);
        this._census = new Uint32Array(mem, this.world.census_ptr(), this.states);
        this._layerScratch = new Uint32Array(mem, this.world.layer_scratch_ptr(), this.states);
    }

    _assertLive() {
        if (!this.world) throw new Error('HexHcp: this world has been disposed.');
    }

    get ruleLength() {
        return this.world.rule_len();
    }

    /** @param {ArrayLike<number>} rule */
    setRule(rule) {
        this._assertLive();
        const previousBuffer = this._wasm.memory.buffer;
        rethrowAsError(() => {
            this.world.set_block_rule(rule instanceof Uint32Array ? rule : Uint32Array.from(rule));
        });
        if (this._wasm.memory.buffer !== previousBuffer) refreshAllViews();
    }

    /** @param {ArrayLike<number>} cells */
    setCells(cells) {
        this._assertLive();
        const previousBuffer = this._wasm.memory.buffer;
        rethrowAsError(() => {
            this.world.set_cells(cells instanceof Uint8Array ? cells : Uint8Array.from(cells));
        });
        if (this._wasm.memory.buffer !== previousBuffer) refreshAllViews();
    }

    /** @param {number} index @param {number} value */
    setCell(index, value) {
        this._assertLive();
        rethrowAsError(() => this.world.set_cell(index, value));
    }

    /** @param {number} value */
    fill(value) {
        this._assertLive();
        rethrowAsError(() => this.world.fill(value));
    }

    /**
     * @param {number} layer
     * @param {ArrayLike<number>} indices
     * @param {number} from
     * @param {number} to
     */
    paintIf(layer, indices, from, to) {
        this._assertLive();
        return rethrowAsError(() => this.world.paint_if(
            layer,
            indices instanceof Uint32Array ? indices : Uint32Array.from(indices),
            from,
            to,
        ));
    }

    /**
     * @param {number} layer
     * @param {number} mask
     * @returns {Uint32Array}
     */
    clearStatesInLayer(layer, mask) {
        this._assertLive();
        rethrowAsError(() => this.world.clear_states_in_layer(layer, mask));
        return Uint32Array.from(this._layerScratch);
    }

    /**
     * @param {number} layer
     * @returns {Uint32Array}
     */
    layerCensus(layer) {
        this._assertLive();
        rethrowAsError(() => this.world.layer_census(layer));
        return Uint32Array.from(this._layerScratch);
    }

    markAllDirty() {
        this._assertLive();
        this.world.mark_all_dirty();
    }

    /** @param {boolean} enabled */
    setSkippingEnabled(enabled) {
        this._assertLive();
        this.world.set_skipping_enabled(Boolean(enabled));
    }

    /** @param {boolean} alternates */
    setBlockAlternates(alternates) {
        this._assertLive();
        this.world.set_block_alternates(Boolean(alternates));
    }

    get blockAlternates() {
        return this.world ? this.world.block_alternates() : false;
    }

    /** @param {number} [count=1] */
    tick(count = 1) {
        this._assertLive();
        const ticks = Math.max(0, Math.floor(count));
        return ticks > 0 ? this.world.run_ticks(ticks) : 0;
    }

    /** @param {number} dtMs */
    advance(dtMs) {
        if (this.speed <= 0) return 0;
        this._accumulator += (dtMs / 1000) * this.speed;
        let ticks = Math.floor(this._accumulator);
        if (ticks <= 0) return 0;
        if (ticks > MAX_TICKS_PER_FRAME) {
            ticks = MAX_TICKS_PER_FRAME;
            this._accumulator = 0;
        } else {
            this._accumulator -= ticks;
        }
        this.tick(ticks);
        return ticks;
    }

    get generation() {
        return Number(this.world.tick_count());
    }

    /** @param {number|bigint} count */
    setGeneration(count) {
        this._assertLive();
        const value = typeof count === 'bigint' ? count : BigInt(Math.max(0, Math.floor(Number(count)) || 0));
        this.world.set_tick_count(value);
    }

    get phase() {
        return this.world.phase();
    }

    get lastChangedCount() {
        return this.world.last_changed_count();
    }

    get isSettled() {
        return this.world.is_settled();
    }

    get chunkActivity() {
        return {active: this.world.active_chunk_count(), total: this.world.chunk_count()};
    }

    census() {
        this._assertLive();
        this.world.compute_census();
        return Uint32Array.from(this._census);
    }

    checksum() {
        this._assertLive();
        return this.world.checksum_state();
    }

    /** @param {number} cell @param {number} direction */
    neighborOf(cell, direction) {
        this._assertLive();
        return this.world.neighbor_of(cell, direction);
    }

    dispose() {
        if (!this.world) return;
        viewOwners.delete(this);
        this.world.free();
        this.world = null;
        this.state = null;
        this._census = null;
        this._layerScratch = null;
    }
}
