#version 300 es
precision highp float;
precision highp int;
precision highp usampler2DArray;

// Ray-marched spacetime volume (#40).
//
// Cost is pixels x steps and is INDEPENDENT of grid resolution: a huge world costs the same as a
// small one, which is the whole reason this is affordable at Explorer's dimensions. The volume is
// a TEXTURE_2D_ARRAY of R8UI bytes, one byte per cell per retained tick, and that byte is already
// a palette index: rule * 2 + state, a direct linear index into the live 128x2 colour LUT. No
// decode, no second table, no per-voxel branch (#40 §1.1). A palette change therefore retints the
// entire history without re-uploading one byte of it.
//
// Object space: the footprint lies in XZ (grid x -> x, grid y -> z) and time runs up +Y, so the
// oldest retained tick is at the bottom of the object and the newest is on top. The object is
// bottom-anchored: it GROWS upward as the history ring fills and loses its top when the user
// resumes from a scrub, which is the same shape the scrub bar reports.

in vec2 v_ndc;
out vec4 outColor;

uniform highp usampler2DArray u_volume;
uniform sampler2D u_colorLUT;

uniform vec3 u_cameraPosition;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
uniform vec3 u_cameraForward;
/** (tan(fovY/2) * aspect, tan(fovY/2)) — taken straight off the perspective matrix. */
uniform vec2 u_tanHalf;

/** Object-space bounds of the LIVE part of the volume (y shrinks with a partly filled ring). */
uniform vec3 u_boxMin;
uniform vec3 u_boxMax;
/** Flat-grid coordinate of the footprint centre, so object XZ maps back onto the hex layout. */
uniform vec2 u_gridCenter;
uniform float u_hexSize;
uniform ivec2 u_gridSize;
/** Thickness of one tick. Fixed by the ring CAPACITY, not by how full it is, so growth reads as
    growth rather than as the whole object stretching. */
uniform float u_layerHeight;
/** Number of live layers, oldest at index 0. */
uniform int u_layers;
/**
 * The volume is a ring: layer 0 lives at physical slot `u_ringBase`, and slots wrap at
 * `u_ringDepth`. Storing it this way means appending a tick at capacity is one texSubImage3D of one
 * layer, never a shuffle of the other 239.
 */
uniform int u_ringBase;
uniform int u_ringDepth;
uniform int u_maxSteps;
/** > 0 selects front-to-back translucency at this alpha per live voxel; <= 0 is the opaque solid. */
uniform float u_layerAlpha;
/**
 * Longest lateral distance (flat-grid units) a single step may cover. The plan's slab march steps
 * exactly one layer plane at a time, which is exact only while the ray is steep; at the orbit
 * camera's usual elevation one slab step crosses several hexes sideways and the march would skip
 * them. Clamping the step keeps the sampling honest at grazing angles. <= 0 restores the pure
 * slab march, which is what the benchmark compares against.
 */
uniform float u_maxLateralStep;
/**
 * The tick the transport bar is parked on, as a live layer index, or -1 when not scrubbing. That
 * one layer is drawn opaque and brightened so it reads as a cross-section plane through the solid —
 * the scrub position and the object are the same piece of state, shown two ways.
 */
uniform int u_highlightLayer;

const float SQRT3 = 1.7320508075688772;

/**
 * Flat-top, odd-q offset grid — the exact layout `gridToPixelCoords` lays down (odd columns pushed
 * down half a row). Axial inverse + cube rounding, then axial -> offset.
 */
ivec2 hexCellAt(vec2 p) {
    float q = (2.0 / 3.0) * p.x / u_hexSize;
    float r = ((-p.x / 3.0) + (SQRT3 / 3.0) * p.y) / u_hexSize;

    float cx = q;
    float cz = r;
    float cy = -cx - cz;
    float rx = floor(cx + 0.5);
    float ry = floor(cy + 0.5);
    float rz = floor(cz + 0.5);
    float dx = abs(rx - cx);
    float dy = abs(ry - cy);
    float dz = abs(rz - cz);
    if (dx > dy && dx > dz) {
        rx = -ry - rz;
    } else if (dy <= dz) {
        rz = -rx - ry;
    }

    int col = int(rx);
    // (col - (col & 1)) is always even, so the integer divide is exact for negative columns too.
    int row = int(rz) + ((col - (col & 1)) / 2);
    return ivec2(col, row);
}

