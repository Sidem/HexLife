export interface CellAssignment {
  index: number
  value: 0 | 1
}

export interface SimulationOptions {
  rulesetHex: string
  rows?: number
  columns?: number
  cols?: number
  density?: number
  seed?: number | null
  initialCells?: Uint8Array | null
}

export interface DensityStateOptions {
  rows: number
  columns: number
  /** Deterministic for every safe integer, including zero. */
  seed: number
  density?: number
}

export interface SparseStateOptions {
  rows: number
  columns: number
  /** Deterministic for every safe integer, including zero. */
  seed: number
  /** Fraction of the grid left live. Useful range for an inhabitable world: 1e-3 to 1e-2. */
  occupancy?: number
}

export interface HexLifeSimulation {
  readonly rows: number
  readonly cols: number
  readonly columns: number
  readonly numCells: number
  readonly generation: number
  readonly activeCount: number
  readonly lastChangedCount: number
  readonly isSettled: boolean
  setCells(edits: Iterable<CellAssignment>): number
  tick(count?: number): number
  /** Native `rule * 2 + state` packing for `@hexlife/embed/spacetime`. */
  packRenderLayer(): Uint8Array
  snapshotCells(): Uint8Array | null
  dispose(): void
}

export function createSimulation(options: SimulationOptions): Promise<HexLifeSimulation>
/** Create HexLife's canonical seeded density state without initializing Wasm. */
export function createDensityState(options: DensityStateOptions): Uint8Array
/**
 * Create the canonical seeded sparse structured state without initializing Wasm: empty space with
 * small connected structures placed in it. Exactly `round(occupancy * rows * columns)` cells live.
 */
export function createSparseState(options: SparseStateOptions): Uint8Array
export function packCells(cells: ArrayLike<number>): Uint8Array
export function unpackCells(packed: Uint8Array, cellCount: number): Uint8Array
