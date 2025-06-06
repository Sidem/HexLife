import * as Config from './core/config.js';
import { WorldManager } from './core/WorldManager.js';
import * as Renderer from './rendering/renderer.js';
import * as CanvasLoader from './rendering/canvasLoader.js';
import * as UI from './ui/ui.js';
import { CanvasInputHandler } from './ui/CanvasInputHandler.js';
import { EventBus, EVENTS } from './services/EventBus.js';
import { OnboardingManager } from './ui/OnboardingManager.js';
import * as PersistenceService from './services/PersistenceService.js';

let gl;
let worldManager;
let canvasInputHandler;
let isInitialized = false;
let lastTimestamp = 0;
let pausedByVisibilityChange = false;
let frameCount = 0;
let lastFpsUpdateTime = 0;
let actualFps = 0;

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
    console.log("Starting Initialization (Worker Architecture)...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }
    
    const sharedSettings = parseUrlParameters();

    CanvasLoader.startCanvasLoader(canvas);

    gl = await Renderer.initRenderer(canvas);
    if (!gl) {
        console.error("Renderer initialization failed.");
        CanvasLoader.stopCanvasLoader();
        return;
    }

    worldManager = new WorldManager(sharedSettings);
    canvasInputHandler = new CanvasInputHandler(canvas, worldManager);

    const worldManagerInterfaceForUI = {
        isSimulationPaused: worldManager.isSimulationPaused.bind(worldManager),
        getCurrentRulesetHex: worldManager.getCurrentRulesetHex.bind(worldManager),
        getCurrentRulesetArray: worldManager.getCurrentRulesetArray.bind(worldManager),
        getCurrentSimulationSpeed: worldManager.getCurrentSimulationSpeed.bind(worldManager),
        getCurrentBrushSize: worldManager.getCurrentBrushSize.bind(worldManager),
        getSelectedWorldIndex: worldManager.getSelectedWorldIndex.bind(worldManager),
        getSelectedWorldStats: worldManager.getSelectedWorldStats.bind(worldManager),
        getWorldSettingsForUI: worldManager.getWorldSettingsForUI.bind(worldManager),
        getEffectiveRuleForNeighborCount: worldManager.getEffectiveRuleForNeighborCount.bind(worldManager),
        getCanonicalRuleDetails: worldManager.getCanonicalRuleDetails.bind(worldManager),
        getSymmetryData: worldManager.getSymmetryData.bind(worldManager),
        getEntropySamplingState: worldManager.getEntropySamplingState.bind(worldManager),
        getCurrentCameraState: worldManager.getCurrentCameraState.bind(worldManager),
    };

    if (!UI.initUI(worldManagerInterfaceForUI)) {
        console.error("UI initialization failed.");
        return;
    }
    defineOnboardingSteps();
    OnboardingManager.startTour();

    // Add a 'Help' button listener if you added one to the UI
    document.getElementById('helpButton').addEventListener('click', () => {
        PersistenceService.saveUISetting('onboarding_complete', false);
        OnboardingManager.startTour();
    });

    // Dispatch initial events to sync UI with the starting state
    EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, worldManager.getSelectedWorldIndex());
    EventBus.dispatch(EVENTS.SIMULATION_PAUSED, worldManager.isSimulationPaused());
    
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
function defineOnboardingSteps() {
    const steps = [
        {
            element: '#hexGridCanvas',
            content: "Welcome to HexLife Explorer! This is a simulation where cells (the hexagons) live or die based on a set of rules. Let's see it in action.",
            primaryAction: { text: 'Next' },
            advanceOn: { type: 'click' } // Advances when user clicks 'Next'
        },
        {
            element: '#playPauseButton',
            content: "This is the Play/Pause button. Click it to bring the world to life. The `P` key is a handy shortcut.",
            primaryAction: { text: 'I clicked it!' },
            advanceOn: { type: 'event', eventName: EVENTS.COMMAND_TOGGLE_PAUSE }
        },
        {
            element: '#rulesetDisplay',
            content: "Great! The patterns you see are controlled by this **Ruleset**. It's like the DNA of this universe. A different ruleset creates a different world.",
            primaryAction: { text: 'Interesting...' },
            advanceOn: { type: 'click' }
        },
        {
            element: '#newRulesButton',
            content: "Let's change the rules. Click the 'NEW' button to open the rule generator. (`N` key works too!)",
            primaryAction: { text: 'Generate' },
            advanceOn: { type: 'click', target: 'element' } // Must click the highlighted element
        },
        {
            element: '#generateRulesetFromPopoutButton',
            content: "Now, just click **'Generate'** to create a new random ruleset and see how everything changes.",
            primaryAction: { text: 'Generate' },
            advanceOn: { type: 'click', target: 'element' }
        },
        {
            element: '#hexGridCanvas',
            content: "You can also edit the world directly! **Click and drag** on the main view to draw your own patterns.",
            primaryAction: { text: 'Continue' },
            advanceOn: { type: 'click' }
        },
        // ... and so on for the rest of the steps outlined in the previous response.
        {
            element: 'body', // No specific highlight
            content: "You've learned the basics! For more control, explore the panels on the left. Enjoy discovering new worlds!",
            primaryAction: { text: 'Finish' },
            advanceOn: { type: 'click' }
        }
    ];

    OnboardingManager.defineTour(steps);
}
/**
 * REFACTORED: This function now also calls the input handler's resize method.
 */
function handleResize() {
    const mainCanvas = document.getElementById('hexGridCanvas');
    if (mainCanvas) {
        CanvasLoader.handleLoaderResize(mainCanvas);
    }
    
    if (isInitialized) {
        if (gl) Renderer.resizeRenderer();
        if (canvasInputHandler) canvasInputHandler.handleResize(); // <-- ADD THIS LINE
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
        worldManager.getCurrentCameraState()
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