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
let neighborhoodSize = Config.DEFAULT_NEIGHBORHOOD_SIZE;
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

    Simulation.initSimulation();

    const simulationInterface = {
        togglePause: () => {
            const nowPaused = !Simulation.isSimulationPaused();
            pausedByVisibilityChange = false;
            Simulation.setSimulationPaused(nowPaused);
            return nowPaused;
        },
        setSpeed: Simulation.setSimulationSpeed,
        setNeighborhoodSize: (size) => { neighborhoodSize = size; },
        generateRandomRuleset: (bias, symmetrical) => Simulation.generateRandomRuleset(bias, symmetrical),
        getCurrentRulesetHex: Simulation.getCurrentRulesetHex,
        getCurrentRulesetArray: Simulation.getCurrentRulesetArray,
        setRuleset: Simulation.setRuleset,
        getWorldStateForSave: Simulation.getWorldStateForSave,
        getSelectedWorldIndex: Simulation.getSelectedWorldIndex,
        loadWorldState: Simulation.loadWorldState,
        resetAllWorldStates: Simulation.resetAllWorldStates,
        isSimulationPaused: Simulation.isSimulationPaused,
        // Functions for editor interaction (used by RulesetEditor via ui.js)
        toggleRuleOutputState: Simulation.toggleRuleOutputState,
        setAllRulesState: Simulation.setAllRulesState,
        setRulesForNeighborCountCondition: Simulation.setRulesForNeighborCountCondition,
        getEffectiveRuleForNeighborCount: Simulation.getEffectiveRuleForNeighborCount,
    };

    if (!UI.initUI(simulationInterface)) {
        console.error("UI initialization failed.");
        return;
    }

    // UI.refreshAllRulesetViews is called within UI.initUI or by editor itself now.
    // However, an initial call after everything is set up might still be good.
    UI.refreshAllRulesetViews(simulationInterface);
    UI.updatePauseButton(Simulation.isSimulationPaused());
    UI.updateStatsDisplay(Simulation.getSelectedWorldStats()); // Initial stats display

    setupCanvasListeners(canvas);
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    isInitialized = true;
    lastTimestamp = performance.now();
    // Initialize performance update timestamps
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
            Simulation.applyBrush(worldIndex, col, row, neighborhoodSize);
        }
        if (worldIndex !== previousSelectedWorld || viewType === 'selected') { // Update stats if selection changes or selected world is clicked
            UI.updateStatsDisplay(Simulation.getSelectedWorldStats());
        }
    }
}

function handleCanvasMouseMove(event) {
    if (!isInitialized) return;
    const { worldIndex, col, row } // Removed viewType as it's not used here
      = getCoordsFromMouseEvent(event);

    // Clear hover for all worlds first
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        // Optimize: only clear if it was previously hovered or if worldIndex is different
        Simulation.clearHoverState(i); // Simulation module can handle optimization if needed
    }

    if (worldIndex !== null && col !== null && row !== null) {
        Simulation.setHoverState(worldIndex, col, row, neighborhoodSize);
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
    event.preventDefault(); // Prevent page scroll

    const scrollAmount = Math.sign(event.deltaY); // -1 for up, 1 for down
    let newSize = neighborhoodSize - scrollAmount; // Scroll up increases size, scroll down decreases
    newSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, newSize));

    if (newSize !== neighborhoodSize) {
        neighborhoodSize = newSize;
        UI.updateBrushSlider(newSize); // Update UI slider

        // Potentially re-evaluate hover state with new brush size
        // Simulate a mouse move event at the current mouse position to update hover
        // This requires knowing the last mouse position over the canvas.
        // For simplicity, just clear and let next mousemove update it,
        // or call handleCanvasMouseMove if event still has valid clientX/Y
         if (event.clientX !== undefined && event.clientY !== undefined) {
             handleCanvasMouseMove(event);
         } else {
            for (let i = 0; i < Config.NUM_WORLDS; i++) {
                 Simulation.clearHoverState(i);
            }
         }
    }
}


