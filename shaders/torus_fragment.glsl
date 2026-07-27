#version 300 es
precision highp float;

in float v_state;
in float v_hover_state;
in float v_lut_x;
in float v_lut_y;
in float v_ghost_state;
in float v_rule_index;
in vec3 v_normal;
in vec3 v_world_position;

uniform sampler2D u_colorLUT;
uniform vec3 u_cameraPosition;
uniform float u_offOpacity;
uniform int u_surfacePass;

out vec4 outColor;

void main() {
    if (u_surfacePass == 1 && v_state < 0.5) {
        discard;
    }
    if (u_surfacePass == 2 && v_state >= 0.5) {
        discard;
    }

    vec3 baseColor;
    if (v_rule_index == 255.0) {
        baseColor = v_state == 1.0 ? vec3(1.0) : vec3(0.0);
    } else {
        baseColor = texture(u_colorLUT, vec2(v_lut_x, v_lut_y)).rgb;
    }

    if (v_hover_state == 1.0) {
        baseColor = mix(baseColor, vec3(1.0), 0.3);
    }

    float alpha = v_state < 0.5 ? u_offOpacity : 1.0;
    if (v_ghost_state == 1.0) {
        baseColor = vec3(1.0);
        alpha = 0.5;
    }
    vec3 normal = normalize(v_normal);
    vec3 viewDirection = normalize(u_cameraPosition - v_world_position);
    // Camera-relative two-sided lighting gives mirrored top/bottom surfaces the same
    // brightness. A fixed world light made opaque black cells look transparent on one half.
    float viewFacing = abs(dot(normal, viewDirection));
    float diffuse = mix(0.35, 1.0, viewFacing);
    float rim = pow(1.0 - viewFacing, 2.4);
    vec3 litColor;
    if (v_state < 0.5) {
        // Keep off-cell brightness stable so lighting cannot masquerade as transparency.
        // Preserve brighter palette colors, but give black entries a readable surface floor.
        litColor = max(baseColor * 0.7, vec3(0.22, 0.24, 0.3))
            + vec3(0.015, 0.02, 0.03) * rim;
    } else {
        litColor = baseColor * (0.48 + 0.62 * diffuse) + vec3(0.16, 0.2, 0.28) * rim;
    }

    outColor = vec4(litColor, alpha);
}
