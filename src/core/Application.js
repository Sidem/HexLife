import { EventBus, EVENTS } from '../services/EventBus.js';
import * as Renderer from '../rendering/renderer.js';
import { showCanvasHint } from '../ui/CanvasHint.js';
import * as PersistenceService from '../services/PersistenceService.js';

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
     * Starts the main application loop. Capture/recording commands are owned by
     * {@link CaptureService} (wired in AppContext), not the render loop.
     */
    run() {
        this.isInitialized = true;
        this.lastTimestamp = performance.now();
        this.lastFpsUpdateTime = this.lastTimestamp;
        requestAnimationFrame(this.renderLoop.bind(this));
        window.addEventListener('resize', this.#handleResize);
        document.addEventListener('visibilitychange', this.#handleVisibilityChange);
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
                        // The unified 'core' tour adapts its steps to mobile/desktop itself.
                        // Deep-link sessions (`?edit=1`) suppress the auto-start: the tour's
                        // first step resets the UI, which would close the panel the link opened.
                        if (!this.appContext.suppressAutoTour) {
                            this.appContext.onboardingManager.startTour('core');
                        }
                        // First-run canvas-interaction hint — only when the tour isn't
                        // taking over the screen (the tour itself teaches these gestures).
                        this.#maybeShowCanvasHint();
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

    /**
     * Show the one-time canvas-interaction hint, gated so it never repeats and never
     * overlaps the onboarding tour. On a true first visit the 'core' tour is active
     * (and teaches these gestures itself), so the hint is suppressed; it surfaces on a
     * later visit once the tour is no longer auto-starting. The flag is set the moment
     * it shows, so a reload won't replay it.
     */
    #maybeShowCanvasHint = () => {
        if (PersistenceService.loadUISetting('seenCanvasHint', false)) return;
        if (this.appContext.onboardingManager?.isActive()) return;
        PersistenceService.saveUISetting('seenCanvasHint', true);
        showCanvasHint();
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