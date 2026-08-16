/**
 * `@hexlife/embed/spacetime` — a run of any HexLife engine drawn as a 3D solid: the grid is the
 * cross-section, time is the vertical axis, and one retained tick is one layer of the object.
 *
 * This is the Explorer's spacetime view (#40), packaged. The ray-march, the shaders, the uniform
 * table and the object's framing are the very same module the app draws with
 * (`src/rendering/spacetime/SpacetimeCore.js`), so an object here and an object there differ only in
 * what was pushed into them. What this entry adds is everything a host outside the app needs: its
 * own WebGL2 context, its own colour table, an orbit camera with optional pointer controls, and a
 * layer feed that takes generations instead of the app's worker stream.
 *
 * **It simulates nothing.** Exactly like `/solid`: a host runs whichever engine it likes — `/sim`,
 * `/ca`, `/stochastic`, or its own — and hands over one generation per tick. The two entries are
 * siblings on purpose. `/solid` welds those layers into a mesh you can print; this one draws them
 * as the object they would be, at interactive frame rates, without meshing anything.
 *
 * Cost is **pixels × march steps and is independent of grid resolution**: a 576-row world costs the
 * same per frame as a 96-row one. What a bigger world costs is texture memory — one byte per cell
 * per layer — which is why `depth` is a budget the host sets rather than a number that grows.
 *
 * The published contract for this entry point lives in `packages/hexlife-embed/README.md`.
 */

import { SpacetimeVolume } from '../rendering/spacetime/SpacetimeVolume.js';
import {
    SPACETIME_CAMERA,
    SPACETIME_MARCH_DEFAULTS,
    computeGeometry,
    createSpacetimeProgram,
    drawSpacetimeVolume,
} from '../rendering/spacetime/SpacetimeCore.js';
import { resolveEmbedLUT } from './embedPalette.js';

export { SPACETIME_CAMERA, SPACETIME_MARCH_DEFAULTS, computeGeometry };

/** Layers requested when the host does not say. Always clamped to the device's real cap. */
export const DEFAULT_DEPTH = 240;

/** Background behind the object — the same value `<hexlife-world>` clears to. */
const DEFAULT_BACKGROUND = '#1a1a1a';

/** Drag feel, copied from the app's `OrbitStrategy` so a drag turns both objects by one angle. */
const ORBIT_RADIANS_PER_PIXEL = 0.008;
/** Wheel feel, copied from the app's `dollyActiveView`. */
const DOLLY_PER_WHEEL_UNIT = 0.001;

const TAU = Math.PI * 2;
const wrapAngle = (angle) => ((angle % TAU) + TAU) % TAU;

/**
 * Clear colour, as premultiplied RGBA floats.
 * @param {string|number[]|null} background `'#rgb'`, `'#rrggbb'`, `[r,g,b,a]` in 0–1, or null /
 *   `'transparent'` for a see-through canvas (the page behind shows through the object).
 */
