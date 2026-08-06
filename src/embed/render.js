import { EmbedRenderer } from './EmbedRenderer.js';

const DEFAULT_CAMERA = Object.freeze({ zoom: 1, panX: 0, panY: 0 });

/**
 * Host-owned renderer for externally verified row-major state. It deliberately owns no simulation,
 * clock, networking, or history: callers upload a generation once, then redraw it through any number
 * of camera changes without another state-buffer upload.
 */
export class HexLifeRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('./render.js').RendererOptions} options
     */
    constructor(canvas, options) {
        if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
        const rows = Number(options?.rows);
        const columns = Number(options?.columns);
        if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows <= 0 || columns <= 0) {
            throw new RangeError('Renderer rows and columns must be positive integers.');
        }

        this.canvas = canvas;
        this.rows = rows;
        this.columns = columns;
        this.numCells = rows * columns;
        this.maxDpr = finiteInRange(options.maxDpr, 1.5, 1, 4);
        this.minZoom = finiteInRange(options.minZoom, 0.3, 0.05, 8);
        this.maxZoom = finiteInRange(options.maxZoom, 5, this.minZoom, 32);
        this._rendererOptions = {
            cols: columns,
            rows,
            palette: options.palette || 'default',
            customGradient: options.customGradient || null,
            colorSettings: options.colorSettings || null,
            lut: options.lut || null,
            flickerProof: !!options.flickerProof,
            hueShift: options.hueShift ?? null,
            repeatToroidal: options.repeatToroidal !== false,
            overlays: true,
        };
        this._camera = { ...DEFAULT_CAMERA, zoom: finiteInRange(options.zoom, 1, this.minZoom, this.maxZoom) };
        this._state = null;
        this._ruleIndices = null;
        this._selectionIndex = null;
        this._draft = [];
        this._contextLost = false;
        this._destroyed = false;
        this._stats = { draws: 0, stateUploads: 0, stateUploadBytes: 0, contextLosses: 0 };
        this._onContextLostCallback = options.onContextLost || null;
        this._onContextRestoredCallback = options.onContextRestored || null;
        this._onContextLost = (event) => this._handleContextLost(event);
        this._onContextRestored = () => this._handleContextRestored();
        canvas.addEventListener('webglcontextlost', this._onContextLost);
        canvas.addEventListener('webglcontextrestored', this._onContextRestored);
        this._createRenderer();
        this.resize();
    }

    _createRenderer() {
        this._renderer = new EmbedRenderer(this.canvas, this._rendererOptions);
        this._renderer.setView(this._camera.zoom, this._camera.panX, this._camera.panY);
    }

    /** Size the backing store from CSS dimensions and the configured DPR cap. */
    resize(width = this.canvas.clientWidth || 1, height = this.canvas.clientHeight || 1) {
        this._assertAlive();
        this._renderer.resize(width, height, this.maxDpr);
        this._renderer.setView(this._camera.zoom, this._camera.panX, this._camera.panY);
    }

    /**
     * Upload one externally verified generation. The arrays must remain immutable until the next
     * call so they can also be restored after a WebGL context loss.
     */
    setState(cells, { ruleIndices = null } = {}) {
        this._assertAlive();
        if (!(cells instanceof Uint8Array) || cells.length !== this.numCells) {
            throw new RangeError(`Expected ${this.numCells} row-major cell bytes.`);
        }
        if (ruleIndices !== null && (!(ruleIndices instanceof Uint8Array) || ruleIndices.length !== this.numCells)) {
            throw new RangeError(`Expected ${this.numCells} row-major rule-index bytes.`);
        }
        this._state = cells;
        this._ruleIndices = ruleIndices;
        if (!this._contextLost) this._renderer.setExternalState(cells, ruleIndices);
        this._stats.stateUploads += 1;
        this._stats.stateUploadBytes += cells.byteLength + (ruleIndices?.byteLength || 0);
    }

    setPalette(options) {
        this._assertAlive();
        Object.assign(this._rendererOptions, options);
        if (!this._contextLost) this._renderer.setPalette(options);
    }

    /** Move rendered content in CSS pixels. */
    panBy(deltaX, deltaY) {
        this._assertAlive();
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
        this._camera.panX += deltaX;
        this._camera.panY += deltaY;
        if (!this._contextLost) this._renderer.setView(this._camera.zoom, this._camera.panX, this._camera.panY);
    }

    /** Set zoom, optionally preserving the canonical point under a CSS-pixel anchor. */
    setZoom(zoom, anchor = null) {
        this._assertAlive();
        const next = finiteInRange(zoom, this._camera.zoom, this.minZoom, this.maxZoom);
        if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
            const cx = (this.canvas.clientWidth || 1) / 2;
            const cy = (this.canvas.clientHeight || 1) / 2;
            const ratio = next / this._camera.zoom;
            this._camera.panX = anchor.x - cx - (anchor.x - cx - this._camera.panX) * ratio;
            this._camera.panY = anchor.y - cy - (anchor.y - cy - this._camera.panY) * ratio;
        }
        this._camera.zoom = next;
        if (!this._contextLost) this._renderer.setView(next, this._camera.panX, this._camera.panY);
    }

    centerOnCell(target) {
        this._assertAlive();
        const index = typeof target === 'number' ? target : target?.row * this.columns + target?.column;
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.numCells) throw new RangeError('Cell index is outside the world.');
        const row = Math.floor(index / this.columns);
        const col = index % this.columns;
        if (!this._contextLost) {
            const pan = this._renderer.centerOnCell(row, col);
            this._camera.panX = pan.panX;
            this._camera.panY = pan.panY;
        }
    }

    hitTest(cssX, cssY) {
        this._assertAlive();
        if (this._contextLost) return null;
        const hit = this._renderer.hitTest(cssX, cssY);
        return hit ? { row: hit.row, column: hit.col, index: hit.row * this.columns + hit.col } : null;
    }

    setSelection(index) {
        this._assertAlive();
        this._selectionIndex = Number.isSafeInteger(index) && index >= 0 && index < this.numCells ? index : null;
        if (!this._contextLost) this._renderer.setSelectionIndex(this._selectionIndex);
    }

    setDraftPreview(edits) {
        this._assertAlive();
        this._draft = Array.from(edits || [], (edit) => ({ index: edit.index, value: edit.value === 0 ? 0 : 1 }));
        if (!this._contextLost) this._renderer.setDraftPreview(this._draft);
    }

    /** Draw exactly one frame. No state-buffer upload occurs here. */
    draw() {
        this._assertAlive();
        if (this._contextLost) return;
        this._renderer.drawCurrent();
        this._stats.draws += 1;
    }

    get camera() { return { ...this._camera }; }
    get stats() { return { ...this._stats }; }
    get contextLost() { return this._contextLost; }

    _handleContextLost(event) {
        event.preventDefault();
        if (this._destroyed) return;
        this._contextLost = true;
        this._stats.contextLosses += 1;
        this._onContextLostCallback?.();
        this.canvas.dispatchEvent(new CustomEvent('hexlife-renderer-contextlost'));
    }

    _handleContextRestored() {
        if (this._destroyed) return;
        try {
            this._createRenderer();
            this.resize();
            if (this._state) this._renderer.setExternalState(this._state, this._ruleIndices);
            this._renderer.setSelectionIndex(this._selectionIndex);
            this._renderer.setDraftPreview(this._draft);
            this._contextLost = false;
            this.draw();
            this._onContextRestoredCallback?.();
            this.canvas.dispatchEvent(new CustomEvent('hexlife-renderer-contextrestored'));
        } catch (error) {
            this.canvas.dispatchEvent(new CustomEvent('hexlife-renderer-error', { detail: { error } }));
        }
    }

    _assertAlive() {
        if (this._destroyed) throw new Error('Renderer has been destroyed.');
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
        this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
        if (!this._contextLost) this._renderer.destroy();
        this._state = null;
        this._ruleIndices = null;
    }
}

export function createRenderer(canvas, options) {
    return new HexLifeRenderer(canvas, options);
}

function finiteInRange(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
