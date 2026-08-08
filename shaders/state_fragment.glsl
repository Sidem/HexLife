#version 300 es
precision mediump float;

// Colour a k-state cell by looking its STATE up in a k-entry palette texture.
//
// **Why this is a separate program rather than a mode uniform on `fragment.glsl`.** HexLife's
// signature look colours a cell by its *rule index*, and that does not survive k > 2: the index is
// `self·k⁶ + Σ neighbourⱼ·kʲ`, which needs 21 bits at k=8, while `a_instance_rule_index` is an
// `UNSIGNED_BYTE`. There is no way to express the k-state look as a branch on the same inputs.
//
// `vertex.glsl` / `fragment.glsl` are shared verbatim with the Explorer app, which is what keeps the
// embed and the app from drifting visually. Adding a mode uniform there would put a k-state concern
// in the app's hot shader and make every future k-state change a change to the binary render path —
// the same argument that keeps `WorldK` out of `World`.

in float v_palette_x;

// k texels wide, 1 tall, RGBA8, NEAREST. One entry per state.
uniform sampler2D u_statePalette;

out vec4 outColor;

void main() {
    outColor = texture(u_statePalette, vec2(v_palette_x, 0.5));
}
