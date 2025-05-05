#version 300 es
precision mediump float;

// Input texture coordinates from vertex shader
in vec2 v_texCoord;

// The texture rendered by the hex simulation
uniform sampler2D u_texture;

// Output color
out vec4 outColor;

// Uniforms
uniform bool u_useTexture; // Flag to switch
uniform vec4 u_color;      // Color to use when not texturing

void main() {
    if (u_useTexture) {
        outColor = texture(u_texture, v_texCoord);
    } else {
        outColor = u_color;
    }
}