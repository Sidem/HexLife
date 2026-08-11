export const INTERPOLATE_NONE: 'none'
export const INTERPOLATE_BRIDGE: 'bridge'
export const INTERPOLATE_UNION: 'union'

export const KEEP_ALL: 'all'
export const KEEP_LARGEST: 'largest'
export const KEEP_PLATE_CONNECTED: 'plate-connected'

export const FORMAT_STL: 'stl'
export const FORMAT_PLY: 'ply'
export const FORMAT_3MF: '3mf'

export const MERGE_NONE: 'none'
export const MERGE_GREEDY: 'greedy'

export type SolidMerge = typeof MERGE_NONE | typeof MERGE_GREEDY

export interface SolidExportOptions {
  /** Defaults to `'stl'`. */
  format?: SolidFormat
  /** Hexagon circumradius in millimetres. Defaults to 2. */
  cellSize?: number
  /** Thickness of one layer in millimetres. Defaults to 0.8. */
  layerHeight?: number
  /**
   * Defaults to `'greedy'`, which is worth well over an order of magnitude in triangles. Use
   * `'none'` if a strict manifold validator objects to the T-junctions merging creates; both
   * meshes bound exactly the same solid, and slicers do not care.
   */
  merge?: SolidMerge
}

/** State 1 is matter, state 0 is void — the mask for a binary `World` or `<hexlife-world>`. */
export const SOLID_STATES_BINARY: 2

/**
 * How consecutive ingested layers are welded together.
 *
 * `bridge` converts diagonal space-time contact into face contact so the object holds together;
 * `union` also fattens it; `none` extrudes the raw layers and is what you want when you are
 * measuring what the interpolation is worth.
 */
export type SolidInterpolate =
  | typeof INTERPOLATE_NONE
  | typeof INTERPOLATE_BRIDGE
  | typeof INTERPOLATE_UNION

export type SolidKeepComponents =
  | typeof KEEP_ALL
  | typeof KEEP_LARGEST
  | typeof KEEP_PLATE_CONNECTED

export type SolidFormat = typeof FORMAT_STL | typeof FORMAT_PLY | typeof FORMAT_3MF

export interface SolidStackOptions {
  rows: number
  /** Must be even: the odd-q torus does not close otherwise. */
  cols: number
  /** Layers ingested from the host, one per `pushLayer()`. */
  ticks: number
  /** Bitmask over cell state values; bit `s` means state `s` is matter. Defaults to binary. */
  solidStates?: number
  /** Defaults to `'bridge'`. */
  interpolate?: SolidInterpolate
  /** Synthesized layers between ingested ones. Defaults to 1; forced to 0 by `'none'`. */
  subLayers?: number
  /**
   * Solid grid layers prepended below tick 0, which is what makes `'plate-connected'` mean
   * "reachable from the build surface". A construction option because it changes the height of
   * the volume, and the volume is allocated exactly once.
   */
  basePlate?: number
}

/** Initialize only the separately distributed solid Wasm artifact. */
export function initSolidEngine(): Promise<void>

/** Version of the volume layout, mesh, and serialized bytes. */
export function solidEngineVersion(): number

/**
 * Bytes of linear memory the solid artifact holds. Wasm memory never shrinks, so after a run this
 * is that run's peak. Counts this artifact alone — the engine being extruded has its own.
 */
export function solidMemoryBytes(): number

/**
 * What `finalize()` found. A slicer will not join separate bodies, so this is the difference
 * between "prints as one piece" and "prints as thirty-seven".
 */
export interface SolidReport {
  /** Components in the welded volume, before the retention policy. */
  componentCount: number
  /** Components that survived it. One means a single printable object. */
  keptComponents: number
  keptVoxels: number
  droppedVoxels: number
  /** Components that never reach layer 0 — the pieces that would print loose. */
  floating: number
}

export interface SolidFinalizeOptions {
  /** Defaults to `'all'`. */
  keepComponents?: SolidKeepComponents
}

/** A stack under construction: geometry fixed, layers accumulating. */
export class SolidStack {
  constructor(options: SolidStackOptions)
  readonly rows: number
  readonly cols: number
  readonly numCells: number
  readonly ticks: number
  readonly basePlate: number
  readonly solidStates: number
  readonly interpolate: SolidInterpolate
  readonly subLayers: number
  /** Height of the finished volume in layers, base plate included. */
  readonly totalLayers: number
  /** Bytes the bit-packed volume occupies. */
  readonly volumeBytes: number
  readonly pushedLayers: number
  readonly isFinalized: boolean
  /**
   * The staging layer, as a view into Wasm memory. Build it once, outside the tick loop, and
   * `set()` into it each tick — that copy is the only data movement this pipeline allows.
   */
  layerView(): Uint8Array
  /** Ingest the staging layer as the next tick. */
  pushLayer(): void
  /** Weld, label components, apply the policy, and report. */
  finalize(options?: SolidFinalizeOptions): SolidReport
  /**
   * Linear index of `cell`'s neighbor in canonical `direction` 0..5, or `-1` where that direction
   * leaves the grid: the printed object has an open boundary even though the simulation is
   * toroidal. Geometry accessor, not a data path.
   */
  neighborOf(cell: number, direction: number): number
  /** Whether the voxel at `(cell, layer)` is solid. For inspecting a fixture. */
  voxelAt(cell: number, layer: number): boolean
  /** FNV-1a over the packed volume. */
  volumeChecksum(): number
  /** Triangles in the last built mesh. */
  readonly triangleCount: number
  /** Welded vertices in the last built mesh. */
  readonly vertexCount: number
  /**
   * Triangles belonging to a top or bottom cap. Merging welds lateral walls and leaves caps alone,
   * so this says whether cap merging would buy anything on a given object.
   */
  readonly capTriangleCount: number
  /**
   * Mesh the finalized volume and serialize it. Async because the 3MF container is deflated by
   * `CompressionStream` — the only stage JavaScript owns, and only because it is not per-voxel.
   */
  export(options?: SolidExportOptions): Promise<Uint8Array>
  /** Mandatory: releases the isolated Wasm buffers. */
  free(): void
}

/** Create a stack for a run of `ticks` ticks over a `rows × cols` grid. */
export function createSolidStack(options: SolidStackOptions): SolidStack
