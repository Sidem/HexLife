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
 * The shaders expect hover and ghost attributes. The embed has neither, and both are neutral at 0
 * (see fragment.glsl), so we leave those attribute arrays *disabled* and feed the constant 0 —
 * cheaper than uploading two more per-cell buffers, and it avoids forking the GLSL.
 */

import * as WebGLUtils from '../rendering/webglUtils.js';
import { generateColorLUT } from '../utils/ruleVizUtils.js';
import { PRESET_PALETTES } from '../core/colorPalettes.js';
import { precomputeSymmetryGroups } from '../core/Symmetry.js';

// eslint-disable-next-line import/no-unresolved
import hexVertexShaderSource from '../../shaders/vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import hexFragmentShaderSource from '../../shaders/fragment.glsl?raw';

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
function fitHexSize(cols, rows, width, height) {
    const gridPixelWidth = cols * ((HEX_WIDTH * 3) / 4) + HEX_WIDTH / 4;
    const gridPixelHeight = rows * HEX_HEIGHT + HEX_HEIGHT / 2;
    if (gridPixelWidth === 0 || gridPixelHeight === 0) return HEX_SIZE;
    const scale = Math.min(width / gridPixelWidth, height / gridPixelHeight) * 0.98;
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
     * @throws {Error} If WebGL2 is unavailable — the caller renders a fallback note instead.
     */
    constructor(canvas, { cols, rows, palette = 'default', customGradient = null, colorSettings = null, lut = null }) {
        this.canvas = canvas;
        this.cols = cols;
        this.rows = rows;
        this.numCells = cols * rows;

        const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
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
        };

        this._setupGeometry();
        this._setupLUT({ palette, customGradient, colorSettings, lut });

        // Set once — these never change for an embed (no hover, fixed camera).
        gl.useProgram(this.program);
        gl.uniform1f(this.uniforms.hoverFilledDarkenFactor, 0.66);
        gl.uniform1f(this.uniforms.hoverInactiveLightenFactor, 1.5);
        gl.uniform1f(this.uniforms.zoom, 1.0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        this._hexSize = 0;
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

        // No hover / ghost buffers: leave the arrays disabled and supply the constant 0, which both
        // shaders treat as "neither highlighted nor ghosted".
        gl.disableVertexAttribArray(this.attribs.instanceHoverState);
        gl.disableVertexAttribArray(this.attribs.instanceGhostState);
        gl.vertexAttrib1f(this.attribs.instanceHoverState, 0);
        gl.vertexAttrib1f(this.attribs.instanceGhostState, 0);

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
     * Resolve whichever palette form the caller supplied into the 128×2 RGBA table the shader samples.
     * Precedence: a decoded world's `colorSettings`, then a baked `lut`, then the element's
     * `palette-on/off` gradient attributes, then the `palette` preset name.
     * @param {{palette?: string, customGradient?: object|null, colorSettings?: object|null,
     *   lut?: Uint8Array|null}} opts
     * @returns {Uint8Array}
     */
    _buildLUT({ palette = 'default', customGradient = null, colorSettings = null, lut = null }) {
        if (colorSettings) return generateColorLUT(colorSettings, SYMMETRY_DATA);
        if (lut && lut.length === 128 * 2 * 4) return lut;
        if (customGradient) {
            return generateColorLUT({ mode: 'gradient', customGradient, hueShift: 0 }, SYMMETRY_DATA);
        }
        let activePreset = palette;
        if (!PRESET_PALETTES[activePreset]) {
            if (activePreset !== 'default') {
                console.warn(`<hexlife-world>: unknown palette "${palette}", using "default".`);
            }
            activePreset = 'default';
        }
        return generateColorLUT(
            { mode: 'preset', activePreset, flickerProofPresets: false, hueShift: 0 },
            SYMMETRY_DATA,
        );
    }

    /**
     * Swap the palette on a live renderer (no sim disruption — the LUT is a pure recolor).
     * @param {{palette?: string, customGradient?: object|null, colorSettings?: object|null,
     *   lut?: Uint8Array|null}} opts
     */
    setPalette(opts) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RGBA, gl.UNSIGNED_BYTE,
            this._buildLUT(opts));
        gl.bindTexture(gl.TEXTURE_2D, null);
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
        if (this.canvas.width === w && this.canvas.height === h) return;

        this.canvas.width = w;
        this.canvas.height = h;

        this._hexSize = fitHexSize(this.cols, this.rows, w, h);
        this._rebuildOffsets(this._hexSize);
        this._center = gridCenter(this.cols, this.rows, this._hexSize);

        const gl = this.gl;
        gl.viewport(0, 0, w, h);
        gl.useProgram(this.program);
        gl.uniform2f(this.uniforms.resolution, w, h);
        gl.uniform1f(this.uniforms.hexSize, this._hexSize);
        gl.uniform2f(this.uniforms.pan, this._center.x, this._center.y);
    }

    /**
     * Draw the sim's current generation. One instanced call over every cell.
     * @param {import('./EmbedSim.js').EmbedSim} sim
     */
    draw(sim) {
        const gl = this.gl;
        if (!this._hexSize) this.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1);

        gl.clearColor(BACKGROUND_COLOR[0], BACKGROUND_COLOR[1], BACKGROUND_COLOR[2], BACKGROUND_COLOR[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
        gl.uniform1i(this.uniforms.colorLUT, 1);

        // The views are windows onto wasm memory — upload straight from them, no copy.
        WebGLUtils.updateBuffer(gl, this.stateBuffer, gl.ARRAY_BUFFER, sim.state);
        WebGLUtils.updateBuffer(gl, this.ruleIndexBuffer, gl.ARRAY_BUFFER, sim.ruleIndices);

        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, this.numCells);
        gl.bindVertexArray(null);
    }

    /** Drop every GL object. Called on element disconnect. */
    destroy() {
        const gl = this.gl;
        gl.deleteBuffer(this.positionBuffer);
        gl.deleteBuffer(this.offsetBuffer);
        gl.deleteBuffer(this.stateBuffer);
        gl.deleteBuffer(this.ruleIndexBuffer);
        gl.deleteVertexArray(this.vao);
        gl.deleteTexture(this.lutTexture);
        gl.deleteProgram(this.program);
    }
}