uint voxelAt(ivec2 cell, int layer) {
    if (cell.x < 0 || cell.x >= u_gridSize.x || cell.y < 0 || cell.y >= u_gridSize.y) return 0u;
    if (layer < 0 || layer >= u_layers) return 0u;
    // Live layer -> physical texture slot. The modulo is the ring unwrap.
    int slot = (u_ringBase + layer) % u_ringDepth;
    return texelFetch(u_volume, ivec3(cell.x, cell.y, slot), 0).r;
}

/** The byte IS the LUT index: high 7 bits are the rule, low bit is the state. */
vec3 voxelColor(uint voxel) {
    float rule = float(voxel >> 1u);
    float state = float(voxel & 1u);
    return texture(u_colorLUT, vec2((rule + 0.5) / 128.0, (state + 0.5) / 2.0)).rgb;
}

void main() {
    if (u_layers <= 0) discard; // nothing recorded yet — the object has not grown

    vec3 rayDirection = normalize(
        u_cameraForward
        + u_cameraRight * (v_ndc.x * u_tanHalf.x)
        + u_cameraUp * (v_ndc.y * u_tanHalf.y)
    );
    // Keep the slab/box arithmetic free of inf*0 = NaN for axis-aligned rays.
    vec3 absDirection = max(abs(rayDirection), vec3(1e-6));
    vec3 signDirection = vec3(
        rayDirection.x < 0.0 ? -1.0 : 1.0,
        rayDirection.y < 0.0 ? -1.0 : 1.0,
        rayDirection.z < 0.0 ? -1.0 : 1.0
    );
    vec3 inverseDirection = signDirection / absDirection;

    vec3 nearPlanes = (u_boxMin - u_cameraPosition) * inverseDirection;
    vec3 farPlanes = (u_boxMax - u_cameraPosition) * inverseDirection;
    vec3 lo = min(nearPlanes, farPlanes);
    vec3 hi = max(nearPlanes, farPlanes);
    float tEnter = max(max(lo.x, lo.y), lo.z);
    float tExit = min(min(hi.x, hi.y), hi.z);
    if (tExit <= max(tEnter, 0.0)) discard;

    float slabStep = u_layerHeight / absDirection.y;
    float lateralStep = u_maxLateralStep > 0.0
        ? u_maxLateralStep / max(length(rayDirection.xz), 1e-6)
        : 1e30;
    float marchStep = min(slabStep, lateralStep);

    float t = max(tEnter, 0.0);
    vec3 accumulated = vec3(0.0);
    float alpha = 0.0;

    for (int i = 0; i < u_maxSteps; ++i) {
        if (t >= tExit) break;
        float segment = min(marchStep, tExit - t);
        vec3 p = u_cameraPosition + rayDirection * (t + segment * 0.5);
        t += segment;

        int layer = clamp(int(floor((p.y - u_boxMin.y) / u_layerHeight)), 0, u_layers - 1);
        ivec2 cell = hexCellAt(p.xz + u_gridCenter);
        uint voxel = voxelAt(cell, layer);
        if ((voxel & 1u) == 0u) continue; // off cells are empty space, exactly as #39 extrudes them

        // One extra fetch buys a flat cap/side split: if the layer we came from is empty this is a
        // horizontal face, otherwise shade it as a wall facing the camera.
        bool capExposed = (voxelAt(cell, layer - int(signDirection.y)) & 1u) == 0u;
        vec3 normal = capExposed
            ? vec3(0.0, -signDirection.y, 0.0)
            : normalize(vec3(-rayDirection.x, 0.0, -rayDirection.z));
        vec3 base = voxelColor(voxel);
        float diffuse = 0.42 + 0.58 * max(dot(normal, normalize(vec3(0.38, 0.86, 0.34))), 0.0);
        vec3 lit = base * diffuse;

        // The scrub plane. Drawn opaque and lifted well clear of the surrounding translucent haze so
        // it reads as a solid cross-section through the object rather than one slightly paler tick.
        if (layer == u_highlightLayer) {
            vec3 plane = mix(lit, vec3(1.0), 0.35);
            float planeAlpha = 1.0 - alpha;
            accumulated += plane * planeAlpha;
            outColor = vec4(accumulated, 1.0);
            return;
        }

        if (u_layerAlpha <= 0.0) {
            // Opaque: the first hit wins and the ray stops. Early termination is what keeps the
            // step count far below `u_layers` at any realistic density.
            outColor = vec4(lit, 1.0);
            return;
        }

        float voxelAlpha = u_layerAlpha * (1.0 - alpha);
        accumulated += lit * voxelAlpha;
        alpha += voxelAlpha;
        if (alpha > 0.99) break;
    }

    if (alpha <= 0.001) discard;
    outColor = vec4(accumulated, alpha); // premultiplied — blend with (ONE, ONE_MINUS_SRC_ALPHA)
}
