import * as Config from './core/config.js';
import { WorldManager } from './core/WorldManager.js';
import * as Renderer from './rendering/renderer.js';
import * as CanvasLoader from './rendering/canvasLoader.js';
import * as UI from './ui/ui.js';
import * as Utils from './utils/utils.js';
import { EventBus, EVENTS } from './services/EventBus.js';

let gl;
let worldManager;
let isInitialized = false;
let lastTimestamp = 0;
let pausedByVisibilityChange = false;

let frameCount = 0;
let lastFpsUpdateTime = 0;
let actualFps = 0;

// Mouse drawing state
let isMouseDrawing = false;
let lastDrawnCellIndex = null;
let strokeAffectedCells = new Set(); // Track cells affected by current stroke
let wasSimulationRunningBeforeStroke = false;
let justFinishedDrawing = false; // Prevent click after drawing
let initialWorldState = null; // Store initial cell states when stroke begins
let cellsShouldBeToggled = new Set(); // Track which cells should be in toggled state

async function initialize() {
    console.log("Starting Initialization (Worker Architecture)...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    // Start the loader immediately
    CanvasLoader.startCanvasLoader(canvas);

    gl = await Renderer.initRenderer(canvas);
    if (!gl) {
        console.error("Renderer initialization failed.");
        CanvasLoader.stopCanvasLoader();
        return;
    }

    worldManager = new WorldManager();

    const worldManagerInterfaceForUI = {
        isSimulationPaused: worldManager.isSimulationPaused,
        getCurrentRulesetHex: worldManager.getCurrentRulesetHex,
        getCurrentRulesetArray: worldManager.getCurrentRulesetArray,
        getCurrentSimulationSpeed: worldManager.getCurrentSimulationSpeed,
        getCurrentBrushSize: worldManager.getCurrentBrushSize,
        getSelectedWorldIndex: worldManager.getSelectedWorldIndex,
        getSelectedWorldStats: worldManager.getSelectedWorldStats,
        getWorldSettingsForUI: worldManager.getWorldSettingsForUI,
        getEffectiveRuleForNeighborCount: worldManager.getEffectiveRuleForNeighborCount,
        getCanonicalRuleDetails: worldManager.getCanonicalRuleDetails,
        getSymmetryData: worldManager.getSymmetryData,
        rulesetToHex: worldManager.rulesetToHex,
        hexToRuleset: worldManager.hexToRuleset,
        
        getSelectedWorldRatioHistory: () => { 
            const stats = worldManager.getSelectedWorldStats();
            return stats?.ratioHistory || [];
        },
        getSelectedWorldEntropyHistory: () => { 
            const stats = worldManager.getSelectedWorldStats();
            return stats?.entropyHistory || [];
        },
        getEntropySamplingState: () => worldManager.getEntropySamplingState(), 
    };

    if (!UI.initUI(worldManagerInterfaceForUI)) {
        console.error("UI initialization failed.");
        return;
    }
    setupCanvasListeners(canvas);
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => {
        worldManager.terminateAllWorkers();
    });


    isInitialized = true;
    lastTimestamp = performance.now();
    lastFpsUpdateTime = lastTimestamp;

    console.log("Initialization Complete. Starting Render Loop.");
    requestAnimationFrame(renderLoop);
}

function setupCanvasListeners(canvas) {
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mouseup', handleCanvasMouseUp);
    canvas.addEventListener('mouseout', handleCanvasMouseOut);
    canvas.addEventListener('wheel', handleCanvasMouseWheel, { passive: false });
}

