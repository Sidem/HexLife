// src/rendering/renderer.js
import * as Config from '../core/config.js';
import * as WebGLUtils from './webglUtils.js';
import * as Utils from '../utils/utils.js';

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

// Buffers & VAOs
let hexBuffers;
let quadBuffers; // For drawing textures and colored quads (like overlays)
let hexVAO;
let quadVAO;

// --- Initialization ---
export async function initRenderer(canvasElement) {
    canvas = canvasElement;
    gl = canvas.getContext('webgl2');
    if (!gl) {
        alert("WebGL 2 not supported!");
        console.error("WebGL 2 not supported!");
        return null;
    }

    hexShaderProgram = await WebGLUtils.loadShaderProgram(gl, 'shaders/vertex.glsl', 'shaders/fragment.glsl');
    quadShaderProgram = await WebGLUtils.loadShaderProgram(gl, 'shaders/quad_vertex.glsl', 'shaders/quad_fragment.glsl');

    if (!hexShaderProgram || !quadShaderProgram) return null;

    hexAttributeLocations = {
        position: gl.getAttribLocation(hexShaderProgram, "a_position"),
        instanceOffset: gl.getAttribLocation(hexShaderProgram, "a_instance_offset"),
        instanceState: gl.getAttribLocation(hexShaderProgram, "a_instance_state"),
        instanceHoverState: gl.getAttribLocation(hexShaderProgram, "a_instance_hover_state"),
        instanceRuleIndex: gl.getAttribLocation(hexShaderProgram, "a_instance_rule_index"),
    };
    hexUniformLocations = {
        resolution: gl.getUniformLocation(hexShaderProgram, "u_resolution"),
        hexSize: gl.getUniformLocation(hexShaderProgram, "u_hexSize"),
        hoverFilledDarkenFactor: gl.getUniformLocation(hexShaderProgram, "u_hoverFilledDarkenFactor"),
        hoverInactiveLightenFactor: gl.getUniformLocation(hexShaderProgram, "u_hoverInactiveLightenFactor"),
    };

    quadAttributeLocations = {
        position: gl.getAttribLocation(quadShaderProgram, "a_position"),
        texCoord: gl.getAttribLocation(quadShaderProgram, "a_texCoord"),
    };
    quadUniformLocations = {
        texture: gl.getUniformLocation(quadShaderProgram, "u_texture"),
        u_color: gl.getUniformLocation(quadShaderProgram, "u_color"),
        u_useTexture: gl.getUniformLocation(quadShaderProgram, "u_useTexture"),
    };

    setupHexBuffersAndVAO();
    setupQuadBuffersAndVAO(); // Ensure this sets up for full FBO quad draw
    setupFBOs();

    resizeRenderer();
    console.log("Renderer initialized.");
    return gl;
}

function setupHexBuffersAndVAO() {
    hexBuffers = {};
    const hexVertices = Utils.createFlatTopHexagonVertices(); // 6 vertices for a fan
    hexBuffers.positionBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, hexVertices, gl.STATIC_DRAW);

    const instanceOffsets = new Float32Array(Config.NUM_CELLS * 2);
    const textureHexSize = Utils.calculateHexSizeForTexture();
    const startX = textureHexSize;
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

    const initialZeros = new Float32Array(Config.NUM_CELLS).fill(0.0);
    hexBuffers.stateBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);
    hexBuffers.hoverBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);
    hexBuffers.ruleIndexBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);

    hexVAO = gl.createVertexArray();
    gl.bindVertexArray(hexVAO);
    // Position Attribute (per vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.positionBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.position);
    gl.vertexAttribPointer(hexAttributeLocations.position, 2, gl.FLOAT, false, 0, 0);
    // Instance Attributes (per instance)
    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.offsetBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceOffset);
    gl.vertexAttribPointer(hexAttributeLocations.instanceOffset, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceOffset, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.stateBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceState);
    gl.vertexAttribPointer(hexAttributeLocations.instanceState, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceState, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.hoverBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceHoverState);
    gl.vertexAttribPointer(hexAttributeLocations.instanceHoverState, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceHoverState, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.ruleIndexBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceRuleIndex);
    gl.vertexAttribPointer(hexAttributeLocations.instanceRuleIndex, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceRuleIndex, 1);

    gl.bindVertexArray(null);
}

