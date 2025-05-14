#version 300 es
precision mediump float;

in float v_state;
in float v_hover_state;
in float v_rule_index;

uniform float u_hoverFilledDarkenFactor;
uniform float u_hoverInactiveLightenFactor;

out vec4 outColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec3 base_color_rgb;
    float hue_offset = 0.1667; // Offset for yellow (60.0 / 360.0)
    float calculated_hue = v_rule_index / 128.0;
    float hue = mod(calculated_hue + hue_offset, 1.0);

    if (v_state == 1.0) { 
        base_color_rgb = hsv2rgb(vec3(hue, 1.0, 1.0));
    } else { 
        base_color_rgb = hsv2rgb(vec3(hue, 0.5, 0.15));
    }

    if (v_hover_state == 1.0) {
        if (v_state == 1.0) { 
            base_color_rgb *= u_hoverFilledDarkenFactor;
        } else { 
            base_color_rgb *= u_hoverInactiveLightenFactor;
        }
    }

    outColor = vec4(base_color_rgb, 1.0);
}