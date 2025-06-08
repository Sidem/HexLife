#version 300 es

layout (location=0) in vec2 a_position;

layout (location=1) in vec2 a_instance_offset;
layout (location=2) in float a_instance_state;
layout (location=3) in float a_instance_hover_state;
layout (location=4) in float a_instance_rule_index;
layout (location=5) in float a_instance_ghost_state; /* NEW */

out float v_state;
out vec2 v_localPos;
out float v_hover_state;
out float v_rule_index;
out float v_ghost_state; /* NEW */

uniform vec2 u_resolution;
uniform float u_hexSize;

uniform vec2 u_pan;
uniform float u_zoom;
void main() {
  v_localPos = a_position * u_hexSize;
  vec2 pos = v_localPos + a_instance_offset;
  vec2 transformedPos = (pos - u_pan) * u_zoom + (u_resolution / 2.0);
  vec2 zeroToOne = transformedPos / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  v_state = a_instance_state;
  v_hover_state = a_instance_hover_state;
  v_rule_index = a_instance_rule_index; 
  v_ghost_state = a_instance_ghost_state; /* NEW */
}