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
let neighborhoodSize = Config.DEFAULT_NEIGHBORHOOD_SIZE; // Track brush size locally for interaction
let pausedByVisibilityChange = false; // <-- NEW: Track if pause was due to tab change

// --- Initialization ---

async function initialize() {
    console.log("Starting Initialization...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    // 1. Initialize Renderer
    gl = await Renderer.initRenderer(canvas);
    if (!gl) {
        console.error("Renderer initialization failed.");
        return;
    }

    // 2. Initialize Simulation
    Simulation.initSimulation();

    // 3. Initialize UI (pass simulation interaction functions)
    const simulationInterface = {
        togglePause: () => {
            const nowPaused = !Simulation.isSimulationPaused();
            pausedByVisibilityChange = false; // <-- User manually toggled, clear the flag
            Simulation.setSimulationPaused(nowPaused);
            // UI update will happen via listener or can be forced here if needed
            // UI.updatePauseButton(nowPaused); // Can call here for immediate feedback
            return nowPaused;
        },
        setSpeed: Simulation.setSimulationSpeed,
        setNeighborhoodSize: (size) => { neighborhoodSize = size; },
        generateRandomRuleset: Simulation.generateRandomRuleset,
        getCurrentRulesetHex: Simulation.getCurrentRulesetHex,
        getCurrentRulesetArray: Simulation.getCurrentRulesetArray, // <-- ADDED
        setRuleset: Simulation.setRuleset,
        getWorldStateForSave: Simulation.getWorldStateForSave,
        getSelectedWorldIndex: Simulation.getSelectedWorldIndex,
        loadWorldState: Simulation.loadWorldState,
        resetAllWorldStates: Simulation.resetAllWorldStates,
        isSimulationPaused: Simulation.isSimulationPaused,
    };
    if (!UI.initUI(simulationInterface)) {
        console.error("UI initialization failed.");
        return;
    }

    // Set initial UI state from simulation
    UI.updateRulesetDisplay(Simulation.getCurrentRulesetHex());
    UI.updatePauseButton(Simulation.isSimulationPaused());


    // 4. Setup Canvas Interaction Listeners
    setupCanvasListeners(canvas);

    // 5. Setup Window Resize Listener
    window.addEventListener('resize', handleResize);

    // 6. Setup Visibility Change Listener <-- NEW
    document.addEventListener('visibilitychange', handleVisibilityChange);

    isInitialized = true;
    lastTimestamp = performance.now();
    console.log("Initialization Complete. Starting Render Loop.");
    requestAnimationFrame(renderLoop); // Start the loop
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
    // *** Get viewType from the coordinate calculation ***
    const { worldIndex, col, row, viewType } = getCoordsFromMouseEvent(event);

    if (worldIndex !== null) { // A world view was clicked
        const previousSelectedWorld = Simulation.getSelectedWorldIndex();

        // Select the clicked world unconditionally
        Simulation.setSelectedWorldIndex(worldIndex);

        // *** Apply brush ONLY if clicking the selected view ***
        if (viewType === 'selected' && col !== null && row !== null) {
            console.log(`Applying brush to selected world ${worldIndex} at [${col}, ${row}]`); // Debug log
            const changed = Simulation.applyBrush(worldIndex, col, row, neighborhoodSize);
            // Stats will update automatically if state changed via applyBrush
        } else if (viewType === 'mini') {
             console.log(`Selected mini-map world ${worldIndex}`); // Debug log
             // Do not apply brush for mini-map clicks
        }

        // Update stats display if selection changed
        if (worldIndex !== previousSelectedWorld) {
           UI.updateStatsDisplay(Simulation.getSelectedWorldStats());
        }
    }
}


function handleCanvasMouseMove(event) {
     if (!isInitialized) return;
     const { worldIndex, col, row, viewType } = getCoordsFromMouseEvent(event);

     let hoverChanged = false;
     // Clear previous hover state across all worlds first
     for (let i = 0; i < Config.NUM_WORLDS; i++) {
         hoverChanged = Simulation.clearHoverState(i) || hoverChanged;
     }

     // Set new hover state only on the specific world being hovered over
     if (worldIndex !== null && col !== null && row !== null) {
         hoverChanged = Simulation.setHoverState(worldIndex, col, row, neighborhoodSize) || hoverChanged;
     }

     // Renderer will pick up changes on the next frame
     // No explicit redraw needed here unless immediate visual feedback is critical
}

function handleCanvasMouseOut(event) {
    if (!isInitialized) return;
    let hoverChanged = false;
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
         hoverChanged = Simulation.clearHoverState(i) || hoverChanged;
    }
    // Renderer will update on next frame
}

