#version 300 es

// Attributes per vertex
layout (location=0) in vec2 a_position;

// Attributes per instance
layout (location=1) in vec2 a_instance_offset;
layout (location=2) in float a_instance_state;
layout (location=3) in float a_instance_hover_state;
layout (location=4) in float a_instance_rule_index; // NEW attribute

// Output to fragment shader
out float v_state;
out vec2 v_localPos;
out float v_hover_state;
out float v_rule_index; // NEW varying

// Uniforms
uniform vec2 u_resolution;
uniform float u_hexSize;

void main() {
  v_localPos = a_position * u_hexSize;
  vec2 pos = v_localPos + a_instance_offset;

  vec2 zeroToOne = pos / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  // Pass values to fragment shader
  v_state = a_instance_state;
  v_hover_state = a_instance_hover_state;
  v_rule_index = a_instance_rule_index; // Pass rule index
}