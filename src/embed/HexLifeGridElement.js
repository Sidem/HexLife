// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * `<hexlife-grid>` — many worlds, one WebGL context.
 *
 * A browser gives a *page* roughly sixteen WebGL contexts (Chrome force-loses the oldest past that
 * and keeps going without an error), so a wall of `<hexlife-world>` elements stops being a wall at
 * sixteen. That is a hard ceiling, not a budget to spend carefully — which makes "show a whole
 * constraint class at once" impossible in the obvious way and trivial in this one: N `EmbedSim`s
 * against a single `EmbedRenderer`, each drawn into its own `gl.viewport`. The marginal cost of a
 * world becomes one instance-buffer upload.
 *
 * It is a **comparison instrument**, and that is what shapes the API. Every world shares one grid,
 * one seed, one density, one palette and one clock, because the entire point is that the *only*
 * difference between two tiles is the rule. The 256 totalistic rules are the motivating case: they
 * are exactly 2⁸, so they fit a 16×16 grid with nothing left over and nothing sampled away.
 *
 * The two rules from `HexLifeElement` hold here without amendment:
 *   1. **Never throw into the host page** — every failure lands in the styled error box.
 *   2. **Never leak** — `disconnectedCallback` frees every wasm world and voids the async-init race.
 *
 * What it deliberately does *not* have: `draw`, `brush`, `torus`, `zoom`, `code` and `worldCode()`.
 * All six are single-world ideas. A host that wants them opens one `<hexlife-world>` on the tile the
 * viewer picked — `hexlife-worldselect` exists to make exactly that handoff.
 */

import { EmbedSim, initEmbedWasm } from './EmbedSim.js';
import { EmbedRenderer } from './EmbedRenderer.js';
import { clampInt, clampFloat, readSeed, readGradient } from './attrs.js';
import { readLayout, resolveRulesetCode, splitRulesetList } from './gridAttrs.js';

/**
 * Attribute defaults and bounds. `rows` defaults lower than `<hexlife-world>`'s 64 because this
 * element's cost is per world: at 256 tiles, 64 rows is already 1.2M cells a frame.
 */
const DEFAULTS = {
    rows: 48,
    density: 0.5,
    speed: 20,
    palette: 'default',
    maxDpr: 1.5,
    gap: 2,
};
const ROWS_MIN = 16;
const ROWS_MAX = 512;
const MAX_DPR_MIN = 1;
const MAX_DPR_MAX = 4;
const GAP_MAX = 32;

/**
 * Hard cap on worlds.
 *
 * Not a performance opinion — a backstop against an attribute typo allocating gigabytes. Each world
 * costs `rows × cols × 4` bytes of wasm linear memory (four per-cell buffers), so 1024 worlds at the
 * default grid is roughly 100 MB, which is a lot but survivable; ten thousand would not be. Past the
 * cap we keep the first `MAX_WORLDS` and say so, rather than failing a page that asked for too much.
 */
const MAX_WORLDS = 1024;

/** Attributes that reconfigure the live grid instead of rebuilding its worlds. */
const LIVE_ATTRS = new Set([
    'speed', 'paused', 'palette', 'palette-on', 'palette-off', 'flicker-proof', 'max-dpr', 'gap',
    'layout', 'link', 'seed', 'density',
]);

const STYLES = `
:host {
    display: block;
    aspect-ratio: 1 / 1;
    position: relative;
    contain: content;
    background: #1a1a1a;
    overflow: hidden;
}
:host([hidden]) { display: none; }
canvas {
    display: block;
    width: 100%;
    height: 100%;
}
.overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(16, 18, 20, 0.12);
    border: 0;
    padding: 0;
    cursor: pointer;
    color: #fff;
}
.overlay svg { width: 12%; max-width: 88px; opacity: 0.85; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.7)); }
.overlay:hover { background: rgba(16, 18, 20, 0.22); }
.overlay:hover svg { opacity: 1; }
@media (prefers-reduced-motion: no-preference) {
    .overlay svg { animation: hexlife-pulse 2.5s ease-in-out infinite; }
    .overlay:hover svg { animation: none; }
}
@keyframes hexlife-pulse {
    0%, 100% { transform: scale(1); opacity: 0.85; }
    50% { transform: scale(1.08); opacity: 1; }
}
.attrib {
    position: absolute;
    right: 6px;
    bottom: 4px;
    font: 500 11px/1.4 system-ui, -apple-system, sans-serif;
    color: rgba(255, 255, 255, 0.55);
    text-decoration: none;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    letter-spacing: 0.02em;
}
.attrib:hover { color: rgba(255, 255, 255, 0.95); }
.error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px;
    box-sizing: border-box;
    text-align: center;
    font: 13px/1.5 system-ui, -apple-system, sans-serif;
    color: #b6bcc4;
    background: #1a1a1a;
}
.error strong { color: #e06c5a; font-weight: 600; }
.error code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: #e0b341;
    word-break: break-all;
}
[hidden] { display: none !important; }
`;

