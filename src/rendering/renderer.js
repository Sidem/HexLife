import * as Config from '../core/config.js';
import * as WebGLUtils from './webglUtils.js';
import * as Utils from '../utils/utils.js';
import { generateColorLUT } from '../utils/ruleVizUtils.js';

let gl;
let canvas;

let hexShaderProgram;
let quadShaderProgram;
let hexAttributeLocations;
let hexUniformLocations;
let quadAttributeLocations;
let quadUniformLocations;
let worldFBOs = [];
let hexBuffers;
let quadBuffers;
let hexVAO;
let quadVAO;
let hexLUTTexture = null;
let disabledTextTexture = null;

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
        colorLUT: gl.getUniformLocation(hexShaderProgram, "u_colorLUT"),
        // NEW: Add locations for pan and zoom uniforms
        pan: gl.getUniformLocation(hexShaderProgram, "u_pan"),
        zoom: gl.getUniformLocation(hexShaderProgram, "u_zoom"),
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
    const lutData = generateColorLUT();
    hexLUTTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hexLUTTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    try {
        const tempCanvas = document.createElement('canvas');
        const texQualityMultiplier = 2;
        const texSize = 128 * texQualityMultiplier;
        tempCanvas.width = texSize;
        tempCanvas.height = texSize;
        const ctx2d = tempCanvas.getContext('2d');

        ctx2d.clearRect(0, 0, texSize, texSize);
        
        ctx2d.translate(-texSize / 2, texSize / 1.95);
        ctx2d.scale(1, -1);
        ctx2d.fillStyle = 'rgba(220, 220, 220, 0.9)';
        const fontSize = texSize / 8; 
        ctx2d.font = `bold ${fontSize}px sans-serif`;
        
        
        ctx2d.fillText('DISABLED', texSize / 2, texSize / 2);


        disabledTextTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, disabledTextTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);

    } catch (e) {
        console.error("Failed to create disabledTextTexture:", e);
        disabledTextTexture = null;
    }

    setupHexBuffersAndVAO();
    setupQuadBuffersAndVAO();
    setupFBOs();

    resizeRenderer();
    console.log("Renderer initialized.");
    return gl;
}

function setupHexBuffersAndVAO() {
    hexBuffers = {};
    const hexVertices = Utils.createFlatTopHexagonVertices();
    hexBuffers.positionBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, hexVertices, gl.STATIC_DRAW);

    const instanceOffsets = new Float32Array(Config.NUM_CELLS * 2);
    const textureHexSize = Utils.calculateHexSizeForTexture();
    const startX = Config.RENDER_TEXTURE_SIZE / 2; // Center grid in texture
    const startY = Config.RENDER_TEXTURE_SIZE / 2;

    for (let i = 0; i < Config.NUM_CELLS; i++) {
        const coords = Utils.indexToCoords(i);
        if (coords) {
            const pixelCoords = Utils.gridToPixelCoords(coords.col, coords.row, textureHexSize);
            instanceOffsets[i * 2] = pixelCoords.x;
            instanceOffsets[i * 2 + 1] = pixelCoords.y;
        }
    }
    hexBuffers.offsetBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, instanceOffsets, gl.STATIC_DRAW);

    
    const initialZerosUint8 = new Uint8Array(Config.NUM_CELLS).fill(0);
    hexBuffers.stateBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZerosUint8, gl.DYNAMIC_DRAW);
    hexBuffers.hoverBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZerosUint8, gl.DYNAMIC_DRAW);
    hexBuffers.ruleIndexBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZerosUint8, gl.DYNAMIC_DRAW);

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
    gl.vertexAttribPointer(hexAttributeLocations.instanceState, 1, gl.UNSIGNED_BYTE, false, 0, 0); 
    gl.vertexAttribDivisor(hexAttributeLocations.instanceState, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.hoverBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceHoverState);
    gl.vertexAttribPointer(hexAttributeLocations.instanceHoverState, 1, gl.UNSIGNED_BYTE, false, 0, 0); 
    gl.vertexAttribDivisor(hexAttributeLocations.instanceHoverState, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.ruleIndexBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceRuleIndex);
    gl.vertexAttribPointer(hexAttributeLocations.instanceRuleIndex, 1, gl.UNSIGNED_BYTE, false, 0, 0); 
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

