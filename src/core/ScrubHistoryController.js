import { EventBus, EVENTS } from '../services/EventBus.js';

/**
 * State-history scrub-back coordinator for the SELECTED world. Owns the main-thread view position
 * (`scrubOffset`, `isScrubbing`) and drives the worker's destructive history playback via the proxy.
 * Only the selected world records history (bounded memory), so capture handoff on world-change lives
 * here too.
 *
 * Extracted from WorldManager (the god-object split, roadmap #3). It reaches back into the host
 * WorldManager for the shared world/proxy state and the pause primitive; WorldManager's select-world
 * and pause paths call into this controller for the scrub-specific bits.
 */
export class ScrubHistoryController {
    /** @param {import('./WorldManager.js').WorldManager} worldManager */
    constructor(worldManager) {
        this.wm = worldManager;
        // The user's current view position on the selected world's recorded history (offset ticks back
        // from the live tip; 0 = present) and whether they're parked there.
        this.scrubOffset = 0;
        this.isScrubbing = false;
    }

    // Emit the selected world's current scrub availability/position so the transport bar can render.
    dispatchScrubState = () => {
        const proxy = this.wm.worlds[this.wm.selectedWorldIndex];
        const length = proxy?.getLatestStats().historyLength ?? 0;
        EventBus.dispatch(EVENTS.STATE_HISTORY_CHANGED, {
            worldIndex: this.wm.selectedWorldIndex,
            length,
            offset: this.scrubOffset,
            isScrubbing: this.isScrubbing,
        });
    };

    /**
     * Hand scrub-back capture from the old selected world to the new one (one world records at a time
     * → bounded memory). Leaving the old world's scrub state intact would strand it parked on a past
     * frame, so resume it before clearing its capture. Called when the selected world changes.
     */
    handleWorldSelected = (prevIndex, newIndex) => {
        if (this.isScrubbing) this.wm.worlds[prevIndex]?.resumeHistory();
        this.wm.worlds[prevIndex]?.setHistoryCapture(false);
        this.wm.worlds[newIndex]?.setHistoryCapture(true);
        this.isScrubbing = false;
        this.scrubOffset = 0;
    };

    // Park the selected world on `offset` ticks back from its live tip. Pauses globally first (you
    // can't sensibly scrub a running grid), then drives the worker's destructive playback.
    scrubSelectedHistory = (offset) => {
        const idx = this.wm.selectedWorldIndex;
        const proxy = this.wm.worlds[idx];
        if (!proxy) return;
        const length = proxy.getLatestStats().historyLength ?? 0;
        if (length === 0) return;
        if (!this.wm.isGloballyPaused) this.wm.setGlobalPause(true);
        this.scrubOffset = Math.max(0, Math.min(length - 1, Math.round(offset) || 0));
        this.isScrubbing = true;
        proxy.scrubHistory(this.scrubOffset);
        this.dispatchScrubState();
    };

    // Step the scrub position by `delta` ticks (positive = back, negative = forward). Forward past the
    // live tip advances the simulation one tick instead (a genuine single-step-forward while paused).
    stepSelectedHistory = (delta) => {
        const idx = this.wm.selectedWorldIndex;
        const proxy = this.wm.worlds[idx];
        if (!proxy) return;
        if (!this.wm.isGloballyPaused) this.wm.setGlobalPause(true);
        const length = proxy.getLatestStats().historyLength ?? 0;
        const target = this.scrubOffset + (Math.round(delta) || 0);
        if (target < 0) {
            // Forward past the tip: advance the live sim. Drops scrub mode (the worker truncates).
            this.isScrubbing = false;
            this.scrubOffset = 0;
            proxy.stepHistoryLive();
        } else {
            if (length === 0) return;
            this.scrubOffset = Math.min(target, length - 1);
            this.isScrubbing = true;
            proxy.scrubHistory(this.scrubOffset);
        }
        this.dispatchScrubState();
    };

    // Leave scrub mode and return the selected world to its live tip (without resuming play). No-op
    // when not scrubbing — also the resume-from-scrub path used when global play resumes.
    exitScrub = () => {
        if (!this.isScrubbing) return;
        this.wm.worlds[this.wm.selectedWorldIndex]?.resumeHistory();
        this.isScrubbing = false;
        this.scrubOffset = 0;
        this.dispatchScrubState();
    };
}
