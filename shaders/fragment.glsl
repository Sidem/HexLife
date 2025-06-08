#version 300 es
precision mediump float;

in float v_state;
in float v_hover_state;
in float v_rule_index;
in float v_ghost_state; /* NEW */

uniform float u_hoverFilledDarkenFactor;
uniform float u_hoverInactiveLightenFactor;
uniform sampler2D u_colorLUT;

out vec4 outColor;

void main() {
    float lut_x = (v_rule_index + 0.5) / 128.0;
    float lut_y = (v_state + 0.5) / 2.0;

    vec3 base_color_rgb = texture(u_colorLUT, vec2(lut_x, lut_y)).rgb;
    if (v_hover_state == 1.0) {
        if (v_state == 1.0) {
            base_color_rgb *= u_hoverFilledDarkenFactor;
        } else {
            base_color_rgb *= u_hoverInactiveLightenFactor;
        }
    }

    float alpha = 1.0;
    if (v_ghost_state == 1.0) {
        base_color_rgb = vec3(1.0, 1.0, 1.0);
        alpha = 0.5;
    }

    outColor = vec4(base_color_rgb, alpha);
}