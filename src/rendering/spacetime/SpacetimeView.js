import * as Config from '../../core/config.js';
import * as WebGLUtils from '../webglUtils.js';
import { lookAt, perspective } from '../mat4.js';
import { torusOrbitCamera } from '../torusMath.js';
import { getSpacetimeViewSettings } from '../../services/SpacetimeViewSettings.js';
import { SpacetimeVolume } from './SpacetimeVolume.js';

// eslint-disable-next-line import/no-unresolved
import spacetimeVertexShaderSource from '../../../shaders/spacetime_vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import spacetimeFragmentShaderSource from '../../../shaders/spacetime_fragment.glsl?raw';

/**
 * #40 Spacetime View — the ray-march half.
 *
 * This whole module (and both shaders, which it pulls in with `?raw`) lives in a lazily imported
 * chunk. `renderer.js` fetches it on the first switch into spacetime mode and never before, so a
 * session that never opens the mode pays nothing: no chunk, no program, no GL object (#40 §2.1).
 * On leaving the mode the volume texture is deleted; the compiled program and the fetched chunk
 * are deliberately kept, so a second toggle is instant.
 *
 * Phase 2 replaced the procedural stand-in volume with the real thing: the worker packs one byte per
 * cell per tick in Rust and ships it, {@link SpacetimeVolume} owns the texture ring, and this module
 * only ever draws what the simulation actually produced.
 */

const SQRT3 = Math.sqrt(3);

/** Framing of the object in the orbit camera's space (the camera sits 4.1–10 units out). */
const FOOTPRINT_HALF_EXTENT = 1.6;
const TIME_HALF_EXTENT = 2.2;
const FIELD_OF_VIEW_RADIANS = Math.PI * 42 / 180;

/**
 * Per-grid-preset layer caps, keyed by grid rows (#40 §3).
 *
 * Depth is `min(preset cap, ring capacity, device MAX_ARRAY_TEXTURE_LAYERS)` and the ring stays 240
 * — a taller object is never worth charging every user permanent worker memory for. The caps below
 * are a *texture* budget only: at one byte per cell per layer the huge preset is 92 MB at the full
 * ring, which is more GPU memory than the object's extra height is worth, so it keeps the most
 * recent 128 ticks. Every other preset takes the whole ring.
 */
export const SPACETIME_DEPTH_CAPS = Object.freeze({
    96: 240,   // small   — 2.6 MB
    192: 240,  // medium  — 10.2 MB
    384: 240,  // large   — 40.9 MB
    576: 128,  // huge    — 49.1 MB instead of 92.1 MB
});

/** Cap for a grid whose row count is not one of the presets (a hand-set `gridRows`). */
const DEFAULT_DEPTH_CAP = 240;

export function depthCapForGrid(rows) {
    return SPACETIME_DEPTH_CAPS[rows] ?? DEFAULT_DEPTH_CAP;
}

export const SPACETIME_DEFAULTS = Object.freeze({
    /** Layers requested. Clamped to the preset cap, the ring size AND the device's layer cap. */
    depth: Config.STATE_HISTORY_RING_SIZE,
    /**
     * 0 = opaque solid (first hit wins); > 0 = front-to-back accumulation at this alpha.
     * The live view runs translucent because an opaque volume is just a silhouette — you cannot
     * see the history inside it. The Phase 1 *gate* number is still the opaque one (§6): opaque is
     * the cheap case and the one the plan named. Users can move this (see `SpacetimeViewSettings`).
     */
    layerAlpha: 0.12,
    /**
     * Longest lateral distance one march step may cover, in hex radii. The plan's slab march is
     * exact only for steep rays; at the orbit camera's usual elevation a full slab step crosses
     * several hexes sideways. 0 restores the pure slab march (faster, and visibly aliased).
     */
    maxLateralStepHexRadii: 0.75,
    /** Hard cap on march steps per ray. Pure slab marching never needs more than `depth`. */
    maxSteps: 512,
});

/**
 * Geometry of the extruded object for a given grid, in object space.
 * The footprint keeps the flat grid's aspect ratio; the taller axis is normalised so the whole
 * object sits inside the orbit camera's default framing.
 *
 * `layerHeight` comes from the ring CAPACITY, not from how full it is, so a growing object grows
 * instead of stretching. `liveLayers` therefore sets only the object's top.
 */
