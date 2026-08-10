// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * `<hexlife-ca>` — the public custom element for **k-state** worlds (KSTATE-PLAN phase 4).
 *
 * The k-state sibling of `<hexlife-world>`, and a *separate element* rather than a mode on that one,
 * for the same reason `WorldK` is a separate struct from `World`: `<hexlife-world>`'s API is frozen
 * and its determinism contract (seed 12345 => checksum 231200078 at tick 100) is load-bearing for
 * the model pipeline. Nothing here can reach it. The two share `EmbedRenderer` — the instanced draw,
 * the fit, the camera and `hitTest` are all state-agnostic — and nothing else.
 *
 * **The two rules from `HexLifeElement` govern this file identically:**
 *
 * 1. **Never throw into the host page.** A bad `rows` for block mode, a missing WebGL2 context, a
 *    wasm init failure, a corrupt `code` — every one lands in a styled error box inside our shadow
 *    root. A third party pasted a script tag; they did not sign up for an exception.
 * 2. **Never leak.** `HexCA` owns wasm memory and a removed element that kept its rAF alive would
 *    keep ticking a freed world. `disconnectedCallback` tears down in reverse order of setup and
 *    voids the async-init race (see `_generation`).
 *
 * ## What it deliberately does not have
 *
 * No torus projection, no poster preview burst, no pinch/wheel camera. Those are *feed decoration* —
 * they exist on `<hexlife-world>` because its job is to be an attractive card in someone's scroll.
 * This element's job is to run a model somebody is looking at on purpose, so it carries the
 * playback and lifecycle policies (offscreen pause, hidden-tab pause, reduced motion, DPR cap,
 * context-loss recovery) and none of the ornament. Adding any of it later is additive.
 *
 * ## Where the rule comes from
 *
 * Not from an attribute. A `neighborhood` table is `k⁷` entries — 16 KB at k=4 — so there is no
 * honest way to spell one in HTML, and the binary element's 32-hex-char `ruleset` has no k-state
 * counterpart. A rule arrives either inside a `code` (`HXK1.`, which carries the whole world) or
 * through {@link HexCAElement#setRule} from script. With neither, the table is all zeros, which is a
 * world that dies on tick one — stated plainly rather than treated as an error, because it is also
 * the correct starting point for a host that is about to install a rule.
 */

import { initEmbedWasm } from './EmbedSim.js';
import { HexCA } from './ca.js';
import { EmbedRenderer } from './EmbedRenderer.js';
import { decodeCaCode, encodeCaCode, isCaCode } from '../core/CaCodec.js';
import { clampBrushSize, collectBrushCells, getHexLine } from '../core/hexBrush.js';
import {
    caColumnsForRows,
    readCaBackend,
    readCaMaxDpr,
    readCaPalette,
    readCaRows,
    readCaSpeed,
    readCaStates,
} from './caAttrs.js';

/** Where the attribution link points. */
const APP_URL = 'https://sidem.github.io/HexLife/';

/**
 * Attributes that reconfigure a **live** world instead of re-booting it.
 *
 * Same discipline as `<hexlife-world>`'s `LIVE_ATTRS`, and the same expensive failure mode if it is
 * wrong: a re-boot rebuilds the `HexCA` and replays tick 0, throwing away whatever the model had
 * evolved or the viewer had painted. What is listed here is everything that is *not* part of the
 * world — playback rate, input policy, colours, decoration.
 */
const LIVE_ATTRS = new Set([
    'paused', 'speed', 'palette', 'max-dpr', 'link', 'draw', 'draw-state', 'brush',
]);

/**
 * Brush radius when `brush` is absent: a single cell.
 *
 * Deliberately **not** `<hexlife-world>`'s default of 2. That element has painted a disk since it
 * shipped; this one has painted one cell, and quietly widening it would repaint every existing
 * `<hexlife-ca draw>` embed the next time its package version moved. A host that wants a disk asks
 * for one.
 */
const DEFAULT_CA_BRUSH = 0;

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
.overlay svg { width: 22%; max-width: 88px; opacity: 0.85; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.7)); }
.overlay:hover { background: rgba(16, 18, 20, 0.22); }
.overlay:hover svg { opacity: 1; }
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