function setupQuadBuffersAndVAO() {
    quadBuffers = {};
    // Fullscreen quad in clip space; also suitable for drawing to FBO texture space
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]); // Covers clip space
    const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]); // Standard texture coords

    quadBuffers.positionBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    quadBuffers.texCoordBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    quadVAO = gl.createVertexArray();
    gl.bindVertexArray(quadVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.positionBuffer);
    gl.enableVertexAttribArray(quadAttributeLocations.position);
    gl.vertexAttribPointer(quadAttributeLocations.position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.texCoordBuffer);
    gl.enableVertexAttribArray(quadAttributeLocations.texCoord);
    gl.vertexAttribPointer(quadAttributeLocations.texCoord, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
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

function renderWorldsToTextures(worldsData) {
    gl.viewport(0, 0, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE); // Set viewport for FBO rendering

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const world = worldsData[i];
        const fboData = worldFBOs[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);

        // Clear with standard background first
        gl.clearColor(...Config.BACKGROUND_COLOR);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (world.enabled) {
            if (!hexShaderProgram || !hexVAO) continue;
            gl.useProgram(hexShaderProgram);
            gl.bindVertexArray(hexVAO);

            const textureHexSize = Utils.calculateHexSizeForTexture();
            gl.uniform2f(hexUniformLocations.resolution, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
            gl.uniform1f(hexUniformLocations.hexSize, textureHexSize);
            gl.uniform1f(hexUniformLocations.hoverFilledDarkenFactor, Config.HOVER_FILLED_DARKEN_FACTOR);
            gl.uniform1f(hexUniformLocations.hoverInactiveLightenFactor, Config.HOVER_INACTIVE_LIGHTEN_FACTOR);

            // Convert Uint8Array to Float32Array for GPU
            const gpuState = new Float32Array(world.jsStateArray);
            const gpuHover = new Float32Array(world.jsHoverStateArray);
            const gpuRuleIndex = new Float32Array(world.jsRuleIndexArray);

            WebGLUtils.updateBuffer(gl, hexBuffers.stateBuffer, gl.ARRAY_BUFFER, gpuState);
            WebGLUtils.updateBuffer(gl, hexBuffers.hoverBuffer, gl.ARRAY_BUFFER, gpuHover);
            WebGLUtils.updateBuffer(gl, hexBuffers.ruleIndexBuffer, gl.ARRAY_BUFFER, gpuRuleIndex);

            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, Config.NUM_CELLS); // 6 vertices for base hex
        } else {
            // World is disabled: Draw a semi-transparent overlay
            if (!quadShaderProgram || !quadVAO) continue;
            gl.useProgram(quadShaderProgram);
            gl.bindVertexArray(quadVAO);

            gl.uniform1f(quadUniformLocations.u_useTexture, 0.0); // Don't use texture
            gl.uniform4fv(quadUniformLocations.u_color, Config.DISABLED_WORLD_OVERLAY_COLOR);

            // The quadVAO is already set up for full clip-space rendering.
            // Since we are rendering to an FBO, clip space (-1 to 1) maps to the FBO texture.
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind FBO
    gl.bindVertexArray(null); // Unbind VAO
}


function renderMainScene(worldsData, selectedWorldIndex) {
    if (!quadShaderProgram || !quadVAO) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Render to canvas
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(...Config.BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(quadShaderProgram);
    gl.bindVertexArray(quadVAO);

    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;
    const isLandscape = canvasWidth >= canvasHeight;
    let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
    let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;

    const padding = Math.min(canvasWidth, canvasHeight) * 0.02;

    if (isLandscape) {
        selectedViewWidth = canvasWidth * 0.6 - padding * 1.5;
        selectedViewHeight = canvasHeight - padding * 2;
        selectedViewX = padding;
        selectedViewY = padding;
        miniMapAreaWidth = canvasWidth * 0.4 - padding * 1.5;
        miniMapAreaHeight = selectedViewHeight;
        miniMapAreaX = selectedViewX + selectedViewWidth + padding;
        miniMapAreaY = padding;
    } else {
        selectedViewHeight = canvasHeight * 0.6 - padding * 1.5;
        selectedViewWidth = canvasWidth - padding * 2;
        selectedViewX = padding;
        selectedViewY = padding;
        miniMapAreaHeight = canvasHeight * 0.4 - padding * 1.5;
        miniMapAreaWidth = selectedViewWidth;
        miniMapAreaX = padding;
        miniMapAreaY = selectedViewY + selectedViewHeight + padding;
    }

    const miniMapGridRatio = Config.WORLD_LAYOUT_COLS / Config.WORLD_LAYOUT_ROWS;
    const miniMapAreaRatio = miniMapAreaWidth / miniMapAreaHeight;
    let gridContainerWidth, gridContainerHeight;
    const miniMapContainerPaddingFactor = 0.95;

    if (miniMapAreaRatio > miniMapGridRatio) {
        gridContainerHeight = miniMapAreaHeight * miniMapContainerPaddingFactor;
        gridContainerWidth = gridContainerHeight * miniMapGridRatio;
    } else {
        gridContainerWidth = miniMapAreaWidth * miniMapContainerPaddingFactor;
        gridContainerHeight = gridContainerWidth / miniMapGridRatio;
    }
    const gridContainerX = miniMapAreaX + (miniMapAreaWidth - gridContainerWidth) / 2;
    const gridContainerY = miniMapAreaY + (miniMapAreaHeight - gridContainerHeight) / 2;
    const miniMapSpacing = Math.min(gridContainerWidth, gridContainerHeight) * 0.01;

    const miniMapW = (gridContainerWidth - (Config.WORLD_LAYOUT_COLS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_COLS;
    const miniMapH = (gridContainerHeight - (Config.WORLD_LAYOUT_ROWS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_ROWS;

    // Render Mini-maps
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const col = i % Config.WORLD_LAYOUT_COLS;
        const miniX = gridContainerX + col * (miniMapW + miniMapSpacing);
        const miniY = gridContainerY + row * (miniMapH + miniMapSpacing);

        // Draw selection outline if this world is selected AND enabled
        // If a disabled world is "selected" via index, it will still show its disabled FBO in main view.
        // The outline should ideally only show for an *active* selection of an enabled world.
        // For now, let's keep outline logic tied to selectedWorldIndex, but an enabled world.
        if (i === selectedWorldIndex && worldsData[i] && worldsData[i].enabled) {
            const outlineThickness = Math.max(2, Math.min(miniMapW, miniMapH) * 0.03); // Dynamic thickness
            gl.uniform1f(quadUniformLocations.u_useTexture, 0.0); // Don't use texture for outline
            gl.uniform4fv(quadUniformLocations.u_color, Config.SELECTION_OUTLINE_COLOR);
            drawQuad(miniX - outlineThickness, miniY - outlineThickness, miniMapW + 2 * outlineThickness, miniMapH + 2 * outlineThickness);
        }

        // Draw the FBO texture for the mini-map
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[i].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0); // Use texture
        drawQuad(miniX, miniY, miniMapW, miniMapH);
    }

    // Render Selected World View (larger)
    // It will correctly show the FBO content, which is already handled (disabled overlay or active cells)
    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldFBOs.length) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[selectedWorldIndex].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight);
    }

    gl.bindVertexArray(null);
}

// Helper to draw a quad at specific pixel coordinates on the canvas
// Modifies the quad's vertex buffer for position
function drawQuad(pixelX, pixelY, pixelW, pixelH) {
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;

    // Convert pixel coordinates to clip space coordinates
    const clipX = (pixelX / canvasWidth) * 2 - 1;
    const clipY = (pixelY / canvasHeight) * -2 + 1; // Y is inverted in clip space
    const clipW = (pixelW / canvasWidth) * 2;
    const clipH = (pixelH / canvasHeight) * 2;

    // Define the vertices for the quad in clip space
    // Vertex order: bottom-left, bottom-right, top-left, top-right (for TRIANGLE_STRIP)
    const positions = new Float32Array([
        clipX,         clipY - clipH,  // Bottom-left
        clipX + clipW, clipY - clipH,  // Bottom-right
        clipX,         clipY,          // Top-left
        clipX + clipW, clipY           // Top-right
    ]);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions); // Update only position data

    // Texture coordinates in quadBuffers.texCoordBuffer remain [0,0, 1,0, 0,1, 1,1]
    // which is correct for mapping a texture to this quad.
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}


// --- Public API ---
export function renderFrame(worldsData, selectedWorldIndex) {
    if (!gl) return;
    renderWorldsToTextures(worldsData); // worldsData now includes 'enabled' status
    renderMainScene(worldsData, selectedWorldIndex);
}

export function resizeRenderer() {
    if (!gl || !canvas) return;
    Utils.resizeCanvasToDisplaySize(canvas, gl); // This sets canvas W/H and viewport
    // No need to re-render explicitly here, renderLoop will handle it.
}