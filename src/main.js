import '../style.css';
import * as Config from './core/config.js';
import * as Renderer from './rendering/renderer.js';
import { InputManager } from './ui/InputManager.js';
import { EventBus, EVENTS } from './services/EventBus.js';
import { AppContext } from './core/AppContext.js';
import { UIManager } from './ui/UIManager.js';
import { Application } from './core/Application.js';
import { SettingsLoader } from './services/SettingsLoader.js';

// Import JSON data directly. Vite handles this automatically.
import rulesetLibrary from './core/library/rulesets.json';
import patternLibrary from './core/library/patterns.json';

let gl;
let appContext;
let uiManager;
let initializedWorkerCount = 0;

function updateLoadingStatus(message) {
    const statusElement = document.getElementById('loading-status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

async function initialize() {
    console.log("Initializing...");
    updateLoadingStatus("Parsing configuration...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    const sharedSettings = SettingsLoader.loadFromUrl();

    // The library data is now imported directly, no need to fetch.
    const libraryData = { rulesets: rulesetLibrary, patterns: patternLibrary };
    
    updateLoadingStatus("Initializing rendering engine...");
    gl = await Renderer.initRenderer(canvas);
    if (!gl) {
        console.error("Renderer initialization failed.");
        updateLoadingStatus("Error: WebGL2 not supported.");
        return;
    }

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
    EventBus.dispatch(EVENTS.SIMULATION_PAUSED, appContext.simulationController.getIsPaused());
    window.addEventListener('beforeunload', () => {
        uiManager.destroy();
        appContext.worldManager.terminateAllWorkers();
    });

    const app = new Application(appContext);
    app.run();
}

initialize().catch(err => {
    console.error("Initialization failed:", err);
    updateLoadingStatus("Error during initialization. See console for details.");
    alert("Application failed to initialize. See console for details.");
});