export class HexCAElement extends HTMLElement {
    static get observedAttributes() {
        return ['code', 'states', 'rows', 'backend', 'speed', 'palette', 'paused', 'max-dpr',
            'link', 'draw', 'draw-state', 'brush'];
    }

    constructor() {
        super();

        const root = this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = STYLES;

        this._canvas = document.createElement('canvas');

        this._overlay = document.createElement('button');
        this._overlay.className = 'overlay';
        this._overlay.type = 'button';
        this._overlay.setAttribute('part', 'overlay');
        this._overlay.setAttribute('aria-label', 'Play simulation');
        this._overlay.innerHTML = PLAY_ICON;
        this._overlay.hidden = true;
        this._overlay.addEventListener('click', () => this.play());

        this._attrib = document.createElement('a');
        this._attrib.className = 'attrib';
        this._attrib.target = '_blank';
        this._attrib.rel = 'noopener noreferrer';
        this._attrib.textContent = 'HexLife';
        this._attrib.hidden = true;

        this._errorBox = document.createElement('div');
        this._errorBox.className = 'error';
        this._errorBox.hidden = true;

        root.append(style, this._canvas, this._overlay, this._attrib, this._errorBox);

        /** @type {import('./ca.js').HexCA|null} */
        this.world = null;
        /** @type {EmbedRenderer|null} */
        this.renderer = null;
        /** @type {string|null} Non-null while the element is in its styled error state. */
        this.error = null;

        /**
         * The cells this world started from, so {@link reset} can rewind to them. A private copy,
         * not a view: `HexCA.state` is a window into wasm linear memory that both detaches and keeps
         * changing as the world ticks, so keeping one here would rewind to "now".
         * @type {Uint8Array|null}
         */
        this._initialCells = null;
        /**
         * The rule currently installed, kept so {@link caCode} can encode the world without asking
         * wasm to hand a `k⁷` table back across the boundary.
         * @type {Uint8Array|Uint16Array|null}
         */
        this._rule = null;
        /** Resolved k-entry palette, kept so `caCode()` can carry the colours actually on screen. */
        this._palette = null;

        // --- playback gates. The loop runs only when ALL of these say yes. ---
        this._userPaused = false;
        this._onScreen = true;
        this._docVisible = document.visibilityState !== 'hidden';
        this._reducedMotion = false;
        this._playRequested = false;
        /** @type {{playing: boolean, userPaused: boolean}|null} */
        this._lastPlayState = null;

        this._rafId = 0;
        this._lastFrameTime = 0;

        // --- draw (paint a state) ---
        this._drawing = false;
        this._drawPointerId = null;
        this._lastDrawCoords = null;
        this._resumeAfterStroke = false;
        /** Brush radius in cells; 0 paints the cell under the pointer and nothing else. */
        this._brushSize = DEFAULT_CA_BRUSH;
        /** Cells already painted during the current stroke, so a slow drag re-pokes nothing. */
        this._strokeAffected = new Set();
        /** Scratch for {@link collectBrushCells}, reused so a drag allocates no sets. */
        this._brushCells = new Set();
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        /** See `HexLifeElement._hasConnected` — attribute parsing precedes the first connect. */
        this._hasConnected = false;
        /** Bumped on every connect/disconnect; an async boot bails if it has moved on. */
        this._generation = 0;

        this._onVisibilityChange = () => {
            this._docVisible = document.visibilityState !== 'hidden';
            this._syncPlayback();
        };
        this._frame = this._frame.bind(this);

        this._resizeObserver = null;
        this._intersectionObserver = null;
        this._motionQuery = null;
        this._onMotionChange = null;

        // --- GPU context loss ---
        this._contextLost = false;
        this._onContextLost = this._onContextLost.bind(this);
        this._onContextRestored = this._onContextRestored.bind(this);
        // Bound here and never unbound, exactly as `<hexlife-world>` does: a rebuild runs `_teardown`
        // before `_boot`, and a context lost in that window must still find a listener.
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
        this._generation++;
        this._teardown();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        if (!this._hasConnected || !this.isConnected) return;
        if (!this.world || !this.renderer) {
            this._rebootSoon();
            return;
        }
        // A `code` is a whole world; so is any structural attribute. Both mean a different world.
        if (!LIVE_ATTRS.has(name)) {
            this._rebootSoon();
            return;
        }

        switch (name) {
            case 'speed':
                this.world.speed = readCaSpeed(this.getAttribute('speed'));
                break;
            case 'palette':
                this._applyPalette();
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
            case 'draw':
                if (!this.hasAttribute('draw')) this._endDrawStroke();
                this._applyPointerAffordance();
                this._syncPlayback();
                break;
            case 'draw-state':
                // Nothing to apply: `_readDrawState` reads the attribute on every stroke.
                break;
            case 'brush':
                this._brushSize = this._readBrushSize();
                break;
        }
    }