export function computeGeometry(cols, rows, depth, liveLayers = depth) {
    // Flat-grid extents, in units of the hex radius (matching `getGridWorldBounds`).
    const flatWidth = (cols - 1) * 1.5 + 2;
    const flatHeight = rows * SQRT3 + SQRT3 / 2;
    const hexSize = (2 * FOOTPRINT_HALF_EXTENT) / Math.max(flatWidth, flatHeight);
    const layerHeight = (2 * TIME_HALF_EXTENT) / Math.max(1, depth);
    const halfX = (flatWidth * hexSize) / 2;
    const halfZ = (flatHeight * hexSize) / 2;
    const floorY = -TIME_HALF_EXTENT;
    return {
        hexSize,
        layerHeight,
        // Object XZ = flat XY; object Y = time, bottom-anchored so the object grows upward.
        boxMin: [-halfX, floorY, -halfZ],
        boxMax: [halfX, floorY + Math.max(0, liveLayers) * layerHeight, halfZ],
        gridCenter: [
            (-hexSize + (cols - 1) * 1.5 * hexSize + hexSize) / 2,
            (-SQRT3 * hexSize / 2 + rows * SQRT3 * hexSize) / 2,
        ],
    };
}

export function createSpacetimeView(gl) {
    let program = null;
    let uniforms = null;
    let volume = null;
    let volumeKey = '';
    let geometry = null;
    // The user's persisted opacity is picked up here rather than pushed in by the renderer, so the
    // settings module stays a detail of this chunk.
    const options = { ...SPACETIME_DEFAULTS, ...getSpacetimeViewSettings() };
    /** Live layer index the transport bar is parked on, or -1 when not scrubbing. */
    let highlightLayer = -1;
    /** Backfill cost, kept for the plan's measured gate rather than re-derived from a claim. */
    let lastBackfill = null;

    /** WebGL2 only guarantees 256 array layers — never assume the 240-tick ring fits (#40 §3). */
    const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);

    function ensureProgram() {
        if (program) return true;
        program = WebGLUtils.loadShaderProgram(
            gl,
            spacetimeVertexShaderSource,
            spacetimeFragmentShaderSource,
        );
        if (!program) return false;
        uniforms = {
            volume: gl.getUniformLocation(program, 'u_volume'),
            colorLUT: gl.getUniformLocation(program, 'u_colorLUT'),
            cameraPosition: gl.getUniformLocation(program, 'u_cameraPosition'),
            cameraRight: gl.getUniformLocation(program, 'u_cameraRight'),
            cameraUp: gl.getUniformLocation(program, 'u_cameraUp'),
            cameraForward: gl.getUniformLocation(program, 'u_cameraForward'),
            tanHalf: gl.getUniformLocation(program, 'u_tanHalf'),
            boxMin: gl.getUniformLocation(program, 'u_boxMin'),
            boxMax: gl.getUniformLocation(program, 'u_boxMax'),
            gridCenter: gl.getUniformLocation(program, 'u_gridCenter'),
            hexSize: gl.getUniformLocation(program, 'u_hexSize'),
            gridSize: gl.getUniformLocation(program, 'u_gridSize'),
            layerHeight: gl.getUniformLocation(program, 'u_layerHeight'),
            layers: gl.getUniformLocation(program, 'u_layers'),
            ringBase: gl.getUniformLocation(program, 'u_ringBase'),
            ringDepth: gl.getUniformLocation(program, 'u_ringDepth'),
            maxSteps: gl.getUniformLocation(program, 'u_maxSteps'),
            layerAlpha: gl.getUniformLocation(program, 'u_layerAlpha'),
            maxLateralStep: gl.getUniformLocation(program, 'u_maxLateralStep'),
            highlightLayer: gl.getUniformLocation(program, 'u_highlightLayer'),
        };
        return true;
    }

    /** Depth actually granted for the current grid, after all three clamps. */
    function resolveDepth() {
        return Math.max(1, Math.min(
            options.depth,
            depthCapForGrid(Config.GRID_ROWS),
            Config.STATE_HISTORY_RING_SIZE,
            maxLayers,
        ));
    }

    /**
     * Create the texture ring if it is missing or the grid changed. Cheap and idempotent — the
     * texture is allocated once per (grid × depth) and reused for the whole session in the mode.
     */
    function ensureVolume() {
        const cols = Config.GRID_COLS;
        const rows = Config.GRID_ROWS;
        const depth = resolveDepth();
        const key = `${cols}x${rows}x${depth}`;
        if (volume && key === volumeKey) return true;
        releaseVolume();
        volume = new SpacetimeVolume(gl, cols, rows, depth);
        volumeKey = key;
        return true;
    }

    function releaseVolume() {
        volume?.dispose();
        volume = null;
        volumeKey = '';
        lastBackfill = null;
        highlightLayer = -1;
    }

    /** One tick from the worker's stream. Returns true when it was stored. */
    function pushLayer(layerBytes, tick) {
        if (!ensureVolume()) return false;
        return volume.push(layerBytes, tick);
    }

    /** The ring's existing frames, oldest → newest, on entering the mode. */
    function backfill(layersBytes, count, buildMs = null) {
        if (!ensureVolume()) return 0;
        const started = performance.now();
        const applied = volume.backfill(layersBytes, count);
        lastBackfill = {
            requested: count,
            applied,
            depth: volume.depth,
            cells: volume.cols * volume.rows,
            megabytes: (applied * volume.cols * volume.rows) / (1024 * 1024),
            // Split so a slow enable can be blamed on the right side of the postMessage.
            workerBuildMs: buildMs,
            uploadMs: performance.now() - started,
        };
        return applied;
    }

    function resetVolume() {
        volume?.reset();
        highlightLayer = -1;
    }

    function truncate(length) {
        return volume?.truncate(length) ?? 0;
    }

    /**
     * Move the cross-section plane. `offset` is tip-relative exactly as the transport bar reports it
     * (0 = the live tip), so the two surfaces cannot drift apart.
     */
    function setScrub({ offset = 0, isScrubbing = false } = {}) {
        if (!isScrubbing || !volume || volume.isEmpty) {
            highlightLayer = -1;
            return;
        }
        highlightLayer = Math.max(0, Math.min(volume.length - 1, volume.length - 1 - offset));
    }

    /**
     * Draw the volume into the current framebuffer.
     * @param {{viewRect: {x:number,y:number,width:number,height:number}, surfaceHeight: number,
     *          lutTexture: WebGLTexture, camera: {yaw:number,pitch:number,distance:number}}} params
     * @returns {boolean} true when the object was drawn.
     */
    function draw({ viewRect, surfaceHeight, lutTexture, camera }) {
        if (!viewRect || !surfaceHeight || !lutTexture) return false;
        if (!ensureProgram() || !ensureVolume()) return false;
        // Nothing recorded yet (a fresh reset, or the mode opened on an empty ring). Decline, and
        // the renderer falls back to the flat quad rather than showing an empty frame.
        if (volume.isEmpty) return false;

        geometry = computeGeometry(volume.cols, volume.rows, volume.depth, volume.length);

        const { position, up } = torusOrbitCamera(camera.yaw, camera.pitch, camera.distance);
        const aspect = Math.max(viewRect.width / viewRect.height, 0.01);
        const projection = perspective(FIELD_OF_VIEW_RADIANS, aspect, 0.1, 40);
        const view = lookAt(position, [0, 0, 0], up);
        // The view matrix's rotation rows are the camera basis in world space; row 2 points from
        // the target back to the eye, so forward is its negation.
        const right = [view[0], view[4], view[8]];
        const cameraUp = [view[1], view[5], view[9]];
        const forward = [-view[2], -view[6], -view[10]];

        const viewportY = surfaceHeight - viewRect.y - viewRect.height;
        gl.viewport(viewRect.x, viewportY, viewRect.width, viewRect.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        const translucent = options.layerAlpha > 0;
        if (translucent) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // fragment alpha is premultiplied
        } else {
            gl.disable(gl.BLEND);
        }

        gl.useProgram(program);
        gl.bindVertexArray(null);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, volume.texture);
        gl.uniform1i(uniforms.volume, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTexture);
        gl.uniform1i(uniforms.colorLUT, 1);

        gl.uniform3fv(uniforms.cameraPosition, position);
        gl.uniform3fv(uniforms.cameraRight, right);
        gl.uniform3fv(uniforms.cameraUp, cameraUp);
        gl.uniform3fv(uniforms.cameraForward, forward);
        // 1/m[0] and 1/m[5] are tan(fovY/2)*aspect and tan(fovY/2).
        gl.uniform2f(uniforms.tanHalf, 1 / projection[0], 1 / projection[5]);
        gl.uniform3fv(uniforms.boxMin, geometry.boxMin);
        gl.uniform3fv(uniforms.boxMax, geometry.boxMax);
        gl.uniform2fv(uniforms.gridCenter, geometry.gridCenter);
        gl.uniform1f(uniforms.hexSize, geometry.hexSize);
        gl.uniform2i(uniforms.gridSize, volume.cols, volume.rows);
        gl.uniform1f(uniforms.layerHeight, geometry.layerHeight);
        gl.uniform1i(uniforms.layers, volume.length);
        gl.uniform1i(uniforms.ringBase, volume.base);
        gl.uniform1i(uniforms.ringDepth, volume.depth);
        gl.uniform1i(uniforms.maxSteps, options.maxSteps);
        gl.uniform1f(uniforms.layerAlpha, options.layerAlpha);
        gl.uniform1i(uniforms.highlightLayer, highlightLayer);
        gl.uniform1f(
            uniforms.maxLateralStep,
            options.maxLateralStepHexRadii > 0
                ? options.maxLateralStepHexRadii * geometry.hexSize
                : 0,
        );

        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        return true;
    }

    /**
     * Fill every layer with a uniform test byte, through the same `backfill` path real history uses.
     * Benchmark-only: the interesting cases for the march are the DEGENERATE ones a real world will
     * not sit at — an empty volume (every ray runs to the step cap, the true worst case) and a solid
     * one (every ray terminates at step 1). Real densities are measured on real history instead.
     */
    function _fillUniform(byte) {
        if (!ensureVolume()) return 0;
        const bytes = new Uint8Array(volume.depth * volume.cols * volume.rows).fill(byte);
        return volume.backfill(bytes, volume.depth);
    }

    /**
     * #40's frame-time gate (§6): time the ray-march itself, without rAF in the way.
     *
     * Each iteration draws the volume and then reads one pixel back, which blocks until the GPU has
     * finished that frame. That makes the number a per-frame GPU cost with no pipelining — stricter
     * than a real rAF loop, never flattering. Wall-clock rAF cadence is not usable here: an
     * automated browser tab is `document.hidden`, so rAF never fires at all.
     *
     * Measures whatever is CURRENTLY in the volume, so the honest way to benchmark the shipped mode
     * is to let a world tick the ring full first. `fill: 'empty' | 'solid'` replaces the contents
     * with a degenerate case and does not restore them.
     *
     * @returns {Promise<object>} timings in ms plus the volume/geometry the number belongs to.
     */
    async function runBenchmark({
        frames = 120,
        warmup = 20,
        viewRect,
        surfaceHeight,
        lutTexture,
        camera = { yaw: 0.55, pitch: 0.42, distance: 6.5 },
        spinPerFrame = 0.01,
        fill = null,
        ...overrides
    } = {}) {
        const previousOptions = { ...options };
        Object.assign(options, overrides);
        try {
            if (!ensureProgram() || !ensureVolume()) return null;
            if (fill === 'empty') _fillUniform(0);
            else if (fill === 'solid') _fillUniform(1);
            if (volume.isEmpty) return null;

            const readback = new Uint8Array(4);
            const samples = [];
            const orbit = { ...camera };
            for (let frame = 0; frame < warmup + frames; frame++) {
                orbit.yaw = camera.yaw + frame * spinPerFrame;
                const started = performance.now();
                const drawn = draw({ viewRect, surfaceHeight, lutTexture, camera: orbit });
                if (!drawn) return null;
                gl.readPixels(
                    Math.round(viewRect.x + viewRect.width / 2),
                    Math.round(surfaceHeight - viewRect.y - viewRect.height / 2),
                    1, 1, gl.RGBA, gl.UNSIGNED_BYTE, readback,
                );
                const elapsed = performance.now() - started;
                if (frame >= warmup) samples.push(elapsed);
            }
            samples.sort((a, b) => a - b);
            const at = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
            return {
                frames: samples.length,
                viewport: { width: viewRect.width, height: viewRect.height },
                medianMs: at(0.5),
                p95Ms: at(0.95),
                minMs: samples[0],
                maxMs: samples[samples.length - 1],
                meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
                fpsAtMedian: 1000 / at(0.5),
                options: { ...options },
                volume: getVolumeInfo(),
                geometry: geometry && { ...geometry },
            };
        } finally {
            Object.assign(options, previousOptions);
        }
    }

    function getVolumeInfo() {
        if (!volume) return null;
        return {
            cols: volume.cols,
            rows: volume.rows,
            depth: volume.depth,
            length: volume.length,
            base: volume.base,
            head: volume.head,
            tipTick: volume.tipTick,
            uploads: volume.uploads,
            megabytes: (volume.cols * volume.rows * volume.depth) / (1024 * 1024),
        };
    }

    return {
        draw,
        pushLayer,
        backfill,
        resetVolume,
        truncate,
        setScrub,
        releaseVolume,
        runBenchmark,
        setOptions: (next) => {
            Object.assign(options, next);
        },
        getInfo: () => ({
            options: { ...options },
            maxLayers,
            depthCap: depthCapForGrid(Config.GRID_ROWS),
            highlightLayer,
            lastBackfill: lastBackfill && { ...lastBackfill },
            volume: getVolumeInfo(),
        }),
        dispose: () => {
            releaseVolume();
            if (program) gl.deleteProgram(program);
            program = null;
            uniforms = null;
        },
    };
}
