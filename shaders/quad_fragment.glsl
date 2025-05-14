#version 300 es
precision mediump float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 outColor;
uniform bool u_useTexture;
uniform vec4 u_color;      

void main() {
    if (u_useTexture) {
        outColor = texture(u_texture, v_texCoord);
    } else {
        outColor = u_color;
    }
}