const PLAY_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,0.45)" stroke="currentColor" stroke-width="2.5"/><path d="M26 20l20 12-20 12z" fill="currentColor"/></svg>';

const APP_URL = 'https://sidem.github.io/HexLife/';
const CONTEXT_RESTORE_TIMEOUT_MS = 4000;
const CONTEXT_LOSS_LOOP_MS = 10_000;

export class HexLifeGridElement extends HTMLElement {
    static get observedAttributes() {
        return ['rulesets', 'layout', 'rows', 'seed', 'density', 'speed', 'palette',
            'palette-on', 'palette-off', 'flicker-proof', 'paused', 'max-dpr', 'gap', 'link'];
    }

    constructor() {
        super();

        const root = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = STYLES;

        this._canvas = document.createElement('canvas');

        this._overlay = document.createElement('button');
        this._overlay.className = 'overlay';
        this._overlay.setAttribute('part', 'overlay');
        this._overlay.setAttribute('aria-label', 'Play');
        this._overlay.innerHTML = PLAY_ICON;
        this._overlay.hidden = true;
        this._overlay.addEventListener('click', () => this.play());

        this._attrib = document.createElement('a');
        this._attrib.className = 'attrib';
        this._attrib.setAttribute('part', 'attribution');
        this._attrib.target = '_blank';
        this._attrib.rel = 'noopener noreferrer';
        this._attrib.href = APP_URL;
        this._attrib.textContent = 'HexLife';

        this._errorBox = document.createElement('div');
        this._errorBox.className = 'error';
        this._errorBox.setAttribute('part', 'error');
        this._errorBox.hidden = true;

        root.append(style, this._canvas, this._overlay, this._errorBox, this._attrib);

        /** @type {EmbedSim[]} One per tile, in reading order. */
        this.sims = [];
        /** @type {EmbedRenderer|null} */
        this.renderer = null;
        /** @type {string|null} Non-null while the styled error box is up. */
        this.error = null;

        /** Ruleset hexes actually loaded, parallel to `sims`. @type {string[]} */
        this._hexes = [];
        /** A programmatic list set through the `rulesets` property; beats the attribute. */
        this._rulesetsProp = null;

        this._rafId = 0;
        this._lastFrameTime = 0;
        this._userPaused = false;
        this._playRequested = false;
        this._onScreen = false;
        this._docVisible = document.visibilityState !== 'hidden';
        this._reducedMotion = false;
        this._lastPlayState = null;

        this._hasConnected = false;
        this._generation = 0;
        /** True between `_boot` starting and its worlds existing — see the `rulesets` setter. */
        this._booting = false;

        this._onVisibilityChange = () => {
            this._docVisible = document.visibilityState !== 'hidden';
            this._syncPlayback();
        };
        this._frame = this._frame.bind(this);
        this._onCanvasClick = this._onCanvasClick.bind(this);

        this._resizeObserver = null;
        this._intersectionObserver = null;
        this._motionQuery = null;
        this._onMotionChange = null;

        this._contextLost = false;
        this._contextRestoreTimer = 0;
        this._contextRestoredAt = 0;
        this._onContextLost = this._onContextLost.bind(this);
        this._onContextRestored = this._onContextRestored.bind(this);
        // Bound for the element's whole life: a rebuild runs `_teardown` before `_boot`, and a
        // context lost during that window would otherwise find nobody listening.
        this._canvas.addEventListener('webglcontextlost', this._onContextLost);
        this._canvas.addEventListener('webglcontextrestored', this._onContextRestored);
    }

    // --- lifecycle ------------------------------------------------------------

