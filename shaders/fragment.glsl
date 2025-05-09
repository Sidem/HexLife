#version 300 es
precision highp float;

// Varying inputs from Vertex Shader
in float v_state;
in vec2 v_localPos;
in float v_hover_state;

out vec4 outColor;

// Uniforms
uniform float u_hexSize;
uniform vec4 u_fillColor;
uniform vec4 u_hoverBorderColor;
uniform vec4 u_hoverEmptyFillColor;
uniform float u_hoverFilledDarkenFactor;

// Signed Distance Function
float signedDistToHexEdgeFlatTop( vec2 p, float size ) {
    vec2 p_abs = abs(p);
    float hexHalfHeight = size * sqrt(3.0) * 0.5;
    vec2 k_diag_normal = vec2(0.86602540378, 0.5); // cos(30), sin(30)
    float proj_y = p_abs.y;
    float proj_diag = dot(k_diag_normal, p_abs);
    return hexHalfHeight - max(proj_y, proj_diag); // distance from point to closest edge (positive inside)
}

void main() {
    float distanceToEdge = signedDistToHexEdgeFlatTop(v_localPos, u_hexSize);

    if (distanceToEdge < 0.0) {
        discard;
    }

    vec4 currentFillColor = u_fillColor;
    bool isFilled = v_state > 0.5;
    bool isHovered = v_hover_state > 0.5;

    if (isHovered) {
        if (isFilled) {
            currentFillColor.rgb *= u_hoverFilledDarkenFactor;
        }
    }

    if (isFilled) {
        outColor = currentFillColor;
    } else if (isHovered && !isFilled) {
        outColor = u_hoverEmptyFillColor;
    } else {
        // Empty, non-hovered cells are not drawn
        discard;
    }

    outColor = clamp(outColor, 0.0, 1.0);
}