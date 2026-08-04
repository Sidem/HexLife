// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * `<hexlife-world>` — the public custom element (#25 Phase 2).
 *
 * This is the *shell* around `EmbedSim` + `EmbedRenderer`: it turns HTML attributes into sim
 * params, owns the animation loop and the policies that make an embed a good citizen on someone
 * else's page (pause offscreen, pause on a hidden tab, respect reduced motion, cap the DPR, free
 * everything on disconnect), and exposes a small JS API.
 *
 * **Two rules govern everything here:**
 *
 * 1. **Never throw into the host page.** A bad `ruleset` attribute, a missing WebGL2 context, a
 *    wasm init failure — every one of them lands in a styled error box inside our shadow root. A
 *    third party pasted a script tag; they did not sign up for an exception in their console.
 * 2. **Never leak.** Multiple instances share one wasm linear memory, and a removed element that
 *    keeps its rAF alive would keep ticking a freed world. `disconnectedCallback` tears down in
 *    the reverse order of setup and voids the async-init race (see `_generation`).
 *
 * Everything is inside a shadow root, so the host page's CSS cannot break us and our CSS cannot
 * touch them.
 */

import { EmbedSim, initEmbedWasm } from './EmbedSim.js';
import { EmbedRenderer } from './EmbedRenderer.js';
import { clampInt, clampFloat, readSeed, readGradient, wheelZoomAllowed } from './attrs.js';
import { decodeWorldCode, encodeWorldCode } from '../core/WorldCodec.js';
import { clampBrushSize, DEFAULT_BRUSH_SIZE } from '../core/hexBrush.js';

/** Where the attribution link points. Deep-links the ruleset via ShareCodec's `r`/`g` params. */
const APP_URL = 'https://sidem.github.io/HexLife/';

/**
 * How long after a stroke begins a second finger still counts as "this was a pinch, not a drawing".
 * Sized from the gap between the two fingers of a real pinch landing (tens of milliseconds, plus
 * headroom); anything slower is treated as a deliberate stroke and is never rewound.
 */
const ACCIDENTAL_STROKE_MS = 220;

/**
 * Attribute defaults and bounds. `speed` mirrors the app's `Config.DEFAULT_SPEED` (40) so a copied
 * embed runs at the rate the user saw — the value is duplicated rather than imported because
 * `config.js` has an import-time side effect the embed must not pull in (see EmbedSim's header).
 */
const DEFAULTS = {
    rows: 64,
    density: 0.5,
    speed: 40,
    palette: 'default',
    maxDpr: 1.5,
};
const ROWS_MIN = 16;
const ROWS_MAX = 512;   // Lower than the app's 2048 on purpose: an embed is a decoration, not a lab.
const MAX_DPR_MIN = 1;
const MAX_DPR_MAX = 4;

/**
 * `preview` — how many generations the poster "breathes" through when it comes into view. Small on
 * purpose: this is a hint that the thing is alive, not a free showing of the whole simulation.
 */
const PREVIEW_MIN = 1;
const PREVIEW_MAX = 60;
const PREVIEW_DEFAULT = 12;
/** ~4 ticks/sec — slow enough to read as deliberate rather than as the world having started. */
const PREVIEW_TICK_MS = 250;

/**
 * `torus` — auto-rotation rate in degrees/second, taken from the attribute's *value* the same way
 * `preview` takes its tick count. `torus="0"` is a still torus the viewer turns by hand; the default
 * matches the Explorer's `TORUS_VIEW_DEFAULTS.rotationSpeed`.
 */
const TORUS_SPIN_MIN = 0;
const TORUS_SPIN_MAX = 45;
const TORUS_SPIN_DEFAULT = 14;

/** Drag-to-orbit sensitivity: radians per CSS pixel. A full turn is roughly a 900px drag. */
const TORUS_ORBIT_RADIANS_PER_PX = 0.007;

/**
 * How long to wait for `webglcontextrestored` before giving up and entering the error state.
 *
 * Cancelling `webglcontextlost` is a *request* for restoration, not a guarantee of one: a browser
 * that lost the context to genuine memory pressure may never find room to hand one back, and some
 * simply never fire the event. Without this the viewer would sit in front of a permanently blank
 * canvas that still reports itself as a healthy world. Generous, because a restore that does arrive
 * usually arrives within a frame or two and the cost of waiting is only a blank canvas either way.
 */
const CONTEXT_RESTORE_TIMEOUT_MS = 4000;

/**
 * A loss this soon after a restore means recovering *caused* the next loss.
 *
 * The loop is real and cheap to fall into: a `torus` world that costs more memory than the device
 * has drops the context, we rebuild it, `_syncTorus` puts it straight back on the torus, and it
 * drops again — each turn paying for a fresh wasm world and a shader compile on hardware that has
 * already said it has nothing to spare. Past this window a second loss is treated as a new event
 * (a laptop that sleeps twice is not a loop); inside it, we stop asking and show the error box.
 */
const CONTEXT_LOSS_LOOP_MS = 10_000;

/**
 * Flat-camera zoom range. 1 is the fitted "whole world" view and the hard floor — below it the grid
 * would letterbox inside empty canvas, which is never what anyone means by zooming out.
 */
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

/**
 * Attributes that reconfigure a **live** world instead of re-booting it.
 *
 * The default is the other way round, and deliberately so: a `code` is a complete world, and
 * changing any part of what it specifies means a different world. What is listed here is everything
 * that is *not* part of the world — playback rate, input policy, camera, tool settings, decoration.
 * Getting this wrong is quiet and expensive: a re-boot re-decodes the code and replays tick 0, so a
 * mis-classified attribute throws away whatever the viewer had drawn or evolved.
 */
const LIVE_ATTRS = new Set([
    'paused', 'max-dpr', 'link', 'speed', 'draw', 'wheel-zoom', 'preview',
    'torus', 'brush', 'zoom', 'palette', 'palette-on', 'palette-off', 'flicker-proof',
]);

const RULESET_RE = /^[0-9a-fA-F]{32}$/;

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
    /* Only a whisper of a scrim: the whole point of the poster frame is to let the viewer SEE the
       initial state before pressing play, so the world must read clearly through the button. */
    background: rgba(16, 18, 20, 0.12);
    border: 0;
    padding: 0;
    cursor: pointer;
    color: #fff;
}
.overlay svg { width: 22%; max-width: 88px; opacity: 0.85; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.7)); }
.overlay:hover { background: rgba(16, 18, 20, 0.22); }
.overlay:hover svg { opacity: 1; }
/* A paused poster in a feed is a dark square that reads as a broken image at scroll speed. A slow
   pulse costs nothing (no sim, no GPU work beyond a composited transform) and says "this runs".
   Reduced motion gets the still poster it asked for. */
@media (prefers-reduced-motion: no-preference) {
    .overlay svg { animation: hexlife-pulse 2.5s ease-in-out infinite; }
    /* Hovering is already an answer to "is this interactive?" — stop competing with the cursor. */
    .overlay:hover svg { animation: none; }
}
@keyframes hexlife-pulse {
    0%, 100% { transform: scale(1); opacity: 0.85; }
    50% { transform: scale(1.08); opacity: 1; }
}
.reset {
    position: absolute;
    left: 8px;
    bottom: 8px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgba(16, 18, 20, 0.35);
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    opacity: 0.45;
    transition: opacity 0.15s ease, background 0.15s ease;
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
}
.reset:hover { opacity: 1; background: rgba(16, 18, 20, 0.6); color: #fff; }
.reset svg { width: 60%; height: 60%; filter: drop-shadow(0 1px 3px rgba(0,0,0,0.8)); }
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

/** Inline play triangle for the poster overlay (no external asset, no font dependency). */
const PLAY_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,0.45)" stroke="currentColor" stroke-width="2.5"/><path d="M26 20l20 12-20 12z" fill="currentColor"/></svg>';

/** Inline reload glyph for the corner reset button. */
const RESET_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" fill="currentColor"/></svg>';

