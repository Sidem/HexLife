/**
 * Type declarations for `<hexlife-world>` — the public API of `HexLifeElement.js`.
 *
 * `src/embed/` is plain JS (see the note atop EmbedSim.js for why it is not `@ts-check`ed), so this
 * file is the one place the element's *documented* surface is written down in a form a compiler can
 * enforce. It exists because the Devvit client (`devvit/src/client/hexlife.ts`) is TypeScript and
 * was hand-mirroring this API in a local type that nothing checked against the real element — the
 * two could drift silently, which is exactly the failure a type is supposed to prevent.
 *
 * **This file is documentation with teeth: it must match `docs/EMBED-PLAN.md` § Public API.** The
 * embed's API is frozen (additive changes only), so adding to it means editing the plan, the
 * element, and this file together.
 *
 * There is no `hexlife-world.js` — the runtime lives in `HexLifeElement.js` and registers itself
 * via `index.js`. Import this module for types only (`import type`), alongside the side-effecting
 * `import '.../embed/index.js'` that actually defines the element.
 */

/** The `EmbedSim` surface `<hexlife-world>` exposes through its readonly `sim` property. */
export interface HexLifeSim {
    readonly rows: number;
    readonly cols: number;
    readonly numCells: number;
    /** 32-char hex ruleset currently loaded. */
    readonly rulesetHex: string;
    /** Generations elapsed since the last reset. */
    readonly tickCount: number;
    /** Target ticks/second once playing. */
    speed: number;
    /**
     * Live view of the current generation's cells (`rows * cols`, 1 = alive), or null once freed.
     * This is a **view into wasm linear memory**, not a copy — see `snapshotCells`.
     */
    readonly state: Uint8Array | null;
    /** Advance exactly one generation. @returns Active cells in the new generation. */
    tick(): number;
    /** Re-seed the initial state and rewind to tick 0. */
    reset(seed?: number | null): void;
    /** Rolling hash of the current state — the determinism cross-check hook. */
    checksum(): number;
    /**
     * A private copy of the current cells, safe to hold across allocating wasm calls (which detach
     * the `state` view) and across ticks. Null once the sim is freed.
     */
    snapshotCells(): Uint8Array | null;
    /**
     * Invert cells under a brush stroke. `strokeAffected` is the per-stroke "already painted" set
     * and is mutated. @returns Whether any cell changed.
     */
    invertBrushLine(
        col0: number,
        row0: number,
        col1: number,
        row1: number,
        brushSize: number,
        strokeAffected: Set<number>,
    ): boolean;
}

/** `hexlife-ready` detail — the world booted and is renderable. */
export interface HexLifeReadyDetail {
    rows: number;
    cols: number;
    numCells: number;
    brushSize: number;
}

/** `hexlife-playstate` detail — the `{playing, userPaused}` tuple changed. */
export interface HexLifePlayStateDetail {
    playing: boolean;
    userPaused: boolean;
}

/** `hexlife-error` detail — the element entered its styled error state and will not run. */
export interface HexLifeErrorDetail {
    message: string;
    detail: string;
}

/**
 * Events the element dispatches. All are `bubbles` + `composed`, so they escape the shadow root and
 * a host can listen on the element itself.
 */
export interface HexLifeElementEventMap {
    'hexlife-ready': CustomEvent<HexLifeReadyDetail>;
    'hexlife-playstate': CustomEvent<HexLifePlayStateDetail>;
    'hexlife-error': CustomEvent<HexLifeErrorDetail>;
}

/**
 * `<hexlife-world>` — see `docs/EMBED-PLAN.md` § Public API for the attributes:
 * `ruleset` · `seed` · `density` · `rows` · `speed` · `palette` · `palette-on`/`off` · `code`
 * (`HXW1.…`, wins over the individual attrs) · `paused` · `max-dpr` · `link` (`on`/`off`) ·
 * `draw` · `wheel-zoom` (`free` | `ctrl`).
 */
export declare class HexLifeElement extends HTMLElement {
    /** The live sim, or null before boot / after teardown / in the error state. */
    readonly sim: HexLifeSim | null;
    /** Non-null while the element is in its styled error state; the message shown. */
    readonly error: string | null;

    /** Start (or resume). An explicit call also overrides `prefers-reduced-motion`. */
    play(): void;
    /** Pause. The current generation stays on screen. */
    pause(): void;
    /**
     * Re-seed the initial state and rewind to tick 0.
     * @param seed Defaults to the `seed` attribute (so `reset()` replays the same run). A falsy
     *   seed is nondeterministic, as in the app.
     */
    reset(seed?: number): void;
    /**
     * Advance exactly `n` generations now, independent of `speed` and the play state.
     * @returns The new tick count.
     */
    tick(n?: number): number;
    /** Set the brush / neighborhood radius used for draw strokes (clamped). */
    setBrushSize(size: number): void;
    /**
     * The world as it stands right now — exact cells, painted ones included — as an `HXW1.` code,
     * or null when there is nothing to encode (error state, or not booted).
     *
     * Never encodes a generator: a remix is the dish, not the recipe, so decoding this reproduces
     * exactly the world on screen rather than re-rolling a new one.
     */
    worldCode(): Promise<string | null>;

    /** Generations elapsed since the last reset. */
    readonly tickCount: number;
    /** Hash of the current state — equal to the app's for equal params + ticks. */
    readonly checksum: number;
    /** Whether the animation loop is currently running. */
    readonly playing: boolean;
    /** Whether the user has paused (attribute or `pause()`), ignoring the viewport/visibility gates. */
    readonly userPaused: boolean;
    /** Brush / neighborhood radius used for draw strokes. */
    readonly brushSize: number;

    addEventListener<K extends keyof HexLifeElementEventMap>(
        type: K,
        listener: (this: HexLifeElement, ev: HexLifeElementEventMap[K]) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<K extends keyof HexLifeElementEventMap>(
        type: K,
        listener: (this: HexLifeElement, ev: HexLifeElementEventMap[K]) => void,
        options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
    ): void;
}

declare global {
    interface HTMLElementTagNameMap {
        'hexlife-world': HexLifeElement;
    }
}