function handleCanvasClick(event) {
    if (!isInitialized || !worldManager) return;
    
    // Prevent click if we just finished drawing
    if (justFinishedDrawing) {
        justFinishedDrawing = false;
        return;
    }
    
    const { worldIndexAtCursor, col, row, viewType } = getCoordsFromMouseEvent(event);

    if (worldIndexAtCursor !== null) {
        const previousSelectedWorld = worldManager.getSelectedWorldIndex();
        if (worldIndexAtCursor !== previousSelectedWorld) {
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
        }

        // Only apply brush if not in continuous drawing mode (to avoid double-clicking)
        if (!isMouseDrawing && viewType === 'selected' && col !== null && row !== null) {
            EventBus.dispatch(EVENTS.COMMAND_APPLY_BRUSH, {
                worldIndex: worldIndexAtCursor,
                col: col,
                row: row,
            });
        }
    }
}

function handleCanvasMouseDown(event) {
    if (!isInitialized || !worldManager) return;
    
    // Only start drawing with left mouse button
    if (event.button !== 0) return;
    
    const { worldIndexAtCursor, col, row, viewType } = getCoordsFromMouseEvent(event);
    
    if (worldIndexAtCursor !== null && viewType === 'selected' && col !== null && row !== null) {
        isMouseDrawing = true;
        strokeAffectedCells.clear(); // Clear previous stroke data
        cellsShouldBeToggled.clear(); // Clear cells that should be toggled
        lastDrawnCellIndex = row * Config.GRID_COLS + col;
        
        // Pause simulation if it's running
        wasSimulationRunningBeforeStroke = !worldManager.isSimulationPaused();
        if (wasSimulationRunningBeforeStroke) {
            EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
        }
        
        // Get initial world state from the selected world
        const selectedWorldData = worldManager.getWorldsRenderData()[worldIndexAtCursor];
        if (selectedWorldData && selectedWorldData.jsStateArray) {
            initialWorldState = new Uint8Array(selectedWorldData.jsStateArray);
        } else {
            initialWorldState = null;
        }
        
        // Track all cells in brush area as should be toggled
        const brushCells = findHexagonsInNeighborhood(col, row, worldManager.getCurrentBrushSize());
        brushCells.forEach(cellIndex => {
            cellsShouldBeToggled.add(cellIndex);
            strokeAffectedCells.add(cellIndex);
        });
        
        // Use selective brush to only toggle the specific cells
        EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
            worldIndex: worldIndexAtCursor,
            cellIndices: brushCells
        });
        
        event.preventDefault();
    }
}

function handleCanvasMouseUp(event) {
    if (!isInitialized || !worldManager) return;
    
    // Only handle left mouse button
    if (event.button !== 0) return;
    
    // Set flag to prevent click event if we were drawing
    if (isMouseDrawing) {
        justFinishedDrawing = true;
        // Clear the flag after a short delay to allow normal clicks
        setTimeout(() => { justFinishedDrawing = false; }, 50);
    }
    
    isMouseDrawing = false;
    lastDrawnCellIndex = null;
    
    // Unpause simulation if it was running before the stroke
    if (wasSimulationRunningBeforeStroke) {
        EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
        wasSimulationRunningBeforeStroke = false;
    }
    
    strokeAffectedCells.clear();
    cellsShouldBeToggled.clear();
    initialWorldState = null;
}

// Function to find hexagons within brush radius (similar to WorldManager's method)
function findHexagonsInNeighborhood(startCol, startRow, maxDistance) {
    const affected = new Set();
    if (startCol === null || startRow === null) return Array.from(affected);

    const q = [[startCol, startRow, 0]];
    const visited = new Map([[`${startCol},${startRow}`, 0]]);
    const startIndex = startRow * Config.GRID_COLS + startCol;
    if (startIndex !== undefined && startIndex >= 0 && startIndex < Config.NUM_CELLS) affected.add(startIndex);

    while (q.length > 0) {
        const [cc, cr, cd] = q.shift();
        if (cd >= maxDistance) continue;

        const dirs = (cc % 2 !== 0) ? Config.NEIGHBOR_DIRS_ODD_R : Config.NEIGHBOR_DIRS_EVEN_R;
        for (const [dx, dy] of dirs) {
            const nc = cc + dx;
            const nr = cr + dy;
            const wc = (nc % Config.GRID_COLS + Config.GRID_COLS) % Config.GRID_COLS;
            const wr = (nr % Config.GRID_ROWS + Config.GRID_ROWS) % Config.GRID_ROWS;

            if (!visited.has(`${wc},${wr}`)) {
                const ni = wr * Config.GRID_COLS + wc;
                if (ni !== undefined && ni >= 0 && ni < Config.NUM_CELLS) {
                    visited.set(`${wc},${wr}`, cd + 1);
                    affected.add(ni);
                    q.push([wc, wr, cd + 1]);
                }
            }
        }
    }
    return Array.from(affected);
}