function parseBackground(background) {
    if (background === null || background === 'transparent') return [0, 0, 0, 0];
    if (Array.isArray(background)) {
        const [r = 0, g = 0, b = 0, a = 1] = background;
        return [r, g, b, a];
    }
    const hex = String(background).trim().replace(/^#/, '');
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return parseBackground(DEFAULT_BACKGROUND);
    return [
        parseInt(full.slice(0, 2), 16) / 255,
        parseInt(full.slice(2, 4), 16) / 255,
        parseInt(full.slice(4, 6), 16) / 255,
        1,
    ];
}

function finiteInRange(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

/**
 * A canvas showing one world's history as a solid.
 *
 * Feed it with {@link HexLifeSpacetime#pushState} once per tick (live), or
 * {@link HexLifeSpacetime#setHistory} once with a finished run. Draw it with
 * {@link HexLifeSpacetime#draw} — nothing here starts a frame loop of its own, because a host that
 * already has one must not be given a second.
 */
export class HexLifeSpacetime {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('./spacetime.js').SpacetimeOptions} options
     */
    constructor(canvas, options = {}) {
        if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
        const rows = Number(options.rows);
        const columns = Number(options.columns ?? options.cols);
        if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows <= 0 || columns <= 0) {
            throw new RangeError('Spacetime rows and columns must be positive integers.');
        }

        this.canvas = canvas;
        this.rows = rows;
        this.columns = columns;
        this.numCells = rows * columns;
        this.maxDpr = finiteInRange(options.maxDpr, 1.5, 0.5, 4);
        this._background = parseBackground(options.background ?? DEFAULT_BACKGROUND);
        this._paletteOptions = {
            palette: options.palette || 'default',
            customGradient: options.customGradient || null,
            colorSettings: options.colorSettings || null,
            lut: options.lut || null,
            flickerProof: !!options.flickerProof,
            hueShift: options.hueShift ?? null,
        };
        this._marchOptions = {
            ...SPACETIME_MARCH_DEFAULTS,
            ...pickMarchOptions(options),
        };
        this._camera = {
            yaw: Number.isFinite(options.camera?.yaw) ? options.camera.yaw : SPACETIME_CAMERA.yaw,
            pitch: Number.isFinite(options.camera?.pitch) ? options.camera.pitch : SPACETIME_CAMERA.pitch,
            distance: finiteInRange(
                options.camera?.distance, SPACETIME_CAMERA.distance,
                SPACETIME_CAMERA.minDistance, SPACETIME_CAMERA.maxDistance,
            ),
        };
        this._requestedDepth = Math.max(1, Math.floor(Number(options.depth) || DEFAULT_DEPTH));
        this._highlightLayer = -1;
        this._destroyed = false;
        this._contextLost = false;
        /** Scratch for `pushState`'s packing pass, allocated once rather than per tick. */
        this._packed = null;
        this._stats = { draws: 0, layersPushed: 0, backfills: 0 };
        this._onContextLostCallback = options.onContextLost || null;
        this._onContextRestoredCallback = options.onContextRestored || null;
        this._onCameraChange = options.onCameraChange || null;

        // The march writes every pixel it keeps and reads no depth, so a depth buffer and MSAA would
        // both be pure cost: there is no geometry edge in this pass to antialias.
        const gl = canvas.getContext('webgl2', {
            alpha: this._background[3] < 1,
            antialias: false,
            depth: false,
            premultipliedAlpha: true,
        });
        if (!gl) throw new Error('WebGL2 is not available');
        this.gl = gl;

        /** WebGL2 only guarantees 256 array layers — never assume a deep request fits (#40 §3). */
        this.maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);

        this._onContextLost = (event) => this._handleContextLost(event);
        this._onContextRestored = () => this._handleContextRestored();
        canvas.addEventListener('webglcontextlost', this._onContextLost);
        canvas.addEventListener('webglcontextrestored', this._onContextRestored);

        this._createGpuState();
        this.resize();
        if (options.controls !== false) this.attachControls();
    }

    /** Compile the march, upload the colour table, allocate the volume. Also the restore path. */
    _createGpuState() {
        const gl = this.gl;
        this._compiled = createSpacetimeProgram(gl);
        if (!this._compiled) throw new Error('Spacetime shaders failed to compile');

        this._lutTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this._lutTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._resolveLut());
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this._volume = new SpacetimeVolume(gl, this.columns, this.rows, this.depth);
    }

    _resolveLut() {
        this._lutBytes = resolveEmbedLUT(this._paletteOptions, 'HexLife spacetime');
        return this._lutBytes;
    }

    /** Layers actually granted: what the host asked for, clamped to what the device will give. */
    get depth() {
        return Math.max(1, Math.min(this._requestedDepth, this.maxLayers));
    }

    /** Layers currently holding history (0 … `depth`). */
    get layerCount() {
        return this._volume?.length ?? 0;
    }

    /** Tick number of the newest layer, or -1 when the host never labelled one. */
    get tipTick() {
        return this._volume?.tipTick ?? -1;
    }

    get camera() {
        return { ...this._camera };
    }

    get contextLost() {
        return this._contextLost;
    }

    /** The 128×2 RGBA table the object is coloured through. Treat as read-only. */
    getLut() {
        return this._lutBytes || null;
    }

    get stats() {
        const volume = this._volume;
        return {
            ...this._stats,
            layers: volume?.length ?? 0,
            depth: this.depth,
            uploads: volume?.uploads ?? 0,
            textureBytes: volume ? volume.cols * volume.rows * volume.depth : 0,
        };
    }

    // --- feeding the volume ---------------------------------------------------

    /**
     * Append one tick, already packed as one byte per cell.
     *
     * The byte **is** the colour-table index: `rule * 2 + state`. A binary world with no rule
     * indices is therefore already packed — its 0/1 state bytes are valid layer bytes as they
     * stand — which is why this path can take a host's live state view with no copy at all.
     *
     * @param {Uint8Array|ArrayBuffer} layer `rows * columns` bytes.
     * @param {number} [tick] Optional label, reported back as {@link HexLifeSpacetime#tipTick}.
     * @returns {boolean} False when the layer was the wrong size or the context is gone.
     */
    pushLayer(layer, tick = -1) {
        this._assertAlive();
        if (this._contextLost || !this._volume) return false;
        if (!this._volume.push(layer, tick)) return false;
        this._stats.layersPushed += 1;
        return true;
    }

    /**
     * Append one generation, packing rule indices into it if there are any.
     *
     * With no `ruleIndices` this delegates straight to {@link HexLifeSpacetime#pushLayer} and costs
     * nothing beyond the upload. With them it is one JavaScript pass over the grid per tick — the
     * app packs the same bytes in Rust, inside the worker, because it does this for nine worlds at
     * once. A host feeding one world can afford the pass; a host feeding many should pack in its
     * own engine and call `pushLayer`.
     *
     * @param {Uint8Array} cells `rows * columns` state values (0 or 1).
     * @param {{ruleIndices?: Uint8Array|null, tick?: number}} [options]
     */
    pushState(cells, { ruleIndices = null, tick = -1 } = {}) {
        this._assertAlive();
        if (!(cells instanceof Uint8Array) || cells.length < this.numCells) {
            throw new RangeError(`Expected ${this.numCells} row-major cell bytes.`);
        }
        if (!ruleIndices) return this.pushLayer(cells, tick);
        return this.pushLayer(this._pack(cells, ruleIndices), tick);
    }

    /**
     * Append an `EmbedSim` generation through its native packer. This is the live-tick path: it
     * performs no per-cell JavaScript work and allocates its Wasm scratch layer only on first use.
     * @param {{numCells: number, generation?: number, packRenderLayer: () => Uint8Array}} sim
     * @param {number} [tick]
     */
    pushSimulation(sim, tick = sim?.generation ?? -1) {
        this._assertAlive();
        if (!sim || sim.numCells !== this.numCells || typeof sim.packRenderLayer !== 'function') {
            throw new TypeError('Expected a same-sized EmbedSim with packRenderLayer().');
        }
        return this.pushLayer(sim.packRenderLayer(), tick);
    }

    /**
     * Replace the whole object with a finished run, oldest generation first, in one upload.
     *
     * This is the `/solid` shape of the API: a host that already has the run — every tick of it —
     * hands the lot over once instead of replaying it. More generations than `depth` keeps the
     * newest, exactly as the live ring does.
     *
     * @param {Array<Uint8Array>|Uint8Array} generations An array of per-tick states, or one
     *   concatenated buffer of `count * rows * columns` bytes.
     * @param {{ruleIndices?: Array<Uint8Array>|null, count?: number}} [options]
     * @returns {number} Layers the object actually kept.
     */
    setHistory(generations, { ruleIndices = null, count = 0 } = {}) {
        this._assertAlive();
        if (this._contextLost || !this._volume) return 0;
        const cells = this.numCells;

        let bytes;
        let frames;
        if (generations instanceof Uint8Array) {
            frames = count || Math.floor(generations.length / cells);
            bytes = generations;
        } else {
            const list = Array.from(generations || []);
            frames = list.length;
            // One allocation and one bulk copy per layer — never a per-cell loop.
            bytes = new Uint8Array(frames * cells);
            for (let index = 0; index < frames; index++) {
                const layer = ruleIndices?.[index]
                    ? this._pack(list[index], ruleIndices[index])
                    : list[index];
                bytes.set(layer.subarray(0, cells), index * cells);
            }
        }

        this._highlightLayer = -1;
        this._stats.backfills += 1;
        return this._volume.backfill(bytes, frames);
    }

    /** Drop the newest `layerCount - length` layers (a host rewinding a recorded future). */
    truncate(length) {
        this._assertAlive();
        return this._volume?.truncate(length) ?? 0;
    }

    /** Empty the object. No upload — the layers simply stop being addressed. */
    reset() {
        this._assertAlive();
        this._volume?.reset();
        this._highlightLayer = -1;
    }

    /**
     * Pack `rule * 2 + state` for one generation into the reusable scratch layer.
     * @returns {Uint8Array}
     */
    _pack(cells, ruleIndices) {
        if (!this._packed) this._packed = new Uint8Array(this.numCells);
        const packed = this._packed;
        for (let index = 0; index < this.numCells; index++) {
            packed[index] = (ruleIndices[index] << 1) | (cells[index] & 1);
        }
        return packed;
    }

    // --- the cross-section ----------------------------------------------------

    /**
     * Draw one layer as an opaque plane through the solid — the cross-section a transport bar is
     * parked on. Pass -1 (or null) to take it away.
     * @param {number|null} layer Live layer index, 0 = the oldest retained tick.
     */
    setCrossSection(layer) {
        this._assertAlive();
        const length = this.layerCount;
        if (layer === null || !Number.isFinite(layer) || length === 0) {
            this._highlightLayer = -1;
            return;
        }
        this._highlightLayer = Math.max(0, Math.min(length - 1, Math.round(layer)));
    }

    /**
     * The same plane, addressed the way a scrub bar reports it: `offset` ticks back from the live
     * tip. Mirrors the app's `STATE_HISTORY_CHANGED` payload exactly, so a host that already has a
     * transport bar can forward it unchanged and the two surfaces cannot drift apart.
     * @param {{offset?: number, isScrubbing?: boolean}} position
     */
    setScrub({ offset = 0, isScrubbing = false } = {}) {
        this.setCrossSection(isScrubbing ? this.layerCount - 1 - offset : null);
    }

    /** The cross-section plane's live layer index, or -1 when there is none. */
    get crossSection() {
        return this._highlightLayer;
    }

    // --- look and camera ------------------------------------------------------

    /**
     * Swap the palette. The volume is **not** re-uploaded: the voxel byte is a table index, so
     * rewriting the 128×2 table retints every layer of history for the cost of 1 KB.
     * @param {import('./spacetime.js').SpacetimePaletteOptions} options
     */
    setPalette(options) {
        this._assertAlive();
        Object.assign(this._paletteOptions, options);
        if (this._contextLost) return;
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this._lutTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RGBA, gl.UNSIGNED_BYTE, this._resolveLut());
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    /**
     * Sampling of the march: `layerAlpha` (0 = an opaque solid, > 0 = see into the history),
     * `maxSteps`, `maxLateralStepHexRadii`.
     * @param {import('./spacetime.js').SpacetimeMarchOptions} options
     */
    setOptions(options) {
        this._assertAlive();
        Object.assign(this._marchOptions, pickMarchOptions(options || {}));
    }

    /** @returns {import('./spacetime.js').SpacetimeMarchOptions} */
    getOptions() {
        return { ...this._marchOptions };
    }

    /**
     * Turn the camera. Both angles wrap: the up vector is derived from the view tangent, so pitch
     * can pass through the poles indefinitely without a look-at singularity or a sudden flip.
     */
    orbit(deltaYaw, deltaPitch) {
        this._assertAlive();
        if (Number.isFinite(deltaYaw)) this._camera.yaw = wrapAngle(this._camera.yaw + deltaYaw);
        if (Number.isFinite(deltaPitch)) this._camera.pitch = wrapAngle(this._camera.pitch + deltaPitch);
        this._onCameraChange?.(this.camera);
    }

    /**
     * Move the camera in or out, clamped to the framing the object is built for: closer than
     * `minDistance` the camera is inside a full-height object, further than `maxDistance` it is a
     * speck.
     * @param {number} factor > 1 pulls back, < 1 moves closer.
     */
    dolly(factor) {
        this._assertAlive();
        if (!Number.isFinite(factor) || factor <= 0) return;
        this._camera.distance = Math.min(
            SPACETIME_CAMERA.maxDistance,
            Math.max(SPACETIME_CAMERA.minDistance, this._camera.distance * factor),
        );
        this._onCameraChange?.(this.camera);
    }

    /** @param {{yaw?: number, pitch?: number, distance?: number}} camera */
    setCamera(camera = {}) {
        this._assertAlive();
        if (Number.isFinite(camera.yaw)) this._camera.yaw = wrapAngle(camera.yaw);
        if (Number.isFinite(camera.pitch)) this._camera.pitch = wrapAngle(camera.pitch);
        if (Number.isFinite(camera.distance)) {
            this._camera.distance = finiteInRange(
                camera.distance, this._camera.distance,
                SPACETIME_CAMERA.minDistance, SPACETIME_CAMERA.maxDistance,
            );
        }
        this._onCameraChange?.(this.camera);
    }

    /** Back to the angles the object was framed at. */
    resetCamera() {
        this.setCamera({
            yaw: SPACETIME_CAMERA.yaw,
            pitch: SPACETIME_CAMERA.pitch,
            distance: SPACETIME_CAMERA.distance,
        });
    }

    // --- frames ---------------------------------------------------------------

    /**
     * Size the backing store from CSS dimensions and the DPR cap.
     *
     * The cap earns its keep here more than anywhere else in the package: this pass is pure
     * fragment work, so a phone at DPR 3 would pay 9× the march for the same object.
     */
    resize(width = this.canvas.clientWidth || 1, height = this.canvas.clientHeight || 1) {
        this._assertAlive();
        const dpr = Math.min(globalThis.devicePixelRatio || 1, this.maxDpr);
        this.canvas.width = Math.max(1, Math.round(width * dpr));
        this.canvas.height = Math.max(1, Math.round(height * dpr));
    }

    /**
     * Draw exactly one frame. No layer upload happens here, so orbiting a finished object is free
     * of everything except the march itself.
     * @returns {boolean} False when there is nothing to draw yet — an empty object, or a lost
     *   context. A host showing a placeholder should key it off this rather than off a tick count.
     */
    draw() {
        this._assertAlive();
        if (this._contextLost || !this._volume) return false;
        const gl = this.gl;
        const [r, g, b, a] = this._background;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(r * a, g * a, b * a, a); // premultiplied, matching the march's own output
        gl.clear(gl.COLOR_BUFFER_BIT);
        this._stats.draws += 1;

        return drawSpacetimeVolume(gl, this._compiled, {
            volume: this._volume,
            camera: this._camera,
            viewRect: { x: 0, y: 0, width: this.canvas.width, height: this.canvas.height },
            surfaceHeight: this.canvas.height,
            lutTexture: this._lutTexture,
            options: this._marchOptions,
            highlightLayer: this._highlightLayer,
        }) !== null;
    }

    // --- pointer controls -----------------------------------------------------

    /**
     * Drag to orbit, wheel or pinch to dolly — the app's own feel, to the constant.
     *
     * On by default, and idempotent. A host driving the camera from its own UI passes
     * `controls: false` and calls {@link HexLifeSpacetime#orbit} itself. Each gesture redraws
     * synchronously: this is the one moment where a redraw is definitionally wanted, and a frame
     * loop of our own is exactly what a host with its own loop does not need.
     */
    attachControls() {
        this._assertAlive();
        if (this._controls) return;
        const canvas = this.canvas;
        const pointers = new Map();
        let pinchDistance = 0;

        const onPointerDown = (event) => {
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.size === 2) pinchDistance = spread(pointers);
            try {
                canvas.setPointerCapture(event.pointerId);
            } catch {
                /* not a live pointer (a synthetic event); the drag still tracks */
            }
            event.preventDefault();
        };
        const onPointerMove = (event) => {
            const previous = pointers.get(event.pointerId);
            if (!previous) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.size >= 2) {
                // Two fingers: the gesture is a pinch, and a pinch is a dolly. Orbiting on the
                // same gesture would make the object lurch every time the fingers were not exactly
                // parallel.
                const next = spread(pointers);
                if (pinchDistance > 0 && next > 0) this.dolly(pinchDistance / next);
                pinchDistance = next;
            } else {
                this.orbit(
                    (event.clientX - previous.x) * ORBIT_RADIANS_PER_PIXEL,
                    (event.clientY - previous.y) * ORBIT_RADIANS_PER_PIXEL,
                );
            }
            this.draw();
        };
        const onPointerUp = (event) => {
            pointers.delete(event.pointerId);
            pinchDistance = 0;
            if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        };
        const onWheel = (event) => {
            event.preventDefault();
            this.dolly(Math.exp(event.deltaY * DOLLY_PER_WHEEL_UNIT));
            this.draw();
        };

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        this._controls = () => {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
            canvas.removeEventListener('wheel', onWheel);
        };
    }

    /** Take the pointer controls off again without destroying the renderer. */
    detachControls() {
        this._controls?.();
        this._controls = null;
    }

    // --- lifecycle ------------------------------------------------------------

    _handleContextLost(event) {
        event.preventDefault();
        if (this._destroyed) return;
        this._contextLost = true;
        this._volume = null;
        this._compiled = null;
        this._lutTexture = null;
        this._onContextLostCallback?.();
        this.canvas.dispatchEvent(new CustomEvent('hexlife-spacetime-contextlost'));
    }

    _handleContextRestored() {
        if (this._destroyed) return;
        try {
            // The volume comes back EMPTY. Layers live only in GPU memory — keeping a CPU mirror of
            // every tick would double the memory this entry exists to bound — so a host that wants
            // its object back re-feeds it, which is why the event carries no data and expects work.
            this._createGpuState();
            this._contextLost = false;
            this._highlightLayer = -1;
            this._onContextRestoredCallback?.();
            this.canvas.dispatchEvent(new CustomEvent('hexlife-spacetime-contextrestored'));
        } catch (error) {
            this.canvas.dispatchEvent(new CustomEvent('hexlife-spacetime-error', { detail: { error } }));
        }
    }

    _assertAlive() {
        if (this._destroyed) throw new Error('Spacetime renderer has been destroyed.');
    }

    /**
     * Give back the volume texture, the colour table and the program.
     *
     * Mandatory, and for the same reason `/solid` stacks must be freed: the volume is by far the
     * largest allocation here — `rows × columns × depth` bytes of GPU memory — and dropping the
     * last JavaScript reference to this object does not reclaim it.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this.detachControls();
        this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
        this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
        if (this._contextLost) return;
        this._volume?.dispose();
        if (this._lutTexture) this.gl.deleteTexture(this._lutTexture);
        if (this._compiled) this.gl.deleteProgram(this._compiled.program);
        this._volume = null;
        this._lutTexture = null;
        this._compiled = null;
    }
}

/** Largest distance between any two tracked pointers — the pinch measurement. */
function spread(pointers) {
    const points = [...pointers.values()];
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

/** The march knobs out of a mixed options object, ignoring everything else. */
function pickMarchOptions(options) {
    const picked = {};
    if (Number.isFinite(options.layerAlpha)) picked.layerAlpha = Math.min(1, Math.max(0, options.layerAlpha));
    if (Number.isFinite(options.maxSteps)) picked.maxSteps = Math.max(1, Math.floor(options.maxSteps));
    if (Number.isFinite(options.maxLateralStepHexRadii)) {
        picked.maxLateralStepHexRadii = Math.max(0, options.maxLateralStepHexRadii);
    }
    return picked;
}

/**
 * Create a spacetime renderer on `canvas`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import('./spacetime.js').SpacetimeOptions} options
 * @returns {HexLifeSpacetime}
 */
export function createSpacetimeView(canvas, options) {
    return new HexLifeSpacetime(canvas, options);
}
