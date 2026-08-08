// NB: deliberately NOT `// @ts-check` — see the note atop EmbedSim.js.

/**
 * `EmbedRenderer` — a minimal WebGL2 renderer for exactly one world, drawn straight to the canvas.
 *
 * **Deliberately forked from `src/rendering/renderer.js`, and only from it.** The app renderer is
 * welded to 9 worlds, per-world FBOs, minimap composition, layout regimes and dirty-flag tracking;
 * none of that survives contact with a single embedded world, and refactoring it to be shareable
 * would be high-risk churn for ~150 saved lines. What is NOT forked is everything that decides how
 * a cell *looks*: the shaders (`shaders/*.glsl`, already fully uniform-driven), the GL helpers
 * (`webglUtils.js`, pure), and the color LUT (`generateColorLUT`). Those are imported, so the embed
 * and the app can never drift visually.
 *
 * The shaders expect hover and ghost attributes. Custom-element callers keep the zero-allocation
 * constant-attribute path; the renderer-only public entry opts into separate selection and sparse
 * draft buffers without mutating its host-owned verified state.
 *
 * **Two draw paths, one context.** `draw(sim)` fills the canvas with a single world;
 * `drawGrid(sims)` tiles many worlds of the *same* `(cols, rows)` across it, one `gl.viewport` +
 * instanced draw each. The second exists because a browser hands a page ~16 WebGL contexts total
 * (Chrome force-loses the oldest past that), so "256 worlds" can never mean 256 canvases. Every
 * world shares this renderer's geometry, offsets, LUT and program — a tile differs only by which
 * two instance buffers were uploaded and where the viewport was pointing, which is why the marginal
 * cost of a world is one buffer upload rather than a context.
 */

import * as WebGLUtils from '../rendering/webglUtils.js';
import { generateColorLUT, rotateHue } from '../utils/ruleVizUtils.js';
import { PRESET_PALETTES } from '../core/colorPalettes.js';
import { precomputeSymmetryGroups } from '../core/Symmetry.js';
import { lookAt, multiply, perspective } from '../rendering/mat4.js';
import { getTorusPeriods, torusOrbitCamera, wrapAngle } from '../rendering/torusMath.js';
import { repeatOffsetsForViewport } from './repeatToroidal.js';

// eslint-disable-next-line import/no-unresolved
import hexVertexShaderSource from '../../shaders/vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import hexFragmentShaderSource from '../../shaders/fragment.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import torusVertexShaderSource from '../../shaders/torus_vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import torusFragmentShaderSource from '../../shaders/torus_fragment.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import stateVertexShaderSource from '../../shaders/state_vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import stateFragmentShaderSource from '../../shaders/state_fragment.glsl?raw';

// Same base hex geometry constants the app uses (config.js). Copied rather than imported because
// config.js runs setGridDimensions() at import time; these three are inert numbers. The absolute
// scale cancels out (everything is fit to the canvas below) — they're kept identical to the app's
// only so the fitted result is pixel-comparable.
const HEX_SIZE = 50;
const HEX_WIDTH = 2 * HEX_SIZE;
const HEX_HEIGHT = Math.sqrt(3) * HEX_SIZE;

/** Background behind the hexes — Config.BACKGROUND_COLOR. */
const BACKGROUND_COLOR = [0.1, 0.1, 0.1, 1.0];

/**
 * Which cells the torus fragment shader keeps this pass — mirrors `u_surfacePass` in
 * `torus_fragment.glsl` and the app renderer's own table.
 */
const TORUS_SURFACE_PASS = Object.freeze({ ALL: 0, LIVE: 1, OFF: 2 });

/**
 * Torus look, copied from the app's `TORUS_VIEW_DEFAULTS` rather than imported: that module is a
 * *settings service* (EventBus + PersistenceService), and an embed on someone else's page has no
 * business owning localStorage keys. These are the shape the Explorer ships, so a world looks the
 * same in both. `radiusRatio` is major/minor; the pair is normalized in `_drawTorus` so the outer
 * silhouette keeps its framing whatever the ratio.
 */
const TORUS_LOOK = Object.freeze({
    offOpacity: 0.12,
    radiusRatio: 1.55,
});

/** Camera framing for the torus view — same figures the app's `drawTorus` uses. */
const TORUS_CAMERA = Object.freeze({
    fovY: (Math.PI * 42) / 180,
    near: 0.1,
    far: 40,
    minDistance: 4.1,
    maxDistance: 10,
    /** Start angles + dolly — the app's initial `torusView`, so the first frame reads the same. */
    yaw: 0.55,
    pitch: 0.42,
    distance: 6.5,
});

/**
 * The symmetry tables `generateColorLUT` needs for the symmetry-keyed palettes (the
 * `symmetryGradient` preset and `mode: 'symmetry'`). The app threads these in from WorldManager;
 * the embed just recomputes them — `precomputeSymmetryGroups` is pure, ~100 lines, and runs over 64
 * bitmasks, so *transmitting* them (or refusing the palettes that need them, as v1 of this file did)
 * was never worth it. Computed once at module load and shared by every instance.
 */
const SYMMETRY_DATA = precomputeSymmetryGroups();

/**
 * Pixel center of a cell, flat-top odd-q layout (odd columns shifted down half a row).
 * Pure, parameterized twin of `utils.gridToPixelCoords`, which reads Config globals.
 * @returns {{x: number, y: number}}
 */
function gridToPixel(col, row, hexSize) {
    const horizSpacing = (2 * hexSize * 3) / 4;
    const vertSpacing = Math.sqrt(3) * hexSize;
    const yOffset = col % 2 !== 0 ? vertSpacing / 2 : 0;
    return { x: col * horizSpacing, y: row * vertSpacing + yOffset };
}

/**
 * Largest hex size that fits the whole grid inside `width`×`height`. Pure twin of
 * `utils.calculateHexSizeForTexture` (which fits into a square RENDER_TEXTURE_SIZE); fitting to the
 * canvas's real dimensions instead means a non-square embed letterboxes rather than clipping.
 */
function fitHexSize(cols, rows, width, height, cover = false) {
    const gridPixelWidth = cols * ((HEX_WIDTH * 3) / 4) + HEX_WIDTH / 4;
    const gridPixelHeight = rows * HEX_HEIGHT + HEX_HEIGHT / 2;
    if (gridPixelWidth === 0 || gridPixelHeight === 0) return HEX_SIZE;
    const scaleForViewport = cover ? Math.max : Math.min;
    const scale = scaleForViewport(width / gridPixelWidth, height / gridPixelHeight) * 0.98;
    return HEX_SIZE * scale;
}

