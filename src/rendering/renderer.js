import * as Config from '../core/config.js';
import * as WebGLUtils from './webglUtils.js';
import * as Utils from '../utils/utils.js';
import { generateColorLUT } from '../utils/ruleVizUtils.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { rulesetVisualizer } from '../utils/rulesetVisualizer.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { uiManager } from '../ui/UIManager.js';
// visualizationController access is now provided via the rendering context

let gl;
let canvas;
let layoutCache = {}; 

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
let minimapOverlayElements = [];
let cycleIndicatorElements = [];
let lastWorldSettings = [];

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
        instanceGhostState: gl.getAttribLocation(hexShaderProgram, "a_instance_ghost_state"), 
    };
    hexUniformLocations = {
        resolution: gl.getUniformLocation(hexShaderProgram, "u_resolution"),
        hexSize: gl.getUniformLocation(hexShaderProgram, "u_hexSize"),
        hoverFilledDarkenFactor: gl.getUniformLocation(hexShaderProgram, "u_hoverFilledDarkenFactor"),
        hoverInactiveLightenFactor: gl.getUniformLocation(hexShaderProgram, "u_hoverInactiveLightenFactor"),
        colorLUT: gl.getUniformLocation(hexShaderProgram, "u_colorLUT"),
        
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
    initMinimapOverlays();
    initCycleIndicators();

    EventBus.subscribe(EVENTS.UI_MODE_CHANGED, ({ mode }) => {
        _handleUIModeChange(mode);
    });

    _handleUIModeChange(uiManager.getMode());

    requestAnimationFrame(() => resizeRenderer());

    console.log("Renderer initialized.");
    return gl;
}

function _handleUIModeChange(mode) {
    if (!minimapOverlayElements || minimapOverlayElements.length === 0) return;
    const isMobile = mode === 'mobile';
    minimapOverlayElements.forEach(overlay => {
        overlay.classList.toggle('mini', isMobile);
    });
    cycleIndicatorElements.forEach(indicator => {
        indicator.classList.toggle('mini', isMobile);
    });
}

