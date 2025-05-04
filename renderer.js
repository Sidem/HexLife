// renderer.js
import * as Config from './config.js';
import * as WebGLUtils from './webglUtils.js';
import * as Utils from './utils.js';

// --- Module State ---
let gl;
let canvas;

// Shader Programs
let hexShaderProgram;
let quadShaderProgram;

// Locations for Hex Shader
let hexAttributeLocations;
let hexUniformLocations;

// Locations for Quad Shader
let quadAttributeLocations;
let quadUniformLocations;

// Framebuffer Objects (one per world)
let worldFBOs = []; // Array of { fbo: WebGLFramebuffer, texture: WebGLTexture }

// A simple buffer for drawing outlines (optional, might not need complex VAO)
let lineBuffer;

// Buffers & VAOs
let hexBuffers; // { positionBuffer, offsetBuffer, stateBuffer, hoverStateBuffer }
let quadBuffers; // { positionBuffer, texCoordBuffer }
let hexVAO;
let quadVAO;

// --- Initialization ---

/**
 * Initializes the WebGL renderer, shaders, buffers, FBOs, and VAOs.
 * @param {HTMLCanvasElement} canvasElement The canvas element to render to.
 * @returns {WebGL2RenderingContext|null} The WebGL context or null on failure.
 */
export async function initRenderer(canvasElement) {
    canvas = canvasElement;
    gl = canvas.getContext('webgl2');
    if (!gl) {
        alert("WebGL 2 not supported!");
        console.error("WebGL 2 not supported!");
        return null;
    }

    // Load Shaders
    hexShaderProgram = await WebGLUtils.loadShaderProgram(gl, 'vertex.glsl', 'fragment.glsl');
    quadShaderProgram = await WebGLUtils.loadShaderProgram(gl, 'quad_vertex.glsl', 'quad_fragment.glsl');

    if (!hexShaderProgram || !quadShaderProgram) {
        return null;
    }

    // --- Get Locations for Hex Shader ---
    hexAttributeLocations = {
        position: gl.getAttribLocation(hexShaderProgram, "a_position"),
        instanceOffset: gl.getAttribLocation(hexShaderProgram, "a_instance_offset"),
        instanceState: gl.getAttribLocation(hexShaderProgram, "a_instance_state"),
        instanceHoverState: gl.getAttribLocation(hexShaderProgram, "a_instance_hover_state"),
    };
    hexUniformLocations = {
        resolution: gl.getUniformLocation(hexShaderProgram, "u_resolution"),
        hexSize: gl.getUniformLocation(hexShaderProgram, "u_hexSize"),
        fillColor: gl.getUniformLocation(hexShaderProgram, "u_fillColor"),
        borderColor: gl.getUniformLocation(hexShaderProgram, "u_borderColor"),
        borderThickness: gl.getUniformLocation(hexShaderProgram, "u_borderThickness"),
        hoverEmptyFillColor: gl.getUniformLocation(hexShaderProgram, "u_hoverEmptyFillColor"),
        hoverFilledDarkenFactor: gl.getUniformLocation(hexShaderProgram, "u_hoverFilledDarkenFactor"),
        hoverFillColor: gl.getUniformLocation(hexShaderProgram, "u_hoverFillColor"),
        hoverBorderColor: gl.getUniformLocation(hexShaderProgram, "u_hoverBorderColor"),
    };

    // --- Get Locations for Quad Shader ---
    quadAttributeLocations = {
        position: gl.getAttribLocation(quadShaderProgram, "a_position"),
        texCoord: gl.getAttribLocation(quadShaderProgram, "a_texCoord"),
    };
    quadUniformLocations = {
        texture: gl.getUniformLocation(quadShaderProgram, "u_texture"),
        u_color: gl.getUniformLocation(quadShaderProgram, "u_color"),
        u_useTexture: gl.getUniformLocation(quadShaderProgram, "u_useTexture"),
    };

    // --- Create Buffers & VAOs ---
    setupHexBuffersAndVAO();
    setupQuadBuffersAndVAO();

    // --- Create FBOs for Render-to-Texture ---
    setupFBOs();

    // Initial resize
    resizeRenderer(); // Sets initial viewport

    console.log("Renderer initialized.");
    return gl;
}

