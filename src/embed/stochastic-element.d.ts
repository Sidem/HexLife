/**
 * Type declarations for `<hexlife-stochastic>` — the public API of `HexStochasticElement.js`,
 * registered by `@hexlife/embed/stochastic-element`.
 *
 * The stochastic counterpart of `ca-element.d.ts`, and it carries the same obligation: **this file
 * is documentation with teeth and must match `packages/hexlife-embed/README.md`**, which is what
 * consumers of the published package actually read. Adding to the element's surface means editing
 * the element, that README and this file together.
 *
 * Importing `@hexlife/embed/stochastic-element` is what *defines* the element, and it is the only
 * element entry that reaches the isolated stochastic Wasm artifact. See `stochastic-element.js`.
 */

import type {StochasticBackend, StochasticWorld} from './stochastic.js'

export type {StochasticBackend, StochasticWorld}

/** `[r, g, b]`, each channel 0–255. */
export type StochasticColor = [number, number, number]

/** Chunks recomputed on the last tick, out of the total the grid is divided into. */
export interface StochasticChunkActivity {
  active: number
  total: number
}

/** `hexlife-stochastic-ready` detail: the world that just booted. */
export interface HexStochasticReadyDetail {
  backend: StochasticBackend
  rows: number
  columns: number
  numCells: number
  seed: bigint
  /** Non-zero when a `code` restored a world mid-run: an `HXS1.` carries its own generation. */
  generation: number
  /** 0 until a rule is installed; then the rule's own visible-state count (5 for the gas). */
  states: number
  /**
   * Whether a rule is installed. False when the element booted without a `code` and nothing has
   * called `setRule` yet. Such a world cannot tick at all — unlike `<hexlife-ca>`, whose rule-less
   * world merely dies on tick one — so the element keeps its loop down until a rule arrives.
   */
  hasRule: boolean
}

/** `hexlife-stochastic-playstate` detail. */
export interface HexStochasticPlayStateDetail {
  /** Whether the animation loop is running right now, after every gate. */
  playing: boolean
  /** Whether the *user* has paused, ignoring the viewport and visibility gates. */
  userPaused: boolean
}

/** `hexlife-stochastic-error` detail. Rule 1 is that the element never throws into the host page. */
export interface HexStochasticErrorDetail {
  message: string
  detail: string
}

export declare class HexStochasticElement extends HTMLElement {
  /**
   * The live stochastic world, or null while booting / in the error state.
   *
   * Exposed because the element is a *host* for `StochasticWorld`, not a wrapper that hides it: a
   * model that needs `setSkippingEnabled`, `transitionCounts()` or `sample()` should reach for them
   * directly rather than wait for the element to grow a passthrough for each.
   */
  readonly world: StochasticWorld | null
  /** Non-null while the element is showing its styled error box. */
  readonly error: string | null

  readonly rows: number
  readonly columns: number
  /** Follows the installed rule's magic, not an attribute. Null before the world boots. */
  readonly backend: StochasticBackend | null
  readonly states: number
  readonly generation: number
  readonly hasRule: boolean
  /** Rolling hash of the current visible state; 0 before a rule is installed. */
  readonly checksum: number
  readonly lastChangedCount: number
  readonly chunkActivity: StochasticChunkActivity | null
  readonly playing: boolean
  readonly userPaused: boolean
  /** Brush radius used by `draw` strokes; 0 is a single cell, which is also the default. */
  readonly brushSize: number

  /**
   * Set the brush radius from script (clamped to 0 … 40). Does not reflect into the `brush`
   * attribute — drive it through one or the other, not both.
   */
  setBrushSize(size: number): void

  /**
   * The seed every world this element builds uses. Defaults to a **fixed** value rather than
   * entropy: two loads of the same page must be the same run.
   *
   * A property rather than an attribute, because a host that cares about the seed is already writing
   * the script that installs the rule. Assigning a different one reboots the element, exactly as
   * changing `rows` does; assigning the same one is a no-op.
   */
  seed: bigint

  /** Start (or resume). An explicit call also overrides `prefers-reduced-motion`. */
  play(): void
  /** Pause. The current generation stays on screen. */
  pause(): void

  /**
   * Install the compiled rule table — `HSN1` bytes from `compileStochasticRule`, or `HSG1` bytes
   * from `compileGasRule`.
   *
   * **This is how a rule gets in** for anything but a `code`: there is no attribute form, because a
   * compiled rule is 272 bytes per row and a gas table is 32 KB.
   *
   * The bytes decide the backend. Installing a gas table on a neighborhood world (or the reverse)
   * rebuilds the world — same seed, same geometry, generation 0 — because a `WorldStochastic`
   * allocates one backend's buffers at construction and never the other's.
   *
   * @returns False when there is no live world. Invalid bytes land in the error box.
   */
  setRule(rule: ArrayLike<number>): boolean

  /**
   * Replace the exact generation-zero state, and make it what `reset()` rewinds to. A one-shot
   * upload: nothing in this element uploads a grid per tick.
   */
  setInitialState(cells: ArrayLike<number>, elapsedAges?: ArrayLike<number> | null): boolean
  /** Intervention-only bulk replacement at the current generation. Never a streaming API. */
  setCells(cells: ArrayLike<number>, elapsedAges?: ArrayLike<number> | null): boolean
  /** Set one cell, waking its chunk. Neighborhood backend only. */
  setCell(index: number, value: number): boolean

  /** Replace the exact generation-zero lattice-gas state and reset snapshot. Gas only. */
  setInitialGasState(channels: ArrayLike<number> | null, walls?: ArrayLike<number> | null): boolean
  /** Intervention-only bulk lattice-gas replacement at the current generation. Gas only. */
  setGasCells(channels: ArrayLike<number> | null, walls?: ArrayLike<number> | null): boolean
  /** Open or close one barrier site. Sealing a site discards particles standing on it. Gas only. */
  setWall(index: number, isWall: boolean): boolean

  /** Rewind to the world's own generation-zero snapshot, inside the engine. */
  reset(): void
  /**
   * Blank the world at the current generation; same rule, same seed, same play state. In the gas the
   * walls stay — they are the container, not its contents.
   */
  clear(): void
  /** Advance exactly `n` generations now, independent of `speed` and the play state. */
  tick(n?: number): number

  /** Per-state occupancy of the current generation — `states` counts. */
  census(): Uint32Array | null
  /** Exact particle total for one species (1 = amber, 2 = cyan). Gas only; 0 otherwise. */
  speciesCount(species: number): number
  /** Sites the collision table rewrote on the last tick. Gas only; 0 otherwise. */
  collisionCount(): number

  /**
   * Encode the world as it stands into an `HXS1.` code — geometry, backend, seed, **generation**,
   * compiled rule, exact visible and auxiliary state, and the colours on screen. Null when no rule
   * is installed.
   *
   * A distinct prefix from `HXW1` and `HXK1`, so the binary and k-state decoders refuse one outright
   * rather than half-read a payload whose every region means something else. A code resumes to an
   * identical *next tick*, not merely an identical frame.
   */
  stochasticCode(): Promise<string | null>
}

/** The registered tag name. */
export const STOCHASTIC_TAG_NAME: 'hexlife-stochastic'

declare global {
  interface HTMLElementTagNameMap {
    'hexlife-stochastic': HexStochasticElement
  }
}