function _calculateAndCacheLayout() {
    if (!gl || !gl.canvas) return;
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;
    const padding = Math.min(canvasWidth, canvasHeight) * 0.02;

    let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
    let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;

    const isLandscape = canvasWidth >= canvasHeight;
    const aspectRatio = canvasWidth / canvasHeight;
    if (isLandscape && aspectRatio > 1.2) {
        selectedViewWidth = canvasWidth * 0.6 - padding * 1.5;
        selectedViewHeight = canvasHeight - padding * 2;
        selectedViewX = padding;
        selectedViewY = padding;
        miniMapAreaWidth = canvasWidth * 0.4 - padding * 1.5;
        miniMapAreaHeight = selectedViewHeight;
        miniMapAreaX = selectedViewX + selectedViewWidth + padding;
        miniMapAreaY = padding;
    } else {
        selectedViewHeight = canvasHeight * 0.65 - padding * 1.5;
        selectedViewWidth = canvasWidth - padding * 2;
        selectedViewX = padding;
        selectedViewY = padding;
        miniMapAreaHeight = canvasHeight * 0.35 - padding * 1.5;
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
    const miniMapSpacing = Math.min(gridContainerWidth, gridContainerHeight) * 0.02;
    const miniMapW = (gridContainerWidth - (Config.WORLD_LAYOUT_COLS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_COLS;
    const miniMapH = (gridContainerHeight - (Config.WORLD_LAYOUT_ROWS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_ROWS;

    layoutCache = {
        selectedView: { x: selectedViewX, y: selectedViewY, width: selectedViewWidth, height: selectedViewHeight },
        miniMap: { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing }
    };
    EventBus.dispatch(EVENTS.LAYOUT_CALCULATED, { ...layoutCache });
}

function initMinimapOverlays() {
    const container = document.getElementById('minimap-guide');
    if (!container) return;
    container.innerHTML = '';
    minimapOverlayElements = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const overlay = document.createElement('div');
        overlay.className = 'minimap-ruleset-overlay';
        overlay.style.display = 'none'; 
        container.appendChild(overlay);
        minimapOverlayElements.push(overlay);
    }
}

function initCycleIndicators() {
    const container = document.getElementById('minimap-guide');
    if (!container) return;
    cycleIndicatorElements = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        let indicator = container.querySelector(`.cycle-indicator[data-world-id='${i}']`);
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'cycle-indicator hidden';
            indicator.dataset.worldId = i;
            container.appendChild(indicator);
        }
        cycleIndicatorElements.push(indicator);
    }
}

export function getLayoutCache() {
    return layoutCache;
}

function setupHexBuffersAndVAO() {
    hexBuffers = {};
    const hexVertices = Utils.createFlatTopHexagonVertices();
    hexBuffers.positionBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, hexVertices, gl.STATIC_DRAW);

    const instanceOffsets = new Float32Array(Config.NUM_CELLS * 2);
    const textureHexSize = Utils.calculateHexSizeForTexture();
    const startX = 0;
    const startY = 0;

    for (let i = 0; i < Config.NUM_CELLS; i++) {
        const coords = Utils.indexToCoords(i);
        if (coords) {
            const pixelCoords = Utils.gridToPixelCoords(coords.col, coords.row, textureHexSize, startX, startY);
            instanceOffsets[i * 2] = pixelCoords.x;
            instanceOffsets[i * 2 + 1] = pixelCoords.y;
        }
    }
    hexBuffers.offsetBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, instanceOffsets, gl.STATIC_DRAW);

    
    const initialZerosUint8 = new Uint8Array(Config.NUM_CELLS).fill(0);
    hexBuffers.stateBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZerosUint8, gl.DYNAMIC_DRAW);
    hexBuffers.hoverBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZerosUint8, gl.DYNAMIC_DRAW);
    hexBuffers.ruleIndexBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZerosUint8, gl.DYNAMIC_DRAW);
    hexBuffers.ghostBuffer = WebGLUtils.createBuffer(gl, gl.ARRAY_BUFFER, initialZerosUint8, gl.DYNAMIC_DRAW); 

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

    gl.bindBuffer(gl.ARRAY_BUFFER, hexBuffers.ghostBuffer);
    gl.enableVertexAttribArray(hexAttributeLocations.instanceGhostState);
    gl.vertexAttribPointer(hexAttributeLocations.instanceGhostState, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.vertexAttribDivisor(hexAttributeLocations.instanceGhostState, 1);

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

function renderWorldsToTextures(allWorldsStatus, selectedWorldIndex, camera) {
    gl.viewport(0, 0, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);

    
    gl.useProgram(hexShaderProgram);
    gl.bindVertexArray(hexVAO);
    
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, hexLUTTexture);
    gl.uniform1i(hexUniformLocations.colorLUT, 1);

    
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const worldStatus = allWorldsStatus[i];
        const worldData = worldStatus ? worldStatus.renderData : null;
        if (worldData && worldData.enabled) {
            const fboData = worldFBOs[i];
            gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);

            
            gl.clearColor(...Config.BACKGROUND_COLOR);
            gl.clear(gl.COLOR_BUFFER_BIT);

            
            if (!worldData.jsStateArray || !worldData.jsRuleIndexArray || !worldData.jsHoverStateArray) {
                continue;
            }

            
            const textureHexSize = Utils.calculateHexSizeForTexture();
            gl.uniform2f(hexUniformLocations.resolution, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
            gl.uniform1f(hexUniformLocations.hexSize, textureHexSize);
            gl.uniform1f(hexUniformLocations.hoverFilledDarkenFactor, Config.HOVER_FILLED_DARKEN_FACTOR);
            gl.uniform1f(hexUniformLocations.hoverInactiveLightenFactor, Config.HOVER_INACTIVE_LIGHTEN_FACTOR);
            
            
            
            if (i === selectedWorldIndex) {
                gl.uniform2f(hexUniformLocations.pan, camera.x, camera.y);
                gl.uniform1f(hexUniformLocations.zoom, camera.zoom);
            } else {
                
                gl.uniform2f(hexUniformLocations.pan, Config.RENDER_TEXTURE_SIZE / 2, Config.RENDER_TEXTURE_SIZE / 2);
                gl.uniform1f(hexUniformLocations.zoom, 1.0);
            }

            
            WebGLUtils.updateBuffer(gl, hexBuffers.stateBuffer, gl.ARRAY_BUFFER, worldData.jsStateArray);
            WebGLUtils.updateBuffer(gl, hexBuffers.hoverBuffer, gl.ARRAY_BUFFER, worldData.jsHoverStateArray);
            WebGLUtils.updateBuffer(gl, hexBuffers.ruleIndexBuffer, gl.ARRAY_BUFFER, worldData.jsRuleIndexArray);
            if (worldData.jsGhostStateArray) {
                WebGLUtils.updateBuffer(gl, hexBuffers.ghostBuffer, gl.ARRAY_BUFFER, worldData.jsGhostStateArray);
            }

            
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, Config.NUM_CELLS);
        }
    }

    
    if (disabledTextTexture) {
        gl.useProgram(quadShaderProgram);
        gl.bindVertexArray(quadVAO);

        
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, disabledTextTexture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);

        
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const worldStatus = allWorldsStatus[i];
            const worldData = worldStatus ? worldStatus.renderData : null;
            if (!worldData || !worldData.enabled) {
                const fboData = worldFBOs[i];
                gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);

                
                gl.clearColor(...Config.DISABLED_WORLD_OVERLAY_COLOR);
                gl.clear(gl.COLOR_BUFFER_BIT);
                
                
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
        }
        
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
    
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
}


