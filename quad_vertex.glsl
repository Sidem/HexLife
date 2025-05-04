#version 300 es

// Input vertex position (usually -1 to 1 for a quad covering the screen/area)
layout (location=0) in vec2 a_position;
// Input texture coordinates (usually 0 to 1)
layout (location=1) in vec2 a_texCoord;

// Pass texture coordinates to the fragment shader
out vec2 v_texCoord;

// Optional: Uniform for position/scale/transformation if needed
// uniform mat4 u_transform;

void main() {
  // gl_Position = u_transform * vec4(a_position, 0.0, 1.0); // If using transform
  gl_Position = vec4(a_position, 0.0, 1.0); // Assume quad vertices are already in clip space
  v_texCoord = a_texCoord;
}