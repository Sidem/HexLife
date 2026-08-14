/**
 * `<hexlife-hcp>` — public custom element for HCP worlds.
 *
 * Isolated artifact: this file imports `./hcp.js` and nothing on the binary, k-state, stochastic
 * or solid path imports this file. The loop calls native `tick(n)` and draws the live state view.
 * It never `setCells` after a tick.
 */

import {HcpRenderer} from './HcpRenderer.js';
import {
    decodeHcpCode,
    HexHcp,
    initHcpEngine,
    isHcpCode,
} from './hcp.js';

const APP_URL = 'https://sidem.github.io/HexLife/';

const LIVE_ATTRS = new Set(['paused', 'speed', 'palette', 'link', 'clip', 'opacity', 'auto-rotate']);

const DEFAULTS = {
    states: 6,
    layers: 24,
    rows: 48,
    columns: 56,
    speed: 24,
};

const STYLES = `
:host {
    display: block;
    aspect-ratio: 5 / 4;
    position: relative;
    contain: content;
    background: #1a1a1a;
    overflow: hidden;
}
:host([hidden]) { display: none; }
canvas { display: block; width: 100%; height: 100%; }
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
.attrib {
    position: absolute;
    right: 6px;
    bottom: 4px;
    font: 500 11px/1.4 system-ui, -apple-system, sans-serif;
    color: rgba(255, 255, 255, 0.55);
    text-decoration: none;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
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
[hidden] { display: none !important; }
`;

const PLAY_ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,0.45)" stroke="currentColor" stroke-width="2.5"/><path d="M26 20l20 12-20 12z" fill="currentColor"/></svg>';

