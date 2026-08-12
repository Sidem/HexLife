import * as Config from '../../core/config.js';
import * as WebGLUtils from '../webglUtils.js';
import { lookAt, perspective } from '../mat4.js';
import { torusOrbitCamera } from '../torusMath.js';

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
 * Phase 1 is a measurement harness: the volume is filled procedurally here, with no worker traffic
 * and no Rust packer. Phase 2 replaces `_fillSyntheticVolume` with real per-tick layers and changes
 * nothing else about the draw.
 */

const SQRT3 = Math.sqrt(3);

/** Framing of the object in the orbit camera's space (the camera sits 4.1–10 units out). */
const FOOTPRINT_HALF_EXTENT = 1.6;
const TIME_HALF_EXTENT = 2.2;
const FIELD_OF_VIEW_RADIANS = Math.PI * 42 / 180;

export const SPACETIME_DEFAULTS = Object.freeze({
    /** Layers requested. Clamped to the ring size AND to the device's MAX_ARRAY_TEXTURE_LAYERS. */
    depth: Config.STATE_HISTORY_RING_SIZE,
    /** Fraction of cells alive per layer in the synthetic fill. */
    density: 0.32,
    /**
     * 0 = opaque solid (first hit wins); > 0 = front-to-back accumulation at this alpha.
     * The live view runs translucent because an opaque volume is just a silhouette — you cannot
     * see the history inside it. The Phase 1 *gate* number is still the opaque one (§6): opaque is
     * the cheap case and the one the plan named.
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
 */
export function computeGeometry(cols, rows, depth) {
    // Flat-grid extents, in units of the hex radius (matching `getGridWorldBounds`).
    const flatWidth = (cols - 1) * 1.5 + 2;
    const flatHeight = rows * SQRT3 + SQRT3 / 2;
    const hexSize = (2 * FOOTPRINT_HALF_EXTENT) / Math.max(flatWidth, flatHeight);
    return {
        hexSize,
        // Object XZ = flat XY; object Y = time.
        boxHalf: [
            (flatWidth * hexSize) / 2,
            TIME_HALF_EXTENT,
            (flatHeight * hexSize) / 2,
        ],
        gridCenter: [
            (-hexSize + (cols - 1) * 1.5 * hexSize + hexSize) / 2,
            (-SQRT3 * hexSize / 2 + rows * SQRT3 * hexSize) / 2,
        ],
        layerHeight: (2 * TIME_HALF_EXTENT) / depth,
    };
}

export function createSpacetimeView(gl) {
    let program = null;
    let uniforms = null;
    let volumeTexture = null;
    let volumeKey = '';
    let geometry = null;
    let volumeInfo = null;
    const options = { ...SPACETIME_DEFAULTS };

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
            boxHalf: gl.getUniformLocation(program, 'u_boxHalf'),
            gridCenter: gl.getUniformLocation(program, 'u_gridCenter'),
            hexSize: gl.getUniformLocation(program, 'u_hexSize'),
            gridSize: gl.getUniformLocation(program, 'u_gridSize'),
            layers: gl.getUniformLocation(program, 'u_layers'),
            maxSteps: gl.getUniformLocation(program, 'u_maxSteps'),
            layerAlpha: gl.getUniformLocation(program, 'u_layerAlpha'),
            maxLateralStep: gl.getUniformLocation(program, 'u_maxLateralStep'),
        };
        return true;
    }

    /**
     * Stand-in for the real layer stream: expanding wavefronts with hashed speckle, which occludes
     * like a real history does (large connected regions near the tip, thinning with age) instead of
     * flattering the early-termination path with a solid block.
     */
    function _fillSyntheticVolume(cols, rows, depth, density) {
        const bytes = new Uint8Array(cols * rows * depth);
        const centerCol = cols / 2;
        const centerRow = rows / 2;
        const radius = new Float32Array(cols * rows);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const dx = (col - centerCol) * 1.5;
                const dy = (row - centerRow + (col & 1 ? 0.5 : 0)) * SQRT3;
                radius[row * cols + col] = Math.hypot(dx, dy);
            }
        }
        // density -> wave threshold. Scaled past the wave's full range (sine + speckle) so that
        // density 0 really is an empty volume — the worst case for the march, where every ray runs
        // to the step cap without a hit — and density 1 really is solid.
        const threshold = 1.36 * Math.cos(Math.PI * Math.min(Math.max(density, 0), 1));
        let liveCount = 0;
        for (let layer = 0; layer < depth; layer++) {
            const phase = layer * 0.55;
            const layerBase = layer * cols * rows;
            for (let i = 0; i < cols * rows; i++) {
                const col = i % cols;
                const row = (i / cols) | 0;
                const hash = ((col * 73856093) ^ (row * 19349663) ^ (layer * 83492791)) & 0xff;
                const wave = Math.sin(radius[i] * 0.11 - phase) + (hash / 255 - 0.5) * 0.7;
                const state = wave > threshold ? 1 : 0;
                liveCount += state;
                // Rule indices must be spatially COHERENT, not per-voxel noise: a real history has
                // neighbouring cells taking the same transition, and the translucent view averages
                // whatever it crosses. Random rules per voxel accumulate into rainbow static and
                // make the fixture read as noise rather than as structure.
                const rule = (((radius[i] * 0.05) | 0) * 11 + ((layer / 24) | 0) * 5) & 0x7f;
                bytes[layerBase + i] = (rule << 1) | state;
            }
        }
        return { bytes, fill: liveCount / bytes.length };
    }

    function ensureVolume() {
        const cols = Config.GRID_COLS;
        const rows = Config.GRID_ROWS;
        const depth = Math.max(1, Math.min(options.depth, Config.STATE_HISTORY_RING_SIZE, maxLayers));
        const key = `${cols}x${rows}x${depth}@${options.density}`;
        if (volumeTexture && key === volumeKey) return true;
        releaseVolume();

        const started = performance.now();
        const { bytes, fill } = _fillSyntheticVolume(cols, rows, depth, options.density);
        const generatedMs = performance.now() - started;

        volumeTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, volumeTexture);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, cols, rows, depth);
        // One byte per cell with no row padding: an odd column count (222 at medium) is not a
        // multiple of the default 4-byte unpack alignment, and the upload is rejected without this.
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, cols, rows, depth,
            gl.RED_INTEGER, gl.UNSIGNED_BYTE, bytes,
        );
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        // Integer textures cannot be filtered.
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

        volumeKey = key;
        geometry = computeGeometry(cols, rows, depth);
        volumeInfo = {
            cols,
            rows,
            depth,
            requestedDepth: options.depth,
            maxLayers,
            megabytes: (cols * rows * depth) / (1024 * 1024),
            fill,
            generatedMs,
        };
        return true;
    }

    function releaseVolume() {
        if (!volumeTexture) return;
        gl.deleteTexture(volumeTexture);
        volumeTexture = null;
        volumeKey = '';
        volumeInfo = null;
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
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, volumeTexture);
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
        gl.uniform3fv(uniforms.boxHalf, geometry.boxHalf);
        gl.uniform2fv(uniforms.gridCenter, geometry.gridCenter);
        gl.uniform1f(uniforms.hexSize, geometry.hexSize);
        gl.uniform2i(uniforms.gridSize, volumeInfo.cols, volumeInfo.rows);
        gl.uniform1i(uniforms.layers, volumeInfo.depth);
        gl.uniform1i(uniforms.maxSteps, options.maxSteps);
        gl.uniform1f(uniforms.layerAlpha, options.layerAlpha);
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
     * Phase 1's gate (#40 §6): time the ray-march itself, without rAF in the way.
     *
     * Each iteration draws the volume and then reads one pixel back, which blocks until the GPU has
     * finished that frame. That makes the number a per-frame GPU cost with no pipelining — stricter
     * than a real rAF loop, never flattering. Wall-clock rAF cadence is not usable here: an
     * automated browser tab is `document.hidden`, so rAF never fires at all.
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
        ...overrides
    } = {}) {
        const previousOptions = { ...options };
        Object.assign(options, overrides);
        try {
            if (!ensureProgram() || !ensureVolume()) return null;
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
                volume: { ...volumeInfo },
                geometry: { ...geometry },
            };
        } finally {
            Object.assign(options, previousOptions);
            ensureVolume(); // restore the benchmarked-away volume if an override rebuilt it
        }
    }

    return {
        draw,
        releaseVolume,
        runBenchmark,
        setOptions: (next) => {
            Object.assign(options, next);
        },
        getInfo: () => ({ options: { ...options }, maxLayers, volume: volumeInfo && { ...volumeInfo } }),
        dispose: () => {
            releaseVolume();
            if (program) gl.deleteProgram(program);
            program = null;
            uniforms = null;
        },
    };
}
