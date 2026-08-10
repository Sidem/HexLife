/* tslint:disable */
/* eslint-disable */

/**
 * Phase-1 allocation and loader shell. It owns the final-size visible state and canonical neighbor
 * table, but deliberately has no transition backend: `tick` does not exist until Phase 2 installs
 * the compiled neighborhood kernel. This keeps Phase 1 focused on the artifact/RNG boundary.
 */
export class WorldStochastic {
    free(): void;
    [Symbol.dispose](): void;
    columns(): number;
    generation(): bigint;
    neighbor_indices_ptr(): number;
    constructor(columns: number, rows: number, seed: bigint);
    num_cells(): number;
    rng_sample(cell_index: number, stream_id: number): number;
    rows(): number;
    seed(): bigint;
    state_ptr(): number;
}

/**
 * Counter-based Philox4x32-10 sample for one stochastic decision.
 *
 * Counter words are `[cell_index, stream_id, generation_lo, generation_hi]`; key words are the
 * low/high halves of `seed`. No mutable cursor exists, so skipping a cell or reordering rule rows
 * cannot shift any other cell's stream. The returned sample is counter word 0 after ten rounds.
 */
export function random_u32(seed: bigint, generation: bigint, cell_index: number, stream_id: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly random_u32: (a: bigint, b: bigint, c: number, d: number) => number;
    readonly __wbg_worldstochastic_free: (a: number, b: number) => void;
    readonly worldstochastic_new: (a: number, b: number, c: bigint) => [number, number, number];
    readonly worldstochastic_rows: (a: number) => number;
    readonly worldstochastic_columns: (a: number) => number;
    readonly worldstochastic_num_cells: (a: number) => number;
    readonly worldstochastic_seed: (a: number) => bigint;
    readonly worldstochastic_generation: (a: number) => bigint;
    readonly worldstochastic_state_ptr: (a: number) => number;
    readonly worldstochastic_neighbor_indices_ptr: (a: number) => number;
    readonly worldstochastic_rng_sample: (a: number, b: number, c: number) => [number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