/** Grid center in world coords — the camera position that shows the grid dead-center. */
function gridCenter(cols, rows, hexSize) {
    const horizSpacing = (hexSize * 2 * 3) / 4;
    const vertSpacing = hexSize * Math.sqrt(3);
    const minX = -hexSize;
    const maxX = (cols - 1) * horizSpacing + hexSize;
    const minY = -vertSpacing / 2;
    const maxY = rows * vertSpacing;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** The 6 unit-circle vertices of a flat-top hexagon (drawn as a TRIANGLE_FAN). */
function hexagonVertices() {
    const v = [];
    for (let i = 0; i < 6; i++) {
        const rad = (Math.PI / 180) * (60 * i);
        v.push(Math.cos(rad), Math.sin(rad));
    }
    return new Float32Array(v);
}

export class EmbedRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} opts
     * @param {number} opts.cols
     * @param {number} opts.rows
     * @param {string} [opts.palette='default'] Key into PRESET_PALETTES.
     * @param {{on: string[], off: string[]}|null} [opts.customGradient=null] Overrides `palette`.
     * @param {object|null} [opts.colorSettings=null] A full ColorController settings object — every
     *   mode, custom map, flicker-proof flag and hue shift the app supports. This is the world-code
     *   path (WorldCodec) and it takes precedence over everything above: the same
     *   `generateColorLUT` the app renders with produces the same table here, symmetry modes
     *   included (see SYMMETRY_DATA).
     * @param {Uint8Array|null} [opts.lut=null] A pre-baked 128×2 RGBA LUT (1024 bytes) — the escape
     *   hatch for a caller that has a table but no settings. Beaten by `colorSettings`.
     * @param {boolean} [opts.flickerProof=false] Suppress the birth/death flash in *preset* mode —
     *   the explorer's "Prevent birth/death flash". Ignored by the other palette forms; see
     *   `_resolveLUT`.
     * @param {number|null} [opts.hueShift=null] Optional global chromatic hue rotation in degrees.
     * @param {boolean} [opts.repeatToroidal=false] Map every cell to its nearest flat toroidal copy.
     * @param {boolean} [opts.overlays=false] Allocate selection and sparse draft overlay buffers.
     * @throws {Error} If WebGL2 is unavailable — the caller renders a fallback note instead.
     */
    constructor(canvas, { cols, rows, palette = 'default', customGradient = null, colorSettings = null, lut = null, flickerProof = false, hueShift = null, repeatToroidal = false, overlays = false }) {
        this.canvas = canvas;
        this.cols = cols;
        this.rows = rows;
        this.numCells = cols * rows;
        this._repeatToroidal = !!repeatToroidal;
        this._overlays = !!overlays;

        // `depth` is on by default, but the torus view depends on it (three depth-resolved passes),
        // so it is asked for explicitly rather than inherited from a default that could change.
        const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, depth: true });
        if (!gl) throw new Error('WebGL2 is not available');
        this.gl = gl;

        this.program = WebGLUtils.loadShaderProgram(gl, hexVertexShaderSource, hexFragmentShaderSource);
        if (!this.program) throw new Error('Shader program failed to compile');

        this.attribs = {
            position: gl.getAttribLocation(this.program, 'a_position'),
            instanceOffset: gl.getAttribLocation(this.program, 'a_instance_offset'),
            instanceState: gl.getAttribLocation(this.program, 'a_instance_state'),
            instanceHoverState: gl.getAttribLocation(this.program, 'a_instance_hover_state'),
            instanceRuleIndex: gl.getAttribLocation(this.program, 'a_instance_rule_index'),
            instanceGhostState: gl.getAttribLocation(this.program, 'a_instance_ghost_state'),
        };
        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            hexSize: gl.getUniformLocation(this.program, 'u_hexSize'),
            pan: gl.getUniformLocation(this.program, 'u_pan'),
            zoom: gl.getUniformLocation(this.program, 'u_zoom'),
            colorLUT: gl.getUniformLocation(this.program, 'u_colorLUT'),
            hoverFilledDarkenFactor: gl.getUniformLocation(this.program, 'u_hoverFilledDarkenFactor'),
            hoverInactiveLightenFactor: gl.getUniformLocation(this.program, 'u_hoverInactiveLightenFactor'),
            repeatToroidal: gl.getUniformLocation(this.program, 'u_repeatToroidal'),
            repeatPeriod: gl.getUniformLocation(this.program, 'u_repeatPeriod'),
            repeatOffset: gl.getUniformLocation(this.program, 'u_repeatOffset'),
        };

        this._setupGeometry();
        this._setupLUT({ palette, customGradient, colorSettings, lut, flickerProof, hueShift });

        // Hover factors are fixed (embed has no hover). Zoom/pan are live — see setView().
        gl.useProgram(this.program);
        gl.uniform1f(this.uniforms.hoverFilledDarkenFactor, 0.66);
        gl.uniform1f(this.uniforms.hoverInactiveLightenFactor, 1.5);
        gl.uniform1f(this.uniforms.zoom, 1.0);
        gl.uniform1i(this.uniforms.repeatToroidal, this._repeatToroidal ? 1 : 0);
        gl.uniform2f(this.uniforms.repeatOffset, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        this._hexSize = 0;
        /** Fitted grid center in world coords (zoom=1, no pan). */
        this._center = { x: 0, y: 0 };
        /** Last CSS size used by resize — needed to convert pan offsets (CSS px) → world. */
        this._cssWidth = 1;
        this._cssHeight = 1;
        this._viewZoom = 1;
        this._viewPanX = 0;
        this._viewPanY = 0;

        // --- tiled multi-world layout (opt-in; see setGridLayout) ---
        /** @type {{cols: number, rows: number, gap: number}|null} Null ⇒ the single-world path. */
        this._layout = null;
        /** Forces a refit on the next `resize` even when the backing store did not change. */
        this._layoutDirty = false;
        /** Tile rects in *device* px, GL convention (y up from the bottom). @type {Array<{x,y,w,h}>} */
        this._tiles = [];
        /** The same rects in CSS px, y down from the top — what a host positions DOM chrome with. */
        this._cssTiles = [];

        // --- torus view (opt-in; see setTorus) ---
        /**
         * Built on first use, never at boot. A feed card that only ever shows the flat grid must not
         * pay for a second shader program compile + link it will never draw with.
         * @type {WebGLProgram|null}
         */
        this._torusProgram = null;
        this._torusUniforms = null;
        this._torusEnabled = false;
        this._torusCamera = {
            yaw: TORUS_CAMERA.yaw,
            pitch: TORUS_CAMERA.pitch,
            distance: TORUS_CAMERA.distance,
        };

        // --- k-state view (opt-in; see setStatePalette / drawStates) ---
        /**
         * Built on first use, exactly like `_torusProgram` and for the same reason: a binary
         * `<hexlife-world>` — which is nearly every instance of this renderer — must not pay for a
         * program it will never draw with.
         * @type {WebGLProgram|null}
         */
        this._stateProgram = null;
        this._stateUniforms = null;
        /** @type {WebGLTexture|null} The k-entry palette. */
        this._statePaletteTexture = null;
        /** `k` — the palette's width in texels, and what puts a state on its texel centre. */
        this._statePaletteSize = 0;
    }

    _setupGeometry() {
        const gl = this.gl;

        this.positionBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, hexagonVertices(), gl.STATIC_DRAW);
        // Per-cell world positions. The vertex shader scales only a_position by u_hexSize, not the
        // instance offset, so these are in world units and must be rebuilt whenever the fitted hex
        // size changes — i.e. on resize (the app never rebuilds them because its FBO is fixed-size).
        this.offsetBuffer = gl.createBuffer();

        const zeros = new Uint8Array(this.numCells);
        this.stateBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
        this.ruleIndexBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);

        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.offsetBuffer);
        gl.enableVertexAttribArray(this.attribs.instanceOffset);
        gl.vertexAttribPointer(this.attribs.instanceOffset, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(this.attribs.instanceOffset, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.stateBuffer);
        gl.enableVertexAttribArray(this.attribs.instanceState);
        gl.vertexAttribPointer(this.attribs.instanceState, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.vertexAttribDivisor(this.attribs.instanceState, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.ruleIndexBuffer);
        gl.enableVertexAttribArray(this.attribs.instanceRuleIndex);
        gl.vertexAttribPointer(this.attribs.instanceRuleIndex, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.vertexAttribDivisor(this.attribs.instanceRuleIndex, 1);

        if (this._overlays) {
            this.hoverBytes = new Uint8Array(this.numCells);
            this.ghostBytes = new Uint8Array(this.numCells);
            this.hoverBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, this.hoverBytes, gl.DYNAMIC_DRAW);
            this.ghostBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, this.ghostBytes, gl.DYNAMIC_DRAW);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.hoverBuffer);
            gl.enableVertexAttribArray(this.attribs.instanceHoverState);
            gl.vertexAttribPointer(this.attribs.instanceHoverState, 1, gl.UNSIGNED_BYTE, false, 0, 0);
            gl.vertexAttribDivisor(this.attribs.instanceHoverState, 1);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostBuffer);
            gl.enableVertexAttribArray(this.attribs.instanceGhostState);
            gl.vertexAttribPointer(this.attribs.instanceGhostState, 1, gl.UNSIGNED_BYTE, false, 0, 0);
            gl.vertexAttribDivisor(this.attribs.instanceGhostState, 1);
        } else {
            // The custom elements do not expose per-cell overlays, so they retain the zero-allocation
            // constant-attribute path. Renderer-only hosts opt into buffers above.
            gl.disableVertexAttribArray(this.attribs.instanceHoverState);
            gl.disableVertexAttribArray(this.attribs.instanceGhostState);
            gl.vertexAttrib1f(this.attribs.instanceHoverState, 0);
            gl.vertexAttrib1f(this.attribs.instanceGhostState, 0);
        }

        gl.bindVertexArray(null);
    }

    /** Rebuild the per-cell offsets for a new hex size (they scale with it — see the shader). */
    _rebuildOffsets(hexSize) {
        const offsets = new Float32Array(this.numCells * 2);
        for (let i = 0; i < this.numCells; i++) {
            const col = i % this.cols;
            const row = Math.floor(i / this.cols);
            const p = gridToPixel(col, row, hexSize);
            offsets[i * 2] = p.x;
            offsets[i * 2 + 1] = p.y;
        }
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.offsetBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
    }

    _setupLUT(opts) {
        const gl = this.gl;
        this.lutTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
            this._buildLUT(opts));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    /**
     * Build the LUT and remember it. Every path that uploads a LUT goes through here (initial
     * setup and every live `setPalette`), so `lutBytes` is always the table currently on screen.
     *
     * Retained because an attribute-driven world has no other record of its colors: the palette
     * only exists as a preset name or a gradient pair until it is resolved into this table, and
     * `worldCode()` has to write real colors into the code. See {@link getLut}.
     * @param {{palette?: string, customGradient?: object|null, colorSettings?: object|null,
     *   lut?: Uint8Array|null, flickerProof?: boolean, hueShift?: number|null}} opts
     * @returns {Uint8Array}
     */
    _buildLUT(opts) {
        this.lutBytes = this._resolveLUT(opts);
        return this.lutBytes;
    }

    /**
     * The 128×2 RGBA table the shader samples, from whichever palette form the caller supplied.
     * Precedence: a decoded world's `colorSettings`, then a baked `lut`, then the element's
     * `palette-on/off` gradient attributes, then the `palette` preset name.
     * @param {{palette?: string, customGradient?: object|null, colorSettings?: object|null,
     *   lut?: Uint8Array|null, flickerProof?: boolean, hueShift?: number|null}} opts
     * @returns {Uint8Array}
     */
    _resolveLUT({ palette = 'default', customGradient = null, colorSettings = null, lut = null, flickerProof = false, hueShift = null }) {
        if (colorSettings) {
            const settings = hueShift === null ? colorSettings : { ...colorSettings, hueShift };
            return generateColorLUT(settings, SYMMETRY_DATA);
        }
        if (lut && lut.length === 128 * 2 * 4) {
            if (!hueShift) return lut;
            const shifted = new Uint8Array(lut);
            for (let i = 0; i < shifted.length; i += 4) {
                const rgb = rotateHue([shifted[i], shifted[i + 1], shifted[i + 2]], hueShift);
                shifted[i] = rgb[0]; shifted[i + 1] = rgb[1]; shifted[i + 2] = rgb[2];
            }
            return shifted;
        }
        if (customGradient) {
            return generateColorLUT({ mode: 'gradient', customGradient, hueShift: hueShift || 0 }, SYMMETRY_DATA);
        }
        let activePreset = palette;
        if (!PRESET_PALETTES[activePreset]) {
            if (activePreset !== 'default') {
                // No element name: this renderer backs both `<hexlife-world>` and `<hexlife-grid>`.
                console.warn(`HexLife: unknown palette "${palette}", using "default".`);
            }
            activePreset = 'default';
        }
        // `flickerProofPresets` blacks out the two entries that make a palette strobe — rule 0 firing
        // a birth and rule 127 firing a death — so a cell that is about to change does not flash a
        // full-brightness frame first. It is the explorer's "Prevent birth/death flash", and it only
        // means anything in preset mode there too: the branches above are a host's own colors, and
        // silently rewriting two of them is not ours to do.
        return generateColorLUT(
            { mode: 'preset', activePreset, flickerProofPresets: !!flickerProof, hueShift: hueShift || 0 },
            SYMMETRY_DATA,
        );
    }

    /**
     * The 128×2 RGBA LUT currently on screen (1024 bytes) — the colors as resolved, whatever form
     * they were specified in. Treat as read-only; it is the renderer's own record.
     * @returns {Uint8Array|null} Null only before the first LUT upload.
     */
    getLut() {
        return this.lutBytes || null;
    }

    /**
     * Swap the palette on a live renderer (no sim disruption — the LUT is a pure recolor).
     * @param {{palette?: string, customGradient?: object|null, colorSettings?: object|null,
     *   lut?: Uint8Array|null, flickerProof?: boolean, hueShift?: number|null}} opts
     */
    setPalette(opts) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RGBA, gl.UNSIGNED_BYTE,
            this._buildLUT(opts));
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    /**
     * Upload host-owned externally verified cells. Unlike `draw(sim)`, this is the only external
     * state-buffer upload path, so camera changes and draw-on-demand frames stay upload-free.
     * @param {Uint8Array} cells Row-major 0/1 cell values.
     * @param {Uint8Array|null} [ruleIndices=null] Optional row-major rule indices.
     */
    setExternalState(cells, ruleIndices = null) {
        if (!(cells instanceof Uint8Array) || cells.length !== this.numCells) {
            throw new RangeError(`Expected ${this.numCells} external cell bytes.`);
        }
        if (ruleIndices !== null && (!(ruleIndices instanceof Uint8Array) || ruleIndices.length !== this.numCells)) {
            throw new RangeError(`Expected ${this.numCells} external rule-index bytes.`);
        }
        const gl = this.gl;
        WebGLUtils.updateBuffer(gl, this.stateBuffer, gl.ARRAY_BUFFER, cells);
        if (ruleIndices) WebGLUtils.updateBuffer(gl, this.ruleIndexBuffer, gl.ARRAY_BUFFER, ruleIndices);
    }

    /** @param {number|null} index Row-major selected-cell index. */
    setSelectionIndex(index) {
        if (!this._overlays) return;
        const next = Number.isSafeInteger(index) && index >= 0 && index < this.numCells ? index : null;
        const gl = this.gl;
        if (this._selectionIndex !== undefined && this._selectionIndex !== null) {
            this.hoverBytes[this._selectionIndex] = 0;
            WebGLUtils.updateBuffer(gl, this.hoverBuffer, gl.ARRAY_BUFFER, this.hoverBytes.subarray(this._selectionIndex, this._selectionIndex + 1), this._selectionIndex);
        }
        if (next !== null) {
            this.hoverBytes[next] = 1;
            WebGLUtils.updateBuffer(gl, this.hoverBuffer, gl.ARRAY_BUFFER, this.hoverBytes.subarray(next, next + 1), next);
        }
        this._selectionIndex = next;
    }

    /**
     * Replace the sparse draft overlay. Value 1 previews a live target; value 0 previews a dead
     * target. Overlay bytes are separate from the verified state buffer.
     * @param {Array<{index: number, value: 0|1}>} edits
     */
    setDraftPreview(edits) {
        if (!this._overlays) return;
        const changed = new Set(this._draftIndices || []);
        for (const index of this._draftIndices || []) this.ghostBytes[index] = 0;
        const next = [];
        for (const edit of edits || []) {
            if (!Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index >= this.numCells) continue;
            this.ghostBytes[edit.index] = edit.value === 0 ? 2 : 1;
            changed.add(edit.index);
            next.push(edit.index);
        }
        const gl = this.gl;
        const ordered = [...changed].sort((a, b) => a - b);
        let start = null;
        let end = null;
        const flush = () => {
            if (start === null || end === null) return;
            WebGLUtils.updateBuffer(gl, this.ghostBuffer, gl.ARRAY_BUFFER, this.ghostBytes.subarray(start, end + 1), start);
        };
        for (const index of ordered) {
            if (start === null) {
                start = index;
                end = index;
            } else if (index === end + 1) {
                end = index;
            } else {
                flush();
                start = index;
                end = index;
            }
        }
        flush();
        this._draftIndices = next;
    }

    /**
     * Size the drawing buffer and refit the grid to it.
     * @param {number} cssWidth  Element width in CSS pixels.
     * @param {number} cssHeight Element height in CSS pixels.
     * @param {number} [maxDpr=1.5] Cap on devicePixelRatio — a phone at DPR 3 would otherwise pay
     *   9× the fragment cost for a decoration.
     */
    resize(cssWidth, cssHeight, maxDpr = 1.5) {
        const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
        const w = Math.max(1, Math.round(cssWidth * dpr));
        const h = Math.max(1, Math.round(cssHeight * dpr));
        this._cssWidth = Math.max(1, cssWidth);
        this._cssHeight = Math.max(1, cssHeight);
        if (this.canvas.width === w && this.canvas.height === h && !this._layoutDirty && this._hexSize > 0) {
            // Still re-apply the view — pan is in CSS pixels and the mapping depends on size.
            this._uploadView();
            return;
        }

        this.canvas.width = w;
        this.canvas.height = h;
        this._refit(w, h);
    }

    /**
     * Fit the hex size to whatever a world is drawn *into* — the whole canvas, or one tile when a
     * grid layout is set — and push the geometry uniforms that follow from it.
     * @param {number} w Backing-store width in device px.
     * @param {number} h Backing-store height in device px.
     */
    _refit(w, h) {
        this._layoutDirty = false;
        this._computeTiles(w, h);
        // Every tile is the same size, so one fit serves all of them; without a layout the "tile" is
        // the canvas and this is the original single-world behavior, unchanged.
        const fitW = this._layout ? this._tiles[0].w : w;
        const fitH = this._layout ? this._tiles[0].h : h;

        this._hexSize = fitHexSize(this.cols, this.rows, fitW, fitH, this._repeatToroidal);
        this._rebuildOffsets(this._hexSize);
        this._center = gridCenter(this.cols, this.rows, this._hexSize);

        const gl = this.gl;
        gl.viewport(0, 0, w, h);
        gl.useProgram(this.program);
        gl.uniform2f(this.uniforms.resolution, fitW, fitH);
        gl.uniform1f(this.uniforms.hexSize, this._hexSize);
        this._repeatPeriod = {
            x: this.cols * this._hexSize * 1.5,
            y: this.rows * this._hexSize * Math.sqrt(3),
        };
        gl.uniform2f(this.uniforms.repeatPeriod, this._repeatPeriod.x, this._repeatPeriod.y);
        // The k-state program draws the same geometry through the same VAO, so it needs the same fit.
        if (this._stateProgram) {
            gl.useProgram(this._stateProgram);
            gl.uniform2f(this._stateUniforms.resolution, fitW, fitH);
            gl.uniform1f(this._stateUniforms.hexSize, this._hexSize);
        }
        this._uploadView();
    }

    // --- tiled multi-world layout ---------------------------------------------

    /**
     * Draw many worlds of this renderer's `(cols, rows)` as a grid of tiles in this one context,
     * instead of one world filling the canvas.
     *
     * @param {{cols: number, rows: number, gap?: number}|null} layout Tiles across × down, and the
     *   gutter between them in CSS px. Null restores the single-world path.
     */
    setGridLayout(layout) {
        if (!layout || !(layout.cols > 0) || !(layout.rows > 0)) {
            this._layout = null;
        } else {
            this._layout = {
                cols: Math.max(1, Math.floor(layout.cols)),
                rows: Math.max(1, Math.floor(layout.rows)),
                gap: Math.max(0, Number(layout.gap) || 0),
            };
        }
        // A layout change refits without a size change, which `resize`'s fast path would skip.
        this._layoutDirty = true;
        if (this.canvas.width && this.canvas.height) this._refit(this.canvas.width, this.canvas.height);
    }

    /** @returns {number} How many tiles the current layout has (0 without one). */
    get tileCount() {
        return this._layout ? this._layout.cols * this._layout.rows : 0;
    }

    /**
     * Rebuild the tile rects for a backing store of `w`×`h` device px.
     *
     * Rects are laid out in *CSS* terms (index 0 top-left, reading order) and then flipped into GL's
     * bottom-up y for the viewport calls, so a host and the GPU agree on which tile is which.
     */
    _computeTiles(w, h) {
        this._tiles = [];
        this._cssTiles = [];
        if (!this._layout) return;

        const { cols: lc, rows: lr, gap } = this._layout;
        const dprX = w / this._cssWidth;
        const dprY = h / this._cssHeight;
        const gapX = gap * dprX;
        const gapY = gap * dprY;
        // Floor to whole device pixels: a fractional viewport would let neighbouring tiles claim the
        // same pixel row and shimmer against each other as the canvas resizes.
        const tw = Math.max(1, Math.floor((w - (lc - 1) * gapX) / lc));
        const th = Math.max(1, Math.floor((h - (lr - 1) * gapY) / lr));

        for (let i = 0; i < lc * lr; i++) {
            const col = i % lc;
            const row = Math.floor(i / lc);
            const x = Math.round(col * (tw + gapX));
            const yTop = Math.round(row * (th + gapY));
            this._tiles.push({ x, y: h - yTop - th, w: tw, h: th });
            this._cssTiles.push({
                x: x / dprX, y: yTop / dprY, width: tw / dprX, height: th / dprY,
            });
        }
    }

    /**
     * The tile's position within the canvas in CSS px (y down from the top) — what a host needs to
     * park a selection outline or a label over a world.
     * @param {number} index
     * @returns {{x: number, y: number, width: number, height: number}|null}
     */
    tileRect(index) {
        const r = this._cssTiles[index];
        return r ? { ...r } : null;
    }

    /**
     * Which tile is under a point, or null for a gutter / outside the grid.
     * @param {number} cssX Pointer x relative to the canvas's left edge, in CSS px.
     * @param {number} cssY Pointer y relative to the canvas's top edge, in CSS px.
     * @returns {number|null}
     */
    tileIndexAt(cssX, cssY) {
        for (let i = 0; i < this._cssTiles.length; i++) {
            const r = this._cssTiles[i];
            if (cssX >= r.x && cssX < r.x + r.width && cssY >= r.y && cssY < r.y + r.height) return i;
        }
        return null;
    }

    /**
     * One frame of a tiled grid: clear once, then per world point the viewport at its tile, upload
     * its two per-cell buffers and issue the same instanced draw the single-world path uses.
     *
     * Everything that decides how a cell *looks* — program, VAO, offsets, hex size, LUT — is set
     * once outside the loop, because every world shares this renderer's grid. `gl.viewport` clips
     * rasterization to the tile, so no scissor is needed and tiles cannot bleed into each other.
     *
     * @param {Array<import('./EmbedSim.js').EmbedSim|null>} sims In tile order; extra sims past the
     *   layout's tile count are ignored, and holes (null, or a freed sim) simply leave a tile empty.
     */
    drawGrid(sims) {
        const gl = this.gl;
        if (!this._layout) return;
        if (!this._hexSize) this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(BACKGROUND_COLOR[0], BACKGROUND_COLOR[1], BACKGROUND_COLOR[2], BACKGROUND_COLOR[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.uniform1i(this.uniforms.colorLUT, 1);

        const n = Math.min(sims.length, this._tiles.length);
        for (let i = 0; i < n; i++) {
            const sim = sims[i];
            // `state` goes null when a sim is freed; a half-torn-down grid must not upload from it.
            if (!sim || !sim.state) continue;
            const t = this._tiles[i];
            gl.viewport(t.x, t.y, t.w, t.h);
            // Views into wasm memory — uploaded straight from them, no copy.
            WebGLUtils.updateBuffer(gl, this.stateBuffer, gl.ARRAY_BUFFER, sim.state);
            WebGLUtils.updateBuffer(gl, this.ruleIndexBuffer, gl.ARRAY_BUFFER, sim.ruleIndices);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);
        }

        gl.bindVertexArray(null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Live camera. `zoom` is multiplicative around the fitted centre (1 = whole grid fits).
     * `panX`/`panY` are CSS-pixel offsets of the view (positive = content moves right/down).
     * @param {number} zoom
     * @param {number} [panX=0]
     * @param {number} [panY=0]
     */
    setView(zoom, panX = 0, panY = 0) {
        this._viewZoom = zoom;
        this._viewPanX = panX;
        this._viewPanY = panY;
        this._uploadView();
    }

    /**
     * Center a canonical row/column in the viewport using the nearest repeated copy.
     * @returns {{panX: number, panY: number}}
     */
    centerOnCell(row, col) {
        const normalizedRow = ((row % this.rows) + this.rows) % this.rows;
        const normalizedCol = ((col % this.cols) + this.cols) % this.cols;
        const point = gridToPixel(normalizedCol, normalizedRow, this._hexSize);
        const dprX = this.canvas.width / this._cssWidth;
        const dprY = this.canvas.height / this._cssHeight;
        const z = this._viewZoom || 1;
        this._viewPanX = ((this._center.x - point.x) * z) / dprX;
        this._viewPanY = ((this._center.y - point.y) * z) / dprY;
        this._uploadView();
        return { panX: this._viewPanX, panY: this._viewPanY };
    }

    /**
     * Map the CSS-pixel pan + zoom onto the shader uniforms. The vertex shader does
     * `(pos - u_pan) * u_zoom + resolution/2`, so u_pan is in *world* units. A CSS-pixel pan of
     * `p` at the current zoom corresponds to a world shift of `p * (backing/css) / zoom`.
     */
    _uploadView() {
        if (!this.gl || !this._center) return;
        const gl = this.gl;
        const dprX = this.canvas.width / this._cssWidth;
        const dprY = this.canvas.height / this._cssHeight;
        const z = this._viewZoom || 1;
        // Subtract so a positive CSS pan (drag content right) matches user expectation.
        const worldPanX = this._center.x - (this._viewPanX * dprX) / z;
        const worldPanY = this._center.y - (this._viewPanY * dprY) / z;
        gl.useProgram(this.program);
        gl.uniform1f(this.uniforms.zoom, z);
        gl.uniform2f(this.uniforms.pan, worldPanX, worldPanY);
        if (this._stateProgram) {
            gl.useProgram(this._stateProgram);
            gl.uniform1f(this._stateUniforms.zoom, z);
            gl.uniform2f(this._stateUniforms.pan, worldPanX, worldPanY);
        }
    }

    // --- torus view -----------------------------------------------------------

    /**
     * Wrap the live world onto a 3D torus instead of drawing it flat.
     *
     * The grid *is* a torus already — edges wrap in both axes — so this is the same instanced draw
     * seen from outside the surface rather than a second world or a second geometry. It shares the
     * VAO, the instance buffers and the color LUT with the flat path; only the program and the
     * depth/blend state differ.
     *
     * @param {boolean} enabled
     * @returns {boolean} Whether the torus is on afterwards — false when the program failed to
     *   build, which is the caller's cue to stay flat rather than show a blank canvas.
     */
    setTorus(enabled) {
        const want = !!enabled;
        if (want && !this._ensureTorusProgram()) {
            this._torusEnabled = false;
            return false;
        }
        this._torusEnabled = want;
        return want;
    }

    /** @returns {boolean} Is the torus projection the one being drawn? */
    get torusEnabled() {
        return this._torusEnabled;
    }

    /**
     * Turn the camera around the torus. Both angles wrap: `torusOrbitCamera` derives `up` from the
     * view tangent, so pitch can pass through the poles indefinitely without a look-at singularity
     * or the sudden flip a fixed world-up would give.
     * @param {number} deltaYaw Radians.
     * @param {number} deltaPitch Radians.
     */
    orbitTorus(deltaYaw, deltaPitch) {
        if (Number.isFinite(deltaYaw)) {
            this._torusCamera.yaw = wrapAngle(this._torusCamera.yaw + deltaYaw);
        }
        if (Number.isFinite(deltaPitch)) {
            this._torusCamera.pitch = wrapAngle(this._torusCamera.pitch + deltaPitch);
        }
    }

    /**
     * Move the camera in or out by a multiplicative factor, clamped to the framing range so the
     * torus can neither be lost in the distance nor turned inside out.
     * @param {number} factor >1 pulls back, <1 moves closer.
     */
    dollyTorus(factor) {
        if (!Number.isFinite(factor) || factor <= 0) return;
        this._torusCamera.distance = Math.min(
            TORUS_CAMERA.maxDistance,
            Math.max(TORUS_CAMERA.minDistance, this._torusCamera.distance * factor),
        );
    }

    /**
     * Compile + link the torus program on first use. Kept out of the constructor on purpose: the
     * common case for this element is a feed card that is never switched to 3D, and a shader compile
     * it never draws with is pure cost on the exact device least able to pay it.
     * @returns {boolean} False if the program could not be built (the caller stays flat).
     */
    _ensureTorusProgram() {
        if (this._torusProgram) return true;
        const gl = this.gl;
        const program = WebGLUtils.loadShaderProgram(gl, torusVertexShaderSource, torusFragmentShaderSource);
        if (!program) {
            console.warn('<hexlife-world>: torus shaders failed to compile; staying flat.');
            return false;
        }
        this._torusProgram = program;
        this._torusUniforms = {
            hexSize: gl.getUniformLocation(program, 'u_hexSize'),
            period: gl.getUniformLocation(program, 'u_period'),
            radii: gl.getUniformLocation(program, 'u_radii'),
            mvp: gl.getUniformLocation(program, 'u_mvp'),
            colorLUT: gl.getUniformLocation(program, 'u_colorLUT'),
            cameraPosition: gl.getUniformLocation(program, 'u_cameraPosition'),
            offOpacity: gl.getUniformLocation(program, 'u_offOpacity'),
            surfacePass: gl.getUniformLocation(program, 'u_surfacePass'),
        };
        return true;
    }

    /**
     * One torus frame. Ported from the app renderer's `drawTorus`, minus the per-world FBO and the
     * hover/ghost buffers the embed doesn't have.
     *
     * The three-pass structure below is the transparency contract, not an optimization: a side-on
     * ray crosses a torus up to four times, so ordinary alpha accumulation would make the shell's
     * opacity depend on the viewing angle. Instead each pass resolves one thing — nearest live cell,
     * nearest off cell, then blend only that winner.
     * @param {import('./EmbedSim.js').EmbedSim} sim
     */
    _drawTorus(sim) {
        const gl = this.gl;

        gl.clearColor(BACKGROUND_COLOR[0], BACKGROUND_COLOR[1], BACKGROUND_COLOR[2], BACKGROUND_COLOR[3]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        // Never cull: the camera tumbles through the poles, and the inner ring reverses its
        // screen-facing orientation when it does.
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);

        gl.useProgram(this._torusProgram);
        gl.bindVertexArray(this.vao);
        WebGLUtils.updateBuffer(gl, this.stateBuffer, gl.ARRAY_BUFFER, sim.state);
        WebGLUtils.updateBuffer(gl, this.ruleIndexBuffer, gl.ARRAY_BUFFER, sim.ruleIndices);

        const u = this._torusUniforms;
        const period = getTorusPeriods(this.cols, this.rows, this._hexSize);
        const camera = torusOrbitCamera(
            this._torusCamera.yaw, this._torusCamera.pitch, this._torusCamera.distance,
        );
        const projection = perspective(
            TORUS_CAMERA.fovY,
            Math.max(this.canvas.width / Math.max(this.canvas.height, 1), 0.01),
            TORUS_CAMERA.near,
            TORUS_CAMERA.far,
        );
        const mvp = multiply(projection, lookAt(camera.position, [0, 0, 0], camera.up));

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.uniform1i(u.colorLUT, 1);
        gl.uniform1f(u.hexSize, this._hexSize);
        gl.uniform2f(u.period, period.x, period.y);
        // Normalized so the ratio reshapes the hole and the tube without also acting as a zoom.
        const minorRadius = 2.55 / (TORUS_LOOK.radiusRatio + 1);
        gl.uniform2f(u.radii, TORUS_LOOK.radiusRatio * minorRadius, minorRadius);
        gl.uniformMatrix4fv(u.mvp, false, mvp);
        gl.uniform3fv(u.cameraPosition, camera.position);
        gl.uniform1f(u.offOpacity, TORUS_LOOK.offOpacity);

        // Nearest live cell wins the depth buffer; off cells are discarded, so activity behind the
        // translucent shell survives in the color buffer.
        gl.uniform1i(u.surfacePass, TORUS_SURFACE_PASS.LIVE);
        gl.depthMask(true);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);

        // Depth-only prepass for the nearest off cell — one shell layer, not four.
        gl.colorMask(false, false, false, false);
        gl.uniform1i(u.surfacePass, TORUS_SURFACE_PASS.OFF);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);

        // Blend only the off fragment that won that prepass.
        gl.colorMask(true, true, true, true);
        gl.depthFunc(gl.EQUAL);
        gl.enable(gl.BLEND);
        gl.depthMask(false);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);

        // Back to the state the flat path assumes the constructor left behind.
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.bindVertexArray(null);
    }

    // --- k-state view ---------------------------------------------------------
    // `@hexlife/embed/ca` worlds hold state VALUES in `0..k`, not a 0/1 flag plus a rule index, and
    // HexLife's rule-index colouring cannot follow them there: the k-state index needs 21 bits at
    // k=8 while `a_instance_rule_index` is an `UNSIGNED_BYTE`. So a k-state world is coloured by
    // state from a k-entry palette, through its own program.
    //
    // Everything *else* here is reused verbatim, which is the point: the instanced draw, the
    // per-cell offsets, the fit, the camera and `hitTest` are all state-agnostic. Only the program
    // and the palette texture differ, and both are built on first use so a binary world pays nothing.

    /**
     * Install the palette a k-state world is coloured with — one entry per state, in state order.
     *
     * Also declares `k` to the renderer: the palette's length *is* the state count as far as the
     * shader is concerned, so this must be called before {@link drawStates}.
     *
     * @param {Array<ArrayLike<number>>} colors `k` entries of `[r, g, b]` (or `[r, g, b, a]`), each
     *   channel 0–255. Alpha defaults to opaque.
     * @returns {boolean} False when the program could not be built (the caller draws nothing rather
     *   than showing a blank canvas it believes is a world) or the palette is unusable.
     */
    setStatePalette(colors) {
        if (!Array.isArray(colors) || colors.length < 1) return false;
        if (!this._ensureStateProgram()) return false;

        const gl = this.gl;
        const k = colors.length;
        const bytes = new Uint8Array(k * 4);
        for (let i = 0; i < k; i++) {
            const c = colors[i] || [];
            bytes[i * 4] = Math.min(255, Math.max(0, Math.round(Number(c[0]) || 0)));
            bytes[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(Number(c[1]) || 0)));
            bytes[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(Number(c[2]) || 0)));
            bytes[i * 4 + 3] = c.length > 3 ? Math.min(255, Math.max(0, Math.round(Number(c[3]) || 0))) : 255;
        }

        gl.bindTexture(gl.TEXTURE_2D, this._statePaletteTexture);
        // `texImage2D` rather than `texSubImage2D`: a live palette swap may also change `k` (a host
        // reconfiguring the world), and that reallocates the texture rather than writing into it.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, k, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this._statePaletteSize = k;
        gl.useProgram(this._stateProgram);
        gl.uniform1f(this._stateUniforms.states, k);
        return true;
    }

    /** @returns {number} States the installed palette covers; 0 before {@link setStatePalette}. */
    get statePaletteSize() {
        return this._statePaletteSize;
    }

    /**
     * Draw one generation of a k-state world.
     *
     * @param {Uint8Array} cells `numCells` state values in `0..k`. This is `HexCA.state` — a view
     *   straight into wasm linear memory, uploaded without a copy exactly as `draw(sim)` does.
     * @returns {boolean} False when there is no palette yet (nothing was drawn).
     */
    drawStates(cells) {
        const gl = this.gl;
        if (!this._stateProgram || !this._statePaletteSize) return false;
        if (!cells || cells.length !== this.numCells) return false;
        if (!this._hexSize) this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);

        WebGLUtils.updateBuffer(gl, this.stateBuffer, gl.ARRAY_BUFFER, cells);

        gl.clearColor(BACKGROUND_COLOR[0], BACKGROUND_COLOR[1], BACKGROUND_COLOR[2], BACKGROUND_COLOR[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this._stateProgram);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._statePaletteTexture);
        gl.uniform1i(this._stateUniforms.statePalette, 1);

        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);
        gl.bindVertexArray(null);
        return true;
    }

    /**
     * Compile + link the k-state program on first use, and allocate its palette texture.
     * @returns {boolean} False if it could not be built.
     */
    _ensureStateProgram() {
        if (this._stateProgram) return true;
        const gl = this.gl;
        const program = WebGLUtils.loadShaderProgram(gl, stateVertexShaderSource, stateFragmentShaderSource);
        if (!program) {
            console.warn('<hexlife-ca>: state shaders failed to compile.');
            return false;
        }
        this._stateProgram = program;
        this._stateUniforms = {
            resolution: gl.getUniformLocation(program, 'u_resolution'),
            hexSize: gl.getUniformLocation(program, 'u_hexSize'),
            pan: gl.getUniformLocation(program, 'u_pan'),
            zoom: gl.getUniformLocation(program, 'u_zoom'),
            states: gl.getUniformLocation(program, 'u_states'),
            statePalette: gl.getUniformLocation(program, 'u_statePalette'),
        };
        this._statePaletteTexture = gl.createTexture();

        // The fit and the camera were pushed to `this.program` before this program existed; replay
        // them, or the first frame draws with zeroed uniforms.
        gl.useProgram(program);
        gl.uniform1f(this._stateUniforms.zoom, 1.0);
        if (this._hexSize) {
            const fitW = this._layout ? this._tiles[0].w : this.canvas.width;
            const fitH = this._layout ? this._tiles[0].h : this.canvas.height;
            gl.uniform2f(this._stateUniforms.resolution, fitW, fitH);
            gl.uniform1f(this._stateUniforms.hexSize, this._hexSize);
            this._uploadView();
        }
        return true;
    }

    /**
     * Map a CSS-pixel point on the canvas to a grid cell (odd-q flat-top, matching the shader).
     * Returns null if the pointer is outside the canvas or the camera isn't ready.
     * @param {number} cssX clientX relative to canvas left (CSS px)
     * @param {number} cssY clientY relative to canvas top (CSS px)
     * @returns {{col: number, row: number}|null}
     */
    hitTest(cssX, cssY) {
        if (!this._hexSize || !this._center || !this._cssWidth || !this._cssHeight) return null;
        const dprX = this.canvas.width / this._cssWidth;
        const dprY = this.canvas.height / this._cssHeight;
        const z = this._viewZoom || 1;
        // Inverse of the vertex transform: (pos - pan) * zoom + res/2  (in backing-store px).
        const sx = cssX * dprX;
        const sy = cssY * dprY;
        const worldPanX = this._center.x - (this._viewPanX * dprX) / z;
        const worldPanY = this._center.y - (this._viewPanY * dprY) / z;
        const worldX = (sx - this.canvas.width / 2) / z + worldPanX;
        const worldY = (sy - this.canvas.height / 2) / z + worldPanY;

        const hexSize = this._hexSize;
        const horizSpacing = (2 * hexSize * 3) / 4;
        const vertSpacing = Math.sqrt(3) * hexSize;

        // Approximate col from x, then row accounting for odd-column stagger.
        let col = Math.round(worldX / horizSpacing);
        if (!this._repeatToroidal) col = Math.max(0, Math.min(this.cols - 1, col));
        const yOffset = col % 2 !== 0 ? vertSpacing / 2 : 0;
        let row = Math.round((worldY - yOffset) / vertSpacing);
        if (!this._repeatToroidal) row = Math.max(0, Math.min(this.rows - 1, row));

        // Refine among the approximate cell and its neighbors (hex centers aren't on a square lattice).
        let best = null;
        let bestDist = Infinity;
        for (let dc = -1; dc <= 1; dc++) {
            for (let dr = -1; dr <= 1; dr++) {
                const c = col + dc;
                const r = row + dr;
                if (!this._repeatToroidal && (c < 0 || r < 0 || c >= this.cols || r >= this.rows)) continue;
                const p = gridToPixel(c, r, hexSize);
                const d = (p.x - worldX) ** 2 + (p.y - worldY) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    best = {
                        col: this._repeatToroidal ? ((c % this.cols) + this.cols) % this.cols : c,
                        row: this._repeatToroidal ? ((r % this.rows) + this.rows) % this.rows : r,
                    };
                }
            }
        }
        // Reject hits far outside any hex (roughly beyond one hex radius²).
        if (!best || bestDist > (hexSize * 1.15) ** 2) return null;
        return best;
    }

    /**
     * Draw the sim's current generation. One instanced call over every cell.
     * @param {import('./EmbedSim.js').EmbedSim} sim
     */
    draw(sim) {
        const gl = this.gl;
        if (!this._hexSize) this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);

        if (this._torusEnabled && this._torusProgram) {
            this._drawTorus(sim);
            return;
        }

        // The views are windows onto wasm memory — upload straight from them, no copy.
        WebGLUtils.updateBuffer(gl, this.stateBuffer, gl.ARRAY_BUFFER, sim.state);
        WebGLUtils.updateBuffer(gl, this.ruleIndexBuffer, gl.ARRAY_BUFFER, sim.ruleIndices);

        this.drawCurrent();
    }

    /** Draw the already-uploaded external state without touching either state buffer. */
    drawCurrent() {
        const gl = this.gl;
        if (!this._hexSize) this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);

        gl.clearColor(BACKGROUND_COLOR[0], BACKGROUND_COLOR[1], BACKGROUND_COLOR[2], BACKGROUND_COLOR[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.uniform1i(this.uniforms.colorLUT, 1);

        if (this._repeatToroidal) {
            const offsets = repeatOffsetsForViewport(
                this.canvas.width,
                this.canvas.height,
                this._viewZoom,
                this._repeatPeriod.x,
                this._repeatPeriod.y,
                this._hexSize,
            );
            for (const offset of offsets) {
                gl.uniform2f(this.uniforms.repeatOffset, offset.x, offset.y);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);
            }
            gl.uniform2f(this.uniforms.repeatOffset, 0, 0);
        } else {
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);
        }
        gl.bindVertexArray(null);
    }

    /** Drop every GL object. Called on element disconnect. */
    destroy() {
        const gl = this.gl;
        gl.deleteBuffer(this.positionBuffer);
        gl.deleteBuffer(this.offsetBuffer);
        gl.deleteBuffer(this.stateBuffer);
        gl.deleteBuffer(this.ruleIndexBuffer);
        if (this.hoverBuffer) gl.deleteBuffer(this.hoverBuffer);
        if (this.ghostBuffer) gl.deleteBuffer(this.ghostBuffer);
        gl.deleteVertexArray(this.vao);
        gl.deleteTexture(this.lutTexture);
        gl.deleteProgram(this.program);
        if (this._torusProgram) {
            gl.deleteProgram(this._torusProgram);
            this._torusProgram = null;
            this._torusUniforms = null;
        }
        if (this._stateProgram) {
            gl.deleteProgram(this._stateProgram);
            this._stateProgram = null;
            this._stateUniforms = null;
        }
        if (this._statePaletteTexture) {
            gl.deleteTexture(this._statePaletteTexture);
            this._statePaletteTexture = null;
            this._statePaletteSize = 0;
        }
    }
}
