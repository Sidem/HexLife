// renderer.js
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
let hexUniformLocations; // This will now store more hover-related uniforms

// Locations for Quad Shader
let quadAttributeLocations;
let quadUniformLocations;

// Framebuffer Objects (one per world)
let worldFBOs = []; // Array of { fbo: WebGLFramebuffer, texture: WebGLTexture }

// A simple buffer for drawing outlines (optional, might not need complex VAO)
let lineBuffer;

// Buffers & VAOs
let hexBuffers; // { positionBuffer, offsetBuffer, stateBuffer, hoverStateBuffer, ruleIndexBuffer }
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
    hexShaderProgram = await WebGLUtils.loadShaderProgram(gl, 'shaders/vertex.glsl', 'shaders/fragment.glsl');
    quadShaderProgram = await WebGLUtils.loadShaderProgram(gl, 'shaders/quad_vertex.glsl', 'shaders/quad_fragment.glsl');

    if (!hexShaderProgram || !quadShaderProgram) {
        return null;
    }

    // --- Get Locations for Hex Shader ---
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
        // Get locations for all hover-related uniforms used in the fragment shader
        hoverFilledDarkenFactor: gl.getUniformLocation(hexShaderProgram, "u_hoverFilledDarkenFactor"),
        hoverInactiveLightenFactor: gl.getUniformLocation(hexShaderProgram, "u_hoverInactiveLightenFactor"),
        // u_hoverEmptyFillColor is no longer directly used by the modified logic,
        // but if you had it here before, you might remove it or leave it if other parts use it.
        // hoverEmptyFillColor: gl.getUniformLocation(hexShaderProgram, "u_hoverEmptyFillColor"),
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

    // 3. Instance State, Hover & RuleIndex Buffers (Dynamic - sized for one world)
    const initialZeros = new Float32Array(Config.NUM_CELLS).fill(0.0);
    hexBuffers.stateBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);
    hexBuffers.hoverBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);
    hexBuffers.ruleIndexBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZeros, gl.DYNAMIC_DRAW);

    // 4. Setup Hex VAO
    hexVAO = gl.createVertexArray();
    gl.bindVertexArray(hexVAO);

    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.positionBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.position);
    gl.vertexAttribPointer(hexAttributeLocations.position, 2, gl.FLOAT, false, 0, 0);

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
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
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

/**
 * Renders all world states to their respective FBO textures.
 * @param {Array<object>} worldsData Array of world data objects from simulation.js.
 */
function renderWorldsToTextures(worldsData) {
    if (!hexShaderProgram || !hexVAO) return;

    gl.useProgram(hexShaderProgram);
    gl.bindVertexArray(hexVAO);

    const textureHexSize = Utils.calculateHexSizeForTexture();
    gl.uniform2f(hexUniformLocations.resolution, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
    gl.uniform1f(hexUniformLocations.hexSize, textureHexSize);

    // Set the hover factor uniforms
    gl.uniform1f(hexUniformLocations.hoverFilledDarkenFactor, Config.HOVER_FILLED_DARKEN_FACTOR);
    gl.uniform1f(hexUniformLocations.hoverInactiveLightenFactor, Config.HOVER_INACTIVE_LIGHTEN_FACTOR);
    // If u_hoverEmptyFillColor was set here before, it can be removed if no longer needed.
    // Example: gl.uniform4fv(hexUniformLocations.hoverEmptyFillColor, Config.HOVER_EMPTY_FILL_COLOR);

    gl.viewport(0, 0, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const world = worldsData[i];
        const fboData = worldFBOs[i];

        const gpuState = new Float32Array(Config.NUM_CELLS);
        const gpuHover = new Float32Array(Config.NUM_CELLS);
        const gpuRuleIndex = new Float32Array(Config.NUM_CELLS);

        for(let j=0; j < Config.NUM_CELLS; j++) {
            gpuState[j] = world.jsStateArray[j];
            gpuHover[j] = world.jsHoverStateArray[j];
            gpuRuleIndex[j] = world.jsRuleIndexArray[j];
        }
        WebGLUtils.updateBuffer(gl, hexBuffers.stateBuffer, gl.ARRAY_BUFFER, gpuState);
        WebGLUtils.updateBuffer(gl, hexBuffers.hoverBuffer, gl.ARRAY_BUFFER, gpuHover);
        WebGLUtils.updateBuffer(gl, hexBuffers.ruleIndexBuffer, gl.ARRAY_BUFFER, gpuRuleIndex);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);
        gl.clearColor(...Config.BACKGROUND_COLOR);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, Config.NUM_CELLS);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
}


