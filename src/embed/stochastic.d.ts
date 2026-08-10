/** Reproducibility version for the Philox tuple-to-counter mapping. */
export const STOCHASTIC_RNG_VERSION: 1
export const MAX_STOCHASTIC_STATES: 16
export const RNG_PHILOX_V1: 'philox-v1'
export const RNG_LEGACY_DEMO_V0: 'legacy-demo-v0'

export type StochasticRng = typeof RNG_PHILOX_V1 | typeof RNG_LEGACY_DEMO_V0

export interface StochasticTransition {
  from: number
  to: number
  /** State whose six-direction match mask selects `probabilityByMask`; omit for spontaneous/timer rows. */
  neighborState?: number | null
  minAge?: number
  maxAge?: number
  /** Higher priorities run first. Equal priorities for one state are rejected as ambiguous. */
  priority?: number
  /** Defaults to true. State changes reset the epoch regardless. */
  resetAge?: boolean
  /** Scalar probability used for all masks; defaults to 1. */
  probability?: number
  /** Exactly 64 probabilities indexed by the canonical six-direction match mask. */
  probabilityByMask?: ArrayLike<number>
  /** Required for stochastic rows; stable string (FNV-1a) or explicit u32. */
  stream?: string | number
}

export interface StochasticRuleInput {
  states: number
  transitions: StochasticTransition[]
  /** Defaults to Philox v1. Legacy v0 exists only for exact migration of the frozen demos. */
  rng?: StochasticRng
}

/** Compile a bounded author object into canonical `HSN1` native rule bytes. */
export function compileStochasticRule(input: StochasticRuleInput): Uint8Array

/**
 * Build 64 independent-exposure probabilities from one chance or six canonical-direction chances.
 */
export function independentNeighborChance(chance: number | ArrayLike<number>): Float64Array

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
  rule?: Uint8Array | null
  cells?: ArrayLike<number> | null
  elapsedAges?: ArrayLike<number> | null
}

/** Dense, allocation-free stochastic-neighborhood runtime. */
export declare class StochasticWorld {
  constructor(options: StochasticWorldOptions)
  readonly rows: number
  readonly columns: number
  readonly numCells: number
  readonly seed: bigint
  readonly generation: bigint
  readonly states: number
  readonly lastChangedCount: number
  /** Live view into isolated stochastic Wasm memory; swaps after every tick and is null after disposal. */
  readonly state: Uint8Array | null

  /** Always samples the public Philox-v1 stream, independent of a rule's migration RNG tag. */
  sample(cellIndex: number, streamId: number): number
  setRule(rule: ArrayLike<number>): void
  setInitialState(cells: ArrayLike<number>, elapsedAges?: ArrayLike<number> | null): void
  /** Intervention-only bulk replacement; normal ticks never upload a grid. */
  setCells(cells: ArrayLike<number>, elapsedAges?: ArrayLike<number> | null): void
  setCell(index: number, value: number): void
  tick(count?: number): number
  reset(): void
  census(): Uint32Array
  /** Cumulative firings per canonical compiled row. */
  transitionCounts(): Uint32Array
  checksum(): number
  auxiliaryChecksum(): number
  snapshotCells(): Uint8Array | null
  snapshotElapsedAges(): Uint16Array
  dispose(): void
}
