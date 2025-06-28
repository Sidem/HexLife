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
    enter(_options) {}

    /**
     * Called when this strategy is deactivated.
     */
    exit() {}
    handleMouseDown(_event) {}
    handleMouseMove(_event) {}
    handleMouseUp(_event) {}
    handleMouseOut(_event) {}
    handleMouseWheel(_event) {}
    handleTouchStart(_event) {}
    handleTouchMove(_event) {}
    handleTouchEnd(_event) {}
    handleKeyDown(_event) {}
}