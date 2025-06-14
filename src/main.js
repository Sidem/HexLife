import * as Config from './core/config.js';
import { WorldManager } from './core/WorldManager.js';
import * as Renderer from './rendering/renderer.js';
import * as UI from './ui/ui.js';
import { onboardingManager } from './ui/ui.js';
import { InputManager } from './ui/InputManager.js';
import { EventBus, EVENTS } from './services/EventBus.js';
import { tours } from './ui/tourSteps.js'; 
import { uiManager } from './ui/UIManager.js';
import { simulationController } from './ui/controllers/SimulationController.js';

let gl;
let worldManager;
let isInitialized = false;
let lastTimestamp = 0;
let pausedByVisibilityChange = false;
let frameCount = 0;
let lastFpsUpdateTime = 0;
let actualFps = 0;
let initializedWorkerCount = 0;
let inputManager;

function updateLoadingStatus(message) {
    const statusElement = document.getElementById('loading-status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function parseUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('r')) return {}; 

    const sharedSettings = {};

    const rulesetHex = params.get('r');
    if (/^[0-9a-fA-F]{32}$/.test(rulesetHex)) {
        sharedSettings.rulesetHex = rulesetHex;
    }

    if (params.has('w')) {
        const worldIndex = parseInt(params.get('w'), 10);
        if (worldIndex >= 0 && worldIndex < Config.NUM_WORLDS) {
            sharedSettings.selectedWorldIndex = worldIndex;
        }
    }

    if (params.has('s')) {
        const speed = parseInt(params.get('s'), 10);
        if (speed >= 1 && speed <= Config.MAX_SIM_SPEED) {
            sharedSettings.speed = speed;
        }
    }

    if (params.has('e')) {
        const enabledMask = parseInt(params.get('e'), 10);
        if (!isNaN(enabledMask)) {
            sharedSettings.enabledMask = enabledMask;
        }
    }

    if (params.has('cam')) {
        const camParts = params.get('cam').split(',').map(Number);
        if (camParts.length === 3 && !camParts.some(isNaN)) {
            sharedSettings.camera = { x: camParts[0], y: camParts[1], zoom: camParts[2] };
        }
    }
    
    window.history.replaceState({}, document.title, window.location.pathname);
    return sharedSettings;
}

async function initialize() {
    console.log("Initializing...");
    updateLoadingStatus("Parsing configuration...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    uiManager.init();
    
    const sharedSettings = parseUrlParameters();

    updateLoadingStatus("Fetching assets...");
    const libraryPromises = [
        fetch('src/core/library/rulesets.json').then(res => res.json()),
        fetch('src/core/library/patterns.json').then(res => res.json())
    ];

    updateLoadingStatus("Initializing rendering engine...");
    gl = await Renderer.initRenderer(canvas);
    if (!gl) {
        console.error("Renderer initialization failed.");
        updateLoadingStatus("Error: WebGL2 not supported.");
        return;
    }

    const [rulesetLibrary, patternLibrary] = await Promise.all(libraryPromises);
    const libraryData = { rulesets: rulesetLibrary, patterns: patternLibrary };

    updateLoadingStatus("Spooling up simulation workers...");
    worldManager = new WorldManager(sharedSettings);

    const worldManagerInterfaceForUI = {
        getCurrentRulesetHex: worldManager.getCurrentRulesetHex.bind(worldManager),
        getCurrentRulesetArray: worldManager.getCurrentRulesetArray.bind(worldManager),
        getSelectedWorldIndex: worldManager.getSelectedWorldIndex.bind(worldManager),
        getSelectedWorldStats: worldManager.getSelectedWorldStats.bind(worldManager),
        getWorldSettingsForUI: worldManager.getWorldSettingsForUI.bind(worldManager),
        getEffectiveRuleForNeighborCount: worldManager.getEffectiveRuleForNeighborCount.bind(worldManager),
        getCanonicalRuleDetails: worldManager.getCanonicalRuleDetails.bind(worldManager),
        getSymmetryData: worldManager.getSymmetryData.bind(worldManager),
        getEntropySamplingState: worldManager.getEntropySamplingState.bind(worldManager),
        getCurrentCameraState: worldManager.getCurrentCameraState.bind(worldManager),
        getRulesetHistoryArrays: worldManager.getRulesetHistoryArrays.bind(worldManager),
    };
    
    inputManager = new InputManager(canvas, worldManager, uiManager.isMobile());


    updateLoadingStatus("Initializing UI components...");
    if (!UI.initUI(worldManagerInterfaceForUI, libraryData)) {
        console.error("UI initialization failed.");
        return;
    }

    document.getElementById('helpButton').addEventListener('click', () => {
        onboardingManager.startTour('core', true);
    });

    EventBus.subscribe(EVENTS.WORKER_INITIALIZED, ({ worldIndex }) => {
        const hexElement = document.getElementById(`loader-hex-${worldIndex}`);
        if (hexElement) {
            hexElement.classList.add('active');
        }
        initializedWorkerCount++;
        updateLoadingStatus(`Spooling up simulation workers... (${initializedWorkerCount}/${Config.NUM_WORLDS})`);
    });

    EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, worldManager.getSelectedWorldIndex());
    EventBus.dispatch(EVENTS.SIMULATION_PAUSED, simulationController.getState().isPaused);
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => {
        worldManager.terminateAllWorkers();
    });

    isInitialized = true;
    lastTimestamp = performance.now();
    lastFpsUpdateTime = lastTimestamp;
    console.log("Initializing render loop.");
    requestAnimationFrame(renderLoop);
}