function handleCanvasMouseWheel(event) {
    if (!isInitialized) return;
    event.preventDefault();

    const scrollAmount = Math.sign(event.deltaY);
    let newSize = neighborhoodSize;
    newSize += (scrollAmount < 0 ? 1 : -1);

    const minBrush = 0;
    const maxBrush = Config.MAX_NEIGHBORHOOD_SIZE;
    newSize = Math.max(minBrush, Math.min(maxBrush, newSize));

    if (newSize !== neighborhoodSize) {
        neighborhoodSize = newSize;
        UI.updateBrushSlider(newSize);

        // Clear hover so it recalculates with new size on next mouse move
        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            Simulation.clearHoverState(i);
        }
    }
    handleCanvasMouseMove(event); // Trigger hover update with new size
}

// --- Coordinate Conversion (Crucial for Interaction) ---
/**
 * Determines which world view (mini/selected) and grid cell corresponds
 * to a mouse event's screen coordinates, adapting to orientation.
 * @param {MouseEvent} event
 * @returns {{worldIndex: number|null, col: number|null, row: number|null, viewType: 'mini'|'selected'|null}}
 */
function getCoordsFromMouseEvent(event) {
    if (!gl || !gl.canvas) return { worldIndex: null, col: null, row: null, viewType: null };

    const rect = gl.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const canvasWidth = gl.canvas.width;
    const canvasHeight = gl.canvas.height;

    // --- Replicate Layout Calculation from updated renderer.js ---
    const isLandscape = canvasWidth >= canvasHeight; // Determine orientation
    let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
    let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;
    const padding = canvasWidth * 0.02; // Use consistent padding

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

    // Mini-Map Grid Calculation (Replicated exactly from renderMainScene)
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
    // --- End Layout Calculation Replication ---


    // 1. Check Selected View Area
    if (mouseX >= selectedViewX && mouseX < selectedViewX + selectedViewWidth &&
        mouseY >= selectedViewY && mouseY < selectedViewY + selectedViewHeight)
    {
        const selWorldIdx = Simulation.getSelectedWorldIndex();
        const texCoordX = (mouseX - selectedViewX) / selectedViewWidth;
        const texCoordY = (mouseY - selectedViewY) / selectedViewHeight;
        const { col, row } = textureCoordsToGridCoords(texCoordX, texCoordY);
        return { worldIndex: selWorldIdx, col, row, viewType: 'selected' };
    }

    // 2. Check Mini-Map Area (Iterate through calculated grid positions)
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const r_map = Math.floor(i / Config.WORLD_LAYOUT_COLS);
        const c_map = i % Config.WORLD_LAYOUT_COLS;
        const miniX = gridContainerX + c_map * (miniMapW + miniMapSpacing);
        const miniY = gridContainerY + r_map * (miniMapH + miniMapSpacing); // Use same spacing

        if (mouseX >= miniX && mouseX < miniX + miniMapW &&
            mouseY >= miniY && mouseY < miniY + miniMapH)
        {
            const texCoordX = (mouseX - miniX) / miniMapW;
            const texCoordY = (mouseY - miniY) / miniMapH;
            const { col, row } = textureCoordsToGridCoords(texCoordX, texCoordY);
            return { worldIndex: i, col, row, viewType: 'mini' };
        }
    }


    return { worldIndex: null, col: null, row: null, viewType: null };
}

/**
 * Converts normalized texture coordinates (0-1) back to grid coordinates (col, row).
 * @param {number} texX Normalized X (0 to 1).
 * @param {number} texY Normalized Y (0 to 1).
 * @returns {{col: number, row: number}|{col: null, row: null}} Grid coords or null if invalid.
 */
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
            const distSq = dx*dx + dy*dy;

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
    console.log("Resizing...");
    Renderer.resizeRenderer();
}

// --- Visibility Change Handling --- <-- NEW SECTION

function handleVisibilityChange() {
    if (!isInitialized) return;

    if (document.hidden) {
        // Tab became hidden
        if (!Simulation.isSimulationPaused()) {
            console.log('Tab hidden, pausing simulation.');
            Simulation.setSimulationPaused(true);
            pausedByVisibilityChange = true;
            UI.updatePauseButton(true); // Update UI button state
        }
    } else {
        // Tab became visible
        if (pausedByVisibilityChange) {
            console.log('Tab visible, resuming simulation.');
            Simulation.setSimulationPaused(false);
            pausedByVisibilityChange = false;
            UI.updatePauseButton(false); // Update UI button state
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

    // 1. Update Simulation State
    const stepOccurred = Simulation.stepSimulation(timeDelta);

    // 2. Render Worlds
    Renderer.renderFrame(Simulation.getWorldsData(), Simulation.getSelectedWorldIndex());

    // 3. Update UI Stats Display
    UI.updateStatsDisplay(Simulation.getSelectedWorldStats());

    // 4. Request Next Frame
    requestAnimationFrame(renderLoop);
}

// --- Start Application ---
initialize().catch(err => {
    console.error("Initialization failed:", err);
    alert("Application failed to initialize. See console for details.");
});
