export const STACKING_HCP: 0
export const XY_TORUS: 0
export const XY_WALL: 1
export const Z_OPEN: 0
export const Z_TORUS: 1
export const HCP_PALETTE_NONE: 0
export const HCP_PALETTE_RGB: 1
export const MAX_HCP_STATES: 16

export function hcpRuleBytes(states: number): number
export function isValidHcpGeometry(
  layers: number,
  rows: number,
  cols: number,
  states: number,
  stacking?: number,
  xyBoundary?: number,
  zBoundary?: number,
): boolean
export function isHcpCode(code: unknown): boolean

export interface HcpCodeInput {
  layers: number
  rows: number
  cols: number
  states: number
  rule: ArrayLike<number>
  cells: ArrayLike<number>
  stacking?: 'hcp' | number
  xyBoundary?: 'torus' | 'wall' | number
  zBoundary?: 'open' | 'torus' | number
  blockAlternates?: boolean
  generation?: number | bigint
  seed?: number | bigint
  palette?: Array<ArrayLike<number>>
  speed?: number
}

export interface DecodedHcpWorld {
  layers: number
  rows: number
  cols: number
  states: number
  stacking: 'hcp'
  xyBoundary: 'torus' | 'wall'
  zBoundary: 'open' | 'torus'
  blockAlternates: boolean
  generation: bigint
  seed: bigint
  speed: number
  rule: Uint32Array
  cells: Uint8Array
  palette: number[][] | null
}

export function encodeHcpCode(world: HcpCodeInput): Promise<string | null>
export function decodeHcpCode(code: string): Promise<DecodedHcpWorld | null>