function handleCanvasMouseMove(event) {
    if (!isInitialized || !worldManager) return;
    const { worldIndexAtCursor, col, row, viewType } = getCoordsFromMouseEvent(event);

    // Handle continuous drawing if mouse is pressed
    if (isMouseDrawing && worldIndexAtCursor !== null && viewType === 'selected' && col !== null && row !== null) {
        const currentCellIndex = row * Config.GRID_COLS + col;
        
        // Only apply brush if we've moved to a different cell to avoid excessive events
        if (currentCellIndex !== lastDrawnCellIndex) {
            lastDrawnCellIndex = currentCellIndex;
            
            // Get all cells that would be affected by the brush at this position
            const brushCells = findHexagonsInNeighborhood(col, row, worldManager.getCurrentBrushSize());
            
            // Check which cells in the brush area should be newly toggled
            const newCellsToToggle = brushCells.filter(cellIndex => !cellsShouldBeToggled.has(cellIndex));
            
            // Only apply brush if there are new cells that should be toggled
            if (newCellsToToggle.length > 0) {
                // Add new cells to the "should be toggled" set
                newCellsToToggle.forEach(cellIndex => {
                    cellsShouldBeToggled.add(cellIndex);
                    strokeAffectedCells.add(cellIndex);
                });
                
                // Use selective brush to only toggle the new cells
                EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
                    worldIndex: worldIndexAtCursor,
                    cellIndices: newCellsToToggle
                });
            }
        }
    }

    // Handle hover state for all worlds
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        if (i !== worldIndexAtCursor || col == null) {
             EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: i });
        }
    }

    if (worldIndexAtCursor !== null && col !== null && row !== null) {
        EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, {
            worldIndex: worldIndexAtCursor,
            col: col,
            row: row,
        });
    }
}

function handleCanvasMouseOut() {
    if (!isInitialized || !worldManager) return;
    
    // Stop drawing when mouse leaves canvas and unpause if needed
    if (isMouseDrawing) {
        isMouseDrawing = false;
        lastDrawnCellIndex = null;
        
        // Unpause simulation if it was running before the stroke
        if (wasSimulationRunningBeforeStroke) {
            EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
            wasSimulationRunningBeforeStroke = false;
        }
        
        strokeAffectedCells.clear();
        cellsShouldBeToggled.clear();
        initialWorldState = null;
    }
    
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
         EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: i });
    }
}

function handleCanvasMouseWheel(event) {
    if (!isInitialized || !worldManager) return;
    event.preventDefault();
    let currentBrush = worldManager.getCurrentBrushSize();
    const scrollAmount = Math.sign(event.deltaY);
    let newSize = currentBrush - scrollAmount;
    newSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, newSize));

    if (newSize !== currentBrush) {
        EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, newSize);
        const rect = gl.canvas.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right &&
            event.clientY >= rect.top && event.clientY <= rect.bottom) {
            handleCanvasMouseMove(event);
        }
    }
}

function getCoordsFromMouseEvent(event) {
    if (!gl || !gl.canvas || !worldManager) return { worldIndexAtCursor: null, col: null, row: null, viewType: null };
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

    const currentSelectedWorldIdx = worldManager.getSelectedWorldIndex();
    if (mouseX >= selectedViewX && mouseX < selectedViewX + selectedViewWidth &&
        mouseY >= selectedViewY && mouseY < selectedViewY + selectedViewHeight) {
        const texCoordX = (mouseX - selectedViewX) / selectedViewWidth;
        const texCoordY = (mouseY - selectedViewY) / selectedViewHeight;
        const { col, row } = textureCoordsToGridCoords(texCoordX, texCoordY);
        return { worldIndexAtCursor: currentSelectedWorldIdx, col, row, viewType: 'selected' };
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
            return { worldIndexAtCursor: i, col, row, viewType: 'mini' };
        }
    }
    return { worldIndexAtCursor: null, col: null, row: null, viewType: null };
}


