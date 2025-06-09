#version 300 es
precision mediump float;

in float v_state;
in float v_hover_state;
in float v_lut_x;
in float v_lut_y;
in float v_ghost_state;

uniform float u_hoverFilledDarkenFactor;
uniform float u_hoverInactiveLightenFactor;
uniform sampler2D u_colorLUT;

out vec4 outColor;
void main() {
    vec3 base_color_rgb = texture(u_colorLUT, vec2(v_lut_x, v_lut_y)).rgb;
    
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