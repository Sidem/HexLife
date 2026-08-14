/**
 * `@hexlife/embed/hcp` — a general k-state CA on the hexagonal close-packed lattice.
 *
 * A fourth isolated Wasm artifact. Root, `/sim`, `/ca`, `/stochastic`, `/solid` and `/spacetime`
 * never import this module.
 */

export {
  decodeHcpCode,
  encodeHcpCode,
  isHcpCode,
  isValidHcpGeometry,
  HCP_PALETTE_NONE,
  HCP_PALETTE_RGB,
  MAX_HCP_STATES,
  STACKING_HCP,
  XY_TORUS,
  XY_WALL,
  Z_OPEN,
  Z_TORUS,
} from '../core/HcpCodec.js'
export type {DecodedHcpWorld, HcpCodeInput} from '../core/HcpCodec.js'

export const BLOCK_PHASES: 6
export const MAX_BLOCK_STATES: 16

export function initHcpEngine(): Promise<void>
export function hcpEngineVersion(): number
export function hcpSiteXyz(col: number, row: number, layer: number, hexSize?: number): number[]

export function sitePosition(
  col: number,
  row: number,
  layer: number,
  hexSize?: number,
): {x: number; y: number; z: number}
export function indexFromCoords(
  layer: number,
  row: number,
  col: number,
  rows: number,
  cols: number,
): number
export function coordsFromIndex(
  index: number,
  rows: number,
  cols: number,
): {layer: number; row: number; col: number}

export function packTet(tet: ArrayLike<number>): number
export function unpackTet(packed: number): number[]
export function blockRuleFromTet(
  states: number,
  fn: (tet: number[]) => ArrayLike<number>,
): Uint32Array
export function isConservative(states: number, rule: ArrayLike<number>): boolean
export function isIsotropic(states: number, rule: ArrayLike<number>): boolean

export interface HexHcpOptions {
  states: number
  layers: number
  rows: number
  columns: number
  rule?: ArrayLike<number> | null
  cells?: ArrayLike<number> | null
  stacking?: 'hcp'
  xyBoundary?: 'torus' | 'wall'
  zBoundary?: 'open' | 'torus'
  speed?: number
}

export interface ChunkActivity {
  active: number
  total: number
}

export declare class HexHcp {
  constructor(options: HexHcpOptions)
  readonly states: number
  readonly layers: number
  readonly rows: number
  readonly columns: number
  readonly numCells: number
  readonly stacking: 'hcp'
  readonly xyBoundary: 'torus' | 'wall'
  readonly zBoundary: 'open' | 'torus'
  readonly state: Uint8Array | null
  speed: number
  readonly ruleLength: number
  readonly generation: number
  readonly phase: number
  readonly lastChangedCount: number
  readonly isSettled: boolean
  readonly blockAlternates: boolean
  readonly chunkActivity: ChunkActivity
  setRule(rule: ArrayLike<number>): void
  setCells(cells: ArrayLike<number>): void
  setCell(index: number, value: number): void
  fill(value: number): void
  paintIf(layer: number, indices: ArrayLike<number>, from: number, to: number): number
  clearStatesInLayer(layer: number, mask: number): Uint32Array
  layerCensus(layer: number): Uint32Array
  markAllDirty(): void
  setSkippingEnabled(enabled: boolean): void
  setBlockAlternates(alternates: boolean): void
  setGeneration(count: number): void
  tick(count?: number): number
  advance(dtMs: number): number
  census(): Uint32Array
  checksum(): number
  neighborOf(cell: number, direction: number): number
  dispose(): void
}
