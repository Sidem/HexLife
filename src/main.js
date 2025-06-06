import * as Config from './core/config.js';
import { WorldManager } from './core/WorldManager.js';
import * as Renderer from './rendering/renderer.js';
import * as CanvasLoader from './rendering/canvasLoader.js';
import * as UI from './ui/ui.js';
import { CanvasInputHandler } from './ui/CanvasInputHandler.js';
import { EventBus, EVENTS } from './services/EventBus.js';

let gl;
let worldManager;
let canvasInputHandler;
let isInitialized = false;
let lastTimestamp = 0;
let pausedByVisibilityChange = false;
let frameCount = 0;
let lastFpsUpdateTime = 0;
let actualFps = 0;

const camera = {
    x: Config.RENDER_TEXTURE_SIZE / 2,
    y: Config.RENDER_TEXTURE_SIZE / 2,
    zoom: 1.0
};

async function initialize() {
    console.log("Starting Initialization (Worker Architecture)...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }
    
    CanvasLoader.startCanvasLoader(canvas);

    gl = await Renderer.initRenderer(canvas);
    if (!gl) {
        console.error("Renderer initialization failed.");
        CanvasLoader.stopCanvasLoader();
        return;
    }

    worldManager = new WorldManager();
    canvasInputHandler = new CanvasInputHandler(canvas, camera, worldManager);

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
        getEntropySamplingState: () => worldManager.getEntropySamplingState(),
    };

    if (!UI.initUI(worldManagerInterfaceForUI)) {
        console.error("UI initialization failed.");
        return;
    }
    
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

function handleResize() {
    const mainCanvas = document.getElementById('hexGridCanvas');
    if (mainCanvas) {
        CanvasLoader.handleLoaderResize(mainCanvas);
    }
    
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
    
    const allWorldsData = worldManager.getWorldsRenderData();
    const areAllWorkersInitialized = worldManager.areAllWorkersInitialized();
    if (areAllWorkersInitialized && CanvasLoader.isLoaderActive()) {
        CanvasLoader.stopCanvasLoader();
    }
    
    Renderer.renderFrameOrLoader(
        allWorldsData, 
        worldManager.getSelectedWorldIndex(), 
        areAllWorkersInitialized, 
        camera
    );

    frameCount++;
    if (timestamp - lastFpsUpdateTime >= 1000) {
        actualFps = frameCount;
        frameCount = 0;
        lastFpsUpdateTime = timestamp;
        const selectedStats = worldManager.getSelectedWorldStats();
        const targetTps = worldManager.getCurrentSimulationSpeed();
        EventBus.dispatch(EVENTS.PERFORMANCE_METRICS_UPDATED, { fps: actualFps, tps: selectedStats.tps || 0, targetTps: targetTps });
    }

    requestAnimationFrame(renderLoop);
}

initialize().catch(err => {
    console.error("Initialization failed:", err);
    alert("Application failed to initialize. See console for details.");
});