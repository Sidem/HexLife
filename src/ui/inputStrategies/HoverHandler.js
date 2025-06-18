import { Throttler } from '../../utils/throttler.js';
import * as Config from '../../core/config.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

/**
 * Encapsulates the logic for handling hover state updates on the grid,
 * including throttling to prevent performance issues.
 */
export class HoverHandler {
    /**
     * @param {InputManager} manager - A reference to the InputManager to access shared state and methods.
     */
    constructor(manager) {
        this.manager = manager;
        this.lastMouseEvent = null;
        this.hoverThrottler = new Throttler(() => this._dispatchHoverState(), Config.SIM_HOVER_THROTTLE_MS);
    }

    /**
     * Schedules a hover state update. To be called from the InputManager's mousemove handler.
     * @param {MouseEvent} event The latest mouse event.
     */
    scheduleHoverUpdate(event) {
        this.lastMouseEvent = event;
        this.hoverThrottler.schedule();
    }

    /**
     * Cancels any pending hover update. To be called from mouseout handlers.
     */
    cancelHoverUpdate() {
        this.lastMouseEvent = null;
        this.hoverThrottler.cancel();
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: this.manager.worldManager.getSelectedWorldIndex() });
    }

    /**
     * Dispatches the hover state to the EventBus based on the last known mouse event.
     * @private
     */
    _dispatchHoverState() {
        if (!this.lastMouseEvent) return;

        const { col, row, viewType } = this.manager.getCoordsFromPointerEvent(this.lastMouseEvent);
        const selectedWorldIdx = this.manager.worldManager.getSelectedWorldIndex();

        if (viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, { worldIndex: selectedWorldIdx, col, row });
        } else {
            // This case handles when the mouse is over the main view but not on a specific hex
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
        }
    }

    destroy() {
        this.hoverThrottler.destroy();
    }
} 