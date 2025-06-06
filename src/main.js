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
    const gliderRuleset = "12482080480080006880800180010117";

    const steps = [
        {
            element: '#hexGridCanvas',
            content: "Welcome to HexLife Explorer! This is a simulation where cells (the hexagons) live or die based on a set of rules. Let's see it in action.",
            primaryAction: { text: 'Next' },
            advanceOn: { type: 'click' }
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
            content: "Let's change the rules. This is the 'NEW' button, which opens the rule generator. (`N` key works too!)",
            primaryAction: { text: 'Next' },
            advanceOn: { type: 'click', target: 'element' }
        },
        {
            element: '#generateRulesetFromPopoutButton',
            content: "This popout has many options, but for now, just click **'Generate'** to create a new random ruleset and see how everything changes.",
            primaryAction: { text: 'Generate' },
            advanceOn: { type: 'click', target: 'element' }
        },
        {
            element: '#setRulesetButton',
            content: "Random rules are fun, but some specific rules create amazing, predictable patterns. Click the `HEX` button to set a specific ruleset.",
            primaryAction: { text: 'Set a Rule' },
            advanceOn: { type: 'click', target: 'element' }
        },
        {
            element: '#setHexPopout',
            content: `Now, use the button below to copy the special "glider" ruleset and then **paste it into the input box to continue.**<br><br><code style="background: #222; padding: 5px 8px; border-radius: 4px; user-select: all;">${gliderRuleset}</code><br><button id="onboarding-copy-ruleset" class="button" style="margin-top: 10px;">Copy Ruleset</button>`,
            onBeforeShow: () => {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_POPOUT, { panelName: 'setHex', shouldShow: true });
            },
            primaryAction: { text: 'Waiting for paste...' },
            advanceOn: { type: 'event', eventName: EVENTS.UI_RULESET_INPUT_CHANGED }
        },
        {
            element: '#setRuleFromPopoutButton',
            content: "Excellent! Now click 'Set' to apply the new rules. After it resets, watch for the small, moving patterns—the 'gliders'!",
            primaryAction: { text: 'Set' },
            advanceOn: { type: 'click', target: 'element' }
        },
        {
            element: '#hexGridCanvas', // Highlighting the canvas again
            content: "You can also edit the world directly! **Click and drag** on the main view to draw your own patterns and interact with the gliders.",
            primaryAction: { text: 'Continue' },
            advanceOn: { type: 'click' }
        },
        {
            element: '#hexGridCanvas', // Assuming you wrap the minimaps for easier selection
            content: "HexLife Explorer runs 9 worlds at once so you can compare rules. This is the mini-map. The highlighted world is the one you're viewing.",
            primaryAction: { text: 'Next' },
            advanceOn: { type: 'click' }
        },
        {
            element: '#hexGridCanvas', // Pseudo-selector, would need a class on the items
            content: "Click on any other world in the mini-map to select it. You can also use the number keys `1-9`.",
            primaryAction: { text: 'Select a world' },
            advanceOn: { type: 'event', eventName: EVENTS.SELECTED_WORLD_CHANGED }
        },
        {
            element: '#vertical-toolbar', // Can also group the panel buttons
            content: "You've learned the basics! When you're ready to dive deeper, these buttons open powerful panels to **Edit** rules, **Setup** worlds, and **Analyze** patterns.",
            primaryAction: { text: 'Got it!' },
            advanceOn: { type: 'click' }
        },
        {
            element: 'body', // No specific highlight, will center the tooltip
            content: "The tour is complete. Enjoy exploring the emergent worlds of HexLife! You can restart this tour anytime using the 'Help' button.",
            primaryAction: { text: 'Start Exploring' },
            advanceOn: { type: 'click' }
        }
    ];

    OnboardingManager.defineTour(steps);
}

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