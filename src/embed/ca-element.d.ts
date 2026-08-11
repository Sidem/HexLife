/**
 * Type declarations for `<hexlife-ca>` — the public API of `HexCAElement.js`, registered by
 * `@hexlife/embed/ca-element`.
 *
 * The k-state counterpart of `hexlife-world.d.ts`, and it carries the same obligation: **this file
 * is documentation with teeth and must match `docs/embed/ca.md`**, which is what consumers of the
 * published package actually read. Adding to the element's surface means editing the element, that
 * doc and this file together.
 *
 * `src/embed/` is plain JS (see the note atop `EmbedSim.js`), so this is the one place the element's
 * documented surface is written down in a form a compiler can enforce.
 *
 * Importing `@hexlife/embed/ca-element` is what *defines* the element — that side effect is the
 * module's whole job, and it is why the entry exists separately from the DOM-free
 * `@hexlife/embed/ca`. See `ca-element.js` for the full argument.
 */

import type {CaBackend, ChunkActivity, HexCA} from './ca.js'

export type {CaBackend, ChunkActivity, HexCA}

/** `[r, g, b]`, each channel 0–255. */
export type CaColor = [number, number, number]

/** `hexlife-ca-ready` detail: the world that just booted. */
export interface HexCaReadyDetail {
  states: number
  rows: number
  columns: number
  backend: CaBackend
  numCells: number
  /**
   * Whether a rule table is installed. False when the element booted without a `code` and nothing
   * has called `setRule` yet — such a world has an all-zero table and dies on tick one, which is a
   * legitimate starting point rather than an error.
   */
  hasRule: boolean
}

/** `hexlife-ca-playstate` detail. */
export interface HexCaPlayStateDetail {
  /** Whether the animation loop is running right now, after every gate. */
  playing: boolean
  /** Whether the *user* has paused, ignoring the viewport and visibility gates. */
  userPaused: boolean
}

/** `hexlife-ca-settled` detail: the generation at which the world reached its fixed point. */
export interface HexCaSettledDetail {
  generation: number
}

/** `hexlife-ca-error` detail. Rule 1 is that the element never throws into the host page. */
export interface HexCaErrorDetail {
  message: string
  detail: string
}

export declare class HexCAElement extends HTMLElement {
  /**
   * The live k-state world, or null while booting / in the error state.
   *
   * Exposed because the element is a *host* for `HexCA`, not a wrapper that hides it: a model that
   * needs `setSkippingEnabled`, `phase` or `lastChangedCount` should reach for them directly rather
   * than wait for the element to grow a passthrough for each.
   */
  readonly world: HexCA | null
  /** Non-null while the element is showing its styled error box. */
  readonly error: string | null

  readonly states: number
  readonly rows: number
  readonly columns: number
  readonly backend: CaBackend | null
  readonly generation: number
  /** Rolling hash of the current generation. */
  readonly checksum: number
  /**
   * Whether the world has reached a fixed point it can never leave. The element acts on this: a
   * settled world stops its animation loop entirely, and any write wakes it again.
   */
  readonly isSettled: boolean
  /** Chunks recomputed on the last tick, out of the total. */
  readonly chunkActivity: ChunkActivity | null
  readonly playing: boolean
  readonly userPaused: boolean
  /** Brush radius used by `draw` strokes; 0 is a single cell, which is also the default. */
  readonly brushSize: number

  /**
   * Set the brush radius from script (clamped to 0 … 40). Does not reflect into the `brush`
   * attribute — drive it through one or the other, not both.
   */
  setBrushSize(size: number): void

  /** Start (or resume). An explicit call also overrides `prefers-reduced-motion`. */
  play(): void
  /** Pause. The current generation stays on screen. */
  pause(): void

  /**
   * Install the rule table — `k^7` entries for `'neighborhood'`, `k^3` for `'block'`, from
   * `ruleFromTable` / `blockRuleFromTable`.
   *
   * **This is how a rule gets in** for anything but a `code`: there is no attribute form, because a
   * `k^7` table is 16 KB at k=4 and cannot honestly be spelled in HTML.
   *
   * @returns False when there is no live world. An invalid table lands in the error box.
   */
  setRule(rule: ArrayLike<number>): boolean

  /**
   * Replace every cell, and make this the state `reset()` rewinds to. The supported bulk write: it
   * validates the states **and wakes the engine's activity tracker**, which a poke straight through
   * `world.state` does not.
   */
  setCells(cells: ArrayLike<number>): boolean
  /** Set one cell, waking its neighbourhood. */
  setCell(index: number, value: number): boolean
  /** Rewind to the cells this world started from (or blank it, if it never had any). */
  reset(): void
  /** Blank the world; same rule, same speed, same play state. Distinct from `reset()`. */
  clear(): void
  /** Advance exactly `n` generations now, independent of `speed` and the play state. */
  tick(n?: number): number

  /**
   * Draw the world's current cells, whoever wrote them.
   *
   * Only needed when a *native* producer fills this world's buffer inside wasm — `DifferenceMask`'s
   * `compareInto`, for instance. Nothing crossed the boundary, so nothing told the element anything
   * changed. Every write on this element already redraws.
   */
  redraw(): void

  /**
   * Per-state occupancy of the current generation — `states` counts.
   *
   * The measurement the block backend exists for: under a conservative block rule every entry holds
   * forever, and under *any* radius-1 rule it cannot, at any `k`.
   */
  census(): Uint32Array | null

  /**
   * Encode the world as it stands right now into an `HXK1.` code — grid, `k`, backend, rule, exact
   * cells and the colours on screen. Null when no rule is installed.
   *
   * A distinct prefix from `HXW1`, so `<hexlife-world code=…>` refuses one of these outright rather
   * than half-reading a payload whose every region means something else.
   */
  caCode(): Promise<string | null>
}

/** The registered tag name. */
export const CA_TAG_NAME: 'hexlife-ca'

declare global {
  interface HTMLElementTagNameMap {
    'hexlife-ca': HexCAElement
  }
}
