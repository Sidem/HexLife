/**
 * Instanced HCP site renderer. Positions are computed in the vertex shader from
 * `gl_InstanceID`; the only per-frame traffic is the live state view.
 *
 * Do not fork the spacetime raymarcher. This is a 3D lattice, not a 2D history.
 */

import {lookAt, multiply, perspective} from '../rendering/mat4.js';

const SQRT3 = Math.sqrt(3);
const SQRT2 = Math.sqrt(2);
const TAU = Math.PI * 2;

export const HCP_CAMERA = Object.freeze({
    yaw: 0.55,
    pitch: 0.42,
    distance: 2.6,
    minDistance: 0.9,
    maxDistance: 8,
    fovY: Math.PI / 5,
    near: 0.05,
    far: 40,
});

const ORBIT_RADIANS_PER_PIXEL = 0.008;
const DOLLY_PER_WHEEL_UNIT = 0.001;

const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
uniform int u_cols;
uniform int u_rows;
uniform int u_layers;
uniform float u_hexSize;
uniform mat4 u_viewProj;
uniform highp usampler3D u_state;
uniform vec3 u_palette[16];
out vec3 v_color;
out vec3 v_world;
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
        v_world = vec3(0.0);
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
    float z = float(layer) * ${SQRT2.toFixed(8)} * R;
    vec3 center = vec3(x, z, y);
    v_world = center + a_position * R * 0.82;
    v_color = u_palette[int(state)];
    gl_Position = u_viewProj * vec4(v_world, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;
uniform vec4 u_clipPlane;
in vec3 v_color;
in vec3 v_world;
in float v_alive;
out vec4 outColor;
void main() {
    if (v_alive < 0.5) discard;
    if (dot(vec4(v_world, 1.0), u_clipPlane) < 0.0) discard;
    vec3 light = normalize(vec3(0.25, 0.8, 0.35));
    vec3 dx = dFdx(v_world);
    vec3 dy = dFdy(v_world);
    vec3 normal = normalize(cross(dx, dy));
    float lambert = 0.35 + 0.65 * max(dot(normal, light), 0.0);
    outColor = vec4(v_color * lambert, 1.0);
}
`;

function icosahedron() {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map((p) => {
        const len = Math.hypot(p[0], p[1], p[2]) || 1;
        return [p[0] / len, p[1] / len, p[2] / len];
    });
    const faces = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const verts = new Float32Array(faces.length * 9);
    let offset = 0;
    for (const face of faces) {
        for (const index of face) {
            verts[offset++] = raw[index][0];
            verts[offset++] = raw[index][1];
            verts[offset++] = raw[index][2];
        }
    }
    return verts;
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

export class HcpRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{layers: number, rows: number, columns: number, background?: string,
     *   controls?: boolean, autoRotate?: boolean, camera?: object}} options
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
        this._dirty = true;
        this._clip = 0.02;
        this._palette = new Float32Array(16 * 3);
        this._dragging = false;
        this._lastX = 0;
        this._lastY = 0;

        const gl = canvas.getContext('webgl2', {alpha: this._background[3] < 1, antialias: true});
        if (!gl) throw new Error('HcpRenderer: WebGL2 is required.');
        this.gl = gl;

        const vs = compile(gl, gl.VERTEX_SHADER, VS);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(`HCP program: ${gl.getProgramInfoLog(program)}`);
        }
        this.program = program;
        this.uniforms = {
            cols: gl.getUniformLocation(program, 'u_cols'),
            rows: gl.getUniformLocation(program, 'u_rows'),
            layers: gl.getUniformLocation(program, 'u_layers'),
            hexSize: gl.getUniformLocation(program, 'u_hexSize'),
            viewProj: gl.getUniformLocation(program, 'u_viewProj'),
            state: gl.getUniformLocation(program, 'u_state'),
            palette: gl.getUniformLocation(program, 'u_palette'),
            clipPlane: gl.getUniformLocation(program, 'u_clipPlane'),
        };

        const verts = icosahedron();
        this._vertCount = verts.length / 3;
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

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
            new Uint8Array(this.numCells),
        );

        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);

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

    /** @param {Array<ArrayLike<number>>} colors */
    setPalette(colors) {
        this._palette.fill(0);
        const count = Math.min(16, colors?.length || 0);
        for (let i = 0; i < count; i++) {
            this._palette[i * 3] = (colors[i][0] || 0) / 255;
            this._palette[i * 3 + 1] = (colors[i][1] || 0) / 255;
            this._palette[i * 3 + 2] = (colors[i][2] || 0) / 255;
        }
        this._dirty = true;
    }

    /** @param {number} t 0 = closed, 1 = fully open slab */
    setClip(t) {
        this._clip = Math.min(1, Math.max(0, Number(t) || 0));
        this._dirty = true;
    }

    markDirty() {
        this._dirty = true;
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
            this._dirty = true;
        }
        this.gl.viewport(0, 0, w, h);
    }

    /**
     * @param {Uint8Array} state
     * @param {{dtMs?: number}} [options]
     */
    draw(state, options = {}) {
        const rotating = this.autoRotate && !this._dragging;
        if (rotating) {
            this._yaw = ((this._yaw + (options.dtMs || 16) * 0.00025) % TAU + TAU) % TAU;
            this._dirty = true;
        }
        if (!this._dirty && !rotating) return false;

        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_3D, this.stateTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(
            gl.TEXTURE_3D, 0,
            0, 0, 0,
            this.columns, this.rows, this.layers,
            gl.RED_INTEGER, gl.UNSIGNED_BYTE,
            state,
        );

        const aspect = this.canvas.width / Math.max(1, this.canvas.height);
        const proj = perspective(HCP_CAMERA.fovY, aspect, HCP_CAMERA.near, HCP_CAMERA.far);
        const cx = this._center[0];
        const cy = this._center[1];
        const cz = this._center[2];
        const span = Math.max(this._center[0], this._center[1], this._center[2]) * 2;
        const dist = this._distance * span;
        const cosP = Math.cos(this._pitch);
        const eye = [
            cx + Math.sin(this._yaw) * cosP * dist,
            cy + Math.sin(this._pitch) * dist,
            cz + Math.cos(this._yaw) * cosP * dist,
        ];
        const view = lookAt(eye, this._center, [0, 1, 0]);
        const viewProj = multiply(proj, view);

        const clipX = this._center[0] + (this._clip * 2 - 1) * this._center[0];

        gl.useProgram(this.program);
        gl.bindVertexArray(this.vao);
        gl.uniform1i(this.uniforms.cols, this.columns);
        gl.uniform1i(this.uniforms.rows, this.rows);
        gl.uniform1i(this.uniforms.layers, this.layers);
        gl.uniform1f(this.uniforms.hexSize, 1);
        gl.uniformMatrix4fv(this.uniforms.viewProj, false, viewProj);
        gl.uniform1i(this.uniforms.state, 0);
        gl.uniform3fv(this.uniforms.palette, this._palette);
        gl.uniform4f(this.uniforms.clipPlane, 1, 0, 0, -clipX);
        gl.clearColor(this._background[0], this._background[1], this._background[2], this._background[3]);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, this._vertCount, this.numCells);
        this._dirty = rotating;
        return true;
    }

    restoreContext() {
        this._dirty = true;
    }

    dispose() {
        const canvas = this.canvas;
        canvas.removeEventListener('pointerdown', this._onPointerDown);
        canvas.removeEventListener('pointermove', this._onPointerMove);
        canvas.removeEventListener('pointerup', this._onPointerUp);
        canvas.removeEventListener('wheel', this._onWheel);
        const gl = this.gl;
        if (gl) {
            gl.deleteTexture(this.stateTex);
            gl.deleteBuffer(this.vbo);
            gl.deleteVertexArray(this.vao);
            gl.deleteProgram(this.program);
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
        this._dirty = true;
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
        this._dirty = true;
    }
}
