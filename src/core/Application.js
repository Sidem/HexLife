import { EventBus, EVENTS } from '../services/EventBus.js';
import * as Renderer from '../rendering/renderer.js';
import { rulesetName } from '../utils/utils.js';

export class Application {
    constructor(appContext) {
        this.appContext = appContext;
        this.isInitialized = false;
        this.lastTimestamp = 0;
        this.frameCount = 0;
        this.lastFpsUpdateTime = 0;
        this.pausedByVisibilityChange = false;
    }

    /**
     * Starts the main application loop.
     */
    run() {
        this.isInitialized = true;
        this.lastTimestamp = performance.now();
        this.lastFpsUpdateTime = this.lastTimestamp;
        requestAnimationFrame(this.renderLoop.bind(this));
        window.addEventListener('resize', this.#handleResize);
        document.addEventListener('visibilitychange', this.#handleVisibilityChange);
        EventBus.subscribe(EVENTS.COMMAND_EXPORT_WORLD_PNG, this.#handleExportWorldPNG);
        console.log("Application loop started.");
    }

    /**
     * Export the selected world's render as a PNG download (media-export flagship, v2.6). Reads the
     * world's FBO at full resolution via the renderer; names the file by ruleset mnemonic + tick.
     */
    #handleExportWorldPNG = async () => {
        const wm = this.appContext.worldManager;
        const idx = wm.selectedWorldIndex;
        try {
            const blobPromise = Renderer.captureWorldPNG(idx);
            const blob = blobPromise && await blobPromise;
            if (!blob) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Could not export PNG.', type: 'error' });
                return;
            }
            const hex = wm.getCurrentRulesetHex();
            const tick = wm.getSelectedWorldStats().tick || 0;
            const name = `hexlife-${rulesetName(hex)}-t${tick}.png`.replace(/\s+/g, '-');
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Saved PNG snapshot.', type: 'success' });
        } catch (err) {
            console.error('PNG export failed:', err);
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Could not export PNG.', type: 'error' });
        }
    }

    /**
     * The main application loop, called by requestAnimationFrame.
     * @param {DOMHighResTimeStamp} timestamp The current timestamp.
     */
    renderLoop(timestamp) {
        if (!this.isInitialized) return;

        const areAllWorkersInitialized = this.appContext.worldManager.areAllWorkersInitialized();
        if (areAllWorkersInitialized) {
            const loadingIndicator = document.getElementById('loading-indicator');
            if (loadingIndicator && loadingIndicator.style.display !== 'none') {
                const updateLoadingStatus = (message) => {
                    const statusElement = document.getElementById('loading-status');
                    if (statusElement) {
                        statusElement.textContent = message;
                    }
                };
                updateLoadingStatus("Finalizing...");
                setTimeout(() => {
                    loadingIndicator.style.opacity = '0';
                    setTimeout(() => { 
                        loadingIndicator.style.display = 'none';
                        // The unified 'core' tour adapts its steps to mobile/desktop itself.
                        this.appContext.onboardingManager.startTour('core');
                    }, 500);
                }, 250);
            }
        }

        Renderer.renderFrameOrLoader(this.appContext, areAllWorkersInitialized);

        this.frameCount++;
        if (timestamp - this.lastFpsUpdateTime >= 1000) {
            const actualFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdateTime = timestamp;
            const selectedStats = this.appContext.worldManager.getSelectedWorldStats();
            const targetTps = this.appContext.simulationController.getSpeed();
            EventBus.dispatch(EVENTS.PERFORMANCE_METRICS_UPDATED, { fps: actualFps, tps: selectedStats.tps || 0, targetTps: targetTps });
        }
        requestAnimationFrame(this.renderLoop.bind(this));
    }

    #handleResize = () => {
        Renderer.resizeRenderer();
    }

    #handleVisibilityChange = () => {
        if (document.hidden) {
            if (!this.appContext.simulationController.getIsPaused()) {
                EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
                this.pausedByVisibilityChange = true;
            }
        } else {
            if (this.pausedByVisibilityChange) {
                EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
                this.pausedByVisibilityChange = false;
            }
        }
    }
} 