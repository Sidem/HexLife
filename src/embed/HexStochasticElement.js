// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * `<hexlife-stochastic>` — the public custom element for **stochastic** worlds (STOCHASTIC-PLAN §8).
 *
 * The third element in the family, and a separate one for the same reason `WorldStochastic` is a
 * third struct rather than a mode on the other two: it lives in a **separate Wasm artifact**, and
 * that isolation is the whole point. `<hexlife-world>` and `<hexlife-ca>` consumers must download
 * and instantiate exactly zero stochastic bytes, which is only true while no module they import
 * reaches this one. This file imports `./stochastic.js`; nothing on the binary or k-state path
 * imports this file.
 *
 * What it *does* share is `EmbedRenderer` — the instanced draw, the fit, the camera and `hitTest`
 * are state-agnostic, and the k-state palette program draws a stochastic world's visible states
 * without knowing what they mean — and `<hexlife-ca>`'s lifecycle policies, verbatim:
 *
 * 1. **Never throw into the host page.** A bad `code`, a missing WebGL2 context, a wasm init
 *    failure, a malformed rule — every one lands in a styled error box inside our shadow root.
 * 2. **Never leak.** `StochasticWorld` owns wasm memory in the isolated artifact, and a removed
 *    element that kept its rAF alive would keep ticking a freed world. `disconnectedCallback` tears
 *    down in reverse order of setup and voids the async-init race (see `_generation`).
 *
 * Plus offscreen pause, hidden-tab pause, reduced motion, a DPR cap, and context-loss recovery that
 * rebuilds only renderer resources — the simulation lives in wasm and survives a lost GPU.
 *
 * ## The visible-state view is read directly
 *
 * The render loop calls native `tick(n)` and then hands `world.state` — a `Uint8Array` view straight
 * into the isolated artifact's linear memory — to the renderer. There is no per-tick snapshot, no
 * host-side mirror, and no `setCells()` upload: `setCells()` is an *intervention* API here and is
 * never used as a streaming one. Read `world.state` fresh at every draw, never cache it: the
 * neighborhood tick swaps its two visible buffers, and any allocating call can detach the view.
 *
 * ## Where the rule and the seed come from
 *
 * Not from attributes. A compiled `HSN1` rule is 272 bytes per row and an `HSG1` gas table is 32 KB,
 * so there is no honest way to spell either in HTML. A rule arrives either inside a `code`
 * (`HXS1.`, which carries the whole world including its generation) or through
 * {@link HexStochasticElement#setRule}. The **backend follows the rule**: installing an `HSG1` table
 * on a neighborhood world rebuilds it as a lattice gas, so there is no `backend` attribute to
 * contradict the rule bytes.
 *
 * The seed is a JS property rather than an attribute for the same reason it is a *fixed* default
 * rather than entropy: §7 forbids hidden entropy, and a host that cares about the seed is already
 * writing the script that installs the rule.
 *
 * ## Deliberately absent
 *
 * No torus projection, no poster burst, no pinch/wheel camera — feed decoration this element has no
 * use for. And no settle short-circuit: `<hexlife-ca>` stops its loop on `isSettled` because a
 * k-state fixed point is genuinely unleavable, whereas a stochastic world with a spontaneous
 * transition can wake on any tick. There is nothing here that could honestly be called settled.
 */

import { EmbedRenderer } from './EmbedRenderer.js';
import {
    BACKEND_LATTICE_GAS,
    BACKEND_NEIGHBORHOOD,
    createStochasticWorldFromCode,
    GAS_STATES,
    initStochasticEngine,
    isStochasticCode,
    StochasticWorld,
} from './stochastic.js';
import {
    readStochasticPalette,
    readStochasticRows,
    readStochasticSpeed,
    stochasticColumnsForRows,
    STOCHASTIC_DEFAULTS,
} from './stochasticAttrs.js';
import { clampBrushSize, collectBrushCells, getHexLine } from '../core/hexBrush.js';

/** Where the attribution link points. */
const APP_URL = 'https://sidem.github.io/HexLife/';

/** Hard cap on ticks simulated per frame — the same anti-spiral guard `HexCA.advance` uses. */
const MAX_TICKS_PER_FRAME = 4;

/**
 * Attributes that reconfigure a **live** world instead of re-booting it.
 *
 * Same discipline as `<hexlife-ca>`'s `LIVE_ATTRS`, and the same expensive failure mode if it is
 * wrong — worse here, in fact: a re-boot rebuilds the `StochasticWorld` at generation 0 *and* drops
 * the installed rule, because the rule came from script that has already run.
 */
const LIVE_ATTRS = new Set(['paused', 'speed', 'palette', 'link', 'draw', 'draw-state', 'brush']);

/** Brush radius when `brush` is absent — a single cell, matching `<hexlife-ca>`'s default. */
const DEFAULT_STOCHASTIC_BRUSH = 0;

/** `HSG1` — the lattice-gas collision table's magic. Anything else compiled is `HSN1`. */
const GAS_RULE_MAGIC = [0x48, 0x53, 0x47, 0x31];

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

/**
 * The two shapes a palette takes, and the boundary between them.
 *
 * `EmbedRenderer` wants one `[r, g, b]` per state; `HXS1` stores a flat byte run and validates its
 * length as `states * 3`. Handing the codec the renderer's shape yields a silent
 * `Uint8Array.from([[26, 26, 26], …])` of NaNs, which fails that length check — so the conversion is
 * explicit in both directions rather than implied.
 *
 * @param {Array<ArrayLike<number>>|null} colors
 * @returns {Uint8Array|null}
 */
function flattenPalette(colors) {
    if (!colors || !colors.length) return null;
    const flat = new Uint8Array(colors.length * 3);
    colors.forEach((color, index) => {
        flat[index * 3] = color[0] & 0xFF;
        flat[index * 3 + 1] = color[1] & 0xFF;
        flat[index * 3 + 2] = color[2] & 0xFF;
    });
    return flat;
}

/** @param {ArrayLike<number>} flat @param {number} states @returns {Array<[number, number, number]>} */
function unflattenPalette(flat, states) {
    const colors = [];
    for (let index = 0; index < states; index++) {
        colors.push([flat[index * 3], flat[index * 3 + 1], flat[index * 3 + 2]]);
    }
    return colors;
}

export class HexStochasticElement extends HTMLElement {
    static get observedAttributes() {
        return ['code', 'rows', 'speed', 'palette', 'paused', 'draw', 'draw-state', 'brush', 'link'];
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

        /** @type {import('./stochastic.js').StochasticWorld|null} */
        this.world = null;
        /** @type {EmbedRenderer|null} */
        this.renderer = null;
        /** @type {string|null} Non-null while the element is in its styled error state. */
        this.error = null;

        /**
         * The seed every world this element builds is constructed with.
         *
         * Held here rather than read back from `world.seed` because it has to survive the world: a
         * backend switch disposes one world and builds another, and that must be the *same run*.
         * @type {bigint}
         */
        this._seed = STOCHASTIC_DEFAULTS.seed;
        /** @type {'neighborhood'|'lattice-gas'} Follows the installed rule; see `setRule`. */
        this._backend = BACKEND_NEIGHBORHOOD;
        /** False until a rule is installed — until then a tick would throw, so the loop stays down. */
        this._hasRule = false;
        /** Resolved palette, kept so `stochasticCode()` carries the colours actually on screen. */
        this._palette = null;

        // --- playback. `speed` and the accumulator live here rather than on the engine: the
        // DOM-free entry's contract is `tick(n)`, and wall-clock pacing is a host concern.
        this._speed = STOCHASTIC_DEFAULTS.speed;
        this._accumulator = 0;

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
        this._brushSize = DEFAULT_STOCHASTIC_BRUSH;
        /** Cells already written during the current stroke, so a slow drag re-pokes nothing. */
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
        // Bound here and never unbound, exactly as the other two elements do: a rebuild runs
        // `_teardown` before `_boot`, and a context lost in that window must still find a listener.
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
        // A `code` is a whole world; so is `rows`. Both mean a different world.
        if (!LIVE_ATTRS.has(name)) {
            this._rebootSoon();
            return;
        }

        switch (name) {
            case 'speed':
                this._speed = readStochasticSpeed(this.getAttribute('speed'));
                this._accumulator = 0;
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
     * Install the compiled rule table. **This is how a rule gets in** for anything but a `code`.
     *
     * The bytes decide the backend: an `HSG1` gas table on a neighborhood world rebuilds the world
     * as a lattice gas (and vice versa) before installing, because a `WorldStochastic` allocates one
     * backend's buffers at construction and never the other's. A rebuild is a *new world at
     * generation 0* — same seed, same geometry — so any cells written beforehand are gone, which is
     * unavoidable: they were states of the other backend.
     *
     * @param {ArrayLike<number>} rule `HSN1` bytes from `compileStochasticRule`, or `HSG1` bytes
     *   from `compileGasRule`.
     * @returns {boolean} False when there is no live world (still booting, or in the error state);
     *   invalid bytes land in the error box rather than throwing, per rule 1.
     */
    setRule(rule) {
        if (!this.world || this.error) return false;
        const bytes = rule instanceof Uint8Array ? rule : Uint8Array.from(rule);
        const backend = GAS_RULE_MAGIC.every((byte, index) => bytes[index] === byte)
            ? BACKEND_LATTICE_GAS
            : BACKEND_NEIGHBORHOOD;
        if (backend !== this._backend && !this._rebuildForBackend(backend)) return false;
        try {
            this.world.setRule(bytes);
        } catch (e) {
            this._fail('Invalid rule table.', String(e && e.message ? e.message : e));
            return false;
        }
        this._hasRule = true;
        // `states` is 0 until a rule lands and then becomes the rule's own count, so the palette can
        // only be resolved now. Without this the renderer would still be holding the one-entry
        // placeholder and would draw every state as the background.
        if (!this._applyPalette()) {
            this._fail('The state shader program failed to build.',
                'WebGL2 is present but would not compile the palette program.');
            return false;
        }
        this._afterMutation();
        return true;
    }

    /**
     * Replace the exact generation-zero state, and make it what {@link reset} rewinds to.
     *
     * The element owns its initial snapshot *inside the engine* — this is a one-shot upload, not a
     * per-tick one. Neighborhood backend only; the gas equivalent is
     * {@link setInitialGasState}.
     *
     * @param {ArrayLike<number>} cells `rows * columns` visible states.
     * @param {ArrayLike<number>|null} [elapsedAges] Per-cell age at generation 0; defaults to zero.
     * @returns {boolean}
     */
    setInitialState(cells, elapsedAges = null) {
        return this._mutate(() => this.world.setInitialState(cells, elapsedAges), 'Invalid cells.');
    }

    /**
     * Intervention-only bulk replacement at the **current** generation.
     *
     * Deliberately not a streaming API: nothing in this element calls it per tick, and a host that
     * does is paying a full-grid upload the engine exists to avoid.
     * @returns {boolean}
     */
    setCells(cells, elapsedAges = null) {
        return this._mutate(() => this.world.setCells(cells, elapsedAges), 'Invalid cells.');
    }

    /** Set one cell, waking its chunk. Neighborhood backend only. */
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

    /**
     * Replace the exact generation-zero lattice-gas state and reset snapshot.
     * @param {ArrayLike<number>|null} channels Six species values per cell, canonical direction order.
     * @param {ArrayLike<number>|null} [walls] Reflecting sites; a closed rim is what makes the
     *   toroidal lattice finite.
     * @returns {boolean}
     */
    setInitialGasState(channels, walls = null) {
        return this._mutate(() => this.world.setInitialGasState(channels, walls), 'Invalid gas state.');
    }

    /** Intervention-only bulk lattice-gas replacement at the current generation. @returns {boolean} */
    setGasCells(channels, walls = null) {
        return this._mutate(() => this.world.setGasCells(channels, walls), 'Invalid gas state.');
    }

    /**
     * Open or close one barrier site. Lattice gas only.
     *
     * Sealing a site discards the particles standing on it — conservation is a property of the tick,
     * not of an intervention that deletes lattice sites.
     * @returns {boolean}
     */
    setWall(index, isWall) {
        if (!this.world || this.error) return false;
        try {
            this.world.setWall(index, isWall);
        } catch {
            return false;
        }
        this._afterMutation();
        return true;
    }

    /** Rewind to the world's own generation-zero snapshot, inside the engine. */
    reset() {
        if (!this.world || this.error || !this._hasRule) return;
        try {
            this.world.reset();
        } catch (e) {
            this._fail('Reset failed.', String(e && e.message ? e.message : e));
            return;
        }
        this._accumulator = 0;
        this._afterMutation();
    }

    /**
     * Blank the world at the current generation: nothing else touched — same rule, same seed, same
     * play state. Distinct from {@link reset}, which hands back the *authored* generation 0.
     *
     * In the gas the walls stay: they are the container, not its contents, and clearing a vessel
     * does not dissolve it.
     */
    clear() {
        if (!this.world || this.error) return;
        try {
            if (this._backend === BACKEND_LATTICE_GAS) {
                this.world.setGasCells(null, this.world.snapshotWalls());
            } else {
                this.world.setCells(new Uint8Array(this.world.numCells));
            }
        } catch (e) {
            this._fail('Clear failed.', String(e && e.message ? e.message : e));
            return;
        }
        this._afterMutation();
    }

    /**
     * Advance exactly `n` generations right now, independent of `speed` and the play state.
     * @param {number} [n=1]
     * @returns {number} The new generation count.
     */
    tick(n = 1) {
        if (!this.world || this.error || !this._hasRule) return 0;
        try {
            this.world.tick(Math.max(0, Math.floor(n)));
        } catch (e) {
            this._fail('Simulation failed.', String(e && e.message ? e.message : e));
            return 0;
        }
        this._afterMutation();
        return this.generation;
    }

    /** Per-state occupancy of the current generation. @returns {Uint32Array|null} */
    census() {
        return this.world && !this.error ? this.world.census() : null;
    }

    /** Exact particle total for one species (1 = amber, 2 = cyan). Lattice gas only. */
    speciesCount(species) {
        if (!this.world || this.error || this._backend !== BACKEND_LATTICE_GAS) return 0;
        return this.world.speciesCount(species);
    }

    /** Sites the collision table rewrote on the last tick. Lattice gas only. */
    collisionCount() {
        if (!this.world || this.error || this._backend !== BACKEND_LATTICE_GAS) return 0;
        return this.world.collisionCount();
    }

    /**
     * Freeze the world as it stands into an `HXS1.` code — geometry, backend, seed, **generation**,
     * compiled rule, exact visible and auxiliary state, and the colours on screen.
     *
     * A distinct prefix from `HXW1` and `HXK1`, so the other two decoders reject one outright. A
     * code resumes to an identical *next tick*, not merely an identical frame.
     *
     * @returns {Promise<string|null>} Null when there is nothing to encode, or no rule installed.
     */
    async stochasticCode() {
        if (!this.world || this.error || !this._hasRule) return null;
        try {
            return await this.world.code({
                // Flat `states * 3` bytes, not triples: the `HXS1` payload stores the palette as a
                // byte run, and the renderer's triples are this element's own shape.
                palette: flattenPalette(this._palette),
                // The codec stores speed as a `u16` and silently substitutes its default for a
                // non-integer, which would quietly change the playback rate a code restores to.
                speed: Math.round(this._speed),
            });
        } catch {
            return null;
        }
    }

    /**
     * The seed every world this element builds uses.
     *
     * Assigning a different one is structural — it is a different run — so it reboots, exactly as
     * changing `rows` does. Assigning the same one is a no-op rather than a silent rewind.
     * @returns {bigint}
     */
    get seed() { return this._seed; }

    set seed(value) {
        const next = typeof value === 'bigint' ? value : BigInt(value);
        if (next === this._seed) return;
        this._seed = next;
        if (this._hasConnected && this.isConnected) this._rebootSoon();
    }

    /** @returns {number} Generations elapsed. Native `u64`, narrowed for hosts that want a number. */
    get generation() { return this.world ? Number(this.world.generation) : 0; }

    /** @returns {number} Visible states the installed rule declares; 0 before one is installed. */
    get states() { return this.world ? this.world.states : 0; }

    get rows() { return this.world ? this.world.rows : 0; }

    get columns() { return this.world ? this.world.columns : 0; }

    /** @returns {'neighborhood'|'lattice-gas'|null} */
    get backend() { return this.world ? this._backend : null; }

    /** @returns {boolean} Whether a rule has been installed; a world without one cannot tick. */
    get hasRule() { return this._hasRule; }

    /** @returns {number} Rolling hash of the current visible state. */
    get checksum() { return this.world && this._hasRule ? this.world.checksum() : 0; }

    /** @returns {number} Cells that changed on the last tick. */
    get lastChangedCount() { return this.world ? this.world.lastChangedCount : 0; }

    /** @returns {{active: number, total: number}|null} The activity-skipping pay-off. */
    get chunkActivity() {
        if (!this.world || this.error) return null;
        return { active: this.world.activeChunkCount(), total: this.world.chunkCount() };
    }

    /** @returns {boolean} Whether the animation loop is currently running. */
    get playing() { return this._rafId !== 0; }

    /** @returns {boolean} True when the user has paused, ignoring the viewport gates. */
    get userPaused() { return this._userPaused; }

    /** @returns {number} Brush radius used by `draw` strokes; 0 is a single cell. */
    get brushSize() { return this._brushSize; }

    /**
     * Set the brush radius from script. Clamped to 0 … `MAX_BRUSH_SIZE`.
     *
     * Does not reflect into the `brush` attribute — drive brush size through one or the other, since
     * the attribute is re-read whenever it changes and would win the next time it moved.
     *
     * @param {number} size
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
        if (raw && !isStochasticCode(raw)) {
            this._fail(
                'Invalid “code”.',
                'Not a HexLife stochastic world code — these start with “HXS1.”. An “HXW1.” or '
                + '“HXK1.” code belongs on <hexlife-world> or <hexlife-ca>, which are different engines.',
            );
            return;
        }

        this._userPaused = this.hasAttribute('paused');
        this._playRequested = false;
        this._docVisible = document.visibilityState !== 'hidden';
        this._speed = readStochasticSpeed(this.getAttribute('speed'));
        this._brushSize = this._readBrushSize();
        this._accumulator = 0;

        this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion = this._motionQuery.matches;
        this._onMotionChange = (e) => {
            this._reducedMotion = e.matches;
            if (e.matches) this._playRequested = false;
            this._syncPlayback();
        };
        this._motionQuery.addEventListener('change', this._onMotionChange);

        try {
            // The one place the isolated stochastic artifact is fetched. No other element reaches
            // this call, which is what keeps root-only and ca-only consumers at zero bytes.
            await initStochasticEngine();
        } catch (e) {
            if (generation !== this._generation) return;
            this._fail('Simulation engine failed to load.', String(e && e.message ? e.message : e));
            return;
        }
        if (generation !== this._generation) return;

        // A code is a complete world — geometry, backend, seed, rule, state *and* generation — and
        // replaces the individual attributes, exactly as the other two elements do with theirs.
        let decodedPalette = null;
        if (raw) {
            let restored;
            try {
                restored = await createStochasticWorldFromCode(raw);
            } catch (e) {
                this._fail('The world code did not fit its own header.', String(e && e.message ? e.message : e));
                return;
            }
            if (generation !== this._generation) {
                if (restored) restored.world.dispose();
                return;
            }
            if (!restored) {
                this._fail('Invalid “code”.', 'Not a HexLife stochastic world code (or it was truncated in transit).');
                return;
            }
            this.world = restored.world;
            this._backend = this.world.backend;
            this._seed = this.world.seed;
            this._hasRule = true;
            decodedPalette = restored.palette;
            this._speed = restored.speed ?? this._speed;
        } else {
            const rows = readStochasticRows(this.getAttribute('rows'));
            try {
                this.world = new StochasticWorld({
                    rows,
                    columns: stochasticColumnsForRows(rows),
                    seed: this._seed,
                    backend: this._backend,
                });
            } catch (e) {
                this._fail('Simulation failed to start.', String(e && e.message ? e.message : e));
                return;
            }
            this._hasRule = false;
        }

        try {
            this.renderer = new EmbedRenderer(this._canvas, {
                cols: this.world.columns,
                rows: this.world.rows,
            });
        } catch (e) {
            this._fail('This browser can’t run WebGL2.', String(e && e.message ? e.message : e));
            return;
        }

        if (!this._applyPalette(decodedPalette)) {
            this._fail('The state shader program failed to build.',
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

        this.dispatchEvent(new CustomEvent('hexlife-stochastic-ready', {
            bubbles: true,
            composed: true,
            detail: {
                backend: this._backend,
                rows: this.world.rows,
                columns: this.world.columns,
                numCells: this.world.numCells,
                seed: this._seed,
                generation: this.generation,
                states: this.world.states,
                /** False until a rule is installed — a world without one cannot tick at all. */
                hasRule: this._hasRule,
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
        // Frees the world inside the isolated artifact and unregisters it from the view-refresh
        // registry. Skipping this would leak that memory for the lifetime of the page — rule 2.
        if (this.world) { this.world.dispose(); this.world = null; }

        this._overlay.hidden = true;
        this._hasRule = false;
        this._palette = null;
        this._accumulator = 0;
        this._lastPlayState = null;
    }

    /**
     * Swap the live world for one on the other backend, same seed and geometry.
     *
     * @param {'neighborhood'|'lattice-gas'} backend
     * @returns {boolean} False when the rebuild failed (and the element is now in its error state).
     */
    _rebuildForBackend(backend) {
        const { rows, columns } = this.world;
        this.world.dispose();
        this.world = null;
        this._hasRule = false;
        try {
            this.world = new StochasticWorld({ rows, columns, seed: this._seed, backend });
        } catch (e) {
            this._fail('Simulation failed to start.', String(e && e.message ? e.message : e));
            return false;
        }
        this._backend = backend;
        return true;
    }

    // --- palette --------------------------------------------------------------

    /**
     * Resolve the palette for the current backend and state count, and hand it to the renderer.
     * @param {ArrayLike<number>|null} [fromCode] Colours a `code` carried — a **flat** `states * 3`
     *   byte run, which wins over the attribute the same way every other world-defining field does.
     * @returns {boolean} False if the state program could not be built.
     */
    _applyPalette(fromCode = null) {
        if (!this.world || !this.renderer) return false;
        const states = Math.max(1, this.world.states);
        const colors = fromCode && fromCode.length === states * 3
            ? unflattenPalette(fromCode, states)
            : readStochasticPalette(this.getAttribute('palette'), states, this._backend);
        this._palette = colors;
        return this.renderer.setStatePalette(colors);
    }

    // --- playback -------------------------------------------------------------

    /** The single place playback is decided; every gate updates a flag and calls this. */
    _syncPlayback() {
        if (!this.world || !this.renderer || this.error || this._contextLost) { this._stopLoop(); return; }

        const motionAllowed = !this._reducedMotion || this._playRequested;
        // `_hasRule` is a gate rather than a guard inside the loop: a rule-less world throws on
        // tick, and the honest reading of "no rule yet" is that there is nothing to play.
        const wants = this._hasRule && !this._userPaused && motionAllowed && !this._drawing;
        const canRun = wants && this._onScreen && this._docVisible;

        // With `draw` on, the host usually owns the play chrome and pointer events must reach the
        // canvas to paint — the same trade the other two elements make.
        const pointerOwned = this.hasAttribute('draw');
        this._overlay.hidden = wants || pointerOwned || !this._hasRule;

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
        this.dispatchEvent(new CustomEvent('hexlife-stochastic-playstate', {
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
        this._rafId = requestAnimationFrame(this._frame);

        const ticks = this._advance(dt);
        // Only when something moved. There is no cheaper correct redraw — the visible state is a
        // wasm view and an unchanged one draws the identical frame.
        if (ticks > 0) this._drawOnce();
    }

    /**
     * Run however many whole ticks `dtMs` of wall-clock owes at the current speed, capped so a speed
     * the device cannot sustain degrades the visual rate instead of locking the page up.
     *
     * @param {number} dtMs
     * @returns {number} Ticks actually run.
     */
    _advance(dtMs) {
        if (this._speed <= 0 || !this._hasRule) return 0;
        this._accumulator += (dtMs / 1000) * this._speed;
        let ticks = Math.floor(this._accumulator);
        if (ticks <= 0) return 0;
        if (ticks > MAX_TICKS_PER_FRAME) {
            ticks = MAX_TICKS_PER_FRAME;
            // Drop the backlog rather than carrying it — carrying it is what spirals.
            this._accumulator = 0;
        } else {
            this._accumulator -= ticks;
        }
        try {
            this.world.tick(ticks);
        } catch (e) {
            // Inside rAF, so there is nobody to catch this but us. Rule 1 all the same.
            this._fail('Simulation failed.', String(e && e.message ? e.message : e));
            return 0;
        }
        return ticks;
    }

    /**
     * Render the current generation exactly once.
     *
     * `world.state` is read here and never cached: the neighborhood tick swaps its two visible
     * buffers, so a stored reference goes one generation stale, and any allocating wasm call can
     * detach the view outright.
     */
    _drawOnce() {
        if (this.world && this.renderer && !this.error && !this._contextLost) {
            this.renderer.drawStates(this.world.state);
        }
    }

    /** Draw, then re-decide playback. Every path that writes state or the rule ends here. */
    _afterMutation() {
        this._drawOnce();
        this._syncPlayback();
    }

    /**
     * The shared shape of every bulk write: never throw, land failures in the error box, redraw.
     * @param {() => void} write
     * @param {string} message
     * @returns {boolean}
     */
    _mutate(write, message) {
        if (!this.world || this.error) return false;
        try {
            write();
        } catch (e) {
            this._fail(message, String(e && e.message ? e.message : e));
            return false;
        }
        this._afterMutation();
        return true;
    }

    _resize() {
        if (!this.renderer || this._contextLost) return;
        const rect = this.getBoundingClientRect();
        this.renderer.resize(rect.width || 1, rect.height || 1, STOCHASTIC_DEFAULTS.maxDpr);
    }

    // --- draw (paint a state) -------------------------------------------------

    /**
     * @returns {number} Brush radius for a stroke: the `brush` attribute if it names one, else a
     *   single cell. A bare `brush` falls through rather than coercing to 0.
     */
    _readBrushSize() {
        const raw = (this.getAttribute('brush') || '').trim();
        return raw === '' ? DEFAULT_STOCHASTIC_BRUSH : clampBrushSize(raw);
    }

    /**
     * @returns {number} The visible state a stroke paints, clamped into range.
     *
     * The default differs by backend because what a single site can *be* differs. In the
     * neighborhood backend any state is a legal cell value, and 1 is the conventional "on". In the
     * gas, a site is six velocity channels and there is no single-site write that puts a particle in
     * one honestly — the one intervention the engine offers is the barrier, so a gas stroke defaults
     * to painting `wall`.
     */
    _readDrawState() {
        const gas = this._backend === BACKEND_LATTICE_GAS;
        const raw = parseInt(String(this.getAttribute('draw-state')), 10);
        const states = Math.max(2, this.world ? this.world.states : 2);
        if (!Number.isFinite(raw)) return gas ? GAS_STATES.wall : Math.min(1, states - 1);
        return Math.min(states - 1, Math.max(0, raw));
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
        // From the previous sample, so a fast drag paints a stroke rather than a dotted line.
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
     * `from` to `to`, each written once per stroke.
     *
     * @param {{col: number, row: number}} from
     * @param {{col: number, row: number}} to
     */
    _paintLine(from, to) {
        const state = this._readDrawState();
        const gas = this._backend === BACKEND_LATTICE_GAS;
        // Only the two states a single site can honestly be set to in the gas; a `draw-state` of
        // amber, cyan or mixed names a channel occupancy, which is not a per-site write.
        if (gas && state !== GAS_STATES.vacuum && state !== GAS_STATES.wall) return;
        const columns = this.world.columns;
        const rows = this.world.rows;
        for (const point of getHexLine(from.col, from.row, to.col, to.row)) {
            collectBrushCells(point.col, point.row, this._brushSize, columns, rows, this._brushCells);
            for (const index of this._brushCells) {
                if (this._strokeAffected.has(index)) continue;
                this._strokeAffected.add(index);
                try {
                    // Through `setCell`/`setWall`, never through the `state` view: the engine skips
                    // chunks that did not change, and a poke into the buffer is invisible to that.
                    if (gas) this.world.setWall(index, state === GAS_STATES.wall);
                    else this.world.setCell(index, state);
                } catch {
                    return;   // A rule-less world or an out-of-range state; not worth blanking this.
                }
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
    // As on `<hexlife-ca>`, the restore path rebuilds only the *renderer*. Rebooting would rebuild
    // the world at generation 0 and throw away a run somebody may have been watching for minutes —
    // and here it would also drop the rule, which arrived from script that has already finished.

    _onContextLost(event) {
        if (this._contextLost) return;
        this._contextLost = true;
        this._stopLoop();
        this._endDrawStroke();
        // Load-bearing, not conventional: the spec only fires `webglcontextrestored` for a
        // *cancelled* `webglcontextlost`.
        event.preventDefault();
        console.warn('<hexlife-stochastic>: WebGL context lost; waiting for the browser to restore it.');
        this.dispatchEvent(new CustomEvent('hexlife-stochastic-contextlost', { bubbles: true, composed: true }));
    }

    _onContextRestored() {
        if (!this._contextLost) return;
        this._contextLost = false;
        if (!this.isConnected || !this.world) return;

        // A restored context is a *blank* one: every buffer, texture, VAO and program died with the
        // old one. The simulation did not — it lives in the isolated artifact's linear memory,
        // untouched — so only the renderer is rebuilt.
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
        console.warn('<hexlife-stochastic>: WebGL context restored; the simulation continued in wasm.');
        this.dispatchEvent(new CustomEvent('hexlife-stochastic-contextrestored', { bubbles: true, composed: true }));
        this._resize();
        this._drawOnce();
        this._syncPlayback();
    }

    // --- chrome ---------------------------------------------------------------

    /**
     * The attribution link.
     *
     * A plain one, as on `<hexlife-ca>` and for the same reason: the Explorer is a binary engine and
     * has no way to open a stochastic world, so a deep link pretending otherwise would be worse
     * than none.
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
        strong.textContent = `<hexlife-stochastic>: ${message}`;
        const code = document.createElement('code');
        code.textContent = detail || '';
        this._errorBox.append(strong, code);
        this._errorBox.hidden = false;
        this._updateAttribution();
        console.warn(`<hexlife-stochastic>: ${message} ${detail || ''}`);
        // Rule 1 says we never throw into the host page — it does not say we get to say nothing.
        this.dispatchEvent(new CustomEvent('hexlife-stochastic-error', {
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
