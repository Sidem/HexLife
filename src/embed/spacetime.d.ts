export interface SpacetimePaletteOptions {
  palette?: string
  customGradient?: {on: string[]; off: string[]} | null
  colorSettings?: object | null
  lut?: Uint8Array | null
  flickerProof?: boolean
  hueShift?: number | null
}

export interface SpacetimeMarchOptions {
  /** 0 draws an opaque solid (first hit wins); above 0 accumulates front-to-back at this alpha. */
  layerAlpha?: number
  /** Longest lateral distance one march step may cover, in hex radii. 0 is a pure slab march. */
  maxLateralStepHexRadii?: number
  /** Hard cap on march steps per ray. */
  maxSteps?: number
}

export interface SpacetimeCamera {
  /** Radians. Wraps. */
  yaw: number
  /** Radians. Wraps through the poles without flipping. */
  pitch: number
  /** Clamped to the object's framing range. */
  distance: number
}

export interface SpacetimeStats {
  draws: number
  layersPushed: number
  backfills: number
  layers: number
  depth: number
  /** Texture uploads since the volume was created — enough to check a "no re-upload" claim. */
  uploads: number
  textureBytes: number
}

export interface SpacetimeOptions extends SpacetimePaletteOptions, SpacetimeMarchOptions {
  rows: number
  columns?: number
  cols?: number
  /** Layers retained. Clamped to the device's MAX_ARRAY_TEXTURE_LAYERS, which may be as low as 256. */
  depth?: number
  /** Cap on devicePixelRatio. The march is pure fragment work, so this is the main cost dial. */
  maxDpr?: number
  /** `'#rrggbb'`, `[r,g,b,a]` in 0–1, or null / `'transparent'` for a see-through canvas. */
  background?: string | number[] | null
  /** Drag-to-orbit and wheel-to-dolly on the canvas. Default true. */
  controls?: boolean
  camera?: Partial<SpacetimeCamera>
  onCameraChange?: (camera: SpacetimeCamera) => void
  onContextLost?: () => void
  /** The volume comes back empty: re-feed it here. */
  onContextRestored?: () => void
}

export interface SpacetimeGeometry {
  hexSize: number
  layerHeight: number
  boxMin: number[]
  boxMax: number[]
  gridCenter: number[]
}

export class HexLifeSpacetime {
  constructor(canvas: HTMLCanvasElement, options: SpacetimeOptions)
  readonly canvas: HTMLCanvasElement
  readonly rows: number
  readonly columns: number
  readonly numCells: number
  /** Layers granted after the device clamp. */
  readonly depth: number
  readonly maxLayers: number
  readonly layerCount: number
  readonly tipTick: number
  readonly camera: SpacetimeCamera
  readonly crossSection: number
  readonly contextLost: boolean
  readonly stats: SpacetimeStats

  pushLayer(layer: Uint8Array | ArrayBuffer, tick?: number): boolean
  pushState(cells: Uint8Array, options?: {ruleIndices?: Uint8Array | null; tick?: number}): boolean
  pushSimulation(
    sim: {readonly numCells: number; readonly generation?: number; packRenderLayer(): Uint8Array},
    tick?: number,
  ): boolean
  setHistory(
    generations: Uint8Array | Iterable<Uint8Array>,
    options?: {ruleIndices?: Uint8Array[] | null; count?: number},
  ): number
  truncate(length: number): number
  reset(): void

  setCrossSection(layer: number | null): void
  setScrub(position: {offset?: number; isScrubbing?: boolean}): void

  setPalette(options: SpacetimePaletteOptions): void
  setOptions(options: SpacetimeMarchOptions): void
  getOptions(): SpacetimeMarchOptions
  getLut(): Uint8Array | null

  orbit(deltaYaw: number, deltaPitch: number): void
  dolly(factor: number): void
  setCamera(camera: Partial<SpacetimeCamera>): void
  resetCamera(): void
  attachControls(): void
  detachControls(): void

  resize(width?: number, height?: number): void
  draw(): boolean
  destroy(): void
}

export function createSpacetimeView(
  canvas: HTMLCanvasElement,
  options: SpacetimeOptions,
): HexLifeSpacetime

/** Layers requested when the host does not say. */
export const DEFAULT_DEPTH: number

/** The orbit framing the object is built for: field of view, near/far, and the dolly range. */
export const SPACETIME_CAMERA: Readonly<{
  fovY: number
  near: number
  far: number
  minDistance: number
  maxDistance: number
  yaw: number
  pitch: number
  distance: number
}>

/** The sampling the Explorer's measured frame time was measured at. */
export const SPACETIME_MARCH_DEFAULTS: Readonly<Required<SpacetimeMarchOptions>>

/** The object's extent in camera space, for a host that wants to reason about the framing. */
export function computeGeometry(
  cols: number,
  rows: number,
  depth: number,
  liveLayers?: number,
): SpacetimeGeometry
