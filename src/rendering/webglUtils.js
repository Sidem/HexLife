/**
 * Creates and compiles a shader.
 * @param {WebGL2RenderingContext} gl The WebGL Context.
 * @param {number} type Shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
 * @param {string} source Shader source code.
 * @returns {WebGLShader|null} The compiled shader or null if compilation fails.
 */
export function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) {
        return shader;
    }
    console.error(`Shader compilation error (${type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'}):`, gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
}

/**
 * Creates and links a shader program.
 * @param {WebGL2RenderingContext} gl The WebGL Context.
 * @param {WebGLShader} vertexShader Compiled vertex shader.
 * @param {WebGLShader} fragmentShader Compiled fragment shader.
 * @returns {WebGLProgram|null} The linked program or null if linking fails.
 */
export function createProgram(gl, vertexShader, fragmentShader) {
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) {
        return program;
    }
    console.error("Shader program linking error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
}

/**
 * Creates a shader program from source strings.
 * @param {WebGL2RenderingContext} gl WebGL context.
 * @param {string} vsSource Vertex shader source code.
 * @param {string} fsSource Fragment shader source code.
 * @returns {WebGLProgram|null} Linked shader program or null on error.
 */
export function loadShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = createProgram(gl, vertexShader, fragmentShader);

    if (program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
    }
    return program;
}


/**
 * Creates a buffer and uploads data.
 * @param {WebGL2RenderingContext} gl WebGL context.
 * @param {GLenum} target Buffer type (e.g., gl.ARRAY_BUFFER).
 * @param {BufferSource} data Data to upload.
 * @param {GLenum} usage Usage hint (e.g., gl.STATIC_DRAW, gl.DYNAMIC_DRAW).
 * @returns {WebGLBuffer} The created buffer.
 */
export function createBuffer(gl, target, data, usage) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage);
    return buffer;
}

/**
 * Updates data in an existing buffer.
 * @param {WebGL2RenderingContext} gl WebGL context.
 * @param {WebGLBuffer} buffer The buffer to update.
 * @param {GLenum} target Buffer type (must match creation type).
 * @param {BufferSource} data New data to upload.
 * @param {number} [offset=0] Offset in bytes where to start updating.
 */
export function updateBuffer(gl, buffer, target, data, offset = 0) {
    gl.bindBuffer(target, buffer);
    
    
    
    
    gl.bufferSubData(target, offset, data);
}


/**
 * Creates a texture suitable for use as a Framebuffer Object (FBO) color attachment.
 * @param {WebGL2RenderingContext} gl WebGL context.
 * @param {number} width Texture width.
 * @param {number} height Texture height.
 * @returns {WebGLTexture} The created texture.
 */
export function createFBOTexture(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const level = 0;
    const internalFormat = gl.RGBA;
    const border = 0;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;
    const data = null;
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
                  width, height, border, format, type, data);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
}

/**
 * Creates a Framebuffer Object (FBO) and attaches a texture.
 * @param {WebGL2RenderingContext} gl WebGL context.
 * @param {WebGLTexture} texture The texture to attach as color buffer.
 * @returns {WebGLFramebuffer} The created FBO.
 */
export function createFBO(gl, texture) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("FBO creation failed: " + status.toString());
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}
