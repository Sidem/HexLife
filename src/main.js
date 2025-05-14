// src/main.js
import * as Config from './core/config.js';
import * as Simulation from './core/simulation.js';
import * as Renderer from './rendering/renderer.js';
import * as UI from './ui/ui.js';
import * as Utils from './utils/utils.js';
import { EventBus, EVENTS } from './services/EventBus.js'; // Import EventBus

// --- Global State ---
let gl; // WebGL Context
let isInitialized = false;
let lastTimestamp = 0;
// neighborhoodSize is now primarily managed and persisted by Simulation.js
// main.js will get it from Simulation.js when needed.
let pausedByVisibilityChange = false;

// Performance Metrics
let frameCount = 0;
let lastFpsUpdateTime = 0;
let actualFps = 0;

let accumulatedTicks = 0;
let lastTpsUpdateTime = 0;
let actualTps = 0;

// --- Initialization ---

async function initialize() {
    console.log("Starting Initialization...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    gl = await Renderer.initRenderer(canvas);
    if (!gl) {
        console.error("Renderer initialization failed.");
        return;
    }

    // Simulation.initSimulation() now loads its own persisted settings (speed, ruleset, world settings)
    // It also loads the brush size into its internal state, which we can retrieve.
    Simulation.initSimulation();
    // const initialBrushSize = Simulation.loadBrushSize(); // No longer needed here, UI init will get it

    // The simulationInterface can be slimmed down if methods are replaced by events.
    // For now, keep getters that UI uses for initialization.
    // UI interaction methods like togglePause, setSpeed etc. will now be via EventBus.
    const simulationInterfaceForUI = {
        // Getters for initial state
        isSimulationPaused: Simulation.isSimulationPaused,
        getCurrentRulesetHex: Simulation.getCurrentRulesetHex,
        getCurrentSimulationSpeed: Simulation.getCurrentSimulationSpeed,
        getCurrentBrushSize: Simulation.getCurrentBrushSize,
        getSelectedWorldIndex: Simulation.getSelectedWorldIndex,
        getWorldStateForSave: Simulation.getWorldStateForSave, // For save button
        getSelectedWorldStats: Simulation.getSelectedWorldStats, // For initial stats
        getEntropySamplingState: Simulation.getEntropySamplingState, // For initial state
        getWorldSettings: Simulation.getWorldSettings,
        getSelectedWorldRatioHistory: Simulation.getSelectedWorldRatioHistory,
        getSelectedWorldEntropyHistory: Simulation.getSelectedWorldEntropyHistory,
        getCurrentRulesetArray: Simulation.getCurrentRulesetArray,
        getEffectiveRuleForNeighborCount: Simulation.getEffectiveRuleForNeighborCount,
    };

    if (!UI.initUI(simulationInterfaceForUI)) {
        console.error("UI initialization failed.");
        return;
    }

    // UI.initUI calls loadAndApplyUISettings which sets up initial UI values
    // including those fetched via simulationInterface (speed, brush size)
    // UI.updatePauseButton(Simulation.isSimulationPaused()); // Done in UI.initUI
    // UI.updateStatsDisplay(Simulation.getSelectedWorldStats()); // Done in UI.initUI

    setupCanvasListeners(canvas);
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    isInitialized = true;
    lastTimestamp = performance.now();
    lastFpsUpdateTime = lastTimestamp;
    lastTpsUpdateTime = lastTimestamp;

    console.log("Initialization Complete. Starting Render Loop.");
    requestAnimationFrame(renderLoop);
}

// --- Interaction Handling ---

function setupCanvasListeners(canvas) {
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseout', handleCanvasMouseOut);
    canvas.addEventListener('wheel', handleCanvasMouseWheel, { passive: false });
}

function handleCanvasClick(event) {
    if (!isInitialized) return;
    const { worldIndex, col, row, viewType } = getCoordsFromMouseEvent(event);

    if (worldIndex !== null) {
        const previousSelectedWorld = Simulation.getSelectedWorldIndex();
        // Simulation.setSelectedWorldIndex(worldIndex); // Dispatch event instead
        EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndex);

        if (viewType === 'selected' && col !== null && row !== null) {
            // Simulation.applyBrush(worldIndex, col, row, Simulation.getCurrentBrushSize()); // Dispatch event
            EventBus.dispatch(EVENTS.COMMAND_APPLY_BRUSH, {
                worldIndex: worldIndex,
                col: col,
                row: row,
                brushSize: Simulation.getCurrentBrushSize() // Get current size
            });
        }
        // Stats display update is now handled by EventBus subscription in UI
        // to WORLD_STATS_UPDATED which is dispatched by simulation after selection/brush
    }
}

