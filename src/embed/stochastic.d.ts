/** Reproducibility version for the Philox tuple-to-counter mapping. */
export const STOCHASTIC_RNG_VERSION: 1

/** Initialize only the separately distributed stochastic Wasm artifact. */
export function initStochasticEngine(): Promise<void>

/** Stable Philox4x32-10 sample for `(seed, generation, cellIndex, streamId)`. */
export function randomU32(
  seed: bigint | number,
  generation: bigint | number,
  cellIndex: number,
  streamId: number,
): number

export interface StochasticWorldOptions {
  rows: number
  /** Must be even so odd-q torus parity closes. */
  columns: number
  seed: bigint | number
}

/**
 * Phase-1 allocation shell. Transition rules and `tick()` arrive with the neighborhood backend;
 * this surface currently pins artifact isolation, geometry, memory views, and counter RNG.
 */
export declare class StochasticWorld {
  constructor(options: StochasticWorldOptions)
  readonly rows: number
  readonly columns: number
  readonly numCells: number
  readonly seed: bigint
  readonly generation: bigint
  /** Live view into the isolated stochastic Wasm memory; null after disposal. */
  readonly state: Uint8Array | null
  sample(cellIndex: number, streamId: number): number
  dispose(): void
}