// UPDATED: Function signature to accept camera and selectedWorldIndex
function renderWorldsToTextures(allWorldsData, selectedWorldIndex, camera) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.viewport(0, 0, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, hexLUTTexture);

    gl.useProgram(hexShaderProgram);
    gl.bindVertexArray(hexVAO);

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const worldData = allWorldsData[i];
        const fboData = worldFBOs[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);

        const clearColor = (worldData && worldData.enabled) ? Config.BACKGROUND_COLOR : Config.DISABLED_WORLD_OVERLAY_COLOR;
        gl.clearColor(...clearColor);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (worldData && worldData.enabled) {
            if (!worldData.jsStateArray || !worldData.jsRuleIndexArray || !worldData.jsHoverStateArray) {
                continue;
            }

            const textureHexSize = Utils.calculateHexSizeForTexture();
            gl.uniform2f(hexUniformLocations.resolution, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
            gl.uniform1f(hexUniformLocations.hexSize, textureHexSize);
            gl.uniform1f(hexUniformLocations.hoverFilledDarkenFactor, Config.HOVER_FILLED_DARKEN_FACTOR);
            gl.uniform1f(hexUniformLocations.hoverInactiveLightenFactor, Config.HOVER_INACTIVE_LIGHTEN_FACTOR);
            gl.uniform1i(hexUniformLocations.colorLUT, 1);
            
            // NEW: Apply pan and zoom uniforms
            // Apply transformation for the selected world, use defaults for others
            if (i === selectedWorldIndex) {
                gl.uniform2f(hexUniformLocations.pan, camera.x, camera.y);
                gl.uniform1f(hexUniformLocations.zoom, camera.zoom);
            } else {
                // Default view for mini-maps
                gl.uniform2f(hexUniformLocations.pan, Config.RENDER_TEXTURE_SIZE / 2, Config.RENDER_TEXTURE_SIZE / 2);
                gl.uniform1f(hexUniformLocations.zoom, 1.0);
            }

            WebGLUtils.updateBuffer(gl, hexBuffers.stateBuffer, gl.ARRAY_BUFFER, worldData.jsStateArray);
            WebGLUtils.updateBuffer(gl, hexBuffers.hoverBuffer, gl.ARRAY_BUFFER, worldData.jsHoverStateArray);
            WebGLUtils.updateBuffer(gl, hexBuffers.ruleIndexBuffer, gl.ARRAY_BUFFER, worldData.jsRuleIndexArray);

            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, Config.NUM_CELLS);

        } else if (disabledTextTexture) {
            // This part requires switching programs, which is less efficient inside the loop.
            // For now, we'll keep it, but a refactor could separate enabled/disabled world rendering.
            gl.useProgram(quadShaderProgram);
            gl.bindVertexArray(quadVAO);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, disabledTextTexture);
            gl.uniform1i(quadUniformLocations.texture, 0);
            gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.disable(gl.BLEND);
            // Switch back to hex program for the next loop iteration
            gl.useProgram(hexShaderProgram);
            gl.bindVertexArray(hexVAO);
        }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
}

// UNCHANGED: This function now just composites the final textures.
function renderMainScene(selectedWorldIndex) {
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

    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldFBOs.length) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[selectedWorldIndex].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight);
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

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const col = i % Config.WORLD_LAYOUT_COLS;
        const miniX = gridContainerX + col * (miniMapW + miniMapSpacing);
        const miniY = gridContainerY + row * (miniMapH + miniMapSpacing);
        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[i].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(miniX, miniY, miniMapW, miniMapH);

        if (i === selectedWorldIndex) {
            const outlineThickness = Math.max(2, Math.min(miniMapW, miniMapH) * 0.02);
            gl.uniform1f(quadUniformLocations.u_useTexture, 0.0);
            gl.uniform4fv(quadUniformLocations.u_color, Config.SELECTION_OUTLINE_COLOR);
            drawQuad(miniX - outlineThickness, miniY - outlineThickness, miniMapW + 2 * outlineThickness, miniMapH + 2 * outlineThickness);
        }
    }

    gl.bindVertexArray(null);
}

function drawQuad(pixelX, pixelY, pixelW, pixelH) {
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;
    const clipX = (pixelX / canvasWidth) * 2 - 1;
    const clipY = (pixelY / canvasHeight) * -2 + 1;
    const clipW = (pixelW / canvasWidth) * 2;
    const clipH = (pixelH / canvasHeight) * 2;
    const positions = new Float32Array([
        clipX, clipY - clipH,
        clipX + clipW, clipY - clipH,
        clipX, clipY,
        clipX + clipW, clipY
    ]);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function renderLoader() {
    if (!gl) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(...Config.BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!quadShaderProgram || !quadVAO) return;

    gl.useProgram(quadShaderProgram);
    gl.bindVertexArray(quadVAO);

    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    const time = performance.now() * 0.002;
    const radius = Math.min(canvasWidth, canvasHeight) * 0.1;
    const dotSize = Math.min(canvasWidth, canvasHeight) * 0.015;

    const numDots = 8;
    for (let i = 0; i < numDots; i++) {
        const angle = (i / numDots) * Math.PI * 2 + time;
        const dotX = centerX + Math.cos(angle) * radius - dotSize / 2;
        const dotY = centerY + Math.sin(angle) * radius - dotSize / 2;

        const alpha = 0.3 + 0.7 * (Math.sin(angle - time) + 1) / 2;

        gl.uniform1f(quadUniformLocations.u_useTexture, 0.0);
        gl.uniform4fv(quadUniformLocations.u_color, [1.0, 1.0, 1.0, alpha]);
        drawQuad(dotX, dotY, dotSize, dotSize);
    }

    gl.bindVertexArray(null);
}

export function renderFrameOrLoader(allWorldsData, selectedWorldIndex, areAllWorkersInitialized, camera) {
    if (!gl) return;

    if (!areAllWorkersInitialized) {
        renderLoader();
    } else {
        renderWorldsToTextures(allWorldsData, selectedWorldIndex, camera);
        renderMainScene(selectedWorldIndex);
    }
}

export function resizeRenderer() {
    if (!gl || !canvas) return;
    Utils.resizeCanvasToDisplaySize(canvas, gl);
}