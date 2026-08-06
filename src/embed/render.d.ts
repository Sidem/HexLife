export interface RendererCellTarget {
  row: number
  column: number
  index: number
}

export interface RendererCamera {
  zoom: number
  panX: number
  panY: number
}

export interface RendererStats {
  draws: number
  stateUploads: number
  stateUploadBytes: number
  contextLosses: number
}

export interface RendererPaletteOptions {
  palette?: string
  customGradient?: {on: string[]; off: string[]} | null
  colorSettings?: object | null
  lut?: Uint8Array | null
  flickerProof?: boolean
  hueShift?: number | null
}

export interface RendererOptions extends RendererPaletteOptions {
  rows: number
  columns: number
  maxDpr?: number
  minZoom?: number
  maxZoom?: number
  zoom?: number
  repeatToroidal?: boolean
  onContextLost?: () => void
  onContextRestored?: () => void
}

export interface DraftPreviewCell {
  index: number
  value: 0 | 1
}

export class HexLifeRenderer {
  constructor(canvas: HTMLCanvasElement, options: RendererOptions)
  readonly canvas: HTMLCanvasElement
  readonly rows: number
  readonly columns: number
  readonly numCells: number
  readonly camera: RendererCamera
  readonly stats: RendererStats
  readonly contextLost: boolean
  resize(width?: number, height?: number): void
  setState(cells: Uint8Array, options?: {ruleIndices?: Uint8Array | null}): void
  setPalette(options: RendererPaletteOptions): void
  panBy(deltaX: number, deltaY: number): void
  setZoom(zoom: number, anchor?: {x: number; y: number} | null): void
  centerOnCell(target: number | Pick<RendererCellTarget, 'row' | 'column'>): void
  hitTest(cssX: number, cssY: number): RendererCellTarget | null
  setSelection(index: number | null): void
  setDraftPreview(edits: Iterable<DraftPreviewCell>): void
  draw(): void
  destroy(): void
}

export function createRenderer(canvas: HTMLCanvasElement, options: RendererOptions): HexLifeRenderer
