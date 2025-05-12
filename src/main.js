// src/main.js
import * as Config from './core/config.js';
import * as Simulation from './core/simulation.js';
import * as Renderer from './rendering/renderer.js';
import * as UI from './ui/ui.js';
import * as Utils from './utils/utils.js';

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

    const simulationInterface = {
        // Playback & Core State
        togglePause: () => {
            const nowPaused = !Simulation.isSimulationPaused();
            pausedByVisibilityChange = false; // Reset flag on manual toggle
            Simulation.setSimulationPaused(nowPaused);
            return nowPaused;
        },
        isSimulationPaused: Simulation.isSimulationPaused,
        getSelectedWorldIndex: Simulation.getSelectedWorldIndex,
        loadWorldState: Simulation.loadWorldState, // Persists changes
        getWorldStateForSave: Simulation.getWorldStateForSave,

        // Speed & Brush (managed by Simulation.js for persistence)
        setSpeed: Simulation.setSimulationSpeed,
        getCurrentSimulationSpeed: Simulation.getCurrentSimulationSpeed,
        setBrushSize: Simulation.setBrushSize,
        getCurrentBrushSize: Simulation.getCurrentBrushSize,

        // Ruleset Management (managed by Simulation.js for persistence)
        generateRandomRuleset: Simulation.generateRandomRuleset,
        getCurrentRulesetHex: Simulation.getCurrentRulesetHex,
        getCurrentRulesetArray: Simulation.getCurrentRulesetArray,
        setRuleset: Simulation.setRuleset,
        toggleRuleOutputState: Simulation.toggleRuleOutputState,
        setAllRulesState: Simulation.setAllRulesState,
        setRulesForNeighborCountCondition: Simulation.setRulesForNeighborCountCondition,
        getEffectiveRuleForNeighborCount: Simulation.getEffectiveRuleForNeighborCount,

        // World Setup & Reset (managed by Simulation.js for persistence)
        getWorldSettings: Simulation.getWorldSettings,
        setWorldInitialDensity: Simulation.setWorldInitialDensity,
        setWorldEnabled: Simulation.setWorldEnabled,
        resetAllWorldsToCurrentSettings: Simulation.resetAllWorldsToCurrentSettings,
        getSelectedWorldStats: Simulation.getSelectedWorldStats, // Gets ratio, avgRatio, history, and calculates current entropy
        getSelectedWorldRatioHistory: Simulation.getSelectedWorldRatioHistory,
        // New functions for sampling and entropy history
        setEntropySampling: Simulation.setEntropySampling,
        getEntropySamplingState: Simulation.getEntropySamplingState,
        getSelectedWorldEntropyHistory: Simulation.getSelectedWorldEntropyHistory
    };

    // UI.initUI will now use simulationInterface to get initial speed/brush for sliders
    if (!UI.initUI(simulationInterface)) {
        console.error("UI initialization failed.");
        return;
    }

    // UI.initUI calls loadAndApplyUISettings which sets up initial UI values
    // including those fetched via simulationInterface (speed, brush size)
    UI.updatePauseButton(Simulation.isSimulationPaused());
    UI.updateStatsDisplay(Simulation.getSelectedWorldStats());

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
        Simulation.setSelectedWorldIndex(worldIndex);

        if (viewType === 'selected' && col !== null && row !== null) {
            Simulation.applyBrush(worldIndex, col, row, Simulation.getCurrentBrushSize());
        }
        // Update stats display (Ratio/AvgRatio) AND analysis panel plots
        if (worldIndex !== previousSelectedWorld || (viewType === 'selected' && col !== null)) {
             UI.updateStatsDisplay(Simulation.getSelectedWorldStats());
             UI.updateAnalysisPanel(); // Update plots on selection change/interaction
        }
    }
}

function handleCanvasMouseMove(event) {
    if (!isInitialized) return;
    const { worldIndex, col, row } = getCoordsFromMouseEvent(event);
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        Simulation.clearHoverState(i);
    }
    if (worldIndex !== null && col !== null && row !== null) {
        // Get current brush size from simulation module for hover
        Simulation.setHoverState(worldIndex, col, row, Simulation.getCurrentBrushSize());
    }
}

function handleCanvasMouseOut() {
    if (!isInitialized) return;
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        Simulation.clearHoverState(i);
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
        Simulation.setBrushSize(newSize); // Update in simulation (and persists to LS)
        UI.updateBrushSlider(newSize);    // Update UI slider display

        // Update hover state based on new brush size
        if (event.clientX !== undefined && event.clientY !== undefined) {
            handleCanvasMouseMove(event); // This will use the new currentBrushSize
        } else {
           for (let i = 0; i < Config.NUM_WORLDS; i++) {
                Simulation.clearHoverState(i);
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
            UI.updatePauseButton(true);
        }
    } else {
        // Only resume if we were the ones who paused it due to visibility
        if (pausedByVisibilityChange) {
            Simulation.setSimulationPaused(false);
            pausedByVisibilityChange = false;
            UI.updatePauseButton(false);
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
    UI.updateStatsDisplay(Simulation.getSelectedWorldStats());

    // Calculate and update FPS (once per second)
    if (timestamp - lastFpsUpdateTime >= 1000) { // Use >= to ensure it runs at least once a second
        actualFps = frameCount;
        frameCount = 0;
        lastFpsUpdateTime = timestamp;
    }

    // Calculate and update actual TPS (once per second)
    if (timestamp - lastTpsUpdateTime >= 1000) {
        actualTps = accumulatedTicks;
        accumulatedTicks = 0;
        lastTpsUpdateTime = timestamp;
    }

    // Update the performance display every frame with the latest calculated values
    UI.updatePerformanceDisplay(actualFps, actualTps);
    UI.updateAnalysisPanel();

    requestAnimationFrame(renderLoop);
}

// --- Start Application ---
initialize().catch(err => {
    console.error("Initialization failed:", err);
    alert("Application failed to initialize. See console for details.");
});