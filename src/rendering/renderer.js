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
// Scratch LUT texture for palette-override captures (baked thumbnails); lazily created.
let overrideLUTTexture = null;
let disabledTextTexture = null;
// Retained for on-demand (outside the frame loop) single-world redraws + preview LUT swaps.
let rendererAppContext = null;

// --- Per-world FBO dirty tracking -------------------------------------------
// A world's FBO only needs redrawing when its visual inputs change. The cell
// buffers are tracked via WorldProxy.renderDirty; here we additionally track the
// inputs the renderer itself owns: which world is selected (changes pan/zoom of
// the affected FBOs), the selected world's camera, and per-world enabled state.
let prevSelectedWorldIndex = -1;
let prevCamera = { x: NaN, y: NaN, zoom: NaN };
let prevEnabled = [];
let worldEverDrawn = [];

// --- Main-scene compositing dirty tracking ----------------------------------
// renderMainScene composites the FBO textures (selected view + 3×3 minimap) to
// the canvas. That output only changes when an FBO was redrawn this frame or the
// layout changed (resize → quad positions move). WebGL keeps the last presented
// frame on screen when the drawing buffer is left untouched, so when nothing
// changed we skip the whole composite and the canvas keeps showing it. A paused,
// idle sim therefore issues no GPU work at all. `composeDirty` is set by the
// layout recompute; per-frame FBO redraws are signalled via renderWorldsToTextures.
let composeDirty = true;
// Precomputed clip-space quad vertices, rebuilt only when the layout changes.
// Avoids allocating a Float32Array + per-quad math every frame in drawQuad.
let quadVertsCache = null;

function updateColorLUTTexture(colorSettings, symmetryData, rulesetArray) {
    if (!gl || !hexLUTTexture) return;
    const lutData = generateColorLUT(colorSettings, symmetryData, rulesetArray);
    gl.bindTexture(gl.TEXTURE_2D, hexLUTTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

export function initRenderer(canvasElement, appContext) {
    canvas = canvasElement;
    rendererAppContext = appContext;
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

    // Transient palette preview (Chroma Lab hover): retint every world live WITHOUT persisting
    // anything. Only the renderer listens — UI components keep showing the saved settings. A null
    // payload ends the preview and re-applies the saved settings.
    EventBus.subscribe(EVENTS.COLOR_PREVIEW_CHANGED, (settings) => {
        const effective = settings || appContext.colorController.getSettings();
        updateColorLUTTexture(effective, appContext.worldManager.getSymmetryData());
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
    // True only in the near-square regime, where the minimap docks as an overlay ON TOP of the
    // selected view (the disjoint landscape/portrait regimes give the minimap its own area).
    // Consumed by the mobile FAB stacks, which raise above the minimap only when it overlaps.
    let isMinimapOverlay = false;
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
        isMinimapOverlay = true;
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
        miniMap: { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing },
        isMinimapOverlay
    };

    // Precompute clip-space quad vertices for everything renderMainScene draws.
    // These depend only on layout (and canvas size), so building them here keeps
    // the per-frame composite allocation-free.
    const miniMaps = new Array(Config.NUM_WORLDS);
    const selectionOutlines = new Array(Config.NUM_WORLDS);
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const col = i % Config.WORLD_LAYOUT_COLS;
        const miniX = gridContainerX + col * (miniMapW + miniMapSpacing);
        const miniY = gridContainerY + row * (miniMapH + miniMapSpacing);
        miniMaps[i] = _computeQuadVerts(miniX, miniY, miniMapW, miniMapH);
        const outlineThickness = Math.max(2, Math.min(miniMapW, miniMapH) * 0.02);
        selectionOutlines[i] = _computeQuadVerts(
            miniX - outlineThickness, miniY - outlineThickness,
            miniMapW + 2 * outlineThickness, miniMapH + 2 * outlineThickness
        );
    }
    quadVertsCache = {
        selectedView: _computeQuadVerts(selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight),
        miniMaps,
        selectionOutlines,
    };
    composeDirty = true; // layout moved — the canvas composite must be redrawn

    EventBus.dispatch(EVENTS.LAYOUT_CALCULATED, { ...layoutCache });
    EventBus.dispatch(EVENTS.LAYOUT_UPDATED, { ...layoutCache });
}

// Convert a pixel-space rect to the clip-space TRIANGLE_STRIP vertices drawQuad
// uploads. Returns a fresh Float32Array; only called on layout change.
function _computeQuadVerts(pixelX, pixelY, pixelW, pixelH) {
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;
    const clipX = (pixelX / canvasWidth) * 2 - 1;
    const clipY = (pixelY / canvasHeight) * -2 + 1;
    const clipW = (pixelW / canvasWidth) * 2;
    const clipH = (pixelH / canvasHeight) * 2;
    return new Float32Array([
        clipX, clipY - clipH,
        clipX + clipW, clipY - clipH,
        clipX, clipY,
        clipX + clipW, clipY
    ]);
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
        return false; // Nothing changed — leave every FBO as-is and skip all GPU work.
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
                const gridCenter = Utils.getGridCenterWorld();
                gl.uniform2f(hexUniformLocations.pan, gridCenter.x, gridCenter.y);
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
    return true; // at least one FBO was redrawn — the canvas composite is stale
}

function renderMainScene(appContext, fbosDrawn) {
    if (!quadShaderProgram || !quadVAO || !quadVertsCache) return;
    // Skip the whole composite when neither an FBO nor the layout changed: the
    // canvas keeps the last presented frame, so an idle/paused sim does no GPU work.
    if (!fbosDrawn && !composeDirty) return;
    composeDirty = false;

    const selectedWorldIndex = appContext.worldManager.getSelectedWorldIndex();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(...Config.BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(quadShaderProgram);
    gl.bindVertexArray(quadVAO);

    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldFBOs.length) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[selectedWorldIndex].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(quadVertsCache.selectedView);
    }

    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        if (i === selectedWorldIndex) {
            gl.uniform1f(quadUniformLocations.u_useTexture, 0.0);
            gl.uniform4fv(quadUniformLocations.u_color, Config.SELECTION_OUTLINE_COLOR);
            drawQuad(quadVertsCache.selectionOutlines[i]);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, worldFBOs[i].texture);
        gl.uniform1i(quadUniformLocations.texture, 0);
        gl.uniform1f(quadUniformLocations.u_useTexture, 1.0);
        drawQuad(quadVertsCache.miniMaps[i]);
    }

    gl.bindVertexArray(null);
}

