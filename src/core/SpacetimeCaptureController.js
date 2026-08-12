import { EventBus, EVENTS } from '../services/EventBus.js';
import { VIEW_MODES } from '../rendering/viewModes.js';

/**
 * Arms the worker's spacetime layer stream (#40) for exactly one world, for exactly as long as the
 * volume is on screen. Counterpart to {@link ScrubHistoryController}, which owns the same ring's
 * scrub-back playback — this owns its GPU mirror.
 *
 * Two conditions must BOTH hold before a single layer is asked for:
 *
 *  1. the selected view is drawn as a spacetime volume, and
 *  2. the renderer has finished lazily loading that projection and has a texture to store layers in.
 *
 * Waiting for (2) is what removes the whole class of "the object is missing its first N ticks" bugs.
 * Enabling capture makes the worker ship the ring's existing frames immediately; if that backfill
 * landed while the projection chunk was still downloading it would be dropped, and every layer
 * arriving in the same window with it. Ordering the arm after the view exists means the backfill and
 * the live stream are one continuous sequence with no gap and no duplicates, so the volume never has
 * to reconcile anything.
 *
 * Off, this costs two idle EventBus subscriptions and nothing else: no worker message is sent, so no
 * layer is packed, copied or posted (#40 §2.1, §8.1).
 */
export class SpacetimeCaptureController {
    /** @param {import('./WorldManager.js').WorldManager} worldManager */
    constructor(worldManager) {
        this.wm = worldManager;
        this.viewMode = VIEW_MODES.FLAT;
        this.viewReady = false;
        /** The world currently streaming layers, or -1. Tracked so a world change disarms the old one. */
        this.armedWorldIndex = -1;

        EventBus.subscribe(EVENTS.VIEW_MODE_CHANGED, ({ mode }) => {
            this.viewMode = mode;
            this._sync();
        });
        EventBus.subscribe(EVENTS.SPACETIME_VIEW_READY, () => {
            this.viewReady = true;
            this._sync();
        });
        EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, () => this._sync());
        // `WorldProxy.sendCommand` silently DROPS anything sent before its worker reports ready, and
        // every UI surface mounts well ahead of the workers — so a mode restored from storage would
        // arm into the void and the object would never appear. Retry when each worker comes up.
        EventBus.subscribe(EVENTS.WORKER_INITIALIZED, () => this._sync());
    }

    /** True while the selected world is actually streaming layers. */
    get isArmed() {
        return this.armedWorldIndex >= 0;
    }

    _sync = () => {
        const wanted = (this.viewMode === VIEW_MODES.SPACETIME && this.viewReady)
            ? this.wm.selectedWorldIndex
            : -1;
        if (wanted === this.armedWorldIndex) return;
        // Disarm first even when switching worlds, so at most one ring is ever mirrored.
        if (this.armedWorldIndex >= 0) {
            this.wm.worlds[this.armedWorldIndex]?.setSpacetimeCapture(false);
            this.armedWorldIndex = -1;
        }
        if (wanted < 0) return;
        const proxy = this.wm.worlds[wanted];
        // Only count it as armed once the command could actually be delivered; otherwise leave the
        // state unarmed so the WORKER_INITIALIZED retry above picks it up.
        if (!proxy?.isInitialized) return;
        proxy.setSpacetimeCapture(true);
        this.armedWorldIndex = wanted;
    };
}
