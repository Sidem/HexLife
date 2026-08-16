/**
 * Instanced HCP site renderer. Positions are computed in the vertex shader from
 * `gl_InstanceID`; the only per-frame traffic is the live state view.
 *
 * Occupied sites are sphere impostors (a camera-facing quad + a ray-sphere hit), which is
 * the HCP packing primitive and cheaper than a tessellated prism (2 triangles, not 24).
 * Do not fork the spacetime raymarcher — this is a 3D lattice, not a 2D history.
 */

import {lookAt, multiply, perspective} from '../rendering/mat4.js';

const SQRT3 = Math.sqrt(3);
const SQRT2 = Math.sqrt(2);
const TAU = Math.PI * 2;

/**
 * Sphere radius as a multiple of hex circumradius `R`. Neighbours sit at `√3 R`, so
 * `√3 / 2` makes neighbouring grains touch. The leftover holes are HCP interstices.
 */
export const SITE_SCALE = SQRT3 / 2;

/** Opacity at or above this is a single solid depth pass. */
export const OPAQUE_OPACITY = 0.999;

/** Front-to-back peels when see-through: each grain behind the last can still land. */
export const PEEL_LAYERS = 8;

export const HCP_CAMERA = Object.freeze({
    yaw: 0.28,
    pitch: 0.58,
    distance: 1.15,
    minDistance: 0.55,
    maxDistance: 8,
    fovY: Math.PI / 5,
    near: 0.05,
    far: 40,
});

/** World-space height of a layer. Layer 0 (shower) is the highest. */
export function visualHeight(layer, layers, hexSize = 1) {
    return (layers - 1 - layer) * SQRT2 * hexSize;
}

/**
 * Near/far planes that actually contain a volume of `span` viewed from `distance`.
 * A fixed far of 40 clips a demo-size puck (span ≈ 80, camera ≈ 90+) entirely.
 */
export function cameraDepths(distance, span) {
    const reach = Math.max(1, Number(distance) || 0) + Math.max(1, Number(span) || 0) * 2;
    return {
        near: Math.max(0.05, reach * 0.002),
        far: reach,
    };
}

const ORBIT_RADIANS_PER_PIXEL = 0.008;
const DOLLY_PER_WHEEL_UNIT = 0.001;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
uniform int u_cols;
uniform int u_rows;
uniform int u_layers;
uniform float u_hexSize;
uniform mat4 u_viewProj;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform highp usampler3D u_state;
uniform vec3 u_palette[16];
out vec3 v_color;
out vec3 v_center;
out vec3 v_quad;
out float v_radius;
out float v_alive;

void main() {
    int id = gl_InstanceID;
    int cols = u_cols;
    int rows = u_rows;
    int col = id % cols;
    int tmp = id / cols;
    int row = tmp % rows;
    int layer = tmp / rows;
    uint state = texelFetch(u_state, ivec3(col, row, layer), 0).r;
    if (state == 0u) {
        v_alive = 0.0;
        v_color = vec3(0.0);
        v_center = vec3(0.0);
        v_quad = vec3(0.0);
        v_radius = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    v_alive = 1.0;
    float R = u_hexSize;
    float x = float(col) * 1.5 * R;
    float y = float(row) * ${SQRT3.toFixed(8)} * R;
    if ((col & 1) != 0) y += 0.5 * ${SQRT3.toFixed(8)} * R;
    if ((layer & 1) != 0) {
        x += 0.5 * R;
        y += 0.5 * ${SQRT3.toFixed(8)} * R;
    }
    // Layer 0 is the shower / open face. Draw it at the TOP so gravity (+layer) is down.
    float z = float(u_layers - 1 - layer) * ${SQRT2.toFixed(8)} * R;
    vec3 center = vec3(x, z, y);
    float radius = R * ${SITE_SCALE.toFixed(8)};
    vec3 quad = center + (u_camRight * a_corner.x + u_camUp * a_corner.y) * (radius * 1.05);
    v_center = center;
    v_quad = quad;
    v_radius = radius;
    v_color = u_palette[int(state)];
    gl_Position = u_viewProj * vec4(quad, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_clipPlane;
uniform float u_opacity;
uniform vec3 u_cameraPos;
uniform mat4 u_viewProj;
uniform int u_peelIndex;
uniform sampler2D u_prevDepth;
in vec3 v_color;
in vec3 v_center;
in vec3 v_quad;
in float v_radius;
in float v_alive;
out vec4 outColor;

void main() {
    if (v_alive < 0.5) discard;
    vec3 ro = u_cameraPos;
    vec3 rd = normalize(v_quad - ro);
    vec3 oc = ro - v_center;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - v_radius * v_radius;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float s = sqrt(disc);
    float t = -b - s;
    if (t < 0.0) t = -b + s;
    if (t < 0.0) discard;
    vec3 hit = ro + rd * t;
    if (dot(vec4(hit, 1.0), u_clipPlane) < 0.0) discard;
    vec4 clip = u_viewProj * vec4(hit, 1.0);
    float depth = clip.z / clip.w * 0.5 + 0.5;
    gl_FragDepth = depth;
    if (u_peelIndex > 0) {
        float prev = texelFetch(u_prevDepth, ivec2(gl_FragCoord.xy), 0).r;
        if (depth <= prev + 1e-4) discard;
    }
    vec3 normal = normalize(hit - v_center);
    vec3 light = normalize(vec3(0.25, 0.8, 0.35));
    float lambert = 0.35 + 0.65 * max(dot(normal, light), 0.0);
    vec3 lit = v_color * lambert;
    outColor = vec4(lit * u_opacity, u_opacity);
}
`;

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
    v_uv = a_corner * 0.5 + 0.5;
    gl_Position = vec4(a_corner, 0.0, 1.0);
}
`;

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
in vec2 v_uv;
out vec4 outColor;
void main() {
    outColor = texture(u_src, v_uv);
}
`;

const FINAL_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec4 u_background;
in vec2 v_uv;
out vec4 outColor;
void main() {
    vec4 layer = texture(u_src, v_uv);
    outColor = vec4(layer.rgb + u_background.rgb * (1.0 - layer.a), u_background.a);
}
`;

function impostorQuad() {
    return new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
    ]);
}

function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`HCP shader: ${log}`);
    }
    return shader;
}