    connectedCallback() {
        this._hasConnected = true;
        this._generation++;
        this._boot(this._generation);
    }

    disconnectedCallback() {
        this._generation++;   // Voids any in-flight boot.
        this._teardown();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        if (!this._hasConnected || !this.isConnected) return;
        if (!this.sims.length || !this.renderer) {
            // Still booting, or in the error state — a re-boot re-reads everything and is the only
            // way back out of an error.
            this._rebuild();
            return;
        }

        if (!LIVE_ATTRS.has(name)) { this._rebuild(); return; }

        switch (name) {
            case 'rows':
                this._rebuild();
                break;
            case 'seed':
            case 'density': {
                const p = this._readParams();
                for (const sim of this.sims) { sim.density = p.density; sim.reset(p.seed); }
                this._drawOnce();
                break;
            }
            case 'speed': {
                const speed = this._readParams().speed;
                for (const sim of this.sims) sim.speed = speed;
                break;
            }
            case 'palette':
            case 'palette-on':
            case 'palette-off':
            case 'flicker-proof':
                this.renderer.setPalette(this._paletteOptions());
                this._drawOnce();
                break;
            case 'layout':
            case 'gap':
                this._applyLayout();
                this._drawOnce();
                break;
            case 'paused':
                this._userPaused = this.hasAttribute('paused');
                if (this._userPaused) this._playRequested = false;
                this._syncPlayback();
                break;
            case 'max-dpr':
                this._resize();
                this._drawOnce();
                break;
            case 'link':
                this._updateAttribution();
                break;
        }
    }

    /** Tear the worlds down and build them again from the current attributes. */
    _rebuild() {
        this._generation++;
        this._teardown();
        this._clearError();
        this._boot(this._generation);
    }

    // --- public JS API --------------------------------------------------------

    /** Start (or resume) every world. An explicit call also overrides `prefers-reduced-motion`. */
    play() {
        this._playRequested = true;
        this._userPaused = false;
        this._syncPlayback();
    }

    /** Pause every world; the current generation stays on screen. */
    pause() {
        this._userPaused = true;
        this._syncPlayback();
    }

    /**
     * Re-seed every world and rewind them all to tick 0.
     * @param {number} [seed] Defaults to the `seed` attribute, so `reset()` replays the same run.
     *   A falsy seed is nondeterministic — and, because every world draws from its own generator
     *   call, it also means the tiles stop sharing an initial condition. Pass a seed for a map.
     */
    reset(seed) {
        if (!this.sims.length) return;
        const s = seed === undefined ? this._readParams().seed : seed;
        for (const sim of this.sims) sim.reset(s);
        this._drawOnce();
    }

    /**
     * Give every world the same exact tick-0 grid, and make `reset()` replay it verbatim.
     *
     * The element's premise is that the only difference between two tiles is the rule, and until
     * this method the only initial condition it could offer was `seed` + `density`. A single seed at
     * the centre, a ring, a glider — anything a host can express as cells — needs *these* cells in
     * every world, not a statistically similar draw per world, or the comparison is not one.
     *
     * One copy is shared by every sim (`EmbedSim.reset` only ever reads from it), so this costs one
     * grid of memory rather than one per world.
     *
     * @param {Uint8Array|number[]|null} cells `rows * cols` entries, 1 = alive. Null hands the
     *   worlds back to the `seed` + `density` generator.
     * @returns {boolean} Whether the cells were accepted — false for a wrong-sized array, which is
     *   reported rather than thrown (see the first law).
     */
    setInitialCells(cells) {
        if (!this.sims.length) return false;
        if (cells === null || cells === undefined) {
            for (const sim of this.sims) sim.initialCells = null;
            this.reset();
            return true;
        }
        const expected = this.sims[0].numCells;
        if (cells.length !== expected) {
            console.warn(`<hexlife-grid>: setInitialCells expected ${expected} cells, got ${cells.length}.`);
            return false;
        }
        const shared = cells instanceof Uint8Array ? new Uint8Array(cells) : Uint8Array.from(cells);
        for (const sim of this.sims) sim.initialCells = shared;
        this.reset();
        return true;
    }

    /** Blank every world — all cells dead, no rule history. Does not rewind `tickCount`. */
    clear() {
        if (!this.sims.length || this.error) return;
        for (const sim of this.sims) sim.clear();
        this._drawOnce();
    }