    _rebootSoon() {
        this._generation++;
        this._teardown();
        this._boot(this._generation);
    }

    // --- public JS API --------------------------------------------------------

    /** Start (or resume). An explicit call also overrides `prefers-reduced-motion`. */
    play() {
        this._playRequested = true;
        this._userPaused = false;
        if (this.hasAttribute('paused')) this.removeAttribute('paused');
        else this._syncPlayback();
    }

    /** Pause. The current generation stays on screen. */
    pause() {
        this._userPaused = true;
        if (!this.hasAttribute('paused')) this.setAttribute('paused', '');
        else this._syncPlayback();
    }

    /**
     * Install the rule table. **This is how a rule gets in** for anything but a `code` — see the
     * header for why there is no attribute form.
     *
     * @param {ArrayLike<number>} rule `k⁷` entries for `'neighborhood'`, `k³` for `'block'`.
     * @returns {boolean} False when there is no live world (still booting, or in the error state);
     *   an invalid table lands in the error box rather than throwing, per rule 1.
     */
    setRule(rule) {
        if (!this.world || this.error) return false;
        try {
            this.world.setRule(rule);
        } catch (e) {
            this._fail('Invalid rule table.', String(e && e.message ? e.message : e));
            return false;
        }
        // Kept as the element's own copy so `caCode()` never has to read a k⁷ table back out of wasm.
        this._rule = rule instanceof Uint8Array || rule instanceof Uint16Array
            ? new (rule.constructor)(rule)
            : Uint8Array.from(rule);
        this._afterMutation();
        return true;
    }

    /**
     * Replace every cell, and make this the state {@link reset} rewinds to.
     *
     * The supported bulk write: it validates the states and wakes the engine's activity tracker, so
     * the region that changed is actually recomputed. A poke straight through `world.state` does
     * neither — see `markAllDirty` in the `@hexlife/embed/ca` docs.
     *
     * @param {ArrayLike<number>} cells `rows * columns` entries in `0..states`.
     * @returns {boolean}
     */
    setCells(cells) {
        if (!this.world || this.error) return false;
        try {
            this.world.setCells(cells);
        } catch (e) {
            this._fail('Invalid cells.', String(e && e.message ? e.message : e));
            return false;
        }
        this._initialCells = Uint8Array.from(cells);
        this._afterMutation();
        return true;
    }

    /** Set one cell, waking its neighbourhood. @param {number} index @param {number} value */
    setCell(index, value) {
        if (!this.world || this.error) return false;
        try {
            this.world.setCell(index, value);
        } catch {
            return false;   // An out-of-range poke is the caller's bug, not a reason to blank a world.
        }
        this._afterMutation();
        return true;
    }

    /** Rewind to the cells this world started from (or blank it, if it never had any). */
    reset() {
        if (!this.world || this.error) return;
        if (this._initialCells) this.world.setCells(this._initialCells);
        else this.world.fill(0);
        this._afterMutation();
    }

    /**
     * Blank the world: every cell state 0, nothing else touched — same rule, same speed, same play
     * state. Distinct from {@link reset}, which hands back the *authored* tick 0.
     */
    clear() {
        if (!this.world || this.error) return;
        this.world.fill(0);
        this._afterMutation();
    }

    /**
     * Advance exactly `n` generations right now, independent of `speed` and the play state.
     * @param {number} [n=1]
     * @returns {number} The new generation count.
     */
    tick(n = 1) {
        if (!this.world || this.error) return 0;
        this.world.tick(Math.max(0, Math.floor(n)));
        this._afterMutation();
        return this.world.generation;
    }

