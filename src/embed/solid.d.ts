export const INTERPOLATE_NONE: 'none'
export const INTERPOLATE_BRIDGE: 'bridge'
export const INTERPOLATE_UNION: 'union'

export const KEEP_ALL: 'all'
export const KEEP_LARGEST: 'largest'
export const KEEP_PLATE_CONNECTED: 'plate-connected'

export const FORMAT_STL: 'stl'
export const FORMAT_PLY: 'ply'
export const FORMAT_3MF: '3mf'

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
  /** Linear index of `cell`'s neighbor in canonical `direction` 0..5. Geometry, not a data path. */
  neighborOf(cell: number, direction: number): number
  /** Mandatory: releases the isolated Wasm buffers. */
  free(): void
}

/** Create a stack for a run of `ticks` ticks over a `rows × cols` grid. */
export function createSolidStack(options: SolidStackOptions): SolidStack
