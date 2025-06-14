import { EventBus, EVENTS } from '../services/EventBus.js';

const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';

class UIManager {
    constructor() {
        this.mode = 'desktop';
        this.mediaQueryList = window.matchMedia(MOBILE_QUERY);
        // Set initial mode immediately on construction
        this.updateMode(false); 
    }

    /**
     * Initializes the manager and sets up listeners for dynamic resizing.
     */
    init() {
        // Listen for changes in the viewport size to dynamically switch modes
        this.mediaQueryList.addEventListener('change', () => this.updateMode(true));
        console.log(`UIManager initialized in '${this.mode}' mode.`);
    }

    /**
     * Checks the media query and updates the UI mode.
     * @param {boolean} [dispatchEvent=true] - Whether to dispatch an event if the mode changes.
     */
    updateMode(dispatchEvent = true) {
        const newMode = this.mediaQueryList.matches ? 'mobile' : 'desktop';
        if (newMode !== this.mode) {
            this.mode = newMode;
            if (dispatchEvent) {
                EventBus.dispatch(EVENTS.UI_MODE_CHANGED, { mode: this.mode });
            }
        }
    }

    /**
     * Returns the current UI mode.
     * @returns {'desktop' | 'mobile'}
     */
    getMode() {
        return this.mode;
    }

    /**
     * Convenience method to check if the current mode is mobile.
     * @returns {boolean}
     */
    isMobile() {
        return this.mode === 'mobile';
    }
}

// Export a singleton instance
export const uiManager = new UIManager();