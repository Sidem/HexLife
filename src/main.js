import '../style.css';
import * as Config from './core/config.js';
import * as Renderer from './rendering/renderer.js';
import { InputManager } from './ui/InputManager.js';
import { EventBus, EVENTS } from './services/EventBus.js';
import { AppContext } from './core/AppContext.js';
import { UIManager } from './ui/UIManager.js';
import { Application } from './core/Application.js';
import { SettingsLoader } from './services/SettingsLoader.js';
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

function detectGraphicsPath() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    return { status: 'no-webgl2', hint: 'WebGL2 unavailable (could be disabled, blocked, or software-only).' };
  }

  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  // Generic strings always exist; detailed strings need the extension.
  const vendor = gl.getParameter(gl.VENDOR) || 'unknown';
  const renderer = gl.getParameter(gl.RENDERER) || 'unknown';

  let unmaskedVendor = null, unmaskedRenderer = null;
  if (ext) {
    unmaskedVendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
    unmaskedRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  }

  const info = (unmaskedVendor || vendor) + ' / ' + (unmaskedRenderer || renderer);

  // Common software renderers you might see:
  const looksSoftware = /swiftshader|llvmpipe|software/i.test(info);

  return {
    status: looksSoftware ? 'software' : 'likely-hardware',
    vendor,
    renderer,
    unmaskedVendor,
    unmaskedRenderer,
    note: ext ? 'Used WEBGL_debug_renderer_info.' : 'Renderer info is masked; result is less certain.'
  };
}

async function initialize() {
    console.log("Initializing...");
    updateLoadingStatus("Parsing configuration...");
    const canvas = document.getElementById('hexGridCanvas');
    if (!canvas) {
        console.error("Canvas element not found!");
        return;
    }

    // GPU acceleration detection
    updateLoadingStatus("Checking GPU acceleration...");
    const detection = detectGraphicsPath();
    if (detection.status === 'no-webgl2' || detection.status === 'software') {
        const message = "Error: This application requires GPU hardware acceleration. Please enable it in your browser settings and restart the browser.";
        updateLoadingStatus(message);
        console.error("GPU acceleration not detected:", detection);
        return;
    }
    console.log("GPU detection:", detection);

    const sharedSettings = SettingsLoader.loadFromUrl();
    const libraryData = { rulesets: rulesetLibrary, patterns: patternLibrary };
    
    updateLoadingStatus("Spooling up simulation workers...");
    appContext = new AppContext(sharedSettings, libraryData);
    
    updateLoadingStatus("Initializing rendering engine...");
    gl = await Renderer.initRenderer(canvas, appContext);
    if (!gl) {
        console.error("Renderer initialization failed.");
        updateLoadingStatus("Error: WebGL2 not supported.");
        return;
    }
    uiManager = new UIManager(appContext);
    new InputManager(canvas, appContext.worldManager, appContext, uiManager.isMobile());

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