function setupHexBuffersAndVAO() {
    hexBuffers = {};

    // 1. Base Hexagon Geometry (Static)
    const hexVertices = Utils.createFlatTopHexagonVertices();
    hexBuffers.positionBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, hexVertices, gl.STATIC_DRAW);

    // 2. Instance Offsets (Static - positions within the RENDER_TEXTURE_SIZE space)
    const instanceOffsets = new Float32Array(Config.NUM_CELLS * 2);
    // Calculate offsets assuming rendering into the texture space
    // We need an appropriate hex size for the texture resolution
    const textureHexSize = Utils.calculateHexSizeForTexture(); // <-- Use Utils.
    const startX = textureHexSize; // Simple offset from edge within texture
    const startY = textureHexSize * Math.sqrt(3) / 2;
    for (let i = 0; i < Config.NUM_CELLS; i++) {
        const coords = Utils.indexToCoords(i);
        if (coords) {
            const pixelCoords = Utils.gridToPixelCoords(coords.col, coords.row, textureHexSize, startX, startY);
            instanceOffsets[i * 2] = pixelCoords.x;
            instanceOffsets[i * 2 + 1] = pixelCoords.y;
        }
    }
    hexBuffers.offsetBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, instanceOffsets, gl.STATIC_DRAW);

    // 3. Instance State & Hover Buffers (Dynamic - sized for one world)
    const initialZeros = new Float32Array(Config.NUM_CELLS).fill(0.0);
    hexBuffers.stateBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);
    hexBuffers.hoverBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);

    // 4. Setup Hex VAO
    hexVAO = gl.createVertexArray();
    gl.bindVertexArray(hexVAO);

    // Position Attribute (per vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.positionBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.position);
    gl.vertexAttribPointer(hexAttributeLocations.position, 2, gl.FLOAT, false, 0, 0);

    // Offset Attribute (per instance)
    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.offsetBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceOffset);
    gl.vertexAttribPointer(hexAttributeLocations.instanceOffset, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceOffset, 1);

    // State Attribute (per instance)
    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.stateBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceState);
    gl.vertexAttribPointer(hexAttributeLocations.instanceState, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceState, 1);

    // Hover Attribute (per instance)
    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.hoverBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceHoverState);
    gl.vertexAttribPointer(hexAttributeLocations.instanceHoverState, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceHoverState, 1);

    gl.bindVertexArray(null); // Unbind VAO
}

function setupQuadBuffersAndVAO() {
    quadBuffers = {};

    // Simple quad covering -1 to 1 in X and Y
    const positions = new Float32Array([
        -1, -1,  1, -1,  -1, 1,   1, 1, // Triangle strip order
    ]);
    // Corresponding texture coordinates (0 to 1)
    const texCoords = new Float32Array([
         0, 0,   1, 0,    0, 1,    1, 1,
    ]);

    quadBuffers.positionBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    quadBuffers.texCoordBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    // Setup Quad VAO
    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);

    // Position Attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.positionBuffer);
    gl.enableVertexAttribArray(quadAttributeLocations.position);
    gl.vertexAttribPointer(quadAttributeLocations.position, 2, gl.FLOAT, false, 0, 0);

    // TexCoord Attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.texCoordBuffer);
    gl.enableVertexAttribArray(quadAttributeLocations.texCoord);
    gl.vertexAttribPointer(quadAttributeLocations.texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null); // Unbind VAO
}

function setupFBOs() {
    worldFBOs = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const texture = WebGLUtils.createFBOTexture(gl, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
        const fbo = WebGLUtils.createFBO(gl, texture);
        worldFBOs.push({ fbo, texture });
    }
}

// --- Rendering Functions ---

/**
 * Renders all world states to their respective FBO textures.
 * @param {Array<object>} worldsData Array of world data objects from simulation.js.
 */
