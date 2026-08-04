/**
 * Type declarations for `<hexlife-grid>` — the public API of `HexLifeGridElement.js`.
 *
 * Same contract as `hexlife-world.d.ts`: `src/embed/` is plain JS, so this file is the one place the
 * element's *documented* surface is written down in a form a compiler can enforce, and it **must
 * match `packages/hexlife-embed/README.md`**, which is what consumers actually read.
 *
 * There is no `hexlife-grid.js` — the runtime lives in `HexLifeGridElement.js` and registers itself
 * via `index.js`. Import this module for types only (`import type`), alongside the side-effecting
 * `import '@hexlife/embed'` that defines the element.
 */

import type {HexLifeSim} from './hexlife-world.js'

/** `hexlife-ready` detail — every world booted and the grid is renderable. */
export interface HexLifeGridReadyDetail {
    /** How many worlds are live (may be fewer than the `rulesets` list if entries were dropped). */
    worlds: number
    /** Rows per world. */
    rows: number
    /** Columns per world, derived from `rows`. */
    cols: number
    /** Cells per world. */
    numCells: number
    /** The tile grid in use. */
    layout: {cols: number; rows: number}
}

/** `hexlife-worldselect` detail — the viewer clicked a tile. */
export interface HexLifeWorldSelectDetail {
    /** Tile index in reading order. */
    index: number
    /** The 32-char hex drawn in that tile — hand this to a `<hexlife-world>`. */
    rulesetHex: string
    /** Generations elapsed in that world when it was clicked. */
    tick: number
    /** Live cells in that world when it was clicked. */
    activeCount: number
}

/** A tile's box in CSS px relative to the element. */
export interface HexLifeTileRect {
    x: number
    y: number
    width: number
    height: number
}

export interface HexLifeGridElementEventMap {
    'hexlife-ready': CustomEvent<HexLifeGridReadyDetail>
    'hexlife-playstate': CustomEvent<{playing: boolean; userPaused: boolean}>
    'hexlife-error': CustomEvent<{message: string; detail: string}>
    'hexlife-worldselect': CustomEvent<HexLifeWorldSelectDetail>
    'hexlife-contextlost': CustomEvent<undefined>
    'hexlife-contextrestored': CustomEvent<undefined>
}

/**
 * `<hexlife-grid>` — many worlds in one WebGL context.
 *
 * See `packages/hexlife-embed/README.md` § `<hexlife-grid>` for the full contract:
 * `rulesets` (required; comma/space-separated 32-char hexes or short codes) · `layout` (`COLSxROWS`,
 * default squarest) · `rows` (16–512, default 48) · `seed` · `density` · `speed` · `paused` ·
 * `palette` / `palette-on` / `palette-off` · `flicker-proof` · `gap` (0–32 CSS px) · `max-dpr` ·
 * `link`.
 *
 * Every world shares one grid, one seed, one density, one palette and one clock — the element is a
 * comparison instrument, so the only intended difference between two tiles is the rule.
 */
export declare class HexLifeGridElement extends HTMLElement {
    /** The live sims, in tile order. Empty before boot / after teardown / in the error state. */
    readonly worlds: HexLifeSim[]
    /** Non-null while the element is in its styled error state; the message shown. */
    readonly error: string | null
    /** How many worlds are live. */
    readonly count: number
    /** Generations elapsed since the last reset — shared by every world. */
    readonly generation: number
    /** Whether the animation loop is currently running. */
    readonly playing: boolean
    /** Whether the user has paused, ignoring the viewport/visibility/reduced-motion gates. */
    readonly userPaused: boolean
    /** The tile grid actually in use. */
    readonly layout: {cols: number; rows: number}

    /**
     * The ruleset codes on show. Setting it is the programmatic twin of the `rulesets` attribute and
     * beats it. A list of the same length swaps rules on the live worlds; a different length
     * rebuilds them.
     */
    rulesets: string[]

    /** Start (or resume) every world. An explicit call also overrides `prefers-reduced-motion`. */
    play(): void
    /** Pause every world. The current generation stays on screen. */
    pause(): void
    /**
     * Re-seed every world and rewind to tick 0.
     * @param seed Defaults to the `seed` attribute. A falsy seed is nondeterministic — and since
     *   each world seeds itself, it also stops the tiles sharing an initial condition.
     */
    reset(seed?: number): void
    /**
     * Give every world the same exact tick-0 grid, and make `reset()` replay it verbatim. Null hands
     * the worlds back to the `seed` + `density` generator.
     * @param cells `rows * cols` entries, 1 = alive.
     * @returns Whether the cells were accepted — false for a wrong-sized array.
     */
    setInitialCells(cells: Uint8Array | number[] | null): boolean
    /** Blank every world — all cells dead, no rule history. Does not rewind `generation`. */
    clear(): void
    /**
     * Advance every world exactly `n` generations now, independent of `speed` and the play state.
     * @returns The new generation.
     */
    tick(n?: number): number

    /** @returns The sim in a tile, or null. */
    worldAt(index: number): HexLifeSim | null
    /** @returns The 32-char ruleset hex in a tile, or null. */
    rulesetAt(index: number): string | null
    /** @returns The tile under a viewport point, or null for a gutter / outside the grid. */
    indexAt(clientX: number, clientY: number): number | null
    /** @returns A tile's box in CSS px relative to this element — for host-drawn chrome. */
    tileRect(index: number): HexLifeTileRect | null

    addEventListener<K extends keyof HexLifeGridElementEventMap>(
        type: K,
        listener: (this: HexLifeGridElement, ev: HexLifeGridElementEventMap[K]) => void,
        options?: boolean | AddEventListenerOptions,
    ): void
    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ): void
    removeEventListener<K extends keyof HexLifeGridElementEventMap>(
        type: K,
        listener: (this: HexLifeGridElement, ev: HexLifeGridElementEventMap[K]) => void,
        options?: boolean | EventListenerOptions,
    ): void
    removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
    ): void
}

declare global {
    interface HTMLElementTagNameMap {
        'hexlife-grid': HexLifeGridElement
    }
}
