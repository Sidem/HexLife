/**
 * `@hexlife/embed/ca` — the k-state cellular automaton runtime.
 *
 * A second engine alongside the binary one, not a generalization of it: `<hexlife-world>`,
 * `@hexlife/embed/sim`, `HXW1` world codes and share links stay binary, and their determinism
 * contract is unaffected by anything here.
 */

/**
 * The `HXK1.` k-state world code, re-exported here because this is the DOM-free entry: a Node host
 * can validate a pasted code without loading the element. A **distinct prefix**, not an `HXW1`
 * version bump — `decodeWorldCode` rejects one of these on sight rather than half-reading it.
 */
export {
  backendTag,
  caRuleShape,
  decodeCaCode,
  encodeCaCode,
  isCaCode,
  isValidCaGeometry,
  CA_PALETTE_NONE,
  CA_PALETTE_RGB,
} from '../core/CaCodec.js'
export type {CaCodeInput, CaPaletteEntry, DecodedCaWorld} from '../core/CaCodec.js'

/** Which rule representation a world uses. */
export type CaBackend = 'neighborhood' | 'block'

/** State cap for `'neighborhood'`, whose table is `k^7` (16 KB at k=4, 273 KB at k=6). */
export const MAX_NEIGHBORHOOD_STATES: 6
/** State cap for `'block'`, whose table is `k^3` (4096 entries at k=16). */
export const MAX_BLOCK_STATES: 16
/** Phases the block partition cycles through. */
export const BLOCK_PHASES: 3

export interface HexCaOptions {
  /** `k`. Capped by the backend — see `MAX_NEIGHBORHOOD_STATES` / `MAX_BLOCK_STATES`. */
  states: number
  /**
   * Grid rows. **`'block'` requires a multiple of 3**, or the triangular partition has a seam at
   * the row wrap; construction throws rather than simulating something wrong. 64 is invalid there.
   */
  rows: number
  /** Grid columns. Must be even, so the column wrap preserves hex parity. */
  columns: number
  /** Defaults to `'neighborhood'`. */
  backend?: CaBackend
  /** From `ruleFromTable` (neighborhood) or `blockRuleFromTable` (block). */
  rule?: ArrayLike<number> | null
  /** The exact tick-0 grid, `rows * columns` entries in `0..states`. */
  cells?: ArrayLike<number> | null
  /** Target ticks/second for `advance()`. Defaults to 10. */
  speed?: number
}

/** Chunks recomputed on the last tick, out of the total — the measured pay-off of chunk skipping. */
export interface ChunkActivity {
  active: number
  total: number
}

export declare class HexCA {
  constructor(options: HexCaOptions)

  readonly states: number
  readonly rows: number
  readonly columns: number
  readonly numCells: number
  readonly backend: CaBackend
  /** Live view of the current generation's cells; may detach when anything else allocates. */
  readonly state: Uint8Array | null
  /** Target ticks/second for `advance()`. */
  speed: number

  /** Entries the rule table for this backend must have (`k^7` or `k^3`). */
  readonly ruleLength: number
  readonly generation: number
  /** The block-partition phase the next tick will use, in `0..BLOCK_PHASES`. */
  readonly phase: number
  readonly lastChangedCount: number
  /** True once the world has reached a fixed point it can never leave. */
  readonly isSettled: boolean
  readonly chunkActivity: ChunkActivity

  setRule(rule: ArrayLike<number>): void
  /** The supported bulk write: validates states and wakes the activity tracker. */
  setCells(cells: ArrayLike<number>): void
  setCell(index: number, value: number): void
  fill(value: number): void
  /** Only needed after writing through `state` directly; the mutators above do it for you. */
  markAllDirty(): void
  /** Results are identical either way; for benchmarking and for debugging a model. */
  setSkippingEnabled(enabled: boolean): void

  /** @returns cells that changed on the final tick. */
  tick(count?: number): number
  /** @returns ticks actually run. */
  advance(dtMs: number): number

  /** Per-state occupancy of the current generation. Under a conservative block rule it never moves. */
  census(): Uint32Array
  checksum(): number
  snapshotCells(): Uint8Array | null
  dispose(): void
}

/** Initialize the shared wasm engine. Idempotent, and the same instance `<hexlife-world>` uses. */
export function initEngine(): Promise<void>

/**
 * Materialize the dense anisotropic rule by calling `fn` once per `(centre, neighbours)`
 * combination — `k^7` times, at load. `neighbours` is in canonical neighbour order, so the rule can
 * depend on *which* neighbour holds what; that anisotropy is how you express gravity.
 */
export function ruleFromTable(
  states: number,
  fn: (centre: number, neighbours: number[]) => number,
): Uint8Array

/** Materialize the `k^3` block rule. `fn` maps an ordered block triple to its rewritten triple. */
export function blockRuleFromTable(
  states: number,
  fn: (block: number[]) => ArrayLike<number>,
): Uint16Array

export function unpackBlock(states: number, packed: number): number[]
export function packBlock(states: number, block: ArrayLike<number>): number

/**
 * Whether every block's output is a permutation of its input multiset, i.e. the rule conserves the
 * per-state census exactly. This is the property no radius-1 rule can have at any `k`, and the
 * reason the block backend exists. Reported, never enforced — reactions and sinks are legitimate.
 */
export function isConservative(states: number, blockRule: ArrayLike<number>): boolean

/**
 * Whether the rule is equivariant under rotating the block (a 120° rotation of the triangle), so it
 * cannot single out a direction. Worth checking deliberately: breaking it is how you get gravity,
 * and that should be a decision rather than an artefact of the vertex ordering.
 */
export function isIsotropic(states: number, blockRule: ArrayLike<number>): boolean
