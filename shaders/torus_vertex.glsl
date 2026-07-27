#version 300 es
precision highp float;

layout (location=0) in vec2 a_position;
layout (location=1) in vec2 a_instance_offset;
layout (location=2) in float a_instance_state;
layout (location=3) in float a_instance_hover_state;
layout (location=4) in float a_instance_rule_index;
layout (location=5) in float a_instance_ghost_state;

out float v_state;
out float v_hover_state;
out float v_lut_x;
out float v_lut_y;
out float v_ghost_state;
out float v_rule_index;
out vec3 v_normal;
out vec3 v_world_position;

uniform float u_hexSize;
uniform vec2 u_period;
uniform vec2 u_radii;
uniform mat4 u_mvp;

const float TAU = 6.283185307179586;

void main() {
    v_state = a_instance_state;
    v_hover_state = a_instance_hover_state;
    v_ghost_state = a_instance_ghost_state;
    v_rule_index = a_instance_rule_index;
    v_lut_x = (a_instance_rule_index + 0.5) / 128.0;
    v_lut_y = (a_instance_state + 0.5) / 2.0;

    vec2 flatPosition = (a_position * u_hexSize) + a_instance_offset;
    float u = TAU * flatPosition.x / u_period.x;
    float v = TAU * flatPosition.y / u_period.y;
    float cosU = cos(u);
    float sinU = sin(u);
    float cosV = cos(v);
    float sinV = sin(v);
    float ringRadius = u_radii.x + u_radii.y * cosV;

    // Negative Z preserves the flat grid's CCW winding on the outward torus surface.
    vec3 worldPosition = vec3(
        ringRadius * cosU,
        u_radii.y * sinV,
        -ringRadius * sinU
    );
    v_normal = normalize(vec3(cosV * cosU, sinV, -cosV * sinU));
    v_world_position = worldPosition;
    gl_Position = u_mvp * vec4(worldPosition, 1.0);

}