    /**
     * Advance every world exactly `n` generations now, independent of `speed` and the play state.
     * @param {number} [n=1]
     * @returns {number} The new tick count (they all share it).
     */
    tick(n = 1) {
        if (!this.sims.length) return 0;
        const steps = Math.max(0, Math.floor(n));
        for (const sim of this.sims) {
            for (let i = 0; i < steps; i++) sim.tick();
        }
        this._drawOnce();
        return this.sims[0].tickCount;
    }

    /**
     * The list of ruleset codes this grid shows. Setting it is the programmatic twin of the
     * `rulesets` attribute and beats it — useful when the list is computed (all 256 totalistic
     * rules, say) rather than authored.
     *
     * A list of the same length as the current one swaps the rules on the *live* worlds; a different
     * length rebuilds them, since the tile count changed.
     * @returns {string[]}
     */
    get rulesets() {
        return this._rulesetsProp ? [...this._rulesetsProp] : splitRulesetList(this.getAttribute('rulesets'));
    }

    set rulesets(list) {
        this._rulesetsProp = Array.isArray(list) ? list.map(String) : null;
        if (!this._hasConnected || !this.isConnected) return;
        // A boot already in flight reads the list itself once wasm is up — the common case, since
        // assigning this property right after the element is parsed lands mid-boot. Rebuilding here
        // would only throw that boot away and start an identical one.
        if (this._booting) return;
        const hexes = this._resolveList();
        if (!hexes.length || hexes.length !== this.sims.length || !this.renderer) {
            this._rebuild();
            return;
        }
        // Same tile count: a rule swap is not a new world, so the worlds are kept and re-seeded.
        const seed = this._readParams().seed;
        for (let i = 0; i < hexes.length; i++) {
            this.sims[i].setRuleset(hexes[i]);
            this.sims[i].reset(seed);
        }
        this._hexes = hexes;
        this._drawOnce();
    }

    /** @returns {number} How many worlds are live. */
    get count() {
        return this.sims.length;
    }

    /** The live sims, in tile order. Treat as read-only. @returns {EmbedSim[]} */
    get worlds() {
        return this.sims;
    }

    /**
     * @param {number} index
     * @returns {EmbedSim|null}
     */
    worldAt(index) {
        return this.sims[index] || null;
    }

    /**
     * The 32-char ruleset hex drawn in a tile — what a host hands to `<hexlife-world>` when the
     * viewer opens one up.
     * @param {number} index
     * @returns {string|null}
     */
    rulesetAt(index) {
        return this._hexes[index] || null;
    }

    /**
     * Which tile a viewport point falls in, or null for a gutter / outside the grid.
     * @param {number} clientX
     * @param {number} clientY
     * @returns {number|null}
     */
    indexAt(clientX, clientY) {
        if (!this.renderer) return null;
        const rect = this._canvas.getBoundingClientRect();
        return this.renderer.tileIndexAt(clientX - rect.left, clientY - rect.top);
    }

    /**
     * A tile's box in CSS px relative to this element — for parking a selection outline or a label
     * over one world without reimplementing the layout maths.
     * @param {number} index
     * @returns {{x: number, y: number, width: number, height: number}|null}
     */
    tileRect(index) {
        return this.renderer ? this.renderer.tileRect(index) : null;
    }

    /** Generations elapsed since the last reset (shared by every world). */
    get generation() {
        return this.sims.length ? this.sims[0].tickCount : 0;
    }

    /** Whether the animation loop is currently running. */
    get playing() {
        return this._rafId !== 0;
    }

    /** Whether the *user* paused, ignoring the viewport / visibility / reduced-motion gates. */
    get userPaused() {
        return this._userPaused;
    }

    /** The tile grid actually in use. @returns {{cols: number, rows: number}} */
    get layout() {
        return readLayout(this.getAttribute('layout'), this.sims.length || 1);
    }

    // --- attributes -----------------------------------------------------------

    _readParams() {
        return {
            rows: clampInt(this.getAttribute('rows'), ROWS_MIN, ROWS_MAX, DEFAULTS.rows),
            density: clampFloat(this.getAttribute('density'), 0, 1, DEFAULTS.density),
            seed: readSeed(this.getAttribute('seed')),
            speed: clampFloat(this.getAttribute('speed'), 0, 1000, DEFAULTS.speed),
            maxDpr: clampFloat(this.getAttribute('max-dpr'), MAX_DPR_MIN, MAX_DPR_MAX, DEFAULTS.maxDpr),
            gap: clampFloat(this.getAttribute('gap'), 0, GAP_MAX, DEFAULTS.gap),
        };
    }