function renderWorldsToTextures(worldsData) {
    if (!hexShaderProgram || !hexVAO) return;

    gl.useProgram(hexShaderProgram);
    gl.bindVertexArray(hexVAO);

    // Calculate shared uniforms for hex rendering within texture
    const textureHexSize = Utils.calculateHexSizeForTexture();
    gl.uniform2f(hexUniformLocations.resolution, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
    gl.uniform1f(hexUniformLocations.hexSize, textureHexSize);
    gl.uniform4fv(hexUniformLocations.fillColor, Config.FILL_COLOR);
    gl.uniform4fv(hexUniformLocations.borderColor, Config.BORDER_COLOR);
    gl.uniform1f(hexUniformLocations.borderThickness, Config.BORDER_THICKNESS);
    gl.uniform4fv(hexUniformLocations.hoverEmptyFillColor, Config.HOVER_EMPTY_FILL_COLOR);
    gl.uniform1f(hexUniformLocations.hoverFilledDarkenFactor, Config.HOVER_FILLED_DARKEN_FACTOR);
    gl.uniform4fv(hexUniformLocations.hoverFillColor, Config.HOVER_FILL_COLOR);
    gl.uniform4fv(hexUniformLocations.hoverBorderColor, Config.HOVER_BORDER_COLOR);

    // Set viewport for rendering into textures
    gl.viewport(0, 0, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const world = worldsData[i];
        const fboData = worldFBOs[i];

        // Update the shared instance buffers with this world's data
        const gpuState = new Float32Array(Config.NUM_CELLS);
        const gpuHover = new Float32Array(Config.NUM_CELLS);
        for(let j=0; j < Config.NUM_CELLS; j++) {
            gpuState[j] = world.jsStateArray[j];
            gpuHover[j] = world.jsHoverStateArray[j];
        }
        WebGLUtils.updateBuffer(gl, hexBuffers.stateBuffer, gl.ARRAY_BUFFER, gpuState);
        WebGLUtils.updateBuffer(gl, hexBuffers.hoverBuffer, gl.ARRAY_BUFFER, gpuHover);

        // Bind FBO and render
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);
        gl.clearColor(...Config.BACKGROUND_COLOR); // Use configured background
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, Config.NUM_CELLS);
    }

    // Unbind FBO and VAO
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
}


/**
 * Renders the mini-maps and selected view to the main canvas.
 * @param {Array<object>} worldsData Array of world data objects.
 * @param {number} selectedWorldIndex Index of the selected world.
 */
