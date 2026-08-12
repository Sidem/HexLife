import * as WebGLUtils from '../webglUtils.js';
import { lookAt, perspective } from '../mat4.js';
import { torusOrbitCamera } from '../torusMath.js';

// eslint-disable-next-line import/no-unresolved
import spacetimeVertexShaderSource from '../../../shaders/spacetime_vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import spacetimeFragmentShaderSource from '../../../shaders/spacetime_fragment.glsl?raw';

/**
 * #40 Spacetime View — the ray-march, with nothing of the Explorer in it.
 *
 * This module knows about a `SpacetimeVolume`, a camera and a colour LUT, and about nothing else:
 * no `Config` globals, no settings service, no event bus, no history ring. That is what lets the
 * *same* march serve two hosts — {@link module:SpacetimeView} inside the app, where the volume is
 * the worker's scrub ring, and `@hexlife/embed/spacetime` outside it, where the volume is whatever
 * layers a package consumer pushed.
 *
 * The split is deliberately drawn at the shaders: both hosts compile *these* two sources through
 * *this* uniform table, so a change to the march cannot land in one and miss the other. Everything
 * that differs between the hosts — where the depth cap comes from, who owns the canvas, what a
 * "tick" is — stays outside.
 */

const SQRT3 = Math.sqrt(3);

/** Framing of the object in the orbit camera's space (the camera sits 4.1–10 units out). */
const FOOTPRINT_HALF_EXTENT = 1.6;
const TIME_HALF_EXTENT = 2.2;
const FIELD_OF_VIEW_RADIANS = Math.PI * 42 / 180;

/**
 * The orbit camera the object is framed for — the same figures the torus view uses, because the two
 * projections share the app's orbit input strategy and must respond to a drag identically.
 *
 * The distance bounds are the framing: closer than `minDistance` the camera is inside a full-height
 * object, further than `maxDistance` it is a speck. A host that drives its own camera still wants
 * these to clamp against.
 */
export const SPACETIME_CAMERA = Object.freeze({
    fovY: FIELD_OF_VIEW_RADIANS,
    near: 0.1,
    far: 40,
    minDistance: 4.1,
    maxDistance: 10,
    yaw: 0.55,
    pitch: 0.42,
    distance: 6.5,
});

/**
 * How the march is sampled. Shared by both hosts; neither of them may fork these numbers, because
 * they are what the plan's measured frame time was measured *at* (#40 §6).
 */
export const SPACETIME_MARCH_DEFAULTS = Object.freeze({
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

/**
 * Compile the ray-march and look up every uniform once.
 *
 * The uniform table is the whole API surface between JavaScript and the shader, which is why it
 * lives here rather than in either host: a new uniform is added in one place and both hosts get it.
 *
 * @param {WebGL2RenderingContext} gl
 * @returns {{program: WebGLProgram, uniforms: object}|null} Null when the program failed to build —
 *   the caller's cue to draw something else rather than an empty frame.
 */
export function createSpacetimeProgram(gl) {
    const program = WebGLUtils.loadShaderProgram(
        gl,
        spacetimeVertexShaderSource,
        spacetimeFragmentShaderSource,
    );
    if (!program) return null;
    return {
        program,
        uniforms: {
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
        },
    };
}

/**
 * Draw the volume into the currently bound framebuffer, as three vertices and one full-screen
 * fragment pass. No VAO, no geometry buffer: the object is entirely a fragment-shader construction,
 * which is why its cost is pixels × steps and not cells × ticks.
 *
 * The caller owns the viewport rectangle because the app draws into one pane of a composed surface
 * while an embed owns its whole canvas. `surfaceHeight` is the framebuffer's height, needed to flip
 * `viewRect` (CSS-style, y down) into GL's y-up convention.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {{program: WebGLProgram, uniforms: object}} compiled From {@link createSpacetimeProgram}.
 * @param {{volume: import('./SpacetimeVolume.js').SpacetimeVolume,
 *          camera: {yaw: number, pitch: number, distance: number},
 *          viewRect: {x: number, y: number, width: number, height: number},
 *          surfaceHeight: number, lutTexture: WebGLTexture, options: object,
 *          highlightLayer?: number}} params
 * @returns {object|null} The geometry the frame was drawn with, or null when nothing was drawn.
 */
export function drawSpacetimeVolume(gl, compiled, {
    volume,
    camera,
    viewRect,
    surfaceHeight,
    lutTexture,
    options,
    highlightLayer = -1,
}) {
    if (!compiled || !volume || volume.isEmpty) return null;
    if (!viewRect || !surfaceHeight || !lutTexture) return null;

    const { program, uniforms } = compiled;
    const geometry = computeGeometry(volume.cols, volume.rows, volume.depth, volume.length);

    const { position, up } = torusOrbitCamera(camera.yaw, camera.pitch, camera.distance);
    const aspect = Math.max(viewRect.width / viewRect.height, 0.01);
    const projection = perspective(SPACETIME_CAMERA.fovY, aspect, SPACETIME_CAMERA.near, SPACETIME_CAMERA.far);
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
    return geometry;
}