    /**
     * Draw the world's current cells, whoever wrote them.
     *
     * For the one case the write path cannot cover: a *native* producer — `DifferenceMask`'s
     * `compareInto`, say — that fills this world's buffer inside wasm. Nothing crossed the boundary,
     * so nothing told the element anything changed, and a paused element would keep showing the
     * previous frame forever. Going through `setCells` instead would mean copying a wasm buffer out
     * to JavaScript and straight back in, which is the cost that analysis exists to avoid.
     *
     * Not needed after `setCells`, `setCell`, `tick`, `reset` or `clear` — those already draw.
     */
    redraw() {
        this._afterMutation();
    }

    /**
     * Per-state occupancy of the current generation.
     *
     * The measurement the block backend exists for: under a conservative block rule every entry holds
     * forever, and under *any* radius-1 rule it cannot — see the `@hexlife/embed/ca` docs.
     * @returns {Uint32Array|null}
     */
    census() {
        return this.world && !this.error ? this.world.census() : null;
    }

    /**
     * Encode the world as it stands right now into an `HXK1.` code — grid, `k`, backend, rule,
     * exact cells and the colours on screen.
     *
     * A **distinct prefix** from `HXW1`, so a binary decoder rejects it outright rather than
     * half-reading it. `<hexlife-world code=…>` will refuse one of these, which is the intent.
     *
     * @returns {Promise<string|null>} Null when there is nothing to encode, or no rule installed.
     */
    async caCode() {
        if (!this.world || this.error || !this._rule) return null;
        const cells = this.world.snapshotCells();
        if (!cells) return null;
        return encodeCaCode({
            rows: this.world.rows,
            cols: this.world.columns,
            states: this.world.states,
            backend: this.world.backend,
            rule: this._rule,
            cells,
            palette: this._palette,
            speed: this.world.speed,
        });
    }

    /** @returns {number} Generations elapsed since boot. */
    get generation() { return this.world ? this.world.generation : 0; }

    /** @returns {number} `k`. */
    get states() { return this.world ? this.world.states : 0; }

    get rows() { return this.world ? this.world.rows : 0; }

    get columns() { return this.world ? this.world.columns : 0; }

    /** @returns {'neighborhood'|'block'|null} */
    get backend() { return this.world ? this.world.backend : null; }

    /** @returns {number} Rolling hash of the current generation. */
    get checksum() { return this.world ? this.world.checksum() : 0; }

    /**
     * @returns {boolean} Whether the world has reached a fixed point it can never leave.
     *
     * Worth acting on rather than merely displaying: a settled world is genuinely free, so a host
     * can stop scheduling frames entirely. This element does exactly that — see `_frame`.
     */
    get isSettled() { return this.world ? this.world.isSettled : false; }

    /** @returns {{active: number, total: number}|null} The chunk-skipping pay-off. */
    get chunkActivity() { return this.world ? this.world.chunkActivity : null; }

    /** @returns {boolean} Whether the animation loop is currently running. */
    get playing() { return this._rafId !== 0; }

    /** @returns {boolean} True when the user has paused, ignoring the viewport gates. */
    get userPaused() { return this._userPaused; }

    /** @returns {number} Brush radius used by `draw` strokes; 0 is a single cell. */
    get brushSize() { return this._brushSize; }

    /**
     * Set the brush radius from script.
     *
     * @param {number} size Clamped to 0 … `MAX_BRUSH_SIZE`.
     *
     * Does not reflect into the `brush` attribute — same contract as `<hexlife-world>`: a host
     * should drive brush size through one of the two, because the attribute is re-read whenever it
     * changes and would win the next time it moved.
     */
    setBrushSize(size) {
        this._brushSize = clampBrushSize(size);
    }

    // --- boot / teardown ------------------------------------------------------

