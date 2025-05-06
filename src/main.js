// main.js
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
        generateRandomRuleset: Simulation.generateRandomRuleset,
        getCurrentRulesetHex: Simulation.getCurrentRulesetHex,
        getCurrentRulesetArray: Simulation.getCurrentRulesetArray,
        setRuleset: Simulation.setRuleset,
        getWorldStateForSave: Simulation.getWorldStateForSave,
        getSelectedWorldIndex: Simulation.getSelectedWorldIndex,
        loadWorldState: Simulation.loadWorldState,
        resetAllWorldStates: Simulation.resetAllWorldStates,
        isSimulationPaused: Simulation.isSimulationPaused,
        // New functions for editor interaction
        toggleRuleOutputState: Simulation.toggleRuleOutputState,
        setAllRulesState: Simulation.setAllRulesState,
    };

    if (!UI.initUI(simulationInterface)) { // Pass the full interface
        console.error("UI initialization failed.");
        return;
    }

    UI.refreshAllRulesetViews(Simulation);
    UI.updatePauseButton(Simulation.isSimulationPaused());

    setupCanvasListeners(canvas);
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    isInitialized = true;
    lastTimestamp = performance.now();
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
        if (worldIndex !== previousSelectedWorld) {
            UI.updateStatsDisplay(Simulation.getSelectedWorldStats());
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
    event.preventDefault();
    const scrollAmount = Math.sign(event.deltaY);
    let newSize = neighborhoodSize + (scrollAmount < 0 ? 1 : -1);
    newSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, newSize));
    if (newSize !== neighborhoodSize) {
        neighborhoodSize = newSize;
        UI.updateBrushSlider(newSize);
        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            Simulation.clearHoverState(i);
        }
    }
    handleCanvasMouseMove(event);
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

function textureCoordsToGridCoords(texX, texY) {
    const pixelX = texX * Config.RENDER_TEXTURE_SIZE;
    const pixelY = texY * Config.RENDER_TEXTURE_SIZE;
    const textureHexSize = Utils.calculateHexSizeForTexture();
    const startX = textureHexSize;
    const startY = textureHexSize * Math.sqrt(3) / 2;
    let minDistSq = Infinity;
    let closestCol = null;
    let closestRow = null;
    for (let r = 0; r < Config.GRID_ROWS; r++) {
        for (let c = 0; c < Config.GRID_COLS; c++) {
            const center = Utils.gridToPixelCoords(c, r, textureHexSize, startX, startY);
            const dx = pixelX - center.x;
            const dy = pixelY - center.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                if (Utils.isPointInHexagon(pixelX, pixelY, center.x, center.y, textureHexSize)) {
                    minDistSq = distSq;
                    closestCol = c;
                    closestRow = r;
                }
            }
        }
    }
    return { col: closestCol, row: closestRow };
}

// --- Resize Handling ---
function handleResize() {
    if (!isInitialized) return;
    Renderer.resizeRenderer();
}

// --- Visibility Change Handling ---
function handleVisibilityChange() {
    if (!isInitialized) return;
    if (document.hidden) {
        if (!Simulation.isSimulationPaused()) {
            Simulation.setSimulationPaused(true);
            pausedByVisibilityChange = true;
            UI.updatePauseButton(true);
        }
    } else {
        if (pausedByVisibilityChange) {
            Simulation.setSimulationPaused(false);
            pausedByVisibilityChange = false;
            UI.updatePauseButton(false);
        }
    }
}

// --- Render Loop ---
function renderLoop(timestamp) {
    if (!isInitialized) {
        requestAnimationFrame(renderLoop);
        return;
    }
    const timeDelta = (timestamp - lastTimestamp) / 1000.0;
    lastTimestamp = timestamp;

    Simulation.stepSimulation(timeDelta);
    Renderer.renderFrame(Simulation.getWorldsData(), Simulation.getSelectedWorldIndex());
    UI.updateStatsDisplay(Simulation.getSelectedWorldStats());
    requestAnimationFrame(renderLoop);
}

// --- Start Application ---
initialize().catch(err => {
    console.error("Initialization failed:", err);
    alert("Application failed to initialize. See console for details.");
});