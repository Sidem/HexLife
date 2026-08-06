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

export interface HexLifeSimulation {
  readonly rows: number
  readonly cols: number
  readonly columns: number
  readonly numCells: number
  readonly generation: number
  readonly activeCount: number
  setCells(edits: Iterable<CellAssignment>): number
  tick(count?: number): number
  snapshotCells(): Uint8Array | null
  dispose(): void
}

export function createSimulation(options: SimulationOptions): Promise<HexLifeSimulation>
/** Create HexLife's canonical seeded density state without initializing Wasm. */
export function createDensityState(options: DensityStateOptions): Uint8Array
export function packCells(cells: ArrayLike<number>): Uint8Array
export function unpackCells(packed: Uint8Array, cellCount: number): Uint8Array