function handleResize() {
    if (isInitialized) {
        if (gl) Renderer.resizeRenderer();
    }
}

function handleVisibilityChange() {
    if (!isInitialized || !worldManager) return;
    if (document.hidden) {
        if (!simulationController.getState().isPaused) {
            simulationController.setPause(true);
            pausedByVisibilityChange = true;
        }
    } else {
        if (pausedByVisibilityChange) {
            simulationController.setPause(false);
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
    const worldSettings = worldManager.getWorldSettingsForUI();
    
    const allWorldsWithSettings = allWorldsData.map((data, i) => ({
        ...data,
        rulesetHex: worldSettings[i]?.rulesetHex || "0".repeat(32)
    }));
    
    const areAllWorkersInitialized = worldManager.areAllWorkersInitialized();
    if (areAllWorkersInitialized) {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator && loadingIndicator.style.display !== 'none') {
            updateLoadingStatus("Finalizing...");
            setTimeout(() => {
                loadingIndicator.style.opacity = '0';
                setTimeout(() => { 
                    loadingIndicator.style.display = 'none'; 
                    if (uiManager.getMode() === 'mobile') {
                        onboardingManager.startTour('coreMobile');
                    } else {
                        onboardingManager.startTour('core');
                    }
                }, 500);
            }, 250);
        }
    }
    
    Renderer.renderFrameOrLoader(
        allWorldsWithSettings, 
        worldManager.getSelectedWorldIndex(), 
        areAllWorkersInitialized, 
        worldManager.getCurrentCameraState()
    );

    frameCount++;
    if (timestamp - lastFpsUpdateTime >= 1000) {
        actualFps = frameCount;
        frameCount = 0;
        lastFpsUpdateTime = timestamp;
        const selectedStats = worldManager.getSelectedWorldStats();
        const targetTps = simulationController.getState().speed;
        EventBus.dispatch(EVENTS.PERFORMANCE_METRICS_UPDATED, { fps: actualFps, tps: selectedStats.tps || 0, targetTps: targetTps });
    }
    requestAnimationFrame(renderLoop);
}

initialize().catch(err => {
    console.error("Initialization failed:", err);
    updateLoadingStatus("Error during initialization. See console for details.");
    alert("Application failed to initialize. See console for details.");
});