function handleCanvasMouseMove(event) {
    if (!isInitialized) return;
    const { worldIndex, col, row } = getCoordsFromMouseEvent(event);
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        // Simulation.clearHoverState(i); // Dispatch event
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: i });
    }
    if (worldIndex !== null && col !== null && row !== null) {
        // Simulation.setHoverState(worldIndex, col, row, Simulation.getCurrentBrushSize()); // Dispatch
        EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, {
            worldIndex: worldIndex,
            col: col,
            row: row,
            brushSize: Simulation.getCurrentBrushSize()
        });
    }
}

function handleCanvasMouseOut() {
    if (!isInitialized) return;
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        // Simulation.clearHoverState(i); // Dispatch event
         EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: i });
    }
}

function handleCanvasMouseWheel(event) {
    if (!isInitialized) return;
    event.preventDefault();
    let currentBrush = Simulation.getCurrentBrushSize();
    const scrollAmount = Math.sign(event.deltaY);
    let newSize = currentBrush - scrollAmount; // Scroll up (negative deltaY) increases size
    newSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, newSize));

    if (newSize !== currentBrush) {
        // Simulation.setBrushSize(newSize); // Dispatch event
        EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, newSize);
        // UI.updateBrushSlider(newSize); // UI will update via BRUSH_SIZE_CHANGED event
        // ... (update hover state by re-triggering mouse move or clearing) ...
        if (event.clientX !== undefined && event.clientY !== undefined) {
            handleCanvasMouseMove(event); // This will dispatch new hover events
        } else {
           for (let i = 0; i < Config.NUM_WORLDS; i++) {
                EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: i });
           }
        }
    }
}

function getCoordsFromMouseEvent(event) { /* ... unchanged from previous version ... */
    if (!gl || !gl.canvas) return { worldIndex: null, col: null, row: null, viewType: null };
    const rect = gl.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;
    const isLandscape = canvasWidth >= canvasHeight;
    let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
    let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;
    const padding = Math.min(canvasWidth, canvasHeight) * 0.02;
    if (isLandscape) {
        selectedViewWidth = canvasWidth * 0.6 - padding * 1.5;
        selectedViewHeight = canvasHeight - padding * 2;
        selectedViewX = padding; selectedViewY = padding;
        miniMapAreaWidth = canvasWidth * 0.4 - padding * 1.5;
        miniMapAreaHeight = selectedViewHeight;
        miniMapAreaX = selectedViewX + selectedViewWidth + padding;
        miniMapAreaY = padding;
    } else {
        selectedViewHeight = canvasHeight * 0.6 - padding * 1.5;
        selectedViewWidth = canvasWidth - padding * 2;
        selectedViewX = padding; selectedViewY = padding;
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

    if (mouseX >= selectedViewX && mouseX < selectedViewX + selectedViewWidth &&
        mouseY >= selectedViewY && mouseY < selectedViewY + selectedViewHeight) {
        const selWorldIdx = Simulation.getSelectedWorldIndex();
        const texCoordX = (mouseX - selectedViewX) / selectedViewWidth;
        const texCoordY = (mouseY - selectedViewY) / selectedViewHeight;
        const { col, row } = textureCoordsToGridCoords(texCoordX, texCoordY);
        return { worldIndex: selWorldIdx, col, row, viewType: 'selected' };
    }
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const r_map = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const c_map = i % Config.WORLD_LAYOUT_COLS;
        const miniX = gridContainerX + c_map * (miniMapW + miniMapSpacing);
        const miniY = gridContainerY + r_map * (miniMapH + miniMapSpacing);
        if (mouseX >= miniX && mouseX < miniX + miniMapW &&
            mouseY >= miniY && mouseY < miniY + miniMapH) {
            const texCoordX = (mouseX - miniX) / miniMapW;
            const texCoordY = (mouseY - miniY) / miniMapH;
            const { col, row } = textureCoordsToGridCoords(texCoordX, texCoordY);
            return { worldIndex: i, col, row, viewType: 'mini' };
        }
    }
    return { worldIndex: null, col: null, row: null, viewType: null };
}