export class HexLifeElement extends HTMLElement {
    static get observedAttributes() {
        return ['code', 'ruleset', 'seed', 'density', 'rows', 'speed', 'palette',
            'palette-on', 'palette-off', 'flicker-proof', 'paused', 'max-dpr', 'link', 'draw',
            'wheel-zoom', 'preview', 'torus', 'brush', 'zoom'];
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

        // A small, faint corner button to restart the world once it is running. For a generator-driven
        // world code (random fill / clumps) this re-rolls a fresh arrangement; for an exact-cells world
        // it rewinds to tick 0. Only shown while the world is running (see `_syncPlayback`).
        // Exposed as `::part(reset)` so a host (e.g. Devvit chrome) can hide it when it owns Restart.
        this._resetBtn = document.createElement('button');
        this._resetBtn.className = 'reset';
        this._resetBtn.type = 'button';
        this._resetBtn.setAttribute('part', 'reset');
        this._resetBtn.setAttribute('aria-label', 'Restart simulation');
        this._resetBtn.title = 'Restart';
        this._resetBtn.innerHTML = RESET_ICON;
        this._resetBtn.hidden = true;
        this._resetBtn.addEventListener('click', () => this.reset());

        this._attrib = document.createElement('a');
        this._attrib.className = 'attrib';
        this._attrib.target = '_blank';
        this._attrib.rel = 'noopener noreferrer';
        this._attrib.textContent = 'HexLife';
        this._attrib.hidden = true;

        this._errorBox = document.createElement('div');
        this._errorBox.className = 'error';
        this._errorBox.hidden = true;

        root.append(style, this._canvas, this._overlay, this._resetBtn, this._attrib, this._errorBox);

        /** @type {EmbedSim|null} */
        this.sim = null;
        /** @type {EmbedRenderer|null} */
        this.renderer = null;
        /** @type {string|null} Non-null while the element is in its styled error state. */
        this.error = null;
        /**
         * The decoded `code` attribute (WorldCodec), or null when the element is driven by the
         * individual attributes. Non-null means the world is fully specified by the code.
         * @type {{rows: number, cols: number, rulesetHex: string, cells: Uint8Array, speed: number,
         *   colorSettings: object|null, lut: Uint8Array|null}|null}
         */
        this._world = null;

        // --- playback gates. The loop runs only when ALL of these say yes. ---
        /** Author/user intent: `paused` attribute, or a `pause()` call. */
        this._userPaused = false;
        /** IntersectionObserver: is any part of us on screen? Assumed true until it first fires. */
        this._onScreen = true;
        /** Is the tab visible? */
        this._docVisible = document.visibilityState !== 'hidden';
        /** `prefers-reduced-motion: reduce` — suppresses autoplay until the user asks for it. */
        this._reducedMotion = false;
        /** Set by an explicit `play()` (or a poster click), which overrides reduced motion. */
        this._playRequested = false;
        /**
         * Last `{playing, userPaused}` announced via `hexlife-playstate`, so repeat syncs stay quiet.
         * @type {{playing: boolean, userPaused: boolean}|null}
         */
        this._lastPlayState = null;

        this._rafId = 0;
        this._lastFrameTime = 0;

        // --- poster preview burst (`preview` attribute) ---
        /**
         * setTimeout id of the in-flight burst step, or 0. Deliberately NOT `_rafId`: the burst is
         * poster decoration, so `playing` must stay false and no `hexlife-playstate` may fire.
         */
        this._previewTimer = 0;
        /** Is a burst in flight (including the final beat before it rewinds)? */
        this._previewActive = false;
        /** Ticks left to run in the current burst. */
        this._previewLeft = 0;
        /** Ticks this burst has actually run — gates the rewind (see `_cancelPreviewBurst`). */
        this._previewTicked = 0;
        /**
         * Has the IntersectionObserver reported anything yet? `_onScreen` optimistically starts
         * true, so without this the *first* report of "visible" looks like no change at all and an
         * element that boots in view would never breathe. See `_onIntersect`.
         */
        this._onScreenKnown = false;
        this._previewStep = this._previewStep.bind(this);

        // Camera (wheel zoom + pinch). Relative to the fitted "show whole grid" view: zoom 1 + pan 0
        // is the default fit. Stored on the element so a resize can re-apply without losing the view.
        this._viewZoom = 1;
        this._viewPanX = 0;
        this._viewPanY = 0;
        /** @type {Map<number, {x: number, y: number}>} active touch points for pinch */
        this._pinchTouches = new Map();
        this._pinchStartDist = 0;
        this._pinchStartZoom = 1;
        /** Midpoint of the two pinch fingers on the previous move — drives two-finger pan. */
        this._pinchLastMid = null;
        /**
         * Set the moment a second finger touches down, cleared only when *every* finger has lifted.
         * Two-finger gestures own navigation outright: without the latch, lifting one finger
         * mid-pinch would drop straight back into painting under the finger still on the glass.
         */
        this._gestureLock = false;
        this._onWheel = this._onWheel.bind(this);
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove = this._onTouchMove.bind(this);
        this._onTouchEnd = this._onTouchEnd.bind(this);
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);

        // --- torus view (`torus` attribute) ---
        /**
         * Its own rAF, deliberately not `_rafId`. A spinning torus is a *camera* animation: the sim
         * is not advancing, so `playing` must stay false and no `hexlife-playstate` may fire. Same
         * separation as the poster preview burst's timer, and for the same reason.
         */
        this._spinRafId = 0;
        this._spinLastTime = 0;
        /** Drag-to-orbit state; null when no pointer owns the camera. */
        this._orbitPointerId = null;
        this._orbitLast = null;
        /** Two-finger dolly baseline, mirroring `_pinchStartDist` / `_pinchStartZoom` for the flat view. */
        this._pinchLastDist = 0;
        this._spinFrame = this._spinFrame.bind(this);

        /** Brush radius from world code (or default 2). */
        this._brushSize = DEFAULT_BRUSH_SIZE;
        /** Invert-draw stroke state (when `draw` attribute is set). */
        this._drawing = false;
        this._drawPointerId = null;
        this._strokeAffected = new Set();
        this._lastDrawCoords = null;
        this._resumeAfterStroke = false;
        /** When the current stroke started, so a pinch onset can tell "a slip" from "real drawing". */
        this._strokeStartTime = 0;

        /**
         * Upgrade order is: `attributeChangedCallback` once per attribute, *then*
         * `connectedCallback`. Without this gate, parsing `<hexlife-world ruleset=… rows=… speed=…>`
         * would boot the element once per attribute before it has ever connected — several `World`
         * allocations and shader programs, all but the last thrown away. Attributes are always read
         * fresh by `_boot`, so ignoring them until the first connect loses nothing.
         */
        this._hasConnected = false;
        /**
         * Bumped on every connect/disconnect. The async wasm init captures it and bails if it has
         * changed by the time it resolves — otherwise a fast connect→disconnect→connect leaves a
         * zombie sim building itself against a torn-down element.
         */
        this._generation = 0;

        this._onVisibilityChange = () => {
            this._docVisible = document.visibilityState !== 'hidden';
            // A hidden tab throttles timers, so a burst there would land as a jerky lurch on
            // return. Hand the poster back and let the next arrival start a clean one.
            if (!this._docVisible) this._cancelPreviewBurst(true);
            this._syncPlayback();
        };
        this._frame = this._frame.bind(this);

        this._resizeObserver = null;
        this._intersectionObserver = null;
        this._motionQuery = null;
        this._onMotionChange = null;

