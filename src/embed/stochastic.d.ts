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

export const BACKEND_NEIGHBORHOOD: 'neighborhood'
export const BACKEND_LATTICE_GAS: 'lattice-gas'

export type StochasticBackend =
  | typeof BACKEND_NEIGHBORHOOD
  | typeof BACKEND_LATTICE_GAS

/** Visible states projected from the six velocity channels of a lattice-gas site. */
export const GAS_STATES: {
  readonly vacuum: 0
  readonly amber: 1
  readonly cyan: 2
  readonly mixed: 3
  readonly wall: 4
}

/** Species labels carried by an occupied velocity channel. */
export const GAS_SPECIES: {readonly empty: 0; readonly amber: 1; readonly cyan: 2}

/** Six outgoing channels, or a genuine symmetry choice between two of them. */
export type GasCollisionOutcome =
  | number[]
  | {primary: number[]; alternate?: number[]; probability?: number}

/**
 * The canonical two-species hexagonal collision operator: head-on pairs rotate ±60°, symmetric
 * triads rotate to the other triad, everything else streams through. Species-exact and sixfold
 * rotation-equivariant.
 */
export function hexGasCollide(channels: number[]): GasCollisionOutcome

export interface GasRuleInput {
  /** Runs once per packed configuration at compile time, never per cell per tick. */
  collide?: (channels: number[], configuration: number) => GasCollisionOutcome
  /** Optional thermal ±60° rotation after collision. Not momentum-conserving; 0 disables it. */
  scatter?: number
  rng?: StochasticRng
}

/** Compile a collision operator into canonical `HSG1` bytes. */
export function compileGasRule(input?: GasRuleInput): Uint8Array

/** Whether `rule` is a well-formed `HSG1` table that conserves both species for every entry. */
export function isConservativeGasRule(rule: ArrayLike<number>): boolean

export interface StochasticWorldOptions {
  rows: number
  /** Must be even so odd-q torus parity closes. */
  columns: number
  seed: bigint | number
  /** Defaults to the neighborhood backend. Chosen at construction so neither allocates the other's buffers. */
  backend?: StochasticBackend
  rule?: Uint8Array | null
  cells?: ArrayLike<number> | null
  elapsedAges?: ArrayLike<number> | null
  /** Lattice gas only: six species values per cell in canonical direction order. */
  channels?: ArrayLike<number> | null
  /** Lattice gas only: reflecting sites. A closed rim is what makes the toroidal lattice finite. */
  walls?: ArrayLike<number> | null
}

/** Dense, allocation-free stochastic-neighborhood runtime. */
export declare class StochasticWorld {
  constructor(options: StochasticWorldOptions)
  readonly backend: StochasticBackend
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
  /** Off forces the dense reference path. Both paths produce identical results every tick. */
  setSkippingEnabled(enabled: boolean): void
  readonly skippingEnabled: boolean
  /** Chunks recomputed during the last tick, out of {@link chunkCount}. */
  activeChunkCount(): number
  chunkCount(): number
  /** Clamp stored epochs to the saturating age horizon; ticking already does this automatically. */
  rebaseEpochs(): void

  // ---- Lattice-gas backend only ----
  /** Replace the exact generation-zero channels and walls, and the reset snapshot. */
  setInitialGasState(channels: ArrayLike<number> | null, walls?: ArrayLike<number> | null): void
  /** Intervention-only bulk replacement at the current generation. */
  setGasCells(channels: ArrayLike<number> | null, walls?: ArrayLike<number> | null): void
  /** Open or close one barrier site. Sealing a site discards any particles standing on it. */
  setWall(index: number, isWall: boolean): void
  /** Exact particle total for one species (1 = amber, 2 = cyan), conserved by every legal table. */
  speciesCount(species: number): number
  /** Sites the collision table rewrote on the last tick. */
  collisionCount(): number
  /** Six species values per cell, for export or debugging only. */
  snapshotChannels(): Uint8Array
  snapshotWalls(): Uint8Array
  census(): Uint32Array
  /** Cumulative firings per canonical compiled row. */
  transitionCounts(): Uint32Array
  /** Visible-state disagreements, compared inside Wasm with no grid snapshots or host scan. */
  differenceCount(other: StochasticWorld): number
  checksum(): number
  auxiliaryChecksum(): number
  snapshotCells(): Uint8Array | null
  snapshotElapsedAges(): Uint16Array
  dispose(): void
}
