#version 300 es

// k-state hex grid: same instanced geometry as `vertex.glsl`, coloured by STATE rather than by rule
// index. A separate program on purpose — see `state_fragment.glsl` for why this is not a mode
// uniform on the shared shaders.
//
// The attribute locations below are NOT a coincidence. `EmbedRenderer` builds one VAO for both
// programs, so `a_position`, `a_instance_offset` and `a_instance_state` must sit at exactly the
// locations `vertex.glsl` gives them. Locations 3–5 (hover, rule index, ghost) are simply not
// declared here: the VAO still has arrays enabled there and GL ignores attributes a program does
// not consume.

layout (location=0) in vec2 a_position;

layout (location=1) in vec2 a_instance_offset;
layout (location=2) in float a_instance_state;

out float v_palette_x;

uniform vec2 u_resolution;
uniform float u_hexSize;

uniform vec2 u_pan;
uniform float u_zoom;

// `k`. The palette texture is k texels wide, so this is what puts a state on its texel centre.
uniform float u_states;

void main() {
  vec2 pos = (a_position * u_hexSize) + a_instance_offset;
  vec2 transformedPos = (pos - u_pan) * u_zoom + (u_resolution / 2.0);
  vec2 zeroToOne = transformedPos / u_resolution;
  vec2 zeroToTwo = zeroToOne * 2.0;
  vec2 clipSpace = zeroToTwo - 1.0;
  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  // Texel centre for this state. `u_states` is clamped away from zero by the host, so this cannot
  // divide by zero even if a caller asks for a degenerate world.
  v_palette_x = (a_instance_state + 0.5) / max(u_states, 1.0);
}