function getCoordsFromMouseEvent(event) {
    if (!gl || !gl.canvas) return { worldIndex: null, col: null, row: null, viewType: null };

    const rect = gl.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;

    const isLandscape = canvasWidth >= canvasHeight;
    let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
    let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;
    // Padding calculation should be consistent with renderer.js
    const padding = Math.min(canvasWidth, canvasHeight) * 0.02; // Dynamic padding based on smaller dimension

    if (isLandscape) {
        selectedViewWidth = canvasWidth * 0.6 - padding * 1.5;
        selectedViewHeight = canvasHeight - padding * 2;
        selectedViewX = padding;
        selectedViewY = padding;

        miniMapAreaWidth = canvasWidth * 0.4 - padding * 1.5;
        miniMapAreaHeight = selectedViewHeight; // Align height with selected view
        miniMapAreaX = selectedViewX + selectedViewWidth + padding;
        miniMapAreaY = padding;
    } else { // Portrait
        selectedViewHeight = canvasHeight * 0.6 - padding * 1.5;
        selectedViewWidth = canvasWidth - padding * 2;
        selectedViewX = padding;
        selectedViewY = padding;

        miniMapAreaHeight = canvasHeight * 0.4 - padding * 1.5;
        miniMapAreaWidth = selectedViewWidth; // Align width with selected view
        miniMapAreaX = padding;
        miniMapAreaY = selectedViewY + selectedViewHeight + padding;
    }

    const miniMapGridRatio = Config.WORLD_LAYOUT_COLS / Config.WORLD_LAYOUT_ROWS;
    const miniMapAreaRatio = miniMapAreaWidth / miniMapAreaHeight;
    let gridContainerWidth, gridContainerHeight;
    const miniMapContainerPaddingFactor = 0.95; // How much of the area the grid container uses

    if (miniMapAreaRatio > miniMapGridRatio) { // Area is wider than grid aspect ratio
        gridContainerHeight = miniMapAreaHeight * miniMapContainerPaddingFactor;
        gridContainerWidth = gridContainerHeight * miniMapGridRatio;
    } else { // Area is taller or equal aspect ratio
        gridContainerWidth = miniMapAreaWidth * miniMapContainerPaddingFactor;
        gridContainerHeight = gridContainerWidth / miniMapGridRatio;
    }

    const gridContainerX = miniMapAreaX + (miniMapAreaWidth - gridContainerWidth) / 2;
    const gridContainerY = miniMapAreaY + (miniMapAreaHeight - gridContainerHeight) / 2;
    const miniMapSpacing = Math.min(gridContainerWidth, gridContainerHeight) * 0.01; // Small spacing relative to container

    const miniMapW = (gridContainerWidth - (Config.WORLD_LAYOUT_COLS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_COLS;
    const miniMapH = (gridContainerHeight - (Config.WORLD_LAYOUT_ROWS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_ROWS;

    // Check selected view first
    if (mouseX >= selectedViewX && mouseX < selectedViewX + selectedViewWidth &&
        mouseY >= selectedViewY && mouseY < selectedViewY + selectedViewHeight) {
        const selWorldIdx = Simulation.getSelectedWorldIndex();
        const texCoordX = (mouseX - selectedViewX) / selectedViewWidth;
        const texCoordY = (mouseY - selectedViewY) / selectedViewHeight;
        const { col, row } = textureCoordsToGridCoords(texCoordX, texCoordY);
        return { worldIndex: selWorldIdx, col, row, viewType: 'selected' };
    }

    // Check mini-maps
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


function textureCoordsToGridCoords(texX, texY) {
    // Ensure texX and texY are within [0, 1] range
    if (texX < 0 || texX > 1 || texY < 0 || texY > 1) {
        return { col: null, row: null };
    }

    const pixelX = texX * Config.RENDER_TEXTURE_SIZE;
    const pixelY = texY * Config.RENDER_TEXTURE_SIZE;

    // Get hex size and starting offsets as used in renderer.js setupHexBuffersAndVAO
    const textureHexSize = Utils.calculateHexSizeForTexture();
    const startX = textureHexSize; // Initial offset from edge of texture
    const startY = textureHexSize * Math.sqrt(3) / 2; // Initial offset for first row

    let minDistSq = Infinity;
    let closestCol = null;
    let closestRow = null;

    // Iterate over a smaller search area if possible, or refine search later.
    // For now, full scan is robust.
    for (let r = 0; r < Config.GRID_ROWS; r++) {
        for (let c = 0; c < Config.GRID_COLS; c++) {
            const center = Utils.gridToPixelCoords(c, r, textureHexSize, startX, startY);
            const dx = pixelX - center.x;
            const dy = pixelY - center.y;
            const distSq = dx * dx + dy * dy;

            // Optimization: if distSq is already greater than a generous hex diameter squared,
            // it's unlikely to be the closest, especially if not even in the bounding box.
            // A simpler check is if point is inside the hexagon, then it's a candidate.
            if (distSq < minDistSq) { // Check if potentially closer first
                 if (Utils.isPointInHexagon(pixelX, pixelY, center.x, center.y, textureHexSize)) {
                    minDistSq = distSq;
                    closestCol = c;
                    closestRow = r;
                }
            } else if (minDistSq < (textureHexSize * textureHexSize) && distSq > (textureHexSize * 2 * textureHexSize * 2 ) ) {
                // If we already found a hex and this one is much further than its diameter, skip detailed check
                // This is a rough optimization, actual check is isPointInHexagon
            }
        }
    }
    // If after checking all, closestCol/Row are still null, but mouse is on canvas,
    // it means it's in the padding area of the texture.
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

    requestAnimationFrame(renderLoop);
}

// --- Start Application ---
initialize().catch(err => {
    console.error("Initialization failed:", err);
    alert("Application failed to initialize. See console for details.");
});