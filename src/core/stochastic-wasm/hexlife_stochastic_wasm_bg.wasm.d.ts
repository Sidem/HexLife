/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const random_u32: (a: bigint, b: bigint, c: number, d: number) => number;
export const __wbg_worldstochastic_free: (a: number, b: number) => void;
export const worldstochastic_new: (a: number, b: number, c: bigint) => [number, number, number];
export const worldstochastic_rows: (a: number) => number;
export const worldstochastic_columns: (a: number) => number;
export const worldstochastic_num_cells: (a: number) => number;
export const worldstochastic_seed: (a: number) => bigint;
export const worldstochastic_generation: (a: number) => bigint;
export const worldstochastic_state_ptr: (a: number) => number;
export const worldstochastic_neighbor_indices_ptr: (a: number) => number;
export const worldstochastic_rng_sample: (a: number, b: number, c: number) => [number, number, number];
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_start: () => void;