    _paletteOptions() {
        return {
            palette: this.getAttribute('palette') || DEFAULTS.palette,
            customGradient: readGradient(this.getAttribute('palette-on'), this.getAttribute('palette-off')),
            flickerProof: this.hasAttribute('flicker-proof'),
        };
    }

    /**
     * The `rulesets` list resolved to 32-char hexes, with unparseable entries dropped.
     *
     * Dropping rather than failing is the first law again: one typo in a 256-entry list must not
     * blank a page. The warning names the offender so it is still findable.
     * @returns {string[]}
     */
    _resolveList() {
        const raw = this._rulesetsProp || splitRulesetList(this.getAttribute('rulesets'));
        const out = [];
        for (const code of raw) {
            const hex = resolveRulesetCode(code);
            if (hex) out.push(hex);
            else console.warn(`<hexlife-grid>: ignoring unparseable ruleset "${code}".`);
        }
        if (out.length > MAX_WORLDS) {
            console.warn(`<hexlife-grid>: ${out.length} rulesets exceeds the ${MAX_WORLDS}-world cap; showing the first ${MAX_WORLDS}.`);
            out.length = MAX_WORLDS;
        }
        return out;
    }

    // --- boot / teardown ------------------------------------------------------

    async _boot(generation) {
        this._clearError();
        this._booting = true;

        try {
            await initEmbedWasm();
        } catch (e) {
            if (generation !== this._generation) return;
            this._booting = false;
            this._fail('Simulation engine failed to load.', String(e && e.message ? e.message : e));
            return;
        }
        if (generation !== this._generation) return;   // Disconnected (or re-booted) mid-init.

        // The list is read *here*, not before the await, and the difference is not cosmetic. A 256
        // entry list is a computed thing, so the natural host code is `<hexlife-grid>` in the markup
        // and `grid.rulesets = […]` in the module that imports this element — which necessarily runs
        // after `connectedCallback`. Checking before the await would fail every such page for one
        // task and emit a `hexlife-error` the host did nothing to deserve.
        const hexes = this._resolveList();
        if (!hexes.length) {
            this._booting = false;
            this._fail(
                'No rulesets to show.',
                'Set a `rulesets` attribute (comma- or space-separated 32-char hexes or short codes '
                + 'like T00), or assign the `rulesets` property.',
            );
            return;
        }

        const params = this._readParams();

        try {
            // One shared seed and density: the grid is a comparison, so the initial condition has to
            // be the constant. Built before the renderer so a wasm OOM fails before a GL context is
            // taken — this element's whole reason for existing is that contexts are scarce.
            this.sims = hexes.map(hex => new EmbedSim({
                rulesetHex: hex,
                rows: params.rows,
                density: params.density,
                seed: params.seed,
                speed: params.speed,
            }));
            this._hexes = hexes;
        } catch (e) {
            this._booting = false;
            this._freeSims();
            this._fail(
                `Could not build ${hexes.length} worlds.`,
                String(e && e.message ? e.message : e),
            );
            return;
        }

        try {
            this.renderer = new EmbedRenderer(this._canvas, {
                cols: this.sims[0].cols,
                rows: this.sims[0].rows,
                ...this._paletteOptions(),
            });
        } catch (e) {
            this._booting = false;
            this._freeSims();
            this._fail('This browser can’t run WebGL2.', String(e && e.message ? e.message : e));
            return;
        }
        this._booting = false;

        document.addEventListener('visibilitychange', this._onVisibilityChange);

        this._resizeObserver = new ResizeObserver(() => {
            this._resize();
            if (!this.playing) this._drawOnce();
        });
        this._resizeObserver.observe(this);

        this._intersectionObserver = new IntersectionObserver(
            (entries) => this._onIntersect(entries), { threshold: 0 });
        this._intersectionObserver.observe(this);

        this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion = this._motionQuery.matches;
        this._onMotionChange = (e) => { this._reducedMotion = e.matches; this._syncPlayback(); };
        this._motionQuery.addEventListener('change', this._onMotionChange);

        this._canvas.addEventListener('click', this._onCanvasClick);

        this._userPaused = this.hasAttribute('paused');
        // Order matters: `_resize` is what teaches the renderer the element's real CSS size, and
        // `_applyLayout` divides that size into tiles. Reversed, the first layout would be computed
        // against the canvas's 300×150 default and could survive if the refit found nothing changed.
        this._resize();
        this._applyLayout();
        this._updateAttribution();
        this._drawOnce();
        this._syncPlayback();

        const layout = this.layout;
        this.dispatchEvent(new CustomEvent('hexlife-ready', {
            bubbles: true,
            composed: true,
            detail: {
                worlds: this.sims.length,
                rows: this.sims[0].rows,
                cols: this.sims[0].cols,
                numCells: this.sims[0].numCells,
                layout: { cols: layout.cols, rows: layout.rows },
            },
        }));
    }

