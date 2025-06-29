#version 300 es
precision mediump float;

in float v_state;
in float v_hover_state;
in float v_lut_x;
in float v_lut_y;
in float v_ghost_state;
in float v_rule_index;

uniform float u_hoverFilledDarkenFactor;
uniform float u_hoverInactiveLightenFactor;
uniform sampler2D u_colorLUT;

out vec4 outColor;

void main() {
    vec3 base_color_rgb;

    if (v_rule_index == 255.0) {
        if (v_state == 1.0) {
            base_color_rgb = vec3(1.0, 1.0, 1.0);
        } else {
            base_color_rgb = vec3(0.0, 0.0, 0.0);
        }
    } else {
        base_color_rgb = texture(u_colorLUT, vec2(v_lut_x, v_lut_y)).rgb;
    }

    if (v_hover_state == 1.0) {
        vec3 hover_color = vec3(1.0, 1.0, 1.0); // White highlight
        float hover_strength = 0.3; // 30% blend
        base_color_rgb = mix(base_color_rgb, hover_color, hover_strength);
    }

    float alpha = 1.0;
    if (v_ghost_state == 1.0) {
        base_color_rgb = vec3(1.0, 1.0, 1.0);
        alpha = 0.5;
    }

    outColor = vec4(base_color_rgb, alpha);
}