    /**
     * @param {number} generation The `_generation` at call time; if it has moved on by the time an
     *   await resolves, this boot was superseded and must do nothing.
     */
    async _boot(generation) {
        this._clearError();

        const raw = (this.getAttribute('code') || '').trim();
        if (raw && !isCaCode(raw)) {
            this._fail(
                'Invalid “code”.',
                'Not a HexLife k-state world code — these start with “HXK1.”. A binary “HXW1.” code '
                + 'belongs on <hexlife-world>, which is a different engine.',
            );
            return;
        }
        const decoded = raw ? await decodeCaCode(raw) : null;
        if (generation !== this._generation) return;
        if (raw && !decoded) {
            this._fail('Invalid “code”.', 'Not a HexLife k-state world code (or it was truncated in transit).');
            return;
        }

        // A code is a complete world and *replaces* the individual attributes, exactly as `HXW1`
        // does on `<hexlife-world>`. Anything half-applied there would be a different world.
        const backend = decoded ? decoded.backend : readCaBackend(this.getAttribute('backend'));
        const states = decoded ? decoded.states : readCaStates(this.getAttribute('states'), backend);
        let rows;
        let columns;
        if (decoded) {
            rows = decoded.rows;
            columns = decoded.cols;
        } else {
            const parsed = readCaRows(this.getAttribute('rows'), backend);
            // The one place this element refuses rather than clamps. The engine throws on
            // `rows % 3 != 0` in block mode because a rounded grid is not the grid you asked for; we
            // catch it here so the refusal reaches the author as readable text, not an exception.
            if (parsed.problem) {
                this._fail(parsed.problem.message, parsed.problem.detail);
                return;
            }
            rows = parsed.rows;
            columns = caColumnsForRows(rows);
        }
        const speed = decoded ? decoded.speed : readCaSpeed(this.getAttribute('speed'));

        this._userPaused = this.hasAttribute('paused');
        this._playRequested = false;
        this._docVisible = document.visibilityState !== 'hidden';
        this._brushSize = this._readBrushSize();

        this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion = this._motionQuery.matches;
        this._onMotionChange = (e) => {
            this._reducedMotion = e.matches;
            if (e.matches) this._playRequested = false;
            this._syncPlayback();
        };
        this._motionQuery.addEventListener('change', this._onMotionChange);

        try {
            await initEmbedWasm();
        } catch (e) {
            if (generation !== this._generation) return;
            this._fail('Simulation engine failed to load.', String(e && e.message ? e.message : e));
            return;
        }
        if (generation !== this._generation) return;

        try {
            this.world = new HexCA({ states, rows, columns, backend, speed });
        } catch (e) {
            this._fail('Simulation failed to start.', String(e && e.message ? e.message : e));
            return;
        }

        // The rule and cells before the renderer, so the first frame is never a blank world that
        // then flickers into its authored state.
        if (decoded) {
            try {
                this.world.setRule(decoded.rule);
                this.world.setCells(decoded.cells);
            } catch (e) {
                this._fail('The world code did not fit its own header.', String(e && e.message ? e.message : e));
                return;
            }
            this._rule = decoded.rule;
            this._initialCells = decoded.cells;
        }

        try {
            this.renderer = new EmbedRenderer(this._canvas, { cols: columns, rows });
        } catch (e) {
            this._fail('This browser can’t run WebGL2.', String(e && e.message ? e.message : e));
            return;
        }

        if (!this._applyPalette(decoded ? decoded.palette : null)) {
            this._fail('The k-state shader program failed to build.',
                'WebGL2 is present but would not compile the palette program.');
            return;
        }

        document.addEventListener('visibilitychange', this._onVisibilityChange);

        this._resizeObserver = new ResizeObserver(() => {
            this._resize();
            if (!this.playing) this._drawOnce();
        });
        this._resizeObserver.observe(this);

        this._intersectionObserver = new IntersectionObserver(
            (entries) => {
                this._onScreen = entries[entries.length - 1].isIntersecting;
                this._syncPlayback();
            },
            { threshold: 0 },
        );
        this._intersectionObserver.observe(this);

        this._bindDrawListeners(true);
        this._resize();
        this._updateAttribution();
        this._drawOnce();
        this._syncPlayback();

        this.dispatchEvent(new CustomEvent('hexlife-ca-ready', {
            bubbles: true,
            composed: true,
            detail: {
                states, rows, columns, backend,
                numCells: this.world.numCells,
                /** False until a rule is installed — a world with no rule dies on tick one. */
                hasRule: !!this._rule,
            },
        }));
    }