function renderMainScene(selectedWorldIndex, allWorldsStatus, vizState) {
    if (!quadShaderProgram || !quadVAO) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(...Config.BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(quadShaderProgram);
    gl.bindVertexArray(quadVAO);

    
    const { selectedView, miniMap } = layoutCache;

    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldFBOs.length) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[selectedWorldIndex].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(selectedView.x, selectedView.y, selectedView.width, selectedView.height);
    }

    const selectedWorldRuleset = allWorldsStatus[selectedWorldIndex]?.stats.rulesetHex;
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const col = i % Config.WORLD_LAYOUT_COLS;
        const miniX = miniMap.gridContainerX + col * (miniMap.miniMapW + miniMap.miniMapSpacing);
        const miniY = miniMap.gridContainerY + row * (miniMap.miniMapH + miniMap.miniMapSpacing);

        if (i === selectedWorldIndex) {
            const outlineThickness = Math.max(2, Math.min(miniMap.miniMapW, miniMap.miniMapH) * 0.02);
            gl.uniform1f(quadUniformLocations.u_useTexture, 0.0);
            gl.uniform4fv(quadUniformLocations.u_color, Config.SELECTION_OUTLINE_COLOR);
            drawQuad(miniX - outlineThickness, miniY - outlineThickness, miniMap.miniMapW + 2 * outlineThickness, miniMap.miniMapH + 2 * outlineThickness);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[i].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(miniX, miniY, miniMap.miniMapW, miniMap.miniMapH);
        
        const worldStatus = allWorldsStatus[i];
        
        // Cycle indicator logic
        const indicatorEl = cycleIndicatorElements[i];
        const showIndicators = vizState?.showCycleIndicator ?? false;
        
        if (indicatorEl && worldStatus?.stats.isInCycle && showIndicators) {
            const cycleLength = worldStatus.stats.cycleLength;
            indicatorEl.classList.remove('hidden');
            // Use the same relative positioning logic as the ruleset overlay
            indicatorEl.style.left = `${miniX - miniMap.gridContainerX + miniMap.miniMapW - 20 - miniMap.miniMapSpacing}px`;
            indicatorEl.style.top = `${miniY - miniMap.gridContainerY}px`;
            
            if (indicatorEl.dataset.cycleLength !== String(cycleLength)) {
                indicatorEl.dataset.cycleLength = String(cycleLength);
                indicatorEl.innerHTML = `
                    <svg viewBox="0 0 24 24" width="100%" height="100%">
                        <path d="M12 2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8V2z" fill="#fff"/>
                        <path d="M22 12a10 10 0 0 0-10-10v2a8 8 0 0 1 8 8h2z" fill="#fff" transform="rotate(180 12 12)"/>
                        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-size="9" font-weight="bold">${cycleLength}</text>
                    </svg>
                `;
            }
        } else if (indicatorEl) {
            indicatorEl.classList.add('hidden');
        }
        
        const overlayEl = minimapOverlayElements[i];
        const showOverlay = vizState?.showMinimapOverlay ?? false;
        
        if (overlayEl && worldStatus?.renderData.enabled && showOverlay) {
            overlayEl.style.display = 'block';
            overlayEl.style.left = `${miniX-miniMap.gridContainerX}px`;
            overlayEl.style.top = `${miniY-miniMap.gridContainerY}px`;
            
            const currentSignature = `${i}-${worldStatus.stats.rulesetHex}-${selectedWorldIndex}-${selectedWorldRuleset}-${rulesetVisualizer.getVisualizationType()}`;
            if (overlayEl.dataset.signature !== currentSignature) {
                overlayEl.innerHTML = '';
                let svg;
                if (i === selectedWorldIndex) {
                    svg = rulesetVisualizer.createRulesetSVG(worldStatus.stats.rulesetHex);
                } else {
                    svg = rulesetVisualizer.createDiffSVG(selectedWorldRuleset, worldStatus.stats.rulesetHex);
                }
                if (svg) {
                    svg.classList.add('ruleset-viz-svg');
                    overlayEl.appendChild(svg);
                }
                overlayEl.dataset.signature = currentSignature;
            }
        } else if (overlayEl) {
            overlayEl.style.display = 'none';
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

export function renderFrameOrLoader(allWorldsStatus, selectedWorldIndex, areAllWorkersInitialized, camera, vizState) {
    if (!gl || !areAllWorkersInitialized) {
        
        return;
    }
    
    
    renderWorldsToTextures(allWorldsStatus, selectedWorldIndex, camera);
    renderMainScene(selectedWorldIndex, allWorldsStatus, vizState);
}

export function resizeRenderer() {
    if (!gl || !canvas) return;
    Utils.resizeCanvasToDisplaySize(canvas, gl);
    _calculateAndCacheLayout(); 
}