        // --- GPU context loss (see `_onContextLost`) ---
        /** Is the drawing context currently gone? Gates every path that would call into it. */
        this._contextLost = false;
        /** Deadline for a restore that may never come. */
        this._contextRestoreTimer = 0;
        /** When the last restore finished, so a loss right afterwards reads as a loop. */
        this._contextRestoredAt = 0;
        this._onContextLost = this._onContextLost.bind(this);
        this._onContextRestored = this._onContextRestored.bind(this);
        // Bound here rather than in `_boot`, and never unbound: a rebuild runs `_teardown` before
        // `_boot`, and a context that went missing during that window would find nobody listening.
        // The canvas lives and dies with the element, so these leak nothing.
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
        this._generation++;   // Voids any in-flight boot (see _generation).
        this._teardown();
    }

    /**
     * Re-derive whatever the changed attribute affects. Structural params (`rows`) need a fresh
     * `World` + renderer, so they re-boot; everything else is applied to the live objects.
     */
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;
        // See `_hasConnected`: attribute parsing precedes the first connect, and a disconnected
        // element re-reads everything when it reconnects. Either way there is nothing to update yet.
        if (!this._hasConnected || !this.isConnected) return;
        // Nothing is live yet (still booting, or in the error state): the boot reads attributes
        // fresh, so a re-boot is both correct and the only way out of an error state.
        if (!this.sim || !this.renderer) {
            this._generation++;
            this._teardown();
            this._boot(this._generation);
            return;
        }

        // A world code owns every world-defining attribute (see `_boot`): the only way to change one
        // of them is a new code, and a new code means a new world. Both cases are a re-boot.
        // Everything in `LIVE_ATTRS` is exempt because it isn't part of the world at all — see the
        // note on that set for what earns a place in it.
        if (name === 'code' || (this._world && !LIVE_ATTRS.has(name))) {
            this._generation++;
            this._teardown();
            this._boot(this._generation);
            return;
        }

        switch (name) {
            case 'rows': {
                // A different grid means a different World and different instance buffers.
                this._generation++;
                this._teardown();
                this._boot(this._generation);
                break;
            }
            case 'ruleset': {
                const hex = this._readRuleset();
                if (typeof hex !== 'string') {
                    this._fail(hex.message, hex.detail);   // _readRuleset returned a problem
                    return;
                }
                this.sim.setRuleset(hex);
                this.sim.reset();          // A new rule table on an evolved state is meaningless.
                this._updateAttribution();
                this._drawOnce();
                break;
            }
            case 'seed':
            case 'density': {
                const p = this._readParams();
                this.sim.density = p.density;
                this.sim.reset(p.seed);
                this._drawOnce();
                break;
            }
            case 'speed':
                this.sim.speed = this._readParams().speed;
                break;
            case 'palette':
            case 'palette-on':
            case 'palette-off':
            case 'flicker-proof':
                this.renderer.setPalette(this._paletteOptions());
                this._drawOnce();
                break;
            case 'brush':
                this._brushSize = this._readBrushSize();
                break;
            case 'zoom':
                this.setZoom(this._readZoom());
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
            case 'preview':
                // Removing it stops the decoration and hands back the authored poster; adding it
                // arms the next arrival. Never bursts on the spot — a burst is a reaction to being
                // seen, not to being configured.
                if (!this.hasAttribute('preview')) this._cancelPreviewBurst(true);
                break;
            case 'draw':
                if (this.hasAttribute('draw')) {
                    // Pointer events are about to mean "paint": the poster, and its burst, are done.
                    this._cancelPreviewBurst(true);
                } else {
                    this._endDrawStroke(false);
                }
                this._applyPointerAffordance();
                this._syncPlayback();
                break;
            case 'torus':
                this._syncTorus();
                break;
            case 'wheel-zoom':
                // Nothing to apply: `_onWheel` reads the attribute on every event.
                break;
        }
    }

    // --- public JS API --------------------------------------------------------

    /** Start (or resume) the simulation. An explicit call also overrides `prefers-reduced-motion`. */
    play() {
        // The viewer asked for the real thing; the poster's decoration steps aside without
        // rewinding, so what they were watching simply keeps going.
        this._cancelPreviewBurst(false);
        this._playRequested = true;
        this._userPaused = false;
        // Keep the attribute in sync so hosts reading `hasAttribute('paused')` stay honest
        // (Devvit transport chrome, tests, etc.). removeAttribute re-enters
        // attributeChangedCallback, which re-derives `_userPaused` as false — same end state.
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
     * Re-seed the initial state and rewind to tick 0.
     * @param {number} [seed] Defaults to the `seed` attribute (so `reset()` replays the same run);
     *   pass a fresh number for a new one. A falsy seed is nondeterministic, as in the app.
     */
    reset(seed) {
        if (!this.sim) return;
        this.sim.reset(seed === undefined ? this._readParams().seed : seed);
        this._drawOnce();
    }

    /**
     * Blank the world: every cell dead, no rule history, nothing else touched — same ruleset, same
     * speed, same play state, same camera.
     *
     * Distinct from {@link reset}, which rewinds to the *authored* tick 0 and hands back the world
     * somebody else made. This is an empty canvas, and with `draw` it is what turns a remix from
     * "invert some of this stranger's cells" into "make your own thing". `tickCount` deliberately
     * keeps counting: the sim has not gone back in time, it has been painted over.
     */
    clear() {
        if (!this.sim || this.error) return;
        this.sim.clear();
        this._drawOnce();
    }

    /**
     * Advance exactly `n` generations right now, independent of `speed` and the play state. This is
     * the determinism cross-check hook (tick to 100, compare `checksum`).
     * @param {number} [n=1]
     * @returns {number} The new tick count.
     */
    tick(n = 1) {
        if (!this.sim) return 0;
        for (let i = 0; i < Math.max(0, Math.floor(n)); i++) this.sim.tick();
        this._drawOnce();
        return this.sim.tickCount;
    }

    /**
     * Encode the world as it stands *right now* into an `HXW1.` world code.
     *
     * This is the "post my remix" primitive: whatever is on screen — including cells the viewer
     * painted and however many generations it has run — becomes something another runtime can
     * reproduce exactly.
     *
     * **Never encodes a `generator`**, even when this world was booted from a code that had one.
     * A generator is a recipe (random fill, clumps) that re-rolls a *different* state on every
     * reset; a remix is the dish. Encoding the recipe here would hand someone a code that has
     * never once produced the world they were looking at.
     *
     * @returns {Promise<string|null>} The code, or null when there is nothing to encode (the
     *   element is in its error state, or has not booted yet).
     */
    async worldCode() {
        if (!this.sim || this.error) return null;
        const cells = this.sim.snapshotCells();
        if (!cells) return null;
        // A host that recolored this world must post the colors on screen, not the ones the code
        // arrived with — "what you see is what posts" is the whole contract of this method, and it
        // covers the palette exactly as much as it covers painted cells. So an override drops the
        // decoded settings and encodes the table the renderer actually drew with.
        const source = this._paletteOverridden() ? null : this._world;
        return encodeWorldCode({
            rows: this.sim.rows,
            cols: this.sim.cols,
            rulesetHex: this.sim.rulesetHex,
            cells,
            // Otherwise the decoder's own precedence: the world's settings, then its baked LUT, then
            // — for an attribute-driven world, which carries neither — whatever the renderer resolved.
            colorSettings: source ? source.colorSettings : null,
            lut: (source && source.lut) || (this.renderer && this.renderer.getLut()),
            speed: this.sim.speed,
            brushSize: this._brushSize,
        });
    }

    /** @returns {number} Generations elapsed since the last reset. */
    get tickCount() { return this.sim ? this.sim.tickCount : 0; }

    /** @returns {number} Hash of the current state — equal to the app's for equal params + ticks. */
    get checksum() { return this.sim ? this.sim.checksum() : 0; }

    /** @returns {boolean} Whether the animation loop is currently running. */
    get playing() { return this._rafId !== 0; }

    /** @returns {boolean} True when the user has paused (attribute or `pause()`), ignoring viewport gates. */
    get userPaused() { return this._userPaused; }

    /** @returns {number} Brush / neighborhood radius used for draw strokes. */
    get brushSize() { return this._brushSize; }

    /**
     * @returns {boolean} Whether the world is actually being drawn on the torus right now.
     *
     * Not the same question as `hasAttribute('torus')`, which is only what the host *asked* for. The
     * projection needs a second shader program built on first use, and on a device that cannot
     * compile it the element stays flat by design (a blank canvas would be the worse answer). Before
     * this getter existed a host had no way to notice, so its own 3D button would sit there reading
     * "pressed" over an unmistakably flat grid.
     */
    get torusEnabled() { return this._torusActive(); }

    /**
     * @param {number} size Clamped to 0 (single cell) … `MAX_BRUSH_SIZE`.
     *
     * Does not reflect into the `brush` attribute, so a host that drives brush size through the
     * attribute should keep doing that rather than mixing the two — the attribute is re-read on
     * every change and would win the next time it moved.
     */
    setBrushSize(size) {
        this._brushSize = clampBrushSize(size);
    }

    /** @returns {number} Current flat-camera zoom; 1 is the fitted "whole world" view. */
    get zoom() { return this._viewZoom; }

    /**
     * Set the flat camera's zoom about the centre of the view.
     *
     * Clamped to 1…8, and `setZoom(1)` is the "I am lost, show me the world again" primitive: the
     * floor clears the pan too, so it always lands on the same fitted view no matter where a pinch
     * left things. That is worth a host putting a button on, because a viewer who has pinched into
     * a corner has no other way back.
     *
     * The torus has its own camera (drag to orbit, wheel to dolly) and ignores this; the value is
     * kept, so it is what the flat view returns to.
     * @param {number} zoom
     */
    setZoom(zoom) {
        if (!this.renderer || !Number.isFinite(zoom)) return;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
        this._zoomBy(next / (this._viewZoom || 1));
    }

    // --- boot / teardown ------------------------------------------------------

    /**
     * @param {number} generation The `_generation` value at call time; if it has moved on by the
     *   time wasm resolves, this boot was superseded and must do nothing.
     */
    async _boot(generation) {
        this._clearError();

        // A `code` attribute (WorldCodec) is a complete world — grid, ruleset, exact cells, exact
        // colors, speed — so it *replaces* the individual attributes rather than merging with them.
        // This is the Reddit post's payload; anything half-applied there would be a different world.
        // Decoding is async (the payload is deflated), so it takes the same generation guard as the
        // wasm init below: a disconnect mid-decode must not boot a world into a torn-down element.
        const raw = (this.getAttribute('code') || '').trim();
        const world = raw ? await decodeWorldCode(raw) : null;
        if (generation !== this._generation) return;
        if (raw && !world) {
            this._fail('Invalid “code”.', 'Not a HexLife world code (or it was truncated in transit).');
            return;
        }
        this._world = world;
        this._brushSize = this._readBrushSize();

        const hex = world ? world.rulesetHex : this._readRuleset();
        if (typeof hex !== 'string') {
            this._fail(hex.message, hex.detail);
            return;
        }
        const params = this._readParams();

        this._userPaused = this.hasAttribute('paused');
        this._playRequested = false;
        this._docVisible = document.visibilityState !== 'hidden';
        this._endDrawStroke(false);

        this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion = this._motionQuery.matches;
        this._onMotionChange = (e) => {
            this._reducedMotion = e.matches;
            if (e.matches) this._playRequested = false;   // Re-enter poster mode if it turns on.
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
        if (generation !== this._generation) return;   // Disconnected (or re-booted) mid-init.

        try {
            this.sim = new EmbedSim({
                rulesetHex: hex,
                rows: world ? world.rows : params.rows,
                cols: world ? world.cols : undefined,
                density: params.density,
                seed: params.seed,
                initialCells: world ? world.cells : null,
                generator: world ? world.generator : null,
                speed: world ? world.speed : params.speed,
            });
        } catch (e) {
            this._fail('Simulation failed to start.', String(e && e.message ? e.message : e));
            return;
        }

        try {
            this.renderer = new EmbedRenderer(this._canvas, {
                cols: this.sim.cols,
                rows: this.sim.rows,
                // Same precedence the live path uses, so a world booted *with* a palette attribute
                // shows what a world given one a moment later would.
                ...this._paletteOptions(),
            });
        } catch (e) {
            // Almost always "no WebGL2". Per the plan there is no 2D fallback in v1 — say so plainly
            // and keep the attribution link, which is the one thing still worth showing.
            this._fail('This browser can’t run WebGL2.', String(e && e.message ? e.message : e));
            return;
        }

        document.addEventListener('visibilitychange', this._onVisibilityChange);

        this._resizeObserver = new ResizeObserver(() => {
            this._resize();
            if (!this.playing) this._drawOnce();   // A paused poster must survive a resize.
        });
        this._resizeObserver.observe(this);

        // Pause when scrolled away: a feed may hold several of these, and an offscreen world is
        // pure waste. `0` threshold = "any pixel visible".
        this._onScreenKnown = false;
        this._intersectionObserver = new IntersectionObserver(
            (entries) => this._onIntersect(entries), { threshold: 0 });
        this._intersectionObserver.observe(this);

        // Zoom: wheel on desktop, pinch on touch. Passive:false on wheel so we can preventDefault
        // (otherwise the host page / Reddit webview scrolls away). Touch listeners are non-passive
        // only while two fingers are down — single-finger scroll still works for the feed
        // (unless `draw` is on, in which case pointer events own single-finger paint).
        this._canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this._canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
        this._canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        this._canvas.addEventListener('touchend', this._onTouchEnd, { passive: true });
        this._canvas.addEventListener('touchcancel', this._onTouchEnd, { passive: true });
        this._bindDrawListeners(true);

        // Before the first resize, so an authored `zoom` is what the opening frame is drawn at
        // rather than something the viewer watches snap into place.
        this._viewZoom = this._readZoom();
        this._resize();
        this._updateAttribution();
        // Before the first draw, so a world booted with `torus` already set never flashes flat.
        this._syncTorus();
        this._drawOnce();
        this._syncPlayback();

        this.dispatchEvent(new CustomEvent('hexlife-ready', {
            bubbles: true,
            composed: true,
            detail: {
                rows: this.sim.rows,
                cols: this.sim.cols,
                numCells: this.sim.numCells,
                brushSize: this._brushSize,
            },
        }));
    }

    _teardown() {
        this._stopLoop();
        if (this._spinRafId) { cancelAnimationFrame(this._spinRafId); this._spinRafId = 0; }
        // A disconnect while the context is away must not leave a deadline that fires `_fail` on a
        // detached element. The recovery path clears this itself before it gets here.
        if (this._contextRestoreTimer) { clearTimeout(this._contextRestoreTimer); this._contextRestoreTimer = 0; }
        this._orbitPointerId = null;
        this._orbitLast = null;
        // No restore: the sim is about to be freed, and a reset on the way out is pure work.
        this._cancelPreviewBurst(false);
        this._endDrawStroke(false);
        this._bindDrawListeners(false);

        if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
        if (this._intersectionObserver) { this._intersectionObserver.disconnect(); this._intersectionObserver = null; }
        if (this._motionQuery && this._onMotionChange) {
            this._motionQuery.removeEventListener('change', this._onMotionChange);
        }
        this._motionQuery = null;
        this._onMotionChange = null;
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this._canvas.removeEventListener('wheel', this._onWheel);
        this._canvas.removeEventListener('touchstart', this._onTouchStart);
        this._canvas.removeEventListener('touchmove', this._onTouchMove);
        this._canvas.removeEventListener('touchend', this._onTouchEnd);
        this._canvas.removeEventListener('touchcancel', this._onTouchEnd);
        this._pinchTouches.clear();
        this._pinchLastDist = 0;

        if (this.renderer) { this.renderer.destroy(); this.renderer = null; }
        // Frees the wasm World and unregisters from the view-refresh registry. Skipping this would
        // leak linear memory for the lifetime of the page.
        if (this.sim) { this.sim.free(); this.sim = null; }

        this._overlay.hidden = true;
        this._resetBtn.hidden = true;
        this._viewZoom = 1;
        this._viewPanX = 0;
        this._viewPanY = 0;
        // Forget the announced state: the next boot must report its own starting point, even if it
        // happens to match whatever the torn-down world was doing.
        this._lastPlayState = null;
    }

    // --- GPU context loss -----------------------------------------------------
    // A WebGL context is not ours to keep. The browser can take it back whenever the GPU is reset,
    // the machine sleeps, or — the common case on phones — something needs the memory more than a
    // decoration in a feed does. An in-app webview (Reddit's, most notably) gets a far smaller
    // budget than the same page in a standalone browser, and the `torus` view is by a wide margin
    // the most expensive thing this element ever asks for: three depth-tested passes against a
    // multisampled framebuffer, where the flat grid needs one pass and no depth at all.
    //
    // Without the two handlers below the failure is silent and total. Every GL call on a lost
    // context is a no-op that does not throw, so `_frame` keeps running, `playing` stays true, the
    // canvas stays blank, and nothing — not `hexlife-error`, not a console line — ever says why.
    // Rule 1 says we do not throw into the host page; it does not say we get to say nothing.

    /**
     * The context went away. Stop everything that would keep drawing into it, then either ask for it
     * back or — if asking is what got us here — give up and say so.
     *
     * @param {WebGLContextEvent} event
     */
    _onContextLost(event) {
        if (this._contextLost) return;   // Drivers can fire this more than once.
        this._contextLost = true;

        // The loops are the urgent part: a rAF spinning against a dead context is invisible work on
        // a device that just told us it is out of resources.
        this._stopLoop();
        if (this._spinRafId) { cancelAnimationFrame(this._spinRafId); this._spinRafId = 0; }
        this._cancelPreviewBurst(false);
        this._endDrawStroke(false);
        this._endOrbit();

        // Rebuilding is what lost it last time. Asking again would just buy another blank canvas at
        // the price of a wasm world and a shader compile, on a device with nothing to spare.
        const looping = this._contextRestoredAt > 0
            && (performance.now() - this._contextRestoredAt) < CONTEXT_LOSS_LOOP_MS;
        if (looping) {
            this._fail(
                'This device ran out of graphics memory.',
                'The GPU dropped this world twice in a row. If the 3D view was on, the flat grid '
                + 'costs far less — reopen this post and leave it flat.',
            );
            return;
        }

        // Load-bearing, not conventional: the spec only fires `webglcontextrestored` for a
        // *cancelled* `webglcontextlost`. Deliberately after the loop check above, so the give-up
        // path does not also ask for a context it has decided not to use.
        event.preventDefault();

        console.warn('<hexlife-world>: WebGL context lost; waiting for the browser to restore it.');
        this.dispatchEvent(new CustomEvent('hexlife-contextlost', { bubbles: true, composed: true }));

        // A restore we asked for may never arrive. Don't leave a blank canvas claiming to be a world.
        clearTimeout(this._contextRestoreTimer);
        this._contextRestoreTimer = setTimeout(() => {
            this._contextRestoreTimer = 0;
            if (!this._contextLost) return;
            this._fail(
                'The GPU dropped this world.',
                'The graphics context was lost and the browser did not restore it. '
                + 'Closing other tabs or apps and reopening this usually brings it back.',
            );
        }, CONTEXT_RESTORE_TIMEOUT_MS);
    }

    /**
     * The browser handed a context back. It is a *blank* one — every buffer, texture, VAO and
     * program the old renderer held died with the old context — so the only correct response is to
     * build the world again from scratch, which is exactly what `_teardown` + `_boot` already do.
     *
     * Bumping `_generation` first is what voids the in-flight boot, if any: a context that dropped
     * mid-boot would otherwise leave that boot racing this one to install a renderer.
     */
    _onContextRestored() {
        if (!this._contextLost) return;
        clearTimeout(this._contextRestoreTimer);
        this._contextRestoreTimer = 0;
        this._contextLost = false;

        // Disconnected while the context was away: `connectedCallback` will boot us if we come back,
        // and booting a detached element now would allocate a world nobody can see.
        if (!this.isConnected) return;

        console.warn('<hexlife-world>: WebGL context restored; rebuilding the world.');
        this.dispatchEvent(new CustomEvent('hexlife-contextrestored', { bubbles: true, composed: true }));

        // Stamped before the rebuild, so the window covers the rebuild itself — a torus world that
        // dies while booting is the loop this guards, and it never reaches the far side of `_boot`.
        this._contextRestoredAt = performance.now();
        this._generation++;
        this._teardown();
        this._boot(this._generation);
    }

    // --- attributes -----------------------------------------------------------

    /**
     * @returns {string|{message: string, detail: string}} The validated hex, or a problem to display.
     *   Returning the error rather than throwing is the whole point (rule 1 in the header).
     */
    _readRuleset() {
        const raw = (this.getAttribute('ruleset') || '').trim();
        if (!raw) {
            return { message: 'Missing “ruleset”.', detail: 'Expected a 32-character hex string.' };
        }
        if (!RULESET_RE.test(raw)) {
            return {
                message: 'Invalid “ruleset”.',
                detail: `Expected 32 hex characters, got ${raw.length}: ${raw.slice(0, 40)}`,
            };
        }
        return raw.toUpperCase();
    }

    /**
     * Is an explicit palette attribute overriding whatever colors a world code carried?
     *
     * Presence, not value: `palette="volcanic"` and a `palette-on` gradient both mean "the host is
     * choosing the colors now", and *removing* both means "give the world its own back". That undo
     * is the whole reason this is a separate question from "what palette" — without it a host could
     * recolor a post but never restore it, since a decoded world's colors have no preset name to
     * ask for. An empty value doesn't count: it names nothing.
     */
    _paletteOverridden() {
        return (this.getAttribute('palette') || '').trim() !== ''
            || (this.getAttribute('palette-on') || '').trim() !== '';
    }

    /**
     * The palette arguments for the renderer — the one place attribute-vs-code precedence is
     * decided, so the boot and a live change cannot disagree about which colors win.
     *
     * `_resolveLUT` prefers `colorSettings`, then `lut`, then the gradient, then the preset name.
     * Nulling the first two when the host has overridden is therefore what lets the attributes
     * through; leaving them in place is what makes the world's own colors authoritative otherwise.
     */
    _paletteOptions() {
        const p = this._readParams();
        const override = this._paletteOverridden();
        const world = override ? null : this._world;
        return {
            palette: p.palette,
            customGradient: p.customGradient,
            colorSettings: world ? world.colorSettings : null,
            lut: world ? world.lut : null,
            flickerProof: this.hasAttribute('flicker-proof'),
        };
    }

    /**
     * Brush radius: the `brush` attribute wins, then a world code's own value, then the default.
     *
     * Note the precedence runs the *opposite* way to every world-defining attribute, where `code`
     * wins. Brush size is a tool setting, not part of the world: it never touches the tick sequence,
     * and a host rendering its own brush control has to be able to make that control tell the truth.
     * A code's value is the author's last setting — an excellent default and a poor override.
     *
     * A valueless `brush` falls through rather than meaning 0: `brush=""` coerces to a legitimate
     * single-cell brush, and silently handing someone that because they wrote a bare attribute is
     * the kind of surprise this element does not do.
     */
    _readBrushSize() {
        const raw = (this.getAttribute('brush') || '').trim();
        if (raw !== '') return clampBrushSize(raw);
        return this._world ? clampBrushSize(this._world.brushSize) : DEFAULT_BRUSH_SIZE;
    }

    /** @returns {number} The `zoom` attribute clamped to the camera's range; absent ⇒ fitted (1). */
    _readZoom() {
        return clampFloat(this.getAttribute('zoom'), ZOOM_MIN, ZOOM_MAX, ZOOM_MIN);
    }

    /** Parse + clamp every non-ruleset attribute. Anything unparseable silently falls back. */
    _readParams() {
        return {
            rows: clampInt(this.getAttribute('rows'), ROWS_MIN, ROWS_MAX, DEFAULTS.rows),
            density: clampFloat(this.getAttribute('density'), 0, 1, DEFAULTS.density),
            // Seeds are uint32. Null (absent/unparseable) means "nondeterministic" — EmbedSim then
            // uses Math.random, exactly as the worker does for a falsy seed.
            seed: readSeed(this.getAttribute('seed')),
            speed: clampFloat(this.getAttribute('speed'), 0, 1000, DEFAULTS.speed),
            palette: (this.getAttribute('palette') || DEFAULTS.palette).trim(),
            customGradient: readGradient(this.getAttribute('palette-on'), this.getAttribute('palette-off')),
            maxDpr: clampFloat(this.getAttribute('max-dpr'), MAX_DPR_MIN, MAX_DPR_MAX, DEFAULTS.maxDpr),
        };
    }

    // --- playback -------------------------------------------------------------

    /**
     * The single place playback is decided. Every gate (attribute, API call, viewport, tab
     * visibility, reduced motion) just updates its own flag and calls this, so the rules can't
     * disagree with each other.
     */
    _syncPlayback() {
        // `_contextLost` sits with the other "there is nothing to run against" gates rather than
        // with the viewport ones: it is not a reason to pause, it is a reason there is no world.
        if (!this.sim || !this.renderer || this.error || this._contextLost) { this._stopLoop(); return; }

        // Reduced motion means: never autoplay. The poster frame + a play button is the escape
        // hatch, and pressing it is the user asking for motion, which we honor.
        const motionAllowed = !this._reducedMotion || this._playRequested;
        // Drawing also holds the loop (pause-while-drawing), same as the explorer.
        const wants = !this._userPaused && motionAllowed && !this._drawing;
        const canRun = wants && this._onScreen && this._docVisible;

        // When `draw` is enabled the host usually owns play chrome (Devvit transport bar); keep the
        // poster off so pointer events reach the canvas for painting. `torus` claims the pointer the
        // same way — for the camera — so it makes the same trade, and a host that turns it on owns
        // its own play control.
        const pointerOwned = this.hasAttribute('draw') || this._torusActive();
        this._overlay.hidden = wants || pointerOwned;
        // Reset is the mirror image: offer it only once the world is running (the overlay is gone),
        // never over the poster frame where it would compete with the play button.
        this._resetBtn.hidden = !wants || pointerOwned;

        if (canRun) this._startLoop();
        else this._stopLoop();

        // After the loop has actually started/stopped, so `playing` is the truth and not a forecast.
        this._emitPlayState();
        // Last: the camera's own loop only runs when the sim's does not, so it needs the settled
        // answer rather than the one from before `_startLoop`.
        this._syncSpinLoop();
    }

    /**
     * Announce `{playing, userPaused}` whenever it changes.
     *
     * Playback has five gates (attribute, API call, viewport, tab visibility, reduced motion) and
     * none of them are visible from outside the element, so a host wanting an honest play/pause
     * label otherwise has to poll a getter on a timer. Deduped against the last emitted tuple:
     * `_syncPlayback` runs on every scroll and visibility flip, and most of those change nothing.
     */
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

    // --- poster preview burst -------------------------------------------------
    // A cellular automaton's whole appeal is motion, and a paused poster in a feed is a dark grid
    // that reads as a broken image at scroll speed. When `preview` is set, the poster runs a few
    // generations as it comes into view and then rewinds to the authored state.
    //
    // Three rules keep this decoration rather than playback:
    //   1. It never touches `_rafId`, so `playing` stays false and no `hexlife-playstate` fires.
    //   2. It only ever runs while the poster is up (paused, not drawable, no explicit play).
    //   3. Anything the *user* does wins instantly — see `_cancelPreviewBurst`.

    /** @returns {number} Ticks to burst, or 0 when the attribute is absent (the feature is opt-in). */
    _readPreviewTicks() {
        if (!this.hasAttribute('preview')) return 0;
        return clampInt(this.getAttribute('preview'), PREVIEW_MIN, PREVIEW_MAX, PREVIEW_DEFAULT);
    }

    /**
     * Is the poster frame what's on screen right now? Only then is there something to animate:
     * a drawable world hands pointer events to paint, and a world the viewer asked to play is
     * already moving.
     */
    _posterShowing() {
        return this._userPaused && !this.hasAttribute('draw') && !this._playRequested
            // The torus hides the poster too (see `_syncPlayback`), and a burst that ticked and then
            // rewound underneath a camera the viewer is turning would read as the world glitching.
            && !this._torusActive();
    }

    /** Start a burst if every gate agrees. Idempotent — a burst in flight is left alone. */
    _maybePreviewBurst() {
        if (this._previewActive) return;
        if (!this.sim || !this.renderer || this.error) return;
        if (!this._docVisible || this._reducedMotion) return;
        if (!this._posterShowing()) return;
        const ticks = this._readPreviewTicks();
        if (!ticks) return;
        this._previewActive = true;
        this._previewLeft = ticks;
        this._previewTicked = 0;
        this._previewTimer = setTimeout(this._previewStep, PREVIEW_TICK_MS);
    }

    _previewStep() {
        this._previewTimer = 0;
        // Re-check every gate each step: a burst spans seconds, and the viewer can pause, play,
        // start drawing, or scroll away in the middle of one.
        if (!this.sim || this.error || !this._posterShowing() || !this._docVisible) {
            this._previewActive = false;
            return;
        }
        if (this._previewLeft > 0) {
            this.sim.tick();
            this._drawOnce();
            this._previewLeft--;
            this._previewTicked++;
            // Note the beat is scheduled even after the last tick. Rewinding in the same step that
            // draws the final generation would put it on screen for zero milliseconds — the burst
            // would show one fewer generation than it was asked for, and snap back mid-motion.
            this._previewTimer = setTimeout(this._previewStep, PREVIEW_TICK_MS);
            return;
        }
        // That beat has now passed: rewind to the state the author actually posted. An exact-cells
        // world replays its cells; a generator world re-rolls, which is that world's own contract.
        this._previewActive = false;
        this.reset();
    }

    /**
     * @param {boolean} restore Rewind to tick 0. True when we're handing the poster back (scrolled
     *   away, tab hidden, `preview` removed) — the authored state is what should be sitting there
     *   next time. **False** when the user took over (play, a draw stroke): resetting under them
     *   would yank the world out from beneath the thing they just did, and for a generator world
     *   it would swap in cells they never saw.
     */
    _cancelPreviewBurst(restore) {
        if (!this._previewActive) return;
        if (this._previewTimer) clearTimeout(this._previewTimer);
        this._previewTimer = 0;
        this._previewLeft = 0;
        this._previewActive = false;
        // Only if it actually moved something: on a generator world `reset()` re-rolls the cells,
        // so restoring a burst that never ticked would change the poster nobody had touched.
        const ticked = this._previewTicked > 0;
        this._previewTicked = 0;
        if (restore && ticked && this.sim && !this.error) this.reset();
    }

    /** IntersectionObserver callback: the viewport gate, and what triggers a poster burst. */
    _onIntersect(entries) {
        const wasOnScreen = this._onScreen;
        const first = !this._onScreenKnown;
        this._onScreenKnown = true;
        this._onScreen = entries[entries.length - 1].isIntersecting;
        this._syncPlayback();

        // "Arrived" = scrolled into view, or was already in view the first time we heard. The
        // second case matters more than it looks: a host that defers mounting until the element is
        // on screen (the Devvit feed does) would otherwise never see a single burst.
        if (this._onScreen && (first || !wasOnScreen)) this._maybePreviewBurst();
        else if (!this._onScreen) this._cancelPreviewBurst(true);
    }

    // --- draw (invert brush) --------------------------------------------------

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

    _onPointerDown(e) {
        if (!this.sim || !this.renderer || this.error) return;
        // The torus takes the pointer before `draw` gets a look at it: there is no hit-test for a
        // cell on a 3D surface, so a drag there can only mean the camera.
        if (this._torusActive()) {
            this._beginOrbit(e);
            return;
        }
        if (!this.hasAttribute('draw')) return;
        // Multi-touch pinch owns the gesture — don't paint under a second finger, and stay out of
        // the way for the rest of it (see `_gestureLock`).
        if (this._pinchTouches.size >= 2 || this._gestureLock) return;
        // A second concurrent pointer *is* the pinch starting. `pointerdown` fires before the
        // matching `touchstart`, so `_pinchTouches` is still size 1 here — this is the earliest
        // point at which a pinch is knowable, and the only one early enough to undo the dab the
        // first finger just painted.
        if (this._drawing && e.pointerId !== this._drawPointerId) {
            this._beginTouchGesture();
            return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const rect = this._canvas.getBoundingClientRect();
        const hit = this.renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (!hit) return;

        e.preventDefault();
        // They're painting on what they can see. Cancel without restoring: rewinding the cells out
        // from under a stroke already in progress would be the rudest possible moment for it.
        this._cancelPreviewBurst(false);
        this._drawing = true;
        this._drawPointerId = e.pointerId;
        this._strokeAffected = new Set();
        this._strokeStartTime = performance.now();
        this._lastDrawCoords = hit;
        // Pause while drawing; remember whether we should resume after the stroke.
        this._resumeAfterStroke = !this._userPaused && this.playing;
        if (!this._userPaused) {
            // Soft pause without flipping the paused attribute (so play/pause chrome stays honest).
            this._syncPlayback();
        }
        try { this._canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

        if (this.sim.invertBrushLine(hit.col, hit.row, hit.col, hit.row, this._brushSize, this._strokeAffected)) {
            this._drawOnce();
        }
    }

    _onPointerMove(e) {
        if (this._orbitPointerId != null) {
            this._moveOrbit(e);
            return;
        }
        if (!this._drawing || e.pointerId !== this._drawPointerId) return;
        if (this._pinchTouches.size >= 2 || this._gestureLock) {
            this._beginTouchGesture();
            return;
        }
        e.preventDefault();
        if (!this.sim || !this.renderer) return;
        const rect = this._canvas.getBoundingClientRect();
        const hit = this.renderer.hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (!hit || !this._lastDrawCoords) return;
        if (hit.col === this._lastDrawCoords.col && hit.row === this._lastDrawCoords.row) return;

        if (this.sim.invertBrushLine(
            this._lastDrawCoords.col, this._lastDrawCoords.row,
            hit.col, hit.row,
            this._brushSize, this._strokeAffected,
        )) {
            this._drawOnce();
        }
        this._lastDrawCoords = hit;
    }

    _onPointerUp(e) {
        if (this._orbitPointerId != null) {
            if (!e || e.pointerId === this._orbitPointerId) this._endOrbit();
            return;
        }
        if (!this._drawing) return;
        if (e && this._drawPointerId != null && e.pointerId !== this._drawPointerId) return;
        this._endDrawStroke(true);
    }

    /**
     * Hand the touch over to navigation (pinch-zoom + two-finger pan): latch the gesture lock and
     * end any stroke in flight, rewinding it when it is young enough to have been an accident.
     */
    _beginTouchGesture() {
        this._gestureLock = true;
        if (this._drawing && this._strokeIsAccidental()) this._revertStroke();
        this._endDrawStroke(true);
    }

    /**
     * Was the in-flight stroke plausibly just the leading edge of a pinch?
     *
     * The two fingers of a pinch land within roughly a tenth of a second of each other, so anything
     * inside the window is a slip and gets rewound. Past it the viewer was genuinely drawing, and
     * un-drawing their work because they then reached for a zoom would be far worse than leaving it.
     */
    _strokeIsAccidental() {
        return performance.now() - this._strokeStartTime < ACCIDENTAL_STROKE_MS;
    }

    /** Undo the current stroke by re-inverting exactly the cells it flipped. */
    _revertStroke() {
        if (!this.sim || this._strokeAffected.size === 0) return;
        if (this.sim.invertCells(this._strokeAffected)) this._drawOnce();
        this._strokeAffected = new Set();
    }

    /**
     * @param {boolean} maybeResume Whether to restore playback if the stroke interrupted it.
     */
    _endDrawStroke(maybeResume) {
        if (!this._drawing && !this._resumeAfterStroke) {
            this._drawPointerId = null;
            this._lastDrawCoords = null;
            return;
        }
        const shouldResume = maybeResume && this._resumeAfterStroke && !this._userPaused;
        this._drawing = false;
        this._drawPointerId = null;
        this._lastDrawCoords = null;
        this._strokeAffected = new Set();
        this._resumeAfterStroke = false;
        if (shouldResume) this._syncPlayback();
        else this._syncPlayback();
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
        // Clamp dt: a backgrounded tab or a long GC pause would otherwise owe us a huge burst of
        // ticks. EmbedSim.advance caps ticks per call too; this keeps the accumulator honest.
        const dt = Math.min(now - this._lastFrameTime, 100);
        this._lastFrameTime = now;
        // The camera rides this loop while it exists — `_syncSpinLoop` keeps its own rAF parked for
        // exactly as long as this one is running, so the torus never spins at double rate.
        this._advanceSpin(dt);
        this.sim.advance(dt);
        this.renderer.draw(this.sim);
    }

    /** Render the current generation exactly once (poster frames, resizes, `tick()`, `reset()`). */
    _drawOnce() {
        if (this.sim && this.renderer && !this.error && !this._contextLost) this.renderer.draw(this.sim);
    }

    _resize() {
        if (!this.renderer || this._contextLost) return;
        const rect = this.getBoundingClientRect();
        this.renderer.resize(rect.width || 1, rect.height || 1, this._readParams().maxDpr);
        this._applyView();
    }

    // --- torus view -----------------------------------------------------------
    // `torus` wraps the live world onto the 3D surface its edges already imply. It is a *projection*,
    // not a mode: same sim, same cells, same instanced draw — only the camera changes. Three rules,
    // mirroring the ones that keep the preview burst honest:
    //
    //   1. It never touches `_rafId`. A spinning camera is not a running simulation, so `playing`
    //      stays false and no `hexlife-playstate` fires for it.
    //   2. The pointer belongs to the camera while it is on, so — exactly as with `draw` — the poster
    //      overlay steps aside and the host owns the play control.
    //   3. Nothing is built until it is first switched on (see `EmbedRenderer._ensureTorusProgram`),
    //      so a feed card that never leaves the flat view pays nothing for this.

    /** @returns {boolean} Is the world being drawn on the torus right now? */
    _torusActive() {
        return this.hasAttribute('torus') && !!this.renderer && this.renderer.torusEnabled;
    }

    /** @returns {number} Auto-rotation in degrees/second; 0 means the viewer turns it by hand. */
    _readTorusSpin() {
        if (!this.hasAttribute('torus')) return 0;
        return clampFloat(this.getAttribute('torus'), TORUS_SPIN_MIN, TORUS_SPIN_MAX, TORUS_SPIN_DEFAULT);
    }

    /**
     * Apply the `torus` attribute to the renderer and everything that follows from it. Safe to call
     * repeatedly — the renderer's own program build is the only one-time part.
     */
    _syncTorus() {
        if (!this.renderer || this.error) return;
        const want = this.hasAttribute('torus');
        // The overwhelmingly common case — a flat world that has never been anything else. There is
        // nothing to undo and no reason to spend a redraw on it, which is what keeps a feed card
        // that never touches 3D paying nothing for this feature at boot.
        if (!want && !this.renderer.torusEnabled) return;
        // `setTorus` returns false when the shaders would not build, which is the one case where the
        // attribute is set but the flat view is still what's on screen. Everything downstream reads
        // `_torusActive()` rather than the attribute, so that stays coherent.
        this.renderer.setTorus(want);
        if (want) {
            // Pointer events are about to mean "turn this", not "paint on it".
            this._endDrawStroke(false);
            this._cancelPreviewBurst(true);
        } else {
            this._endOrbit();
        }
        this._applyPointerAffordance();
        this._syncSpinLoop();
        this._syncPlayback();
        this._drawOnce();
    }

    /**
     * Cursor + `touch-action` for whatever currently owns the pointer. One place, because `draw` and
     * `torus` both claim it and the loser must not leave its cursor behind.
     */
    _applyPointerAffordance() {
        const owned = this._torusActive() || this.hasAttribute('draw');
        this._canvas.style.touchAction = owned ? 'none' : '';
        this._canvas.style.cursor = this._torusActive() ? 'grab'
            : this.hasAttribute('draw') ? 'crosshair' : '';
    }

    /**
     * Run the camera's own rAF only when it is the only thing that would move.
     *
     * While the sim loop is running it already redraws every frame, so `_frame` advances the spin
     * itself and a second loop would just double the work. The gates are otherwise the playback
     * gates: an offscreen or backgrounded element spins nothing, and reduced motion gets a still
     * torus it can still turn by hand.
     */
    _syncSpinLoop() {
        const wants = this._torusActive()
            && this._readTorusSpin() > 0
            && !this.playing
            && !this._orbitPointerId
            && this._onScreen
            && this._docVisible
            && (!this._reducedMotion || this._playRequested)
            && !this.error
            && !this._contextLost;
        if (wants) {
            if (this._spinRafId) return;
            this._spinLastTime = performance.now();
            this._spinRafId = requestAnimationFrame(this._spinFrame);
        } else if (this._spinRafId) {
            cancelAnimationFrame(this._spinRafId);
            this._spinRafId = 0;
        }
    }

    _spinFrame(now) {
        this._spinRafId = requestAnimationFrame(this._spinFrame);
        const dt = Math.min(now - this._spinLastTime, 100);
        this._spinLastTime = now;
        this._advanceSpin(dt);
        this._drawOnce();
    }

    /**
     * Turn the camera by one frame's worth of auto-rotation.
     * @param {number} dt Milliseconds since the previous frame (already clamped by the caller).
     */
    _advanceSpin(dt) {
        if (!this._torusActive() || this._orbitPointerId != null) return;
        const degreesPerSecond = this._readTorusSpin();
        if (degreesPerSecond <= 0) return;
        this.renderer.orbitTorus((degreesPerSecond * Math.PI / 180) * (dt / 1000), 0);
    }

    /** Drag-to-orbit: take the pointer, or ignore it if another one already has the camera. */
    _beginOrbit(e) {
        if (this._orbitPointerId != null) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        this._orbitPointerId = e.pointerId;
        this._orbitLast = { x: e.clientX, y: e.clientY };
        this._canvas.style.cursor = 'grabbing';
        try { this._canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        // Hand the frame back: while a finger is on the glass the camera follows it, not the clock.
        this._syncSpinLoop();
    }

    _moveOrbit(e) {
        if (this._orbitPointerId !== e.pointerId || !this._orbitLast) return;
        e.preventDefault();
        const dx = e.clientX - this._orbitLast.x;
        const dy = e.clientY - this._orbitLast.y;
        this._orbitLast = { x: e.clientX, y: e.clientY };
        // Drag right turns the torus right; drag down tips the near face toward the viewer.
        this.renderer.orbitTorus(-dx * TORUS_ORBIT_RADIANS_PER_PX, dy * TORUS_ORBIT_RADIANS_PER_PX);
        if (!this.playing) this._drawOnce();
    }

    _endOrbit() {
        if (this._orbitPointerId == null) return;
        try { this._canvas.releasePointerCapture(this._orbitPointerId); } catch { /* ignore */ }
        this._orbitPointerId = null;
        this._orbitLast = null;
        this._applyPointerAffordance();
        this._syncSpinLoop();
    }

    // --- camera (zoom) --------------------------------------------------------

    /**
     * Apply the current view zoom/pan to the renderer. Zoom is multiplicative around the fitted
     * center; pan is in CSS-pixel deltas of the canvas (converted to world space by the renderer).
     */
    _applyView() {
        if (!this.renderer) return;
        this.renderer.setView(this._viewZoom, this._viewPanX, this._viewPanY);
    }

    /**
     * Zoom by a multiplicative factor, optionally around a canvas-local point (CSS pixels from the
     * canvas top-left). Keeps that point stable under the cursor/finger so wheel zoom feels anchored.
     *
     * Floor is 1 (= the initial fitted "whole world" view). Zooming out past that would letterbox
     * the grid inside empty canvas — not allowed. At the floor, pan is cleared so the world is
     * always centred and fills the view.
     * @param {number} factor
     * @param {number} [localX]
     * @param {number} [localY]
     */
    _zoomBy(factor, localX, localY) {
        if (!this.renderer || !Number.isFinite(factor) || factor <= 0) return;
        const prev = this._viewZoom;
        // Min 1 = initial fit (100%); max 8 = close detail.
        const next = Math.min(8, Math.max(1, prev * factor));
        if (next === prev) {
            // Still at the floor while trying to zoom out further — force a clean fit.
            if (next === 1 && (this._viewPanX !== 0 || this._viewPanY !== 0)) {
                this._viewPanX = 0;
                this._viewPanY = 0;
                this._applyView();
                if (!this.playing) this._drawOnce();
            }
            return;
        }

        if (next === 1) {
            // Fully zoomed out: cover the view, no offset.
            this._viewZoom = 1;
            this._viewPanX = 0;
            this._viewPanY = 0;
        } else {
            // Anchor: shift pan so the world point under (localX, localY) stays put. Without an
            // anchor (pinch midpoint missing), zoom about the canvas centre.
            const rect = this._canvas.getBoundingClientRect();
            const ax = localX ?? rect.width / 2;
            const ay = localY ?? rect.height / 2;
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            // Pan is stored in CSS pixels of offset from centre; scale it with zoom so the anchor holds.
            const scale = next / prev;
            this._viewPanX = ax - cx - (ax - cx - this._viewPanX) * scale;
            this._viewPanY = ay - cy - (ay - cy - this._viewPanY) * scale;
            this._viewZoom = next;
        }
        this._applyView();
        if (!this.playing) this._drawOnce();
    }

    _onWheel(e) {
        // Fall through *without* preventDefault when the wheel isn't ours, so the page scrolls
        // normally (see `wheelZoomAllowed`).
        if (!wheelZoomAllowed(this.getAttribute('wheel-zoom'), e)) return;
        // Zoom is ours: preventDefault so the host page doesn't scroll away under the cursor.
        e.preventDefault();
        // On the torus the wheel dollies the camera. There is no anchor point to hold steady — the
        // thing under the cursor is a curved surface, not a spot on a map — so it moves in and out
        // about the centre, which is also the only place the whole shape stays framed.
        if (this._torusActive()) {
            this.renderer.dollyTorus(Math.exp(e.deltaY * 0.001));
            if (!this.playing) this._drawOnce();
            return;
        }
        const rect = this._canvas.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        // deltaY > 0 = scroll down = zoom out. Use an exponential so trackpads and mice both feel ok.
        const factor = Math.exp(-e.deltaY * 0.0015);
        this._zoomBy(factor, localX, localY);
    }

    _onTouchStart(e) {
        for (const t of e.changedTouches) {
            this._pinchTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
        if (this._pinchTouches.size >= 2) {
            const pts = [...this._pinchTouches.values()];
            const dx = pts[0].x - pts[1].x;
            const dy = pts[0].y - pts[1].y;
            this._pinchStartDist = Math.hypot(dx, dy) || 1;
            this._pinchLastDist = this._pinchStartDist;
            this._pinchStartZoom = this._viewZoom;
            this._pinchLastMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
            // On the torus, one finger orbits and two dolly — so a second finger ends the orbit
            // rather than a draw stroke.
            if (this._torusActive()) this._endOrbit();
            // Belt and braces: `pointerdown` for the second finger normally gets here first, but a
            // host that swallows pointer events would leave the stroke running without this.
            else this._beginTouchGesture();
        }
    }

    _onTouchMove(e) {
        for (const t of e.changedTouches) {
            if (this._pinchTouches.has(t.identifier)) {
                this._pinchTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
            }
        }
        if (this._pinchTouches.size !== 2) return;
        // Two-finger gesture owns the touch — stop the feed from scrolling underneath.
        e.preventDefault();
        const pts = [...this._pinchTouches.values()];
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy) || 1;
        if (this._torusActive()) {
            // Spread = closer. Relative to the previous frame rather than the gesture start, because
            // `dollyTorus` accumulates into a clamped distance and has no absolute target to aim at.
            this.renderer.dollyTorus((this._pinchLastDist || dist) / dist);
            this._pinchLastDist = dist;
            if (!this.playing) this._drawOnce();
            return;
        }
        const factor = dist / this._pinchStartDist;
        // Same floor as wheel zoom: never smaller than the initial fitted view.
        const target = Math.min(8, Math.max(1, this._pinchStartZoom * factor));
        // Set absolute zoom from the pinch start rather than stacking relative factors (avoids drift).
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const rect = this._canvas.getBoundingClientRect();
        const ratio = target / this._viewZoom;
        // Zoom first, anchored at the midpoint so the world stays pinned under the fingers, then
        // translate by however far that midpoint travelled. The two compose into the one gesture
        // people expect from a map: spread to zoom, slide to pan, in any mixture.
        if (ratio !== 1 || target === 1) {
            this._zoomBy(ratio, midX - rect.left, midY - rect.top);
        }
        if (this._pinchLastMid) {
            this._panBy(midX - this._pinchLastMid.x, midY - this._pinchLastMid.y);
        }
        this._pinchLastMid = { x: midX, y: midY };
    }

    /**
     * Translate the view by a CSS-pixel delta (positive = content follows the finger right/down).
     *
     * Clamped to the same bound the anchored zoom maths already preserves — `(zoom - 1) * half` per
     * axis — so the grid can never be dragged off into empty canvas, and at the zoom floor pan is
     * pinned to 0 (the fitted view is centred by definition).
     * @param {number} dx
     * @param {number} dy
     */
    _panBy(dx, dy) {
        if (!this.renderer || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
        const rect = this._canvas.getBoundingClientRect();
        const maxX = ((this._viewZoom - 1) * rect.width) / 2;
        const maxY = ((this._viewZoom - 1) * rect.height) / 2;
        const nextX = Math.min(maxX, Math.max(-maxX, this._viewPanX + dx));
        const nextY = Math.min(maxY, Math.max(-maxY, this._viewPanY + dy));
        if (nextX === this._viewPanX && nextY === this._viewPanY) return;
        this._viewPanX = nextX;
        this._viewPanY = nextY;
        this._applyView();
        if (!this.playing) this._drawOnce();
    }

    _onTouchEnd(e) {
        for (const t of e.changedTouches) this._pinchTouches.delete(t.identifier);
        if (this._pinchTouches.size < 2) {
            this._pinchStartDist = 0;
            this._pinchLastDist = 0;
            this._pinchLastMid = null;
        }
        // Only a fully empty glass releases the lock — one finger left over from a pinch must not
        // start painting a line across everything the viewer was just navigating around.
        if (this._pinchTouches.size === 0) this._gestureLock = false;
    }

    // --- chrome ---------------------------------------------------------------

    _updateAttribution() {
        if (this.getAttribute('link') === 'off') {
            this._attrib.hidden = true;
            return;
        }
        const hex = this._world ? this._world.rulesetHex : this._readRuleset();
        const rows = this._world ? this._world.rows : this._readParams().rows;
        const url = new URL(APP_URL);
        if (typeof hex === 'string') url.searchParams.set('r', hex);
        if (rows !== DEFAULTS.rows) url.searchParams.set('g', String(rows));
        this._attrib.href = url.toString();
        this._attrib.title = 'Open this ruleset in HexLife Explorer';
        this._attrib.hidden = false;
    }

    /** Enter the styled error state: no canvas, no loop, a readable message, link kept. */
    _fail(message, detail) {
        this.error = message;
        this._teardown();
        this._errorBox.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = `<hexlife-world>: ${message}`;
        const code = document.createElement('code');
        code.textContent = detail || '';
        this._errorBox.append(strong, code);
        this._errorBox.hidden = false;
        this._updateAttribution();
        console.warn(`<hexlife-world>: ${message} ${detail || ''}`);
        // Rule 1 (see the header) says we never throw into the host page — but a host that renders
        // its own chrome around us still needs to know we gave up, rather than showing a transport
        // bar for a world that will never run.
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
