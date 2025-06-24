import { EventBus, EVENTS } from '../services/EventBus.js';
import * as Renderer from '../rendering/renderer.js';

export class Application {
    constructor(appContext) {
        this.appContext = appContext;
        this.isInitialized = false;
        this.lastTimestamp = 0;
        this.frameCount = 0;
        this.lastFpsUpdateTime = 0;
    }

    /**
     * Starts the main application loop.
     */
    run() {
        this.isInitialized = true;
        this.lastTimestamp = performance.now();
        this.lastFpsUpdateTime = this.lastTimestamp;
        requestAnimationFrame(this.renderLoop.bind(this));
        console.log("Application loop started.");
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
                        if (this.appContext.uiManager.isMobile()) {
                            this.appContext.onboardingManager.startTour('coreMobile');
                        } else {
                            this.appContext.onboardingManager.startTour('core');
                        }
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
            const targetTps = this.appContext.simulationController.getState().speed;
            EventBus.dispatch(EVENTS.PERFORMANCE_METRICS_UPDATED, { fps: actualFps, tps: selectedStats.tps || 0, targetTps: targetTps });
        }
        requestAnimationFrame(this.renderLoop.bind(this));
    }
} 