    _teardown() {
        this._stopLoop();
        this._endDrawStroke();
        this._bindDrawListeners(false);

        if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
        if (this._intersectionObserver) { this._intersectionObserver.disconnect(); this._intersectionObserver = null; }
        if (this._motionQuery && this._onMotionChange) {
            this._motionQuery.removeEventListener('change', this._onMotionChange);
        }
        this._motionQuery = null;
        this._onMotionChange = null;
        document.removeEventListener('visibilitychange', this._onVisibilityChange);

        if (this.renderer) { this.renderer.destroy(); this.renderer = null; }
        // Frees the wasm world and unregisters it from the view-refresh registry. Skipping this
        // would leak linear memory for the lifetime of the page — rule 2.
        if (this.world) { this.world.dispose(); this.world = null; }

        this._overlay.hidden = true;
        this._rule = null;
        this._initialCells = null;
        this._palette = null;
        this._lastPlayState = null;
    }

    // --- palette --------------------------------------------------------------

    /**
     * Resolve the k-entry palette and hand it to the renderer.
     * @param {Array<ArrayLike<number>>|null} [fromCode] Colours a `code` carried, which win over the
     *   attribute the same way every other world-defining field does.
     * @returns {boolean} False if the state program could not be built.
     */
    _applyPalette(fromCode = null) {
        if (!this.world || !this.renderer) return false;
        const colors = fromCode && fromCode.length === this.world.states
            ? fromCode
            : readCaPalette(this.getAttribute('palette'), this.world.states);
        this._palette = colors;
        return this.renderer.setStatePalette(colors);
    }

    // --- playback -------------------------------------------------------------

    /** The single place playback is decided; every gate updates a flag and calls this. */
    _syncPlayback() {
        if (!this.world || !this.renderer || this.error || this._contextLost) { this._stopLoop(); return; }

        const motionAllowed = !this._reducedMotion || this._playRequested;
        const wants = !this._userPaused && motionAllowed && !this._drawing;
        const canRun = wants && this._onScreen && this._docVisible;

        // With `draw` on, the host usually owns the play chrome and pointer events must reach the
        // canvas to paint — same trade `<hexlife-world>` makes.
        const pointerOwned = this.hasAttribute('draw');
        this._overlay.hidden = wants || pointerOwned;

        if (canRun) this._startLoop();
        else this._stopLoop();

        this._emitPlayState();
    }

    /** Announce `{playing, userPaused}` whenever it changes, deduped. */
    _emitPlayState() {
        const playing = this.playing;
        const userPaused = this._userPaused;
        const last = this._lastPlayState;
        if (last && last.playing === playing && last.userPaused === userPaused) return;
        this._lastPlayState = { playing, userPaused };
        this.dispatchEvent(new CustomEvent('hexlife-ca-playstate', {
            bubbles: true,
            composed: true,
            detail: { playing, userPaused },
        }));
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
        const dt = Math.min(now - this._lastFrameTime, 100);
        this._lastFrameTime = now;
        const ticks = this.world.advance(dt);

        // A settled world is a fixed point it can never leave, so there is nothing left to compute
        // *or* to draw. Stopping the loop outright — rather than spinning on a world that returns
        // "0 changed" forever — is the whole practical value of `isSettled`, and physical models
        // settle constantly (a pool comes to rest, a front reaches the far wall). Every write path
        // goes through `_afterMutation`, which is what wakes the loop again.
        if (this.world.isSettled) {
            this._rafId = 0;
            if (ticks) this.renderer.drawStates(this.world.state);
            this.dispatchEvent(new CustomEvent('hexlife-ca-settled', {
                bubbles: true,
                composed: true,
                detail: { generation: this.world.generation },
            }));
            this._emitPlayState();
            return;
        }

        this._rafId = requestAnimationFrame(this._frame);
        this.renderer.drawStates(this.world.state);
    }

    /** Render the current generation exactly once (resizes, `tick()`, `reset()`, paint strokes). */
    _drawOnce() {
        if (this.world && this.renderer && !this.error && !this._contextLost) {
            this.renderer.drawStates(this.world.state);
        }
    }

    /**
     * Draw, then re-decide playback. Every path that *writes cells or the rule* ends here rather
     * than at `_drawOnce`, and the reason is `_frame`'s settle branch: a world that reached a fixed
     * point has stopped its own loop, and a write is exactly the thing that can un-settle it.
     * Without this, painting into a pool that had come to rest would leave the new cells sitting
     * there motionless — the most confusing bug this element could have.
     */
    _afterMutation() {
        this._drawOnce();
        this._syncPlayback();
    }

