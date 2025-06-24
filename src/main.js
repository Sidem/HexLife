import * as Config from './core/config.js';
import * as Renderer from './rendering/renderer.js';
import { InputManager } from './ui/InputManager.js';
import { EventBus, EVENTS } from './services/EventBus.js';
import { AppContext } from './core/AppContext.js';
import { UIManager } from './ui/UIManager.js';
import { Application } from './core/Application.js';

let gl;
let appContext;
let uiManager;
let pausedByVisibilityChange = false;
let initializedWorkerCount = 0;

function updateLoadingStatus(message) {
    const statusElement = document.getElementById('loading-status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function parseUrlParameters() {
    const params = new URLSearchParams(window.location.search);
    if (params.toString() === '') return {};

    const sharedSettings = {
        fromUrl: true // Flag to indicate settings are from URL
    };

    // Rulesets
    if (params.has('r_all')) {
        sharedSettings.rulesets = params.get('r_all').split(',');
    } else if (params.has('r')) {
        const singleRuleset = params.get('r');
        if (/^[0-9a-fA-F]{32}$/.test(singleRuleset)) {
            sharedSettings.rulesetHex = singleRuleset;
        }
    }

    // Densities
    if (params.has('d')) {
        sharedSettings.densities = params.get('d').split(',').map(Number);
    }

    // Enabled Mask
    if (params.has('e')) {
        const enabledMask = parseInt(params.get('e'), 10);
        if (!isNaN(enabledMask)) {
            sharedSettings.enabledMask = enabledMask;
        }
    }

    // Selected World
    if (params.has('w')) {
        const worldIndex = parseInt(params.get('w'), 10);
        if (worldIndex >= 0 && worldIndex < Config.NUM_WORLDS) {
            sharedSettings.selectedWorldIndex = worldIndex;
        }
    }

    // Camera
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
    appContext = new AppContext(sharedSettings, libraryData);
    uiManager = new UIManager(appContext);
    const inputManager = new InputManager(canvas, appContext.worldManager, appContext, uiManager.isMobile());

    EventBus.subscribe(EVENTS.WORKER_INITIALIZED, ({ worldIndex }) => {
        const hexElement = document.getElementById(`loader-hex-${worldIndex}`);
        if (hexElement) {
            hexElement.classList.add('active');
        }
        initializedWorkerCount++;
        updateLoadingStatus(`Spooling up simulation workers... (${initializedWorkerCount}/${Config.NUM_WORLDS})`);
    });

    EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, appContext.worldManager.getSelectedWorldIndex());
    EventBus.dispatch(EVENTS.SIMULATION_PAUSED, appContext.simulationController.getState().isPaused);
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => {
        uiManager.destroy();
        appContext.worldManager.terminateAllWorkers();
    });

    const app = new Application(appContext);
    app.run();
}

function handleResize() {
    if (gl) {
        Renderer.resizeRenderer();
    }
}

function handleVisibilityChange() {
    if (!appContext) return;
    if (document.hidden) {
        if (!appContext.simulationController.getState().isPaused) {
            EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
            pausedByVisibilityChange = true;
        }
    } else {
        if (pausedByVisibilityChange) {
            EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
            pausedByVisibilityChange = false;
        }
    }
}



initialize().catch(err => {
    console.error("Initialization failed:", err);
    updateLoadingStatus("Error during initialization. See console for details.");
    alert("Application failed to initialize. See console for details.");
});