function renderMainScene(worldsData, selectedWorldIndex) {
    if (!quadShaderProgram || !quadVAO) return;

    // Bind default framebuffer (null) and set viewport to canvas size
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Clear main canvas
    gl.clearColor(...Config.BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use Quad shader program and VAO
    gl.useProgram(quadShaderProgram);
    gl.bindVertexArray(quadVAO);

    // --- Calculate Layout ---
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;

    const selectedViewWidth = canvasWidth * 0.6;
    const selectedViewHeight = canvasHeight * 0.9;
    const selectedViewX = canvasWidth * 0.02;
    const selectedViewY = (canvasHeight - selectedViewHeight) / 2;

    const miniMapAreaX = selectedViewX + selectedViewWidth + canvasWidth * 0.02;
    const miniMapAreaWidth = canvasWidth - miniMapAreaX - canvasWidth * 0.02;
    const miniMapAreaHeight = canvasHeight * 0.9;
    const miniMapAreaY = canvasHeight * 0.05; // Position near top (5% margin)

    // --- ADJUST MINIMAP AREA SIZE ---
    const finalMiniMapAreaWidth = miniMapAreaWidth * 0.8; // 20% reduction
    const finalMiniMapAreaHeight = miniMapAreaHeight * 0.65; // 35% reduction
    // Center the reduced area horizontally, keep top alignment vertically
    const finalMiniMapAreaX = miniMapAreaX + (miniMapAreaWidth - finalMiniMapAreaWidth) / 2;
    const finalMiniMapAreaY = miniMapAreaY; // Use the already top-aligned Y
    // --- END ADJUSTMENT ---

    const miniMapSpacing = 5; // Horizontal spacing
    const miniMapVerticalSpacing = 1; // *** REDUCED vertical spacing ***

    // Recalculate dimensions using potentially different spacings and FINAL area size
    const miniMapW = (finalMiniMapAreaWidth - (Config.WORLD_LAYOUT_COLS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_COLS;
    // Use VERTICAL spacing for height calculation
    const miniMapH = (finalMiniMapAreaHeight - (Config.WORLD_LAYOUT_ROWS - 1) * miniMapVerticalSpacing) / Config.WORLD_LAYOUT_ROWS;


    // --- Draw Mini-Maps ---
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const col = i % Config.WORLD_LAYOUT_COLS;

        // Use HORIZONTAL spacing for X calc, using FINAL area start X
        const miniX = finalMiniMapAreaX + col * (miniMapW + miniMapSpacing);
        // Use VERTICAL spacing for Y calc, using FINAL area start Y
        const miniY = finalMiniMapAreaY + row * (miniMapH + miniMapVerticalSpacing); // *** USE CORRECT SPACING ***

        // --- Draw Selection Outline ---
        if (i === selectedWorldIndex) {
            const outlineThickness = 2; // Thickness in pixels
            gl.uniform1f(quadUniformLocations.u_useTexture, 0.0); // Use color
            gl.uniform4fv(quadUniformLocations.u_color, Config.SELECTION_OUTLINE_COLOR); // Yellow
            drawQuad(miniX - outlineThickness,
                     miniY - outlineThickness,
                     miniMapW + 2 * outlineThickness,
                     miniMapH + 2 * outlineThickness,
                     canvasWidth, canvasHeight);
            gl.uniform1f(quadUniformLocations.u_useTexture, 1.0); // Switch back to texture for the actual map
        }
        // --- End Selection Outline ---

        // Bind the texture for this world
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[i].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0); // Ensure texture is used

        drawQuad(miniX, miniY, miniMapW, miniMapH, canvasWidth, canvasHeight);
    }

    // --- Draw Selected View ---
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, worldFBOs[selectedWorldIndex].texture);
    gl.uniform1i(quadUniformLocations.texture, 0);
    drawQuad(selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight, canvasWidth, canvasHeight);

    // --- Draw Outlines (Optional) ---
    // ... (outline logic if needed) ...

    gl.bindVertexArray(null); // Unbind VAO
}


/**
 * Helper to draw a quad at specific screen pixel coordinates.
 * Assumes quadVAO and quadShaderProgram are bound.
 * Converts pixel coords to clip space for vertex positions.
 */
function drawQuad(pixelX, pixelY, pixelW, pixelH, canvasWidth, canvasHeight) {
    // Convert pixel coordinates to clip space (-1 to 1)
    const clipX = (pixelX / canvasWidth) * 2 - 1;
    const clipY = (pixelY / canvasHeight) * -2 + 1; // Flip Y
    const clipW = (pixelW / canvasWidth) * 2;
    const clipH = (pixelH / canvasHeight) * 2;

    // Calculate vertices for a triangle strip quad in clip space
    const positions = new Float32Array([
        clipX,         clipY - clipH,  // Bottom-left
        clipX + clipW, clipY - clipH,  // Bottom-right
        clipX,         clipY,          // Top-left
        clipX + clipW, clipY,          // Top-right
    ]);

    // Update the quad position buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);

    // Draw the quad
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}


// --- Public API ---

/**
 * Main render function to be called each frame.
 * @param {Array<object>} worldsData Simulation data for all worlds.
 * @param {number} selectedWorldIndex Index of the world to display magnified.
 */
export function renderFrame(worldsData, selectedWorldIndex) {
    if (!gl) return;

    // 1. Render simulation state of each world into its texture
    renderWorldsToTextures(worldsData);

    // 2. Render the main scene using the generated textures
    renderMainScene(worldsData, selectedWorldIndex);
}

/**
 * Handles canvas resize events.
 */
export function resizeRenderer() {
    if (!gl || !canvas) return;
    // Use utility to resize canvas drawing buffer and set main viewport
    Utils.resizeCanvasToDisplaySize(canvas, gl);
}