function link(gl, vsSource, fsSource) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`HCP program: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
}

function parseBackground(background) {
    if (background === null || background === 'transparent') return [0, 0, 0, 0];
    if (Array.isArray(background)) {
        const [r = 0, g = 0, b = 0, a = 1] = background;
        return [r, g, b, a];
    }
    const hex = String(background).trim().replace(/^#/, '');
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return [0.1, 0.1, 0.1, 1];
    return [
        parseInt(full.slice(0, 2), 16) / 255,
        parseInt(full.slice(2, 4), 16) / 255,
        parseInt(full.slice(4, 6), 16) / 255,
        1,
    ];
}

function makeColorTex(gl, width, height) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
}

function makeDepthTex(gl, width, height) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F,
        width, height, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null,
    );
    return tex;
}

export class HcpRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{layers: number, rows: number, columns: number, background?: string,
     *   controls?: boolean, autoRotate?: boolean, camera?: object,
     *   onInvalidate?: () => void}} options
     */
    constructor(canvas, options) {
        this.canvas = canvas;
        this.layers = options.layers;
        this.rows = options.rows;
        this.columns = options.columns;
        this.numCells = this.layers * this.rows * this.columns;
        this._background = parseBackground(options.background ?? '#1a1a1a');
        this._controls = options.controls !== false;
        this.autoRotate = !!options.autoRotate;
        this._yaw = options.camera?.yaw ?? HCP_CAMERA.yaw;
        this._pitch = options.camera?.pitch ?? HCP_CAMERA.pitch;
        this._distance = options.camera?.distance ?? HCP_CAMERA.distance;
        this._frameDirty = true;
        this._stateDirty = true;
        this._onInvalidate = options.onInvalidate || null;
        this._clip = 0.02;
        this._opacity = 1;
        this._palette = new Float32Array(16 * 3);
        this._dragging = false;
        this._lastX = 0;
        this._lastY = 0;
        this._targetW = 0;
        this._targetH = 0;

        const gl = canvas.getContext('webgl2', {alpha: this._background[3] < 1, antialias: true});
        if (!gl) throw new Error('HcpRenderer: WebGL2 is required.');
        this.gl = gl;

        this.program = link(gl, VS, FS);
        this.uniforms = {
            cols: gl.getUniformLocation(this.program, 'u_cols'),
            rows: gl.getUniformLocation(this.program, 'u_rows'),
            layers: gl.getUniformLocation(this.program, 'u_layers'),
            hexSize: gl.getUniformLocation(this.program, 'u_hexSize'),
            viewProj: gl.getUniformLocation(this.program, 'u_viewProj'),
            camRight: gl.getUniformLocation(this.program, 'u_camRight'),
            camUp: gl.getUniformLocation(this.program, 'u_camUp'),
            cameraPos: gl.getUniformLocation(this.program, 'u_cameraPos'),
            state: gl.getUniformLocation(this.program, 'u_state'),
            palette: gl.getUniformLocation(this.program, 'u_palette'),
            clipPlane: gl.getUniformLocation(this.program, 'u_clipPlane'),
            opacity: gl.getUniformLocation(this.program, 'u_opacity'),
            peelIndex: gl.getUniformLocation(this.program, 'u_peelIndex'),
            prevDepth: gl.getUniformLocation(this.program, 'u_prevDepth'),
        };

        this.blitProgram = link(gl, QUAD_VS, BLIT_FS);
        this.blitSrc = gl.getUniformLocation(this.blitProgram, 'u_src');
        this.finalProgram = link(gl, QUAD_VS, FINAL_FS);
        this.finalSrc = gl.getUniformLocation(this.finalProgram, 'u_src');
        this.finalBackground = gl.getUniformLocation(this.finalProgram, 'u_background');

        const verts = impostorQuad();
        this._vertCount = verts.length / 2;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        this.quadVao = gl.createVertexArray();
        gl.bindVertexArray(this.quadVao);
        this.quadVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        this.stateTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, this.stateTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texImage3D(
            gl.TEXTURE_3D, 0, gl.R8UI,
            this.columns, this.rows, this.layers,
            0, gl.RED_INTEGER, gl.UNSIGNED_BYTE,
            null,
        );

        this._peelFbo = null;
        this._accumFbo = null;
        this._prevDepthFbo = null;
        this._peelColor = null;
        this._peelDepth = null;
        this._accumColor = null;
        this._prevDepth = null;

        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onWheel = this._onWheel.bind(this);
        if (this._controls) {
            canvas.addEventListener('pointerdown', this._onPointerDown);
            canvas.addEventListener('wheel', this._onWheel, {passive: false});
        }

        this._center = this._volumeCenter();
    }

    _volumeCenter() {
        const R = 1;
        const width = (this.columns - 1) * 1.5 * R + R;
        const depth = (this.rows - 1) * SQRT3 * R + SQRT3 * R;
        const height = (this.layers - 1) * SQRT2 * R;
        return [width / 2, height / 2, depth / 2];
    }

    _deleteTargets() {
        const gl = this.gl;
        if (!gl) return;
        if (this._peelColor) gl.deleteTexture(this._peelColor);
        if (this._peelDepth) gl.deleteTexture(this._peelDepth);
        if (this._accumColor) gl.deleteTexture(this._accumColor);
        if (this._prevDepth) gl.deleteTexture(this._prevDepth);
        if (this._peelFbo) gl.deleteFramebuffer(this._peelFbo);
        if (this._accumFbo) gl.deleteFramebuffer(this._accumFbo);
        if (this._prevDepthFbo) gl.deleteFramebuffer(this._prevDepthFbo);
        this._peelColor = this._peelDepth = this._accumColor = this._prevDepth = null;
        this._peelFbo = this._accumFbo = this._prevDepthFbo = null;
        this._targetW = 0;
        this._targetH = 0;
    }

    _ensureTargets(width, height) {
        if (this._targetW === width && this._targetH === height && this._peelFbo) return;
        const gl = this.gl;
        this._deleteTargets();
        this._peelColor = makeColorTex(gl, width, height);
        this._peelDepth = makeDepthTex(gl, width, height);
        this._accumColor = makeColorTex(gl, width, height);
        this._prevDepth = makeDepthTex(gl, width, height);

        this._peelFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._peelFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._peelColor, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._peelDepth, 0);

        this._accumFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._accumFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._accumColor, 0);

        this._prevDepthFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._prevDepthFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this._prevDepth, 0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this._targetW = width;
        this._targetH = height;
    }

    /** @param {Array<ArrayLike<number>>} colors */
    setPalette(colors) {
        this._palette.fill(0);
        const count = Math.min(16, colors?.length || 0);
        for (let i = 0; i < count; i++) {
            this._palette[i * 3] = (colors[i][0] || 0) / 255;
            this._palette[i * 3 + 1] = (colors[i][1] || 0) / 255;
            this._palette[i * 3 + 2] = (colors[i][2] || 0) / 255;
        }
        this._frameDirty = true;
    }

    /** @param {number} t 0 = closed, 1 = fully open slab */
    setClip(t) {
        this._clip = Math.min(1, Math.max(0, Number(t) || 0));
        this._frameDirty = true;
    }

    /**
     * Per-grain alpha in `0..1`. Below 1, later peels keep the grains behind the first,
     * so lowering the slider looks into the packed bed instead of ghosting the silhouette.
     */
    setOpacity(value) {
        const number = Number(value);
        this._opacity = Number.isFinite(number) ? Math.min(1, Math.max(0.04, number)) : 1;
        this._frameDirty = true;
    }

    /** @param {boolean} enabled */
    setAutoRotate(enabled) {
        this.autoRotate = !!enabled;
        this._frameDirty = true;
    }

    markDirty() {
        this._frameDirty = true;
    }

    /** Mark the volume contents dirty after native state mutation. */
    markStateDirty() {
        this._stateDirty = true;
        this._frameDirty = true;
    }

    /**
     * @param {number} width
     * @param {number} height
     * @param {number} [dpr]
     */
    resize(width, height, dpr = 1) {
        const ratio = Math.min(Math.max(dpr, 0.5), 2);
        const w = Math.max(1, Math.round(width * ratio));
        const h = Math.max(1, Math.round(height * ratio));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
            this._frameDirty = true;
        }
        this.gl.viewport(0, 0, w, h);
    }

    _bindSiteProgram(viewProj, eye, camRight, camUp, clipX, peelIndex) {
        const gl = this.gl;
        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, this.stateTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this._prevDepth);
        gl.uniform1i(this.uniforms.cols, this.columns);
        gl.uniform1i(this.uniforms.rows, this.rows);
        gl.uniform1i(this.uniforms.layers, this.layers);
        gl.uniform1f(this.uniforms.hexSize, 1);
        gl.uniformMatrix4fv(this.uniforms.viewProj, false, viewProj);
        gl.uniform3fv(this.uniforms.camRight, camRight);
        gl.uniform3fv(this.uniforms.camUp, camUp);
        gl.uniform3fv(this.uniforms.cameraPos, eye);
        gl.uniform1i(this.uniforms.state, 0);
        gl.uniform1i(this.uniforms.prevDepth, 1);
        gl.uniform3fv(this.uniforms.palette, this._palette);
        gl.uniform4f(this.uniforms.clipPlane, 1, 0, 0, -clipX);
        gl.uniform1f(this.uniforms.opacity, this._opacity);
        gl.uniform1i(this.uniforms.peelIndex, peelIndex);
    }

    /**
     * @param {Uint8Array} state
     * @param {{dtMs?: number}} [options]
     */
    draw(state, options = {}) {
        const rotating = this.autoRotate && !this._dragging;
        if (rotating) {
            this._yaw = ((this._yaw + (options.dtMs || 16) * 0.00025) % TAU + TAU) % TAU;
            this._frameDirty = true;
        }
        if (!this._frameDirty && !rotating) return false;

        const gl = this.gl;
        if (this._stateDirty) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_3D, this.stateTex);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texSubImage3D(
                gl.TEXTURE_3D, 0,
                0, 0, 0,
                this.columns, this.rows, this.layers,
                gl.RED_INTEGER, gl.UNSIGNED_BYTE,
                state,
            );
            this._stateDirty = false;
        }

        const aspect = this.canvas.width / Math.max(1, this.canvas.height);
        const cx = this._center[0];
        const cy = this._center[1];
        const cz = this._center[2];
        const span = Math.max(this._center[0], this._center[1], this._center[2], 1) * 2;
        const dist = this._distance * span;
        const depth = cameraDepths(dist, span);
        const proj = perspective(HCP_CAMERA.fovY, aspect, depth.near, depth.far);
        const cosP = Math.cos(this._pitch);
        const eye = [
            cx + Math.sin(this._yaw) * cosP * dist,
            cy + Math.sin(this._pitch) * dist,
            cz + Math.cos(this._yaw) * cosP * dist,
        ];
        const view = lookAt(eye, this._center, [0, 1, 0]);
        const viewProj = multiply(proj, view);
        const camRight = new Float32Array([view[0], view[4], view[8]]);
        const camUp = new Float32Array([view[1], view[5], view[9]]);
        const clipX = this._center[0] + (this._clip * 2 - 1) * this._center[0];

        const opaqueSurface = this._opacity >= OPAQUE_OPACITY;
        if (opaqueSurface) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            gl.clearColor(this._background[0], this._background[1], this._background[2], this._background[3]);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.disable(gl.BLEND);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LESS);
            gl.depthMask(true);
            gl.disable(gl.CULL_FACE);
            this._bindSiteProgram(viewProj, eye, camRight, camUp, clipX, 0);
            gl.uniform1f(this.uniforms.opacity, 1);
            gl.drawArraysInstanced(gl.TRIANGLES, 0, this._vertCount, this.numCells);
        } else {
            this._drawPeels(viewProj, eye, camRight, camUp, clipX);
        }

        this._frameDirty = rotating;
        return true;
    }

    _drawPeels(viewProj, eye, camRight, camUp, clipX) {
        const gl = this.gl;
        const width = this.canvas.width;
        const height = this.canvas.height;
        this._ensureTargets(width, height);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._accumFbo);
        gl.viewport(0, 0, width, height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const peels = PEEL_LAYERS;
        for (let peel = 0; peel < peels; peel++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._peelFbo);
            gl.viewport(0, 0, width, height);
            gl.disable(gl.BLEND);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LESS);
            gl.depthMask(true);
            gl.disable(gl.CULL_FACE);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            this._bindSiteProgram(viewProj, eye, camRight, camUp, clipX, peel);
            gl.drawArraysInstanced(gl.TRIANGLES, 0, this._vertCount, this.numCells);

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._peelFbo);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._prevDepthFbo);
            gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);

            gl.bindFramebuffer(gl.FRAMEBUFFER, this._accumFbo);
            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            // Front-to-back under: dest.a is coverage so far, remaining transmittance is 1 - dest.a.
            gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
            gl.useProgram(this.blitProgram);
            gl.bindVertexArray(this.quadVao);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this._peelColor);
            gl.uniform1i(this.blitSrc, 2);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(this.finalProgram);
        gl.bindVertexArray(this.quadVao);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this._accumColor);
        gl.uniform1i(this.finalSrc, 2);
        gl.uniform4f(
            this.finalBackground,
            this._background[0], this._background[1], this._background[2], this._background[3],
        );
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
    }

    restoreContext() {
        this._deleteTargets();
        this._frameDirty = true;
        this._stateDirty = true;
    }

    dispose() {
        const canvas = this.canvas;
        canvas.removeEventListener('pointerdown', this._onPointerDown);
        canvas.removeEventListener('pointermove', this._onPointerMove);
        canvas.removeEventListener('pointerup', this._onPointerUp);
        canvas.removeEventListener('wheel', this._onWheel);
        const gl = this.gl;
        if (gl) {
            this._deleteTargets();
            gl.deleteTexture(this.stateTex);
            gl.deleteBuffer(this.vbo);
            gl.deleteBuffer(this.quadVbo);
            gl.deleteVertexArray(this.vao);
            gl.deleteVertexArray(this.quadVao);
            gl.deleteProgram(this.program);
            gl.deleteProgram(this.blitProgram);
            gl.deleteProgram(this.finalProgram);
        }
    }

    _onPointerDown(event) {
        this._dragging = true;
        this._lastX = event.clientX;
        this._lastY = event.clientY;
        this.canvas.setPointerCapture(event.pointerId);
        this.canvas.addEventListener('pointermove', this._onPointerMove);
        this.canvas.addEventListener('pointerup', this._onPointerUp);
    }

    _onPointerMove(event) {
        const dx = event.clientX - this._lastX;
        const dy = event.clientY - this._lastY;
        this._lastX = event.clientX;
        this._lastY = event.clientY;
        this._yaw = ((this._yaw - dx * ORBIT_RADIANS_PER_PIXEL) % TAU + TAU) % TAU;
        this._pitch = Math.min(1.2, Math.max(-0.15, this._pitch + dy * ORBIT_RADIANS_PER_PIXEL));
        this._frameDirty = true;
        this._onInvalidate?.();
    }

    _onPointerUp(event) {
        this._dragging = false;
        this.canvas.releasePointerCapture(event.pointerId);
        this.canvas.removeEventListener('pointermove', this._onPointerMove);
        this.canvas.removeEventListener('pointerup', this._onPointerUp);
    }

    _onWheel(event) {
        event.preventDefault();
        const factor = 1 + event.deltaY * DOLLY_PER_WHEEL_UNIT;
        this._distance = Math.min(
            HCP_CAMERA.maxDistance,
            Math.max(HCP_CAMERA.minDistance, this._distance * factor),
        );
        this._frameDirty = true;
        this._onInvalidate?.();
    }
}