// Upload precomputed clip-space vertices (from quadVertsCache) and draw the quad.
function drawQuad(verts) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffers.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function renderFrameOrLoader(appContext, areAllWorkersInitialized) {
    if (!gl || !areAllWorkersInitialized) {
        return;
    }
    const fbosDrawn = renderWorldsToTextures(appContext);
    renderMainScene(appContext, fbosDrawn);
}

export function resizeRenderer() {
    if (!gl || !canvas) return;
    Utils.resizeCanvasToDisplaySize(canvas, gl);
    _calculateAndCacheLayout();
}

/**
 * Capture a world's render-texture FBO as a PNG Blob (full {@link Config.RENDER_TEXTURE_SIZE}²
 * resolution, independent of the on-screen canvas size or layout). Reading the FBO directly avoids
 * needing `preserveDrawingBuffer` on the main context and grabs just the one world (not the 3×3
 * composite). Used by the media-export feature for snapshots of the selected world.
 * @param {number} worldIndex
 * @returns {Promise<Blob|null>|null} resolves to the PNG blob, or null if capture is unavailable.
 */
export function captureWorldPNG(worldIndex) {
    const out = _captureWorldToCanvas(worldIndex);
    if (!out) return null;
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

/**
 * Capture a world's render-texture FBO and downscale it to a small square thumbnail data URL.
 * Used by the auto-explore gallery (visual previews of finds, roadmap F6). Returns a JPEG data URL
 * (~2–4 KB at 96px/0.5), or null if capture is unavailable. Synchronous — no Blob/decoder round-trip.
 * @param {number} worldIndex
 * @param {number} [size=96] Output square edge in px.
 * @param {number} [quality=0.5] JPEG quality in [0,1].
 * @returns {string|null}
 */
export function captureWorldThumbnail(worldIndex, size = 96, quality = 0.5) {
    const full = _captureWorldToCanvas(worldIndex);
    if (!full) return null;
    const thumb = document.createElement('canvas');
    thumb.width = size;
    thumb.height = size;
    const ctx = thumb.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(full, 0, 0, size, size);
    return thumb.toDataURL('image/jpeg', quality);
}

/**
 * Redraw ONE world's FBO immediately (outside the dirty-flag frame loop) with the given LUT texture.
 * Powers the palette-independent thumbnail capture: draw with the fixed thumbnail LUT, read back,
 * then redraw with the live LUT so nothing user-visible changes. Mirrors the per-world block of
 * renderWorldsToTextures exactly (same uniforms/buffers) minus the dirty bookkeeping — it must not
 * clear renderDirty, or the frame loop would skip a genuinely-pending repaint. Returns true when
 * the draw ran (world enabled + views present).
 * @param {number} worldIndex
 * @param {WebGLTexture} lutTexture
 * @returns {boolean}
 */
function _redrawWorldFBO(worldIndex, lutTexture) {
    if (!gl || !rendererAppContext || !lutTexture) return false;
    const fboData = worldFBOs[worldIndex];
    if (!fboData) return false;
    const worldData = rendererAppContext.worldManager.getWorldsRenderData()[worldIndex];
    if (!worldData || !worldData.enabled) return false;
    if (!worldData.jsStateArray || !worldData.jsRuleIndexArray || !worldData.jsHoverStateArray) return false;

    const selectedWorldIndex = rendererAppContext.worldManager.getSelectedWorldIndex();
    const camera = rendererAppContext.worldManager.getCurrentCameraState();

    gl.viewport(0, 0, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
    gl.useProgram(hexShaderProgram);
    gl.bindVertexArray(hexVAO);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    gl.uniform1i(hexUniformLocations.colorLUT, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);
    gl.clearColor(...Config.BACKGROUND_COLOR);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const textureHexSize = Utils.calculateHexSizeForTexture();
    gl.uniform2f(hexUniformLocations.resolution, Config.RENDER_TEXTURE_SIZE, Config.RENDER_TEXTURE_SIZE);
    gl.uniform1f(hexUniformLocations.hexSize, textureHexSize);
    gl.uniform1f(hexUniformLocations.hoverFilledDarkenFactor, Config.HOVER_FILLED_DARKEN_FACTOR);
    gl.uniform1f(hexUniformLocations.hoverInactiveLightenFactor, Config.HOVER_INACTIVE_LIGHTEN_FACTOR);
    if (worldIndex === selectedWorldIndex && camera) {
        gl.uniform2f(hexUniformLocations.pan, camera.x, camera.y);
        gl.uniform1f(hexUniformLocations.zoom, camera.zoom);
    } else {
        const gridCenter = Utils.getGridCenterWorld();
        gl.uniform2f(hexUniformLocations.pan, gridCenter.x, gridCenter.y);
        gl.uniform1f(hexUniformLocations.zoom, 1.0);
    }
    WebGLUtils.updateBuffer(gl, hexBuffers.stateBuffer, gl.ARRAY_BUFFER, worldData.jsStateArray);
    WebGLUtils.updateBuffer(gl, hexBuffers.hoverBuffer, gl.ARRAY_BUFFER, worldData.jsHoverStateArray);
    WebGLUtils.updateBuffer(gl, hexBuffers.ruleIndexBuffer, gl.ARRAY_BUFFER, worldData.jsRuleIndexArray);
    if (worldData.jsGhostStateArray) {
        WebGLUtils.updateBuffer(gl, hexBuffers.ghostBuffer, gl.ARRAY_BUFFER, worldData.jsGhostStateArray);
    }
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 6, Config.NUM_CELLS);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
}

/**
 * Capture a world thumbnail rendered with an OVERRIDE color LUT instead of the live palette — the
 * palette-independent capture path for baked library thumbnails (pass
 * {@link generateThumbnailLUT}'s data). Redraws the world's FBO with the override LUT, captures,
 * then repaints with the live LUT so the visible minimap is undisturbed. Falls back to a plain
 * live-palette capture when the override draw can't run.
 * @param {number} worldIndex
 * @param {Uint8Array} lutData 128x2 RGBA LUT texture data.
 * @param {number} [size=96]
 * @param {number} [quality=0.5]
 * @returns {string|null}
 */
export function captureWorldThumbnailWithLUT(worldIndex, lutData, size = 96, quality = 0.5) {
    if (!gl || !lutData) return captureWorldThumbnail(worldIndex, size, quality);
    if (!overrideLUTTexture) {
        overrideLUTTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, overrideLUTTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, null);
    } else {
        gl.bindTexture(gl.TEXTURE_2D, overrideLUTTexture);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if (!_redrawWorldFBO(worldIndex, overrideLUTTexture)) {
        return captureWorldThumbnail(worldIndex, size, quality);
    }
    const thumb = captureWorldThumbnail(worldIndex, size, quality);
    _redrawWorldFBO(worldIndex, hexLUTTexture); // repaint with the live palette
    return thumb;
}

/**
 * Capture a world's render-texture FBO and downscale it to a small square `ImageData` (RGBA pixels).
 * Used by the optional perceptual auto-explore objective (v3.0) to feed rendered frames to the
 * foundation-model embedding worker. Returns raw `ImageData` (not a data URL) so the bytes can be
 * transferred to the worker without a JPEG encode/decode round-trip. Null if capture is unavailable.
 * @param {number} worldIndex
 * @param {number} [size=224] Output square edge in px (CLIP's native input size).
 * @returns {ImageData|null}
 */
export function captureWorldImageData(worldIndex, size = 224) {
    const full = _captureWorldToCanvas(worldIndex);
    if (!full) return null;
    const small = document.createElement('canvas');
    small.width = size;
    small.height = size;
    const ctx = small.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(full, 0, 0, size, size);
    return ctx.getImageData(0, 0, size, size);
}

/**
 * Read a world's FBO into a full-resolution top-left-oriented 2D canvas (the shared capture path for
 * PNG export and thumbnails). Reading the FBO directly avoids needing `preserveDrawingBuffer` on the
 * main context and grabs just the one world (not the 3×3 composite).
 * @param {number} worldIndex
 * @returns {HTMLCanvasElement|null}
 */
function _captureWorldToCanvas(worldIndex, reuseCanvas = null) {
    if (!gl || worldIndex < 0 || worldIndex >= worldFBOs.length) return null;
    const fboData = worldFBOs[worldIndex];
    if (!fboData) return null;

    const size = Config.RENDER_TEXTURE_SIZE;
    const pixels = new Uint8Array(size * size * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboData.fbo);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // WebGL's FBO origin is bottom-left; flip rows into top-left image orientation.
    // Reuse the caller's canvas (recording hot path) to avoid per-frame allocation.
    const out = reuseCanvas || document.createElement('canvas');
    out.width = size;
    out.height = size;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.createImageData(size, size);
    const rowBytes = size * 4;
    for (let y = 0; y < size; y++) {
        const srcStart = (size - 1 - y) * rowBytes;
        imageData.data.set(pixels.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
    }
    ctx.putImageData(imageData, 0, 0);
    return out;
}

/** The live main canvas element (used by the media-export feature for WebM capture). */
export function getCanvasElement() {
    return canvas;
}

// --- Capture Studio compositor ---------------------------------------------
// Arbitrary-resolution stills/recording, built on the per-world FBOs (already
// drawn every frame; the selected world's FBO already bakes in camera pan/zoom).
// All resolution logic lives in 2D so no GL layout refactor is needed, and it
// works for both capture sources ('selected' world / 'canvas' as-seen composite).

// Reusable per-world readback canvases (RENDER_TEXTURE_SIZE²) so the per-frame
// recording path doesn't allocate a fresh canvas for every world every frame.
const _captureCanvasPool = new Map();
function _poolCanvasFor(worldIndex) {
    let c = _captureCanvasPool.get(worldIndex);
    if (!c) {
        c = document.createElement('canvas');
        c.width = Config.RENDER_TEXTURE_SIZE;
        c.height = Config.RENDER_TEXTURE_SIZE;
        _captureCanvasPool.set(worldIndex, c);
    }
    return c;
}

// Convert a Config float color array ([r,g,b,a] in 0..1) to a CSS color string.
function _floatColorToCss(c) {
    const r = Math.round((c[0] ?? 0) * 255);
    const g = Math.round((c[1] ?? 0) * 255);
    const b = Math.round((c[2] ?? 0) * 255);
    const a = c[3] ?? 1;
    return `rgba(${r},${g},${b},${a})`;
}

/**
 * Draw one frame of the chosen capture source into a caller-supplied 2D context,
 * scaled to `width`×`height`. Used by both the one-shot still path and the
 * per-frame recording loop.
 * @param {CanvasRenderingContext2D} ctx Destination 2D context (sized width×height).
 * @param {{source:'selected'|'canvas', width:number, height:number, selectedIndex:number, background?:boolean}} opts
 * @returns {boolean} true if a frame was composed.
 */
export function composeCaptureFrame(ctx, { source, width, height, selectedIndex, background = true } = {}) {
    if (!gl || !ctx || !(width > 0) || !(height > 0)) return false;

    if (background) {
        ctx.fillStyle = _floatColorToCss(Config.BACKGROUND_COLOR);
        ctx.fillRect(0, 0, width, height);
    } else {
        ctx.clearRect(0, 0, width, height);
    }

    if (source === 'selected') {
        const c = _captureWorldToCanvas(selectedIndex, _poolCanvasFor(selectedIndex));
        if (!c) return false;
        ctx.drawImage(c, 0, 0, width, height);
        return true;
    }

    // 'canvas' — reproduce the on-screen composite (selected view + 3×3 minimap)
    // at the target resolution by scaling the cached live-canvas layout rects.
    if (!layoutCache || !layoutCache.selectedView || !layoutCache.miniMap) return false;
    if (!canvas || !canvas.width || !canvas.height) return false;
    const sx = width / canvas.width;
    const sy = height / canvas.height;

    const sv = layoutCache.selectedView;
    const selC = _captureWorldToCanvas(selectedIndex, _poolCanvasFor(selectedIndex));
    if (selC) ctx.drawImage(selC, sv.x * sx, sv.y * sy, sv.width * sx, sv.height * sy);

    const { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing } = layoutCache.miniMap;
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const row = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const col = i % Config.WORLD_LAYOUT_COLS;
        const mx = gridContainerX + col * (miniMapW + miniMapSpacing);
        const my = gridContainerY + row * (miniMapH + miniMapSpacing);
        const dx = mx * sx, dy = my * sy, dw = miniMapW * sx, dh = miniMapH * sy;
        // Disabled worlds carry their dim overlay in the FBO already, so a plain
        // readback reproduces them faithfully — no special-casing needed.
        const c = _captureWorldToCanvas(i, _poolCanvasFor(i));
        if (c) ctx.drawImage(c, dx, dy, dw, dh);
        if (i === selectedIndex) {
            ctx.strokeStyle = _floatColorToCss(Config.SELECTION_OUTLINE_COLOR);
            ctx.lineWidth = Math.max(1.5, Math.min(dw, dh) * 0.02);
            ctx.strokeRect(dx, dy, dw, dh);
        }
    }
    return true;
}

/**
 * One-shot still capture of the chosen source at an arbitrary resolution/format.
 * @param {{source:'selected'|'canvas', width:number, height:number, selectedIndex:number, format?:'png'|'jpeg', quality?:number}} opts
 * @returns {Promise<Blob|null>|null} resolves to the encoded image blob, or null if capture is unavailable.
 */
export function captureSourceToBlob({ source, width, height, selectedIndex, format = 'png', quality = 0.92 } = {}) {
    if (!gl) return null;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(width));
    out.height = Math.max(1, Math.round(height));
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    const ok = composeCaptureFrame(ctx, { source, width: out.width, height: out.height, selectedIndex });
    if (!ok) return null;
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return new Promise((resolve) => out.toBlob(resolve, mime, quality));
}

/** The live canvas aspect ratio (width/height), for source-aware resolution presets. */
export function getLiveCanvasAspect() {
    if (!canvas || !canvas.height) return 16 / 9;
    return canvas.width / canvas.height;
}