function textureCoordsToGridCoords(texX, texY) { /* ... unchanged from previous version ... */
    if (texX < 0 || texX > 1 || texY < 0 || texY > 1) return { col: null, row: null };
    const pixelX = texX * Config.RENDER_TEXTURE_SIZE;
    const pixelY = texY * Config.RENDER_TEXTURE_SIZE;
    const textureHexSize = Utils.calculateHexSizeForTexture();
    const startX = textureHexSize;
    const startY = textureHexSize * Math.sqrt(3) / 2;
    let minDistSq = Infinity;
    let closestCol = null; let closestRow = null;
    for (let r = 0; r < Config.GRID_ROWS; r++) {
        for (let c = 0; c < Config.GRID_COLS; c++) {
            const center = Utils.gridToPixelCoords(c, r, textureHexSize, startX, startY);
            const dx = pixelX - center.x; const dy = pixelY - center.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                 if (Utils.isPointInHexagon(pixelX, pixelY, center.x, center.y, textureHexSize)) {
                    minDistSq = distSq; closestCol = c; closestRow = r;
                }
            }
        }
    }
    return { col: closestCol, row: closestRow };
}

// --- Resize Handling ---
function handleResize() {
    if (!isInitialized || !gl) return;
    Renderer.resizeRenderer(); // This should handle canvas.width/height and gl.viewport
}

// --- Visibility Change Handling ---
function handleVisibilityChange() {
    if (!isInitialized) return;
    if (document.hidden) {
        if (!Simulation.isSimulationPaused()) {
            Simulation.setSimulationPaused(true);
            pausedByVisibilityChange = true; // Remember we paused it due to visibility
            // UI.updatePauseButton(true); // Done in UI.initUI
        }
    } else {
        // Only resume if we were the ones who paused it due to visibility
        if (pausedByVisibilityChange) {
            Simulation.setSimulationPaused(false);
            pausedByVisibilityChange = false;
            // UI.updatePauseButton(false); // Done in UI.initUI
            lastTimestamp = performance.now(); // Reset timestamp to avoid large jump
        }
    }
}

// --- Render Loop ---
function renderLoop(timestamp) {
    if (!isInitialized) {
        requestAnimationFrame(renderLoop); // Keep trying if not initialized
        return;
    }

    const timeDelta = (timestamp - lastTimestamp) / 1000.0; // Time in seconds
    lastTimestamp = timestamp;

    // --- Simulation Step ---
    // Simulation.stepSimulation now limits steps per frame.
    const ticksProcessedThisFrame = Simulation.stepSimulation(timeDelta);
    accumulatedTicks += ticksProcessedThisFrame;

    // --- Rendering ---
    Renderer.renderFrame(Simulation.getWorldsData(), Simulation.getSelectedWorldIndex());
    frameCount++;

    // --- Update Stats and Performance Indicators ---
    // UI.updateStatsDisplay(Simulation.getSelectedWorldStats()); // Now updated via EventBus
    
    if (timestamp - lastFpsUpdateTime >= 1000) {
        actualFps = frameCount; frameCount = 0; lastFpsUpdateTime = timestamp;
        actualTps = accumulatedTicks; accumulatedTicks = 0; lastTpsUpdateTime = timestamp;
        EventBus.dispatch(EVENTS.PERFORMANCE_METRICS_UPDATED, { fps: actualFps, tps: actualTps });
    }
    // UI.updatePerformanceDisplay(actualFps, actualTps); // Now updated via EventBus
    // UI.updateAnalysisPanel(); // Now updated via EventBus (WORLD_STATS_UPDATED)

    requestAnimationFrame(renderLoop);
}

// --- Start Application ---
initialize().catch(err => {
    console.error("Initialization failed:", err);
    alert("Application failed to initialize. See console for details.");
});