/**
 * @class BaseInputStrategy
 * @description Defines the interface for all input handling strategies.
 * Concrete strategies will override these methods.
 */
export class BaseInputStrategy {
    /**
     * @param {InputManager} manager - A reference to the main InputManager to access shared state and methods.
     */
    constructor(manager) {
        this.manager = manager;
    }
    /**
     * Called when this strategy becomes active.
     * @param {object} [options] - Optional data passed when switching strategies (e.g., pattern data).
     */
    enter(options) {}

    /**
     * Called when this strategy is deactivated.
     */
    exit() {}
    handleMouseDown(event) {}
    handleMouseMove(event) {}
    handleMouseUp(event) {}
    handleMouseOut(event) {}
    handleMouseWheel(event) {}
    handleTouchStart(event) {}
    handleTouchMove(event) {}
    handleTouchEnd(event) {}
    handleKeyDown(event) {}
}