/**
 * Renders the mini-maps and selected view to the main canvas, adjusting layout based on orientation.
 * @param {Array<object>} worldsData Array of world data objects.
 * @param {number} selectedWorldIndex Index of the selected world.
 */
function renderMainScene(worldsData, selectedWorldIndex) {
    if (!quadShaderProgram || !quadVAO) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    const padding = canvasWidth * 0.02;

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
    if (miniMapAreaRatio > miniMapGridRatio) {
        gridContainerHeight = miniMapAreaHeight * 0.95;
        gridContainerWidth = gridContainerHeight * miniMapGridRatio;
    } else {
        gridContainerWidth = miniMapAreaWidth * 0.95;
        gridContainerHeight = gridContainerWidth / miniMapGridRatio;
    }
    const gridContainerX = miniMapAreaX + (miniMapAreaWidth - gridContainerWidth) / 2;
    const gridContainerY = miniMapAreaY + (miniMapAreaHeight - gridContainerHeight) / 2;
    const miniMapSpacing = 5;
    const miniMapW = (gridContainerWidth - (Config.WORLD_LAYOUT_COLS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_COLS;
    const miniMapH = (gridContainerHeight - (Config.WORLD_LAYOUT_ROWS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_ROWS;

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const col = i % Config.WORLD_LAYOUT_COLS;
        const miniX = gridContainerX + col * (miniMapW + miniMapSpacing);
        const miniY = gridContainerY + row * (miniMapH + miniMapSpacing);

        if (i === selectedWorldIndex) {
            const outlineThickness = 2;
            gl.uniform1f(quadUniformLocations.u_useTexture, 0.0);
            gl.uniform4fv(quadUniformLocations.u_color, Config.SELECTION_OUTLINE_COLOR);
            drawQuad(miniX - outlineThickness, miniY - outlineThickness, miniMapW + 2 * outlineThickness, miniMapH + 2 * outlineThickness, canvasWidth, canvasHeight);
            gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[i].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(miniX, miniY, miniMapW, miniMapH, canvasWidth, canvasHeight);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, worldFBOs[selectedWorldIndex].texture);
    gl.uniform1i(quadUniformLocations.texture, 0);
    gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
    drawQuad(selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight, canvasWidth, canvasHeight);

    gl.bindVertexArray(null);
}

function drawQuad(pixelX, pixelY, pixelW, pixelH, canvasWidth, canvasHeight) {
    const clipX = (pixelX / canvasWidth) * 2 - 1;
    const clipY = (pixelY / canvasHeight) * -2 + 1;
    const clipW = (pixelW / canvasWidth) * 2;
    const clipH = (pixelH / canvasHeight) * 2;
    const positions = new Float32Array([clipX, clipY - clipH, clipX + clipW, clipY - clipH, clipX, clipY, clipX + clipW, clipY]);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// --- Public API ---
export function renderFrame(worldsData, selectedWorldIndex) {
    if (!gl) return;
    renderWorldsToTextures(worldsData);
    renderMainScene(worldsData, selectedWorldIndex);
}

export function resizeRenderer() {
    if (!gl || !canvas) return;
    Utils.resizeCanvasToDisplaySize(canvas, gl);
}