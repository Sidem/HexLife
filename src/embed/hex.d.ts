export interface AxialCoordinate {
  q: number
  r: number
}

export interface CubeCoordinate extends AxialCoordinate {
  s: number
}

export interface PixelPoint {
  x: number
  y: number
}

export type HexDirection = 0 | 1 | 2 | 3 | 4 | 5
export type HexDirectionName =
  | 'east'
  | 'southeast'
  | 'southwest'
  | 'west'
  | 'northwest'
  | 'northeast'

export interface HexDirectionDefinition extends AxialCoordinate {
  readonly index: HexDirection
  readonly name: HexDirectionName
}

export interface ChunkAddress {
  chunkQ: number
  chunkR: number
  localQ: number
  localR: number
}

/** Clockwise in screen space (+Y down): E, SE, SW, W, NW, NE. */
export const HEX_DIRECTIONS: readonly [
  HexDirectionDefinition,
  HexDirectionDefinition,
  HexDirectionDefinition,
  HexDirectionDefinition,
  HexDirectionDefinition,
  HexDirectionDefinition,
]

export function normalizeHexDirection(direction: number): HexDirection
export function directionVector(direction: number): AxialCoordinate
export function rotateHexDirection(direction: number, clockwiseSteps?: number): HexDirection
export function axialNeighbor(
  coordinate: AxialCoordinate,
  direction: number,
  distance?: number,
): AxialCoordinate
export function rotateAxial(
  coordinate: AxialCoordinate,
  clockwiseSteps: number,
  center?: AxialCoordinate,
): AxialCoordinate
export function axialToCube(coordinate: AxialCoordinate): CubeCoordinate
export function cubeToAxial(coordinate: CubeCoordinate): AxialCoordinate
export function axialDistance(from: AxialCoordinate, to: AxialCoordinate): number
/** Largest-error correction; exact ties prefer q, then r, then s. */
export function roundCube(coordinate: CubeCoordinate): CubeCoordinate
export function roundAxial(coordinate: AxialCoordinate): AxialCoordinate
/** Pointy-top conversion; size is the hex circumradius and origin defaults to (0, 0). */
export function axialToPixel(
  coordinate: AxialCoordinate,
  size: number,
  origin?: PixelPoint,
): PixelPoint
export function pixelToFractionalAxial(
  point: PixelPoint,
  size: number,
  origin?: PixelPoint,
): AxialCoordinate
export function pixelToAxial(
  point: PixelPoint,
  size: number,
  origin?: PixelPoint,
): AxialCoordinate
export function axialLine(from: AxialCoordinate, to: AxialCoordinate): AxialCoordinate[]
/** Floor-based chunk mapping. Local coordinates are always in [0, chunkSize). */
export function axialToChunk(coordinate: AxialCoordinate, chunkSize: number): ChunkAddress
export function chunkToAxial(address: ChunkAddress, chunkSize: number): AxialCoordinate
