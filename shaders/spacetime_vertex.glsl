#version 300 es
precision highp float;

// Fullscreen triangle from gl_VertexID alone — no VBO, no VAO, no attributes.
// The spacetime view must not own GL objects it does not need (#40 §2 "zero cost when off"):
// the only object it allocates is the volume texture, released the moment the mode is left.
out vec2 v_ndc;

void main() {
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    v_ndc = corner * 2.0 - 1.0;
    gl_Position = vec4(v_ndc, 0.0, 1.0);
}
