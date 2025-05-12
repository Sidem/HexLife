#version 300 es
precision mediump float;

// Varyings from vertex shader
in float v_state;         // 0.0 (inactive) or 1.0 (active)
in float v_hover_state;   // 0.0 (no hover) or 1.0 (hover)
in float v_rule_index;    // Rule index (0-127)


uniform float u_hoverFilledDarkenFactor; // Factor to darken active cells on hover
uniform float u_hoverInactiveLightenFactor; // NEW uniform for lightening inactive cells

out vec4 outColor;

// Function to convert HSV to RGB
// H: 0-1, S: 0-1, V: 0-1
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec3 base_color_rgb;

    float hue_offset = 0.1667; // Offset for yellow (60.0 / 360.0)
    float calculated_hue = v_rule_index / 128.0;
    float hue = mod(calculated_hue + hue_offset, 1.0); // Add offset and wrap around

    if (v_state == 1.0) { 
        base_color_rgb = hsv2rgb(vec3(hue, 1.0, 1.0));
    } else { 
        base_color_rgb = hsv2rgb(vec3(hue, 0.5, 0.15));
    }

    // Apply hover effect
    if (v_hover_state == 1.0) {
        if (v_state == 1.0) { // Hovering over an active cell
            base_color_rgb *= u_hoverFilledDarkenFactor; // Darken existing color
        } else { // Hovering over an inactive cell
            // MODIFIED BEHAVIOR: Lighten the original inactive cell color
            base_color_rgb *= u_hoverInactiveLightenFactor; // Lighten existing color
        }
    }

    outColor = vec4(base_color_rgb, 1.0);
}