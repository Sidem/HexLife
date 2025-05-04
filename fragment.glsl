#version 300 es
precision highp float;

// Varying inputs from Vertex Shader
in float v_state;
in vec2 v_localPos;
in float v_hover_state; // <-- CORRECTED: Receive varying, no layout qualifier

out vec4 outColor;

// Uniforms
uniform float u_hexSize;
uniform vec4 u_fillColor;
uniform vec4 u_borderColor;
uniform float u_borderThickness;
uniform vec4 u_hoverFillColor;
uniform vec4 u_hoverBorderColor;
uniform vec4 u_hoverEmptyFillColor;
uniform float u_hoverFilledDarkenFactor;

// Signed Distance Function (implementation unchanged)
float signedDistToHexEdgeFlatTop( vec2 p, float size ) {
    vec2 p_abs = abs(p);
    float hexHalfHeight = size * sqrt(3.0) * 0.5;
    vec2 k_diag_normal = vec2(0.86602540378, 0.5);
    float proj_y = p_abs.y;
    float proj_diag = dot(k_diag_normal, p_abs);
    return hexHalfHeight - max(proj_y, proj_diag);
}

void main() {
    float distanceToEdge = signedDistToHexEdgeFlatTop(v_localPos, u_hexSize);

    if (distanceToEdge < 0.0) {
        discard;
    }

    vec4 currentFillColor = u_fillColor;
    vec4 currentBorderColor = u_borderColor;
    bool isFilled = v_state > 0.5;
    bool isHovered = v_hover_state > 0.5;

    if (isHovered) {
        // Apply border hover color universally
        currentBorderColor = mix(currentBorderColor, u_hoverBorderColor, 0.6);

        // Apply fill hover based on state
        if (isFilled) {
            // Darken the existing fill color
            currentFillColor.rgb *= u_hoverFilledDarkenFactor;
        } else {
            // For empty cells, we need to draw *something* when hovered
            // We will handle this below by NOT discarding
        }

    } else {
         // Not hovered, use base colors
    }

    // Determine final color
    if (distanceToEdge < u_borderThickness) {
        outColor = currentBorderColor;
    } else if (isFilled) {
        outColor = currentFillColor;
    } else if (isHovered && !isFilled) {
        // Draw the empty hover color if hovered and empty
        outColor = u_hoverEmptyFillColor;
    } else {
        // Otherwise, empty cells are not drawn (discard)
        discard;
    }

    // Clamp color (good practice)
    outColor = clamp(outColor, 0.0, 1.0);
}