function readInt(value, fallback, min, max) {
    const n = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function readSpeed(value) {
    if (value == null || value === '') return DEFAULTS.speed;
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULTS.speed;
    return Math.min(1000, Math.max(0, n));
}

function readPalette(value, states) {
    if (value && value.includes(',')) {
        const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
        const colors = parts.map((hex) => {
            const full = hex.replace(/^#/, '');
            const raw = full.length === 3 ? full.replace(/./g, (c) => c + c) : full;
            if (!/^[0-9a-f]{6}$/i.test(raw)) return [26, 26, 26];
            return [
                parseInt(raw.slice(0, 2), 16),
                parseInt(raw.slice(2, 4), 16),
                parseInt(raw.slice(4, 6), 16),
            ];
        });
        while (colors.length < states) colors.push([26, 26, 26]);
        return colors.slice(0, Math.max(states, 1));
    }
    const out = [];
    for (let i = 0; i < Math.max(states, 1); i++) {
        const t = states <= 1 ? 0 : i / (states - 1);
        out.push([
            Math.round(30 + t * 180),
            Math.round(40 + (1 - t) * 80),
            Math.round(50 + Math.sin(t * Math.PI) * 120),
        ]);
    }
    out[0] = [18, 18, 20];
    return out;
}

export class HexHcpElement extends HTMLElement {
    static get observedAttributes() {
        return ['code', 'states', 'layers', 'rows', 'columns', 'speed', 'palette', 'paused', 'link', 'clip', 'opacity', 'auto-rotate'];
    }

    constructor() {
        super();
        this.attachShadow({mode: 'open'});
        this.shadowRoot.innerHTML = `<style>${STYLES}</style><canvas part="canvas"></canvas><button class="overlay" part="overlay" type="button" aria-label="Play">${PLAY_ICON}</button><a class="attrib" part="link" href="${APP_URL}" target="_blank" rel="noopener">HexLife</a><div class="error" hidden></div>`;
        this._canvas = this.shadowRoot.querySelector('canvas');
        this._overlay = this.shadowRoot.querySelector('.overlay');
        this._attrib = this.shadowRoot.querySelector('.attrib');
        this._errorBox = this.shadowRoot.querySelector('.error');
        this.world = null;
        this.renderer = null;
        this.error = null;
        this._rule = null;
        this._initialCells = null;
        this._palette = null;
        this._userPaused = false;
        this._simPlaying = false;
        this._onScreen = true;
        this._docVisible = true;
        this._reducedMotion = false;
        this._playRequested = false;
        this._rafId = 0;
        this._lastFrameTime = 0;
        this._hasConnected = false;
        this._generation = 0;
        this._contextLost = false;
        this._frame = this._frame.bind(this);
        this._onVisibilityChange = () => {
            this._docVisible = document.visibilityState !== 'hidden';
            this._syncPlayback();
        };
        this._onContextLost = (event) => {
            event.preventDefault();
            this._contextLost = true;
            this._stopLoop();
        };
        this._onContextRestored = () => {
            this._contextLost = false;
            if (this.renderer) this.renderer.restoreContext();
            this._applyPalette();
            this._afterMutation();
        };
        this._overlay.addEventListener('click', () => this.play());
        this._canvas.addEventListener('webglcontextlost', this._onContextLost);
        this._canvas.addEventListener('webglcontextrestored', this._onContextRestored);
    }

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
        if (oldValue === newValue || !this._hasConnected || !this.isConnected) return;
        if (!this.world || !this.renderer) {
            this._rebootSoon();
            return;
        }
        if (!LIVE_ATTRS.has(name)) {
            this._rebootSoon();
            return;
        }
        if (name === 'speed') this.world.speed = readSpeed(this.getAttribute('speed'));
        else if (name === 'palette') {
            this._applyPalette();
            this._drawOnce();
        } else if (name === 'paused') {
            this._userPaused = this.hasAttribute('paused');
            if (this._userPaused) this._playRequested = false;
            this._syncPlayback();
        } else if (name === 'link') this._updateAttribution();
        else if (name === 'clip' && this.renderer) {
            this.renderer.setClip(Number(this.getAttribute('clip')));
            this._drawOnce();
        } else if (name === 'opacity' && this.renderer) {
            this.renderer.setOpacity(Number(this.getAttribute('opacity')));
            this._drawOnce();
        } else if (name === 'auto-rotate' && this.renderer) {
            this._applyAutoRotate();
            this._drawOnce();
        }
    }

    play() {
        this._playRequested = true;
        this._userPaused = false;
        if (this.hasAttribute('paused')) this.removeAttribute('paused');
        else this._syncPlayback();
    }

    pause() {
        this._userPaused = true;
        if (!this.hasAttribute('paused')) this.setAttribute('paused', '');
        else this._syncPlayback();
    }

    /** @param {number} [count=1] */
    tick(count = 1) {
        if (!this.world) return 0;
        const changed = this.world.tick(count);
        this._drawOnce();
        return changed;
    }

    reset() {
        if (!this.world) return;
        if (this._initialCells) this.world.setCells(this._initialCells);
        else this.world.fill(0);
        this._afterMutation();
    }

    /** @param {ArrayLike<number>} rule */
    setRule(rule) {
        if (!this.world || this.error) return false;
        try {
            this.world.setRule(rule);
        } catch (e) {
            this._fail('Invalid rule table.', String(e && e.message ? e.message : e));
            return false;
        }
        this._rule = rule instanceof Uint32Array ? new Uint32Array(rule) : Uint32Array.from(rule);
        this._afterMutation();
        return true;
    }

    /** @param {ArrayLike<number>} cells */
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

    get generation() { return this.world ? this.world.generation : 0; }
    get isSettled() { return this.world ? this.world.isSettled : false; }
    get playing() { return this._simPlaying; }
    get userPaused() { return this._userPaused; }

    async _boot(generation) {
        this._clearError();
        const raw = (this.getAttribute('code') || '').trim();
        if (raw && !isHcpCode(raw)) {
            this._fail('Invalid “code”.', 'Not a HexLife HCP world code — these start with “HXP1.”.');
            return;
        }
        const decoded = raw ? await decodeHcpCode(raw) : null;
        if (generation !== this._generation) return;
        if (raw && !decoded) {
            this._fail('Invalid “code”.', 'Not a HexLife HCP world code (or it was truncated).');
            return;
        }

        const states = decoded ? decoded.states : readInt(this.getAttribute('states'), DEFAULTS.states, 2, 16);
        const layers = decoded ? decoded.layers : readInt(this.getAttribute('layers'), DEFAULTS.layers, 2, 256);
        const rows = decoded ? decoded.rows : readInt(this.getAttribute('rows'), DEFAULTS.rows, 3, 512);
        const columns = decoded ? decoded.cols : readInt(this.getAttribute('columns'), DEFAULTS.columns, 2, 512);
        const speed = decoded ? decoded.speed : readSpeed(this.getAttribute('speed'));

        this._userPaused = this.hasAttribute('paused');
        this._playRequested = false;
        this._docVisible = document.visibilityState !== 'hidden';

        try {
            await initHcpEngine();
        } catch (e) {
            if (generation !== this._generation) return;
            this._fail('Simulation engine failed to load.', String(e && e.message ? e.message : e));
            return;
        }
        if (generation !== this._generation) return;

        try {
            this.world = new HexHcp({
                states,
                layers,
                rows,
                columns,
                speed,
                stacking: decoded ? decoded.stacking : 'hcp',
                xyBoundary: decoded ? decoded.xyBoundary : 'torus',
                zBoundary: decoded ? decoded.zBoundary : 'open',
            });
            if (decoded?.blockAlternates) this.world.setBlockAlternates(true);
        } catch (e) {
            this._fail('Simulation failed to start.', String(e && e.message ? e.message : e));
            return;
        }

        if (decoded) {
            try {
                this.world.setRule(decoded.rule);
                this.world.setCells(decoded.cells);
                this.world.setGeneration(Number(decoded.generation));
            } catch (e) {
                this._fail('The world code did not fit its own header.', String(e && e.message ? e.message : e));
                return;
            }
            this._rule = decoded.rule;
            this._initialCells = decoded.cells;
        }

        try {
            this.renderer = new HcpRenderer(this._canvas, {
                layers,
                rows,
                columns,
                autoRotate: this._readAutoRotate(),
            });
        } catch (e) {
            this._fail('This browser can’t run WebGL2.', String(e && e.message ? e.message : e));
            return;
        }
        this.renderer.setClip(Number(this.getAttribute('clip') ?? 0.35));
        this.renderer.setOpacity(this.hasAttribute('opacity') ? Number(this.getAttribute('opacity')) : 1);
        this._applyPalette(decoded ? decoded.palette : null);
        this._updateAttribution();

        document.addEventListener('visibilitychange', this._onVisibilityChange);
        this._resizeObserver = new ResizeObserver(() => {
            this._resize();
            if (!this.playing) this._drawOnce();
        });
        this._resizeObserver.observe(this);
        this._intersectionObserver = new IntersectionObserver((entries) => {
            this._onScreen = entries[entries.length - 1].isIntersecting;
            this._syncPlayback();
        }, {threshold: 0});
        this._intersectionObserver.observe(this);
        this._motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion = this._motionQuery.matches;
        this._onMotionChange = (e) => {
            this._reducedMotion = e.matches;
            if (e.matches) this._playRequested = false;
            this._applyAutoRotate();
            this._syncPlayback();
        };
        this._motionQuery.addEventListener('change', this._onMotionChange);

        this._applyAutoRotate();
        this._resize();
        this._drawOnce();
        this._syncPlayback();
        this.dispatchEvent(new CustomEvent('hexlife-hcp-ready', {
            bubbles: true,
            composed: true,
            detail: {states, layers, rows, columns},
        }));
    }

    _teardown() {
        this._stopLoop();
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
        this._resizeObserver?.disconnect();
        this._intersectionObserver?.disconnect();
        this._motionQuery?.removeEventListener('change', this._onMotionChange);
        this.renderer?.dispose();
        this.world?.dispose();
        this.renderer = null;
        this.world = null;
    }

    _rebootSoon() {
        this._generation++;
        this._teardown();
        this._boot(this._generation);
    }

    _applyPalette(fromCode = null) {
        if (!this.world || !this.renderer) return false;
        const colors = fromCode && fromCode.length === this.world.states
            ? fromCode
            : readPalette(this.getAttribute('palette'), this.world.states);
        this._palette = colors;
        this.renderer.setPalette(colors);
        return true;
    }

    _updateAttribution() {
        const href = this.getAttribute('link') || APP_URL;
        this._attrib.href = href;
        this._attrib.hidden = href === 'none';
    }

    _readAutoRotate() {
        const raw = this.getAttribute('auto-rotate');
        if (raw == null || raw === '') return true;
        return raw !== 'false' && raw !== '0';
    }

    _applyAutoRotate() {
        if (!this.renderer) return;
        this.renderer.setAutoRotate(this._readAutoRotate() && !this._reducedMotion);
    }

    _syncPlayback() {
        if (!this.world || !this.renderer || this.error || this._contextLost) {
            this._simPlaying = false;
            this._stopLoop();
            return;
        }
        const motionAllowed = !this._reducedMotion || this._playRequested;
        const wantsSim = !this._userPaused && motionAllowed && this._onScreen && this._docVisible;
        this._simPlaying = wantsSim;
        this._overlay.hidden = wantsSim || this.hasAttribute('paused');
        // Orbit and auto-rotate must keep drawing while the host holds `paused`.
        if (this._onScreen && this._docVisible) this._startLoop();
        else this._stopLoop();
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
        if (this._simPlaying) this.world.advance(dt);
        this._rafId = requestAnimationFrame(this._frame);
        this.renderer.draw(this.world.state, {dtMs: this._simPlaying || this.renderer.autoRotate ? dt : 0});
    }

    _drawOnce() {
        if (this.world && this.renderer && !this.error && !this._contextLost) {
            this.renderer.markDirty();
            this.renderer.draw(this.world.state);
        }
    }

    _afterMutation() {
        this._drawOnce();
        this._syncPlayback();
    }

    _resize() {
        if (!this.renderer || this._contextLost) return;
        const rect = this.getBoundingClientRect();
        this.renderer.resize(rect.width || 1, rect.height || 1, Math.min(window.devicePixelRatio || 1, 1.5));
    }

    _fail(title, detail) {
        this.error = {title, detail};
        this._errorBox.hidden = false;
        this._errorBox.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
        this._overlay.hidden = true;
    }

    _clearError() {
        this.error = null;
        this._errorBox.hidden = true;
        this._errorBox.textContent = '';
    }
}