    _resize() {
        if (!this.renderer || this._contextLost) return;
        const rect = this.getBoundingClientRect();
        this.renderer.resize(rect.width || 1, rect.height || 1, readCaMaxDpr(this.getAttribute('max-dpr')));
    }

    // --- draw (paint a state) -------------------------------------------------
    // The k-state counterpart of `<hexlife-world>`'s invert brush. It paints a *value* rather than
    // flipping a bit, because there is nothing to flip: with k states there is no "the other one".

    /**
     * @returns {number} Brush radius for a stroke: the `brush` attribute if it names one, else a
     *   single cell. A bare `brush` falls through rather than coercing to 0, for the same reason
     *   `<hexlife-world>` does it — `brush=""` reading as "single cell" is a surprise, not a default.
     */
    _readBrushSize() {
        const raw = (this.getAttribute('brush') || '').trim();
        return raw === '' ? DEFAULT_CA_BRUSH : clampBrushSize(raw);
    }

    /** @returns {number} The state a stroke paints; clamped into range, default 1. */
    _readDrawState() {
        const raw = parseInt(String(this.getAttribute('draw-state')), 10);
        const k = this.world ? this.world.states : 2;
        if (!Number.isFinite(raw)) return Math.min(1, k - 1);
        return Math.min(k - 1, Math.max(0, raw));
    }

    _bindDrawListeners(on) {
        const method = on ? 'addEventListener' : 'removeEventListener';
        this._canvas[method]('pointerdown', this._onPointerDown);
        this._canvas[method]('pointermove', this._onPointerMove);
        this._canvas[method]('pointerup', this._onPointerUp);
        this._canvas[method]('pointercancel', this._onPointerUp);
        this._canvas[method]('lostpointercapture', this._onPointerUp);
        if (on) this._applyPointerAffordance();
        else {
            this._canvas.style.touchAction = '';
            this._canvas.style.cursor = '';
        }
    }

    _applyPointerAffordance() {
        const owned = this.hasAttribute('draw');
        this._canvas.style.touchAction = owned ? 'none' : '';
        this._canvas.style.cursor = owned ? 'crosshair' : '';
    }