    /** Free every wasm world and drop the list. Safe to call twice. */
    _freeSims() {
        for (const sim of this.sims) {
            try { sim.free(); } catch { /* already freed */ }
        }
        this.sims = [];
        this._hexes = [];
    }

    _teardown() {
        this._booting = false;
        this._stopLoop();
        if (this._contextRestoreTimer) { clearTimeout(this._contextRestoreTimer); this._contextRestoreTimer = 0; }

        if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
        if (this._intersectionObserver) { this._intersectionObserver.disconnect(); this._intersectionObserver = null; }
        if (this._motionQuery && this._onMotionChange) {
            this._motionQuery.removeEventListener('change', this._onMotionChange);
        }
        this._motionQuery = null;
        this._onMotionChange = null;
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this._canvas.removeEventListener('click', this._onCanvasClick);

        if (this.renderer) { this.renderer.destroy(); this.renderer = null; }
        // Frees the wasm Worlds and unregisters them from the view-refresh registry. At 256 worlds
        // this is ~11 MB of linear memory that would otherwise be held for the page's lifetime.
        this._freeSims();

        this._overlay.hidden = true;
        this._lastPlayState = null;
    }

    // --- layout ---------------------------------------------------------------

    /** Push the current `layout` + `gap` attributes into the renderer. */
    _applyLayout() {
        if (!this.renderer) return;
        const { cols, rows } = readLayout(this.getAttribute('layout'), this.sims.length);
        this.renderer.setGridLayout({ cols, rows, gap: this._readParams().gap });
    }

    _resize() {
        if (!this.renderer || this._contextLost) return;
        const rect = this.getBoundingClientRect();
        this.renderer.resize(rect.width || 1, rect.height || 1, this._readParams().maxDpr);
    }

    // --- selection ------------------------------------------------------------

    /**
     * A click on a tile announces *which* world was clicked and nothing else.
     *
     * The element deliberately owns no selection state: what a host does with a picked world — open
     * a `<hexlife-world>`, deep-link the Explorer, copy the hex — is host business, and a built-in
     * highlight would only be in the way of whatever they draw instead. `tileRect()` is there so
     * they can put it exactly where the tile is.
     */
    _onCanvasClick(e) {
        if (!this.renderer || this.error) return;
        const index = this.indexAt(e.clientX, e.clientY);
        if (index === null || index >= this.sims.length) return;
        this.dispatchEvent(new CustomEvent('hexlife-worldselect', {
            bubbles: true,
            composed: true,
            detail: {
                index,
                rulesetHex: this._hexes[index],
                tick: this.sims[index].tickCount,
                activeCount: this.sims[index].activeCount,
            },
        }));
    }

    // --- playback -------------------------------------------------------------

    _syncPlayback() {
        if (!this.sims.length || !this.renderer || this.error || this._contextLost) {
            this._stopLoop();
            return;
        }

        const motionAllowed = !this._reducedMotion || this._playRequested;
        const wants = !this._userPaused && motionAllowed;
        const canRun = wants && this._onScreen && this._docVisible;

        this._overlay.hidden = wants;

        if (canRun) this._startLoop();
        else this._stopLoop();

        this._emitPlayState();
    }

    _emitPlayState() {
        const playing = this.playing;
        const userPaused = this._userPaused;
        const last = this._lastPlayState;
        if (last && last.playing === playing && last.userPaused === userPaused) return;
        this._lastPlayState = { playing, userPaused };
        this.dispatchEvent(new CustomEvent('hexlife-playstate', {
            bubbles: true,
            composed: true,
            detail: { playing, userPaused },
        }));
    }

