import * as Config from '../core/config.js';
import * as WebGLUtils from './webglUtils.js';
import * as Utils from '../utils/utils.js';
import { generateColorLUT } from '../utils/ruleVizUtils.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

// eslint-disable-next-line import/no-unresolved
import hexVertexShaderSource from '../../shaders/vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import hexFragmentShaderSource from '../../shaders/fragment.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import quadVertexShaderSource from '../../shaders/quad_vertex.glsl?raw';
// eslint-disable-next-line import/no-unresolved
import quadFragmentShaderSource from '../../shaders/quad_fragment.glsl?raw';

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

// --- Per-world FBO dirty tracking -------------------------------------------
// A world's FBO only needs redrawing when its visual inputs change. The cell
// buffers are tracked via WorldProxy.renderDirty; here we additionally track the
// inputs the renderer itself owns: which world is selected (changes pan/zoom of
// the affected FBOs), the selected world's camera, and per-world enabled state.
let prevSelectedWorldIndex = -1;
let prevCamera = { x: NaN, y: NaN, zoom: NaN };
let prevEnabled = [];
let worldEverDrawn = [];

function updateColorLUTTexture(colorSettings, symmetryData, rulesetArray) {
    if (!gl || !hexLUTTexture) return;
    const lutData = generateColorLUT(colorSettings, symmetryData, rulesetArray);
    gl.bindTexture(gl.TEXTURE_2D, hexLUTTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

export function initRenderer(canvasElement, appContext) {
    canvas = canvasElement;
    gl = canvas.getContext('webgl2');
    if (!gl) {
        alert("WebGL 2 not supported!");
        console.error("WebGL 2 not supported!");
        return null;
    }

    hexShaderProgram = WebGLUtils.loadShaderProgram(gl, hexVertexShaderSource, hexFragmentShaderSource);
    quadShaderProgram = WebGLUtils.loadShaderProgram(gl, quadVertexShaderSource, quadFragmentShaderSource);
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
    const colorSettings = appContext.colorController.getSettings();
    const symmetryData = appContext.worldManager.getSymmetryData();
    // Get the initial ruleset array to generate the first LUT
    const lutData = generateColorLUT(colorSettings, symmetryData);
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
    
    EventBus.subscribe(EVENTS.COLOR_SETTINGS_CHANGED, (settings) => {
        updateColorLUTTexture(settings, appContext.worldManager.getSymmetryData());
        // The LUT change alters every world's appearance but produces no STATE_UPDATE,
        // so force an FBO redraw on the next frame.
        appContext.worldManager.markAllWorldsRenderDirty();
    });
    
    requestAnimationFrame(() => resizeRenderer());

    console.log("Renderer initialized.");
    return gl;
}

function _calculateAndCacheLayout() {
    if (!gl || !gl.canvas) return;
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;
    const padding = Math.min(canvasWidth, canvasHeight) * 0.02;
    let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
    let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;
    const aspectRatio = canvasWidth / canvasHeight;
    if (aspectRatio >= Config.LAYOUT_LANDSCAPE_MIN_ASPECT) {
        // Wide: minimap column on the right, selected view absorbs the rest.
        // The minimap grid is square, so its column never needs to be wider
        // than the available height; any excess goes to the selected view.
        selectedViewHeight = canvasHeight - padding * 2;
        miniMapAreaWidth = Math.min(canvasWidth * 0.4 - padding * 1.5, selectedViewHeight);
        selectedViewWidth = canvasWidth - miniMapAreaWidth - padding * 3;
        selectedViewX = padding;
        selectedViewY = padding;
        miniMapAreaHeight = selectedViewHeight;
        miniMapAreaX = selectedViewX + selectedViewWidth + padding;
        miniMapAreaY = padding;
    } else if (aspectRatio <= Config.LAYOUT_PORTRAIT_MAX_ASPECT) {
        // Tall & narrow: minimap strip across the bottom. The strip is roughly
        // as wide as it is tall here, so the square grid nearly fills it.
        selectedViewWidth = canvasWidth - padding * 2;
        miniMapAreaHeight = Math.min(canvasHeight * 0.35 - padding * 1.5, selectedViewWidth);
        selectedViewHeight = canvasHeight - miniMapAreaHeight - padding * 3;
        selectedViewX = padding;
        selectedViewY = padding;
        miniMapAreaWidth = selectedViewWidth;
        miniMapAreaX = padding;
        miniMapAreaY = selectedViewY + selectedViewHeight + padding;
    } else {
        // Near-square: a full-width/height strip would leave the square grid floating in a
        // large empty band, so the selected view fills the whole canvas and the minimap is
        // docked as a square overlay in the bottom-right corner. Input hit-testing checks the
        // minimap before the selected view, so the overlapped corner still selects mini worlds.
        selectedViewX = padding;
        selectedViewY = padding;
        selectedViewWidth = canvasWidth - padding * 2;
        selectedViewHeight = canvasHeight - padding * 2;
        const overlaySide = Math.min(canvasWidth, canvasHeight) * Config.MINIMAP_OVERLAY_SIZE_FACTOR;
        miniMapAreaWidth = overlaySide;
        miniMapAreaHeight = overlaySide;
        miniMapAreaX = canvasWidth - padding - overlaySide;
        miniMapAreaY = canvasHeight - padding - overlaySide;
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
    EventBus.dispatch(EVENTS.LAYOUT_UPDATED, { ...layoutCache });
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

function renderWorldsToTextures(appContext) {
    // Hot path: pull only render data (typed-array views + flags). Avoid
    // getWorldsFullStatus(), which additionally spreads `{...latestStats}` for all
    // 9 worlds every rAF — the renderer never reads stats here.
    const allWorldsRenderData = appContext.worldManager.getWorldsRenderData();
    const selectedWorldIndex = appContext.worldManager.getSelectedWorldIndex();
    const camera = appContext.worldManager.getCurrentCameraState();

    // Decide which world FBOs actually need redrawing this frame. The FBO textures
    // retain their contents between frames, so any world we skip simply keeps the
    // pixels from when it was last drawn — renderMainScene composites them as usual.
    const selectionChanged = selectedWorldIndex !== prevSelectedWorldIndex;
    const cameraChanged = !camera ||
        camera.x !== prevCamera.x || camera.y !== prevCamera.y || camera.zoom !== prevCamera.zoom;
    const needsDraw = new Array(Config.NUM_WORLDS);
    let anyDraw = false;
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const worldData = allWorldsRenderData[i] || null;
        const enabled = !!(worldData && worldData.enabled);
        let draw = false;
        if (!worldEverDrawn[i]) {
            draw = true;                                  // first ever frame for this world
        } else if (worldData && worldData.dirty) {
            draw = true;                                  // state / hover / ghost changed
        } else if (enabled !== prevEnabled[i]) {
            draw = true;                                  // enabled <-> disabled toggled
        } else if (selectionChanged && (i === selectedWorldIndex || i === prevSelectedWorldIndex)) {
            draw = true;                                  // pan/zoom of this FBO changed
        } else if (i === selectedWorldIndex && cameraChanged) {
            draw = true;                                  // selected world's camera moved
        }
        needsDraw[i] = draw;
        anyDraw = anyDraw || draw;
    }

    prevSelectedWorldIndex = selectedWorldIndex;
    if (camera) prevCamera = { x: camera.x, y: camera.y, zoom: camera.zoom };

    if (!anyDraw) {
        return; // Nothing changed — leave every FBO as-is and skip all GPU work.
    }

    gl.viewport(0, 0, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
    gl.useProgram(hexShaderProgram);
    gl.bindVertexArray(hexVAO);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, hexLUTTexture);
    gl.uniform1i(hexUniformLocations.colorLUT, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const worldData = allWorldsRenderData[i] || null;
        if (worldData && worldData.enabled && needsDraw[i]) {
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
            appContext.worldManager.clearWorldRenderDirty(i);
            prevEnabled[i] = true;
            worldEverDrawn[i] = true;
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
            const worldData = allWorldsRenderData[i] || null;
            if ((!worldData || !worldData.enabled) && needsDraw[i]) {
                const fboData = worldFBOs[i];
                gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);
                gl.clearColor(...Config.DISABLED_WORLD_OVERLAY_COLOR);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                appContext.worldManager.clearWorldRenderDirty(i);
                prevEnabled[i] = false;
                worldEverDrawn[i] = true;
            }
        }
        
        gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
    
    
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
}

function renderMainScene(appContext) {
    const selectedWorldIndex = appContext.worldManager.getSelectedWorldIndex();
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

export function renderFrameOrLoader(appContext, areAllWorkersInitialized) {
    if (!gl || !areAllWorkersInitialized) {
        return;
    }
    renderWorldsToTextures(appContext);
    renderMainScene(appContext);
}

export function resizeRenderer() {
    if (!gl || !canvas) return;
    Utils.resizeCanvasToDisplaySize(canvas, gl);
    _calculateAndCacheLayout(); 
}
