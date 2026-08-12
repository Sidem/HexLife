import * as Config from '../../core/config.js';
import { getSpacetimeViewSettings } from '../../services/SpacetimeViewSettings.js';
import { SpacetimeVolume } from './SpacetimeVolume.js';
import {
    SPACETIME_MARCH_DEFAULTS,
    computeGeometry,
    createSpacetimeProgram,
    drawSpacetimeVolume,
} from './SpacetimeCore.js';

/**
 * #40 Spacetime View — the Explorer's half of the ray-march.
 *
 * The march itself lives in {@link module:SpacetimeCore} and is shared, unmodified, with the
 * `@hexlife/embed/spacetime` package entry. What is *here* is everything that is the Explorer's and
 * not a general 3D volume's: where the depth cap comes from (`Config` + the device), whose settings
 * the opacity is read from, and the plan's frame-time benchmark.
 *
 * This whole module (and the core and both shaders it pulls in) lives in a lazily imported chunk.
 * `renderer.js` fetches it on the first switch into spacetime mode and never before, so a session
 * that never opens the mode pays nothing: no chunk, no program, no GL object (#40 §2.1). On leaving
 * the mode the volume texture is deleted; the compiled program and the fetched chunk are
 * deliberately kept, so a second toggle is instant.
 *
 * Phase 2 replaced the procedural stand-in volume with the real thing: the worker packs one byte per
 * cell per tick in Rust and ships it, {@link SpacetimeVolume} owns the texture ring, and this module
 * only ever draws what the simulation actually produced.
 */

// Re-exported so the object's shape has one importable definition: callers (and the tests that pin
// the framing) ask this module for it and get the very function the march uses.
export { computeGeometry };

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
    // The sampling numbers are the core's, not this module's: they are what the plan's frame time
    // was measured at, and the embed entry marches with exactly the same ones. Users can move
    // `layerAlpha` from the settings panel (see `SpacetimeViewSettings`).
    ...SPACETIME_MARCH_DEFAULTS,
});

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
        const compiled = createSpacetimeProgram(gl);
        if (!compiled) return false;
        program = compiled.program;
        uniforms = compiled.uniforms;
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

        geometry = drawSpacetimeVolume(gl, { program, uniforms }, {
            volume,
            camera,
            viewRect,
            surfaceHeight,
            lutTexture,
            options,
            highlightLayer,
        });
        return geometry !== null;
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
