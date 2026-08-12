/**
 * A minimal WebGL2 stand-in that RECORDS every call instead of drawing.
 *
 * Written for #40 §8, which asks for the zero-cost-when-off contract as tests rather than as claims.
 * Two of its three assertions are about GL: that the flat path's call sequence is unchanged, and
 * that leaving the mode really deletes the texture. Both are questions about what was called, in
 * what order, with what arguments — which is exactly what this captures and a mocked-out renderer
 * cannot answer.
 *
 * Every `create*` returns a fresh tagged object so allocation and deletion can be paired up;
 * `getParameter` answers with plausible desktop limits.
 */
export function createRecordingGL(overrides = {}) {
    const calls = [];
    /** Live GL objects by kind, so a leak shows up as something never deleted. */
    const live = new Map();
    let nextId = 1;

    const constants = {
        TEXTURE_2D: 0x0de1,
        TEXTURE_2D_ARRAY: 0x8c1a,
        R8UI: 0x8232,
        RED_INTEGER: 0x8d94,
        UNSIGNED_BYTE: 0x1401,
        RGBA: 0x1908,
        TRIANGLES: 0x0004,
        NEAREST: 0x2600,
        CLAMP_TO_EDGE: 0x812f,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        UNPACK_ALIGNMENT: 0x0cf5,
        MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
        TEXTURE0: 0x84c0,
        TEXTURE1: 0x84c1,
        DEPTH_TEST: 0x0b71,
        CULL_FACE: 0x0b44,
        BLEND: 0x0be2,
        ONE: 1,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
    };

    const record = (name, args) => calls.push({ name, args });

    const make = (kind) => {
        const object = { __kind: kind, __id: nextId++ };
        live.set(object, kind);
        return object;
    };

    const gl = {
        ...constants,
        canvas: { width: 1280, height: 800 },
        calls,

        createTexture: () => { record('createTexture', []); return make('texture'); },
        deleteTexture: (t) => { record('deleteTexture', [t?.__id]); live.delete(t); },
        createProgram: () => { record('createProgram', []); return make('program'); },
        deleteProgram: (p) => { record('deleteProgram', [p?.__id]); live.delete(p); },
        createShader: () => make('shader'),
        deleteShader: () => {},
        shaderSource: () => {},
        compileShader: () => {},
        attachShader: () => {},
        linkProgram: () => {},
        useProgram: (p) => record('useProgram', [p?.__id]),
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        getShaderInfoLog: () => '',
        getProgramInfoLog: () => '',
        getUniformLocation: (_p, name) => ({ __kind: 'uniform', name }),

        bindTexture: (target, t) => record('bindTexture', [target, t?.__id ?? null]),
        bindVertexArray: (v) => record('bindVertexArray', [v?.__id ?? null]),
        activeTexture: (u) => record('activeTexture', [u]),
        texStorage3D: (...a) => record('texStorage3D', a),
        texSubImage3D: (target, level, x, y, z, w, h, d, fmt, type, data) =>
            record('texSubImage3D', [target, level, x, y, z, w, h, d, fmt, type, data?.length ?? 0]),
        texParameteri: (...a) => record('texParameteri', a),
        pixelStorei: (...a) => record('pixelStorei', a),
        viewport: (...a) => record('viewport', a),
        enable: (c) => record('enable', [c]),
        disable: (c) => record('disable', [c]),
        blendFunc: (...a) => record('blendFunc', a),
        drawArrays: (...a) => record('drawArrays', a),
        readPixels: () => record('readPixels', []),

        uniform1i: (u, v) => record('uniform1i', [u?.name, v]),
        uniform1f: (u, v) => record('uniform1f', [u?.name, v]),
        uniform2i: (u, ...v) => record('uniform2i', [u?.name, ...v]),
        uniform2f: (u, ...v) => record('uniform2f', [u?.name, ...v]),
        uniform2fv: (u, v) => record('uniform2fv', [u?.name, Array.from(v)]),
        uniform3fv: (u, v) => record('uniform3fv', [u?.name, Array.from(v)]),

        getParameter: (p) => (p === constants.MAX_ARRAY_TEXTURE_LAYERS ? 2048 : 0),

        /** GL objects created and not yet deleted, by kind. */
        liveObjects() {
            const counts = {};
            for (const kind of live.values()) counts[kind] = (counts[kind] || 0) + 1;
            return counts;
        },
        /** Just the call names, which is the granularity a sequence comparison wants. */
        sequence() {
            return calls.map((c) => c.name);
        },
        callsNamed(name) {
            return calls.filter((c) => c.name === name);
        },
        clear() {
            calls.length = 0;
        },
        ...overrides,
    };
    return gl;
}