    _onPointerDown(e) {
        if (!this.world || !this.renderer || this.error) return;
        if (!this.hasAttribute('draw')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const hit = this._hit(e);
        if (!hit) return;

        e.preventDefault();
        this._drawing = true;
        this._drawPointerId = e.pointerId;
        this._lastDrawCoords = hit;
        this._strokeAffected.clear();
        this._resumeAfterStroke = !this._userPaused && this.playing;
        this._syncPlayback();   // Pause while drawing, without flipping the `paused` attribute.
        try { this._canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        this._paintLine(hit, hit);
    }

    _onPointerMove(e) {
        if (!this._drawing || e.pointerId !== this._drawPointerId) return;
        e.preventDefault();
        const hit = this._hit(e);
        if (!hit || !this._lastDrawCoords) return;
        if (hit.col === this._lastDrawCoords.col && hit.row === this._lastDrawCoords.row) return;
        // From the previous sample, not just at this one: a fast drag skips cells, and a brush that
        // only stamps where the pointer was sampled leaves a dotted line instead of a stroke.
        this._paintLine(this._lastDrawCoords, hit);
        this._lastDrawCoords = hit;
    }

    _onPointerUp(e) {
        if (!this._drawing) return;
        if (e && this._drawPointerId != null && e.pointerId !== this._drawPointerId) return;
        this._endDrawStroke();
    }

    _hit(e) {
        const rect = this._canvas.getBoundingClientRect();
        return this.renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
    }

    /**
     * Paint one segment of a stroke: every cell within {@link _brushSize} of the hex line from
     * `from` to `to`, each set once per stroke.
     *
     * @param {{col: number, row: number}} from
     * @param {{col: number, row: number}} to
     */
    _paintLine(from, to) {
        const state = this._readDrawState();
        const columns = this.world.columns;
        const rows = this.world.rows;
        for (const point of getHexLine(from.col, from.row, to.col, to.row)) {
            collectBrushCells(point.col, point.row, this._brushSize, columns, rows, this._brushCells);
            for (const index of this._brushCells) {
                if (this._strokeAffected.has(index)) continue;
                this._strokeAffected.add(index);
                // Through `setCell`, never through the `state` view: the engine skips chunks that did
                // not change, and a poke straight into the buffer is invisible to that tracker.
                this.world.setCell(index, state);
            }
        }
        // `_drawOnce`, not `_afterMutation`: the stroke deliberately holds the loop until it ends,
        // and `_endDrawStroke` is what hands playback back.
        this._drawOnce();
    }

    _endDrawStroke() {
        if (!this._drawing && !this._resumeAfterStroke) {
            this._drawPointerId = null;
            this._lastDrawCoords = null;
            this._strokeAffected.clear();
            return;
        }
        this._drawing = false;
        this._drawPointerId = null;
        this._lastDrawCoords = null;
        this._resumeAfterStroke = false;
        this._strokeAffected.clear();
        this._syncPlayback();
    }

    // --- GPU context loss -----------------------------------------------------
    // Every GL call on a lost context is a silent no-op, so without these the failure is total and
    // invisible: the loop keeps running, `playing` stays true, and the canvas stays blank forever.
    //
    // Simpler than `<hexlife-world>`'s handling in one respect and better in another. Simpler: there
    // is no torus here, so the "recovering caused the next loss" spiral that element guards against
    // has no engine. Better: rebooting would rebuild the `HexCA` and replay tick 0, throwing away a
    // model somebody may have been running for minutes — so the restore path rebuilds only the
    // *renderer* and hands it the world that is still perfectly alive in wasm.

    _onContextLost(event) {
        if (this._contextLost) return;
        this._contextLost = true;
        this._stopLoop();
        this._endDrawStroke();
        // Load-bearing, not conventional: the spec only fires `webglcontextrestored` for a
        // *cancelled* `webglcontextlost`.
        event.preventDefault();
        console.warn('<hexlife-ca>: WebGL context lost; waiting for the browser to restore it.');
        this.dispatchEvent(new CustomEvent('hexlife-ca-contextlost', { bubbles: true, composed: true }));
    }

    _onContextRestored() {
        if (!this._contextLost) return;
        this._contextLost = false;
        if (!this.isConnected || !this.world) return;

        // A restored context is a *blank* one: every buffer, texture, VAO and program died with the
        // old one. The simulation did not — it lives in wasm linear memory, untouched — so only the
        // renderer is rebuilt.
        if (this.renderer) { this.renderer.destroy(); this.renderer = null; }
        try {
            this.renderer = new EmbedRenderer(this._canvas, {
                cols: this.world.columns,
                rows: this.world.rows,
            });
        } catch (e) {
            this._fail('The GPU dropped this world.', String(e && e.message ? e.message : e));
            return;
        }
        if (!this._applyPalette()) {
            this._fail('The GPU dropped this world.', 'The palette program would not rebuild.');
            return;
        }
        console.warn('<hexlife-ca>: WebGL context restored; the simulation continued in wasm.');
        this.dispatchEvent(new CustomEvent('hexlife-ca-contextrestored', { bubbles: true, composed: true }));
        this._resize();
        this._drawOnce();
        this._syncPlayback();
    }

    // --- chrome ---------------------------------------------------------------

    /**
     * The attribution link.
     *
     * Deliberately *not* the deep link `<hexlife-world>` builds. That one carries the ruleset into
     * the Explorer, and the Explorer is binary — it has no way to open a k-state world, so a link
     * pretending otherwise would be worse than a plain one.
     */
    _updateAttribution() {
        if (this.getAttribute('link') === 'off') {
            this._attrib.hidden = true;
            return;
        }
        this._attrib.href = APP_URL;
        this._attrib.title = 'HexLife — hexagonal cellular automata';
        this._attrib.hidden = false;
    }

    /** Enter the styled error state: no world, no loop, a readable message, link kept. */
    _fail(message, detail) {
        this.error = message;
        this._teardown();
        this._errorBox.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = `<hexlife-ca>: ${message}`;
        const code = document.createElement('code');
        code.textContent = detail || '';
        this._errorBox.append(strong, code);
        this._errorBox.hidden = false;
        this._updateAttribution();
        console.warn(`<hexlife-ca>: ${message} ${detail || ''}`);
        // Rule 1 says we never throw into the host page — it does not say we get to say nothing.
        this.dispatchEvent(new CustomEvent('hexlife-ca-error', {
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