function textureCoordsToGridCoords(texX, texY) {
    if (texX < 0 || texX > 1 || texY < 0 || texY > 1) return { col: null, row: null };
    const pixelX = texX * Config.RENDER_TEXTURE_SIZE;
    const pixelY = texY * Config.RENDER_TEXTURE_SIZE;

    const textureHexSize = Utils.calculateHexSizeForTexture();
    const startX = textureHexSize;
    const startY = textureHexSize * Math.sqrt(3) / 2;

    let minDistSq = Infinity;
    let closestCol = null;
    let closestRow = null;

    const searchRadius = 2;
    const estimatedColRough = (pixelX - startX) / (textureHexSize * 1.5);
    const estimatedRowRough = (pixelY - startY) / (textureHexSize * Math.sqrt(3));

    for (let rOffset = -searchRadius; rOffset <= searchRadius; rOffset++) {
        for (let cOffset = -searchRadius; cOffset <= searchRadius; cOffset++) {
            const c = Math.round(estimatedColRough + cOffset);
            const r = Math.round(estimatedRowRough + rOffset);

            if (c < 0 || c >= Config.GRID_COLS || r < 0 || r >= Config.GRID_ROWS) continue;

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

function handleResize() {
    // Handle Canvas 2D loader resize if active
    const mainCanvas = document.getElementById('hexGridCanvas');
    if (mainCanvas) {
        CanvasLoader.handleLoaderResize(mainCanvas);
    }
    
    // Handle WebGL renderer resize if initialized
    if (isInitialized && gl) {
        Renderer.resizeRenderer();
    }
}

function handleVisibilityChange() {
    if (!isInitialized || !worldManager) return;
    if (document.hidden) {
        if (!worldManager.isSimulationPaused()) {
            worldManager.setGlobalPause(true);
            pausedByVisibilityChange = true;
        }
    } else {
        if (pausedByVisibilityChange) {
            worldManager.setGlobalPause(false);
            pausedByVisibilityChange = false;
            lastTimestamp = performance.now();
        }
    }
}

function renderLoop(timestamp) {
    if (!isInitialized || !worldManager) {
        requestAnimationFrame(renderLoop);
        return;
    }

    const timeDelta = (timestamp - lastTimestamp) / 1000.0;
    lastTimestamp = timestamp;

    const allWorldsData = worldManager.getWorldsRenderData();
    const areAllWorkersInitialized = worldManager.areAllWorkersInitialized();
    
    // Stop the Canvas 2D loader once all workers are ready
    if (areAllWorkersInitialized && CanvasLoader.isLoaderActive()) {
        CanvasLoader.stopCanvasLoader();
    }
    
    // Only start WebGL rendering after workers are initialized
    if (areAllWorkersInitialized) {
        Renderer.renderFrameOrLoader(allWorldsData, worldManager.getSelectedWorldIndex(), areAllWorkersInitialized);
    }

    frameCount++;
    if (timestamp - lastFpsUpdateTime >= 1000) {
        actualFps = frameCount;
        frameCount = 0;
        lastFpsUpdateTime = timestamp;

        const selectedStats = worldManager.getSelectedWorldStats();
        EventBus.dispatch(EVENTS.PERFORMANCE_METRICS_UPDATED, { fps: actualFps, tps: selectedStats.tps || 0 });
    }

    requestAnimationFrame(renderLoop);
}

initialize().catch(err => {
    console.error("Initialization failed:", err);
    alert("Application failed to initialize. See console for details.");
});