    _onIntersect(entries) {
        this._onScreen = entries[entries.length - 1].isIntersecting;
        this._syncPlayback();
    }

    _startLoop() {
        if (this._rafId) return;
        this._lastFrameTime = performance.now();
        this._rafId = requestAnimationFrame(this._frame);
    }

    _stopLoop() {
        if (!this._rafId) return;
        cancelAnimationFrame(this._rafId);
        this._rafId = 0;
    }

    _frame(now) {
        this._rafId = requestAnimationFrame(this._frame);
        const dt = Math.min(now - this._lastFrameTime, 100);
        this._lastFrameTime = now;
        // Every sim gets the same dt and carries its own accumulator, so the tiles stay in lockstep
        // — which is the whole contract: at generation N, every tile is showing generation N.
        for (let i = 0; i < this.sims.length; i++) this.sims[i].advance(dt);
        this.renderer.drawGrid(this.sims);
    }

    _drawOnce() {
        if (this.sims.length && this.renderer && !this.error && !this._contextLost) {
            this.renderer.drawGrid(this.sims);
        }
    }

    // --- GPU context loss -----------------------------------------------------
    // Same contract as `<hexlife-world>`: a lost context is not an error state, it is a gap. We stop
    // every loop, ask for the context back, and rebuild if it arrives. The stakes are higher here —
    // this element exists precisely because contexts are scarce — so the loop guard matters more,
    // not less: rebuilding 256 worlds is exactly the kind of ask that loses a context twice.

    _onContextLost(event) {
        if (this._contextLost) return;
        this._contextLost = true;
        this._stopLoop();

        const looping = this._contextRestoredAt > 0
            && (performance.now() - this._contextRestoredAt) < CONTEXT_LOSS_LOOP_MS;
        if (looping) {
            this._fail(
                'This device ran out of graphics memory.',
                `The GPU dropped this grid twice in a row. ${this.sims.length} worlds at `
                + `${this._readParams().rows} rows is a large ask — try fewer worlds or a smaller grid.`,
            );
            return;
        }

        // Load-bearing: the spec only fires `webglcontextrestored` for a *cancelled* loss event.
        event.preventDefault();

        console.warn('<hexlife-grid>: WebGL context lost; waiting for the browser to restore it.');
        this.dispatchEvent(new CustomEvent('hexlife-contextlost', { bubbles: true, composed: true }));

        clearTimeout(this._contextRestoreTimer);
        this._contextRestoreTimer = setTimeout(() => {
            this._contextRestoreTimer = 0;
            if (!this._contextLost) return;
            this._fail(
                'The GPU dropped this grid.',
                'The graphics context was lost and the browser did not restore it. '
                + 'Closing other tabs or apps and reopening this usually brings it back.',
            );
        }, CONTEXT_RESTORE_TIMEOUT_MS);
    }

    _onContextRestored() {
        if (!this._contextLost) return;
        clearTimeout(this._contextRestoreTimer);
        this._contextRestoreTimer = 0;
        this._contextLost = false;
        this._contextRestoredAt = performance.now();
        this.dispatchEvent(new CustomEvent('hexlife-contextrestored', { bubbles: true, composed: true }));
        // Everything the old renderer held died with the old context; a rebuild is the only cure,
        // and it ends in a fresh `hexlife-ready`.
        this._rebuild();
    }

    // --- error state ----------------------------------------------------------

    _updateAttribution() {
        this._attrib.hidden = this.getAttribute('link') === 'off';
    }

    _fail(message, detail) {
        this.error = message;
        this._teardown();
        this._errorBox.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = `<hexlife-grid>: ${message}`;
        const code = document.createElement('code');
        code.textContent = detail || '';
        this._errorBox.append(strong, code);
        this._errorBox.hidden = false;
        this._updateAttribution();
        console.warn(`<hexlife-grid>: ${message} ${detail || ''}`);
        this.dispatchEvent(new CustomEvent('hexlife-error', {
            bubbles: true,
            composed: true,
            detail: { message, detail: detail || '' },
        }));
    }

    _clearError() {
        this.error = null;
        this._errorBox.hidden = true;
    }
}
