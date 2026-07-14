import { EventBus, EVENTS } from '../services/EventBus.js';
import * as Config from '../core/config.js';

/**
 * A data-driven keyboard shortcut manager for the HexLife Explorer.
 * This class uses a centralized shortcut registry and a dispatcher to handle key events,
 * improving maintainability and extensibility.
 */
export class KeyboardShortcutManager {
    constructor(appContext, panelManager, toolbar) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.panelManager = panelManager;
        this.toolbar = toolbar;
        this.shortcuts = [];
        // Tracks held `repeatOnHold` keys (keyed by event.code) so we can drive a smooth,
        // OS-independent auto-repeat instead of relying on the native key-repeat rate.
        this._repeatTimers = new Map();
    }

    /** Delay (ms) before a held key starts repeating, then the interval between repeats. */
    static get REPEAT_DELAY_MS() { return 280; }
    static get REPEAT_INTERVAL_MS() { return 60; }

    /**
     * Initializes the manager by registering all shortcuts and attaching the global event listener.
     */
    init() {
        this._registerShortcuts();
        document.addEventListener('keydown', this._handleKeyDown.bind(this));
        document.addEventListener('keyup', this._handleKeyUp.bind(this));
        // Stop any in-flight repeat if focus leaves the window (keyup may never arrive).
        window.addEventListener('blur', () => this._clearAllRepeats());
    }

    /**
     * Centralized registry for all keyboard shortcuts. Each shortcut is an object defining
     * its properties and the action to perform. This approach makes adding, removing,
     * or modifying shortcuts straightforward.
     * @private
     */
    _registerShortcuts() {
        this.shortcuts = [
            // Panel Toggles
            { key: 'e', description: 'Toggle ruleset editor panel', category: 'Panels', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'ruleset' }) },
            { key: 's', description: 'Toggle world setup panel', category: 'Panels', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'worldsetup' }) },
            { key: 'a', description: 'Toggle analysis panel', category: 'Panels', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'analysis' }) },
            { key: 'n', description: 'Toggle ruleset actions panel', category: 'Panels', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetactions' }) },
            { key: 'Escape', description: 'Close active popout or top-most panel', category: 'Global', handler: () => this._handleEscape() },
            { key: 'k', ctrlKey: true, displayKey: 'Ctrl / ⌘ + K', description: 'Open the command palette', category: 'Global', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_COMMAND_PALETTE) },

            // Simulation Controls
            { key: 'p', description: 'Play / pause simulation', category: 'Global Controls', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
            } },
            { key: ' ', displayKey: 'Space', description: 'Play / pause simulation', category: 'Global Controls', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
            } },
            // Speed nudge (±1 tps). Hold to ramp continuously.
            { key: 'ArrowUp', repeatOnHold: true, description: 'Increase speed by 1 tps (hold to ramp)', category: 'Global Controls', handler: () => this._nudgeSpeed(1) },
            { key: 'ArrowDown', repeatOnHold: true, description: 'Decrease speed by 1 tps (hold to ramp)', category: 'Global Controls', handler: () => this._nudgeSpeed(-1) },
            // State-history scrub-back: step one tick when paused (← back into recorded history,
            // → forward; forward past the live tip advances the sim a single tick).
            { key: 'ArrowLeft', description: 'Step back one tick (when paused)', category: 'Global Controls', handler: () => {
                if (this.appContext.simulationController?.getIsPaused()) EventBus.dispatch(EVENTS.COMMAND_STATE_STEP, { delta: 1 });
            } },
            { key: 'ArrowRight', description: 'Step forward one tick (when paused)', category: 'Global Controls', handler: () => {
                if (this.appContext.simulationController?.getIsPaused()) EventBus.dispatch(EVENTS.COMMAND_STATE_STEP, { delta: -1 });
            } },
            { key: 'h', displayOnly: true, description: 'Hold + drag to shift the world (wrap-around re-centre)', category: 'Global Controls' },
            { key: 'l', description: "Lock / unlock the selected world's ruleset", category: 'Global Controls', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_WORLD_LOCK);
                const idx = this.appContext.worldManager.getSelectedWorldIndex();
                const locked = this.appContext.worldManager.getWorldSettingsForUI()[idx]?.locked;
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `${locked ? 'Locked' : 'Unlocked'} world ${idx + 1}` });
            } },
            { key: 'b', description: "Flag / unflag the selected world as a breeding parent", category: 'Global Controls', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_WORLD_PARENT);
                const idx = this.appContext.worldManager.getSelectedWorldIndex();
                const isParent = this.appContext.worldManager.getWorldSettingsForUI()[idx]?.isParent;
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `World ${idx + 1} ${isParent ? 'added to' : 'removed from'} breeding pool` });
            } },
            { key: 'b', shiftKey: true, description: 'Breed offspring from the parent genepool', category: 'Actions & Panels', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_EXECUTE_BREED_WORLDS);
            } },
            
            // Ruleset Actions
            { key: 'i', description: "Invert the selected world's ruleset", category: 'Actions & Panels', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_INVERT_RULESET);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Ruleset inverted' });
            }},
            { key: 'g', description: 'Generate new ruleset', category: 'Actions & Panels', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Generated new ruleset' });
            }},
            { key: 'o', description: 'Clone selected ruleset to all others', category: 'Actions & Panels', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_CLONE_RULESET);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cloned ruleset to all worlds' });
            }},
            { key: 'm', description: 'Clone & mutate all other worlds', category: 'Actions & Panels', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cloned ruleset to all worlds & mutated others' });
            }},
            { key: 'm', shiftKey: true, description: 'Mutate selected/all worlds', category: 'Actions & Panels', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Mutated ruleset' });
            }},

            // Reset & Clear
            { key: 'd', description: 'Reset densities to default & reset all', category: 'Reset & Clear', handler: () => { 
                EventBus.dispatch(EVENTS.COMMAND_RESET_INITIAL_STATES_TO_DEFAULT); 
                EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); 
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Default densities restored & all worlds reset' });
            }},
            { key: 'd', shiftKey: true, description: 'Apply selected initial state to all & reset all', category: 'Reset & Clear', handler: () => { 
                EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL); 
                EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); 
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Selected initial state applied to all & all worlds reset' });
            }},
            { key: 'r', description: 'Reset all enabled worlds', category: 'Reset & Clear', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Reset all worlds' });
            }},
            { key: 'r', shiftKey: true, description: 'Reset the selected world only', category: 'Reset & Clear', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' });
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Reset selected world' });
            }},
            { key: 'c', description: 'Clear all enabled worlds', category: 'Reset & Clear', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' });
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cleared all worlds' });
            }},
            { key: 'c', shiftKey: true, description: 'Clear the selected world only', category: 'Reset & Clear', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' });
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cleared selected world' });
            }},

            // Saved Starts. The controlled-comparison recipe: pause on an interesting state →
            // Shift+T → R. Every world then restarts from those exact cells under its own ruleset.
            // The toast comes from the WorldManager handler, so every dispatch source shares it.
            { key: 't', description: "Capture the current cells as a saved start & use it for this world's resets", category: 'Saved Starts', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_CAPTURE_STATE_TO_LIBRARY, { assignScope: 'selected' });
            }},
            { key: 't', shiftKey: true, description: 'Capture the current cells and set them as the start for ALL worlds (then R)', category: 'Saved Starts', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_CAPTURE_STATE_TO_LIBRARY, { assignScope: 'all' });
            }},

            // Patterns
            { key: 'c', ctrlKey: true, skipWhenTextSelected: true, description: 'Copy a region of cells as a pattern', category: 'Patterns', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_COPY_PATTERN);
            }},
            { key: 'v', ctrlKey: true, description: 'Paste the copied pattern', category: 'Patterns', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_PASTE_PATTERN);
            }},

            // Copy the selected world's state (not its ruleset) to another world. Bound to the numpad
            // (Ctrl + top-row digits is hijacked by the browser for tab switching). Same 3x3 grid
            // mapping as world selection: Num7 = top-left, Num1 = bottom-left.
            ...Array.from({ length: 9 }, (_, i) => ({
                code: `Numpad${i + 1}`,
                ctrlKey: true,
                displayKey: `Ctrl + Num ${i + 1}`,
                description: `Copy selected world's state to world ${[6, 7, 8, 3, 4, 5, 0, 1, 2][i] + 1}`,
                category: 'Patterns',
                handler: () => this._handleCopyStateTo(i + 1),
            })),

            // Contextual placing-mode keys (handled by PlacePatternStrategy) — documented here only.
            { key: 'r', displayOnly: true, description: 'Rotate pattern 60° clockwise', category: 'Patterns (while placing)' },
            { key: 'r', shiftKey: true, displayOnly: true, description: 'Rotate pattern 60° counter-clockwise', category: 'Patterns (while placing)' },
            { key: 'f', displayOnly: true, description: 'Mirror pattern horizontally', category: 'Patterns (while placing)' },
            { key: 'f', shiftKey: true, displayOnly: true, description: 'Mirror pattern vertically', category: 'Patterns (while placing)' },

            // Capture / recording
            { key: 'v', description: 'Record video — start (last settings) / stop & save', category: 'Capture', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_QUICK_TOGGLE_RECORDING);
            }},
            { key: 'v', shiftKey: true, description: 'Pause / resume the active recording', category: 'Capture', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_RECORDING_PAUSE);
            }},

            // History
            { key: 'z', ctrlKey: true, description: 'Undo ruleset change', category: 'History', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_UNDO_RULESET, { worldIndex: this.appContext.worldManager.getSelectedWorldIndex() });
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Undo' });
            }},
            { key: 'z', ctrlKey: true, shiftKey: true, description: 'Redo ruleset change', category: 'History', handler: () => {
                EventBus.dispatch(EVENTS.COMMAND_REDO_RULESET, { worldIndex: this.appContext.worldManager.getSelectedWorldIndex() });
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Redo' });
            }},

            // World Selection
            ...Array.from({ length: 9 }, (_, i) => ({
                key: `${i + 1}`,
                description: `Select world ${i + 1}`,
                category: 'Global Controls',
                handler: () => this._handleNumericSelect(i + 1)
            })),
        ];
    }

    /**
     * Returns the registered shortcuts.
     * @returns {Array<object>} A list of shortcut objects.
     */
    getShortcuts() {
        return this.shortcuts;
    }
    
    /**
     * The main keydown event dispatcher.
     * It finds the matching shortcut from the registry and executes its handler.
     * @param {KeyboardEvent} event The native keyboard event.
     * @private
     */
    _handleKeyDown(event) {
        if (this._isInputFocused(event)) {

            if (event.key.toLowerCase() === 'escape') {
                 this._handleEscape();
            }
            return;
        }

        const pressedKey = event.key.toLowerCase();

        const shortcut = this.shortcuts.find(s => {
            // Display-only entries document contextual shortcuts (handled elsewhere) and are never dispatched here.
            if (s.displayOnly) return false;
            // `code`-based entries match the physical key (e.g. Numpad digits, which are layout-independent
            // and dodge the browser's Ctrl+digit tab-switch on the top number row).
            const keyMatch = s.code ? (s.code === event.code) : (s.key.toLowerCase() === pressedKey);
            const shiftMatch = (s.shiftKey || false) === event.shiftKey;
            const ctrlMatch = (s.ctrlKey || false) === (event.ctrlKey || event.metaKey);
            return keyMatch && shiftMatch && ctrlMatch;
        });

        if (shortcut) {
            // Don't hijack Ctrl+C when the user is copying selected page text.
            if (shortcut.skipWhenTextSelected && this._hasTextSelection()) {
                return;
            }
            event.preventDefault();

            if (shortcut.repeatOnHold) {
                // Drive our own steady auto-repeat instead of the OS one: ignore the native
                // repeat events, fire once now, then ramp after a short delay.
                if (event.repeat || this._repeatTimers.has(event.code)) return;
                shortcut.handler();
                this._startRepeat(event.code, shortcut.handler);
                return;
            }

            shortcut.handler();
        }
    }

    /**
     * Begins the hold-to-repeat cycle for a key: an initial delay, then a steady interval.
     * @param {string} code The physical `event.code` of the held key (used for the keyup match).
     * @param {Function} handler The shortcut handler to invoke on each repeat.
     * @private
     */
    _startRepeat(code, handler) {
        const KSM = KeyboardShortcutManager;
        const delayId = setTimeout(() => {
            const intervalId = setInterval(handler, KSM.REPEAT_INTERVAL_MS);
            this._repeatTimers.set(code, { intervalId });
        }, KSM.REPEAT_DELAY_MS);
        this._repeatTimers.set(code, { delayId });
    }

    /**
     * Stops the repeat cycle for a released key.
     * @param {KeyboardEvent} event The native keyup event.
     * @private
     */
    _handleKeyUp(event) {
        this._clearRepeat(event.code);
    }

    /** Clears any pending delay / interval timer for a single key. @private */
    _clearRepeat(code) {
        const t = this._repeatTimers.get(code);
        if (!t) return;
        if (t.delayId) clearTimeout(t.delayId);
        if (t.intervalId) clearInterval(t.intervalId);
        this._repeatTimers.delete(code);
    }

    /** Clears every active repeat timer (e.g. on window blur). @private */
    _clearAllRepeats() {
        this._repeatTimers.forEach(t => {
            if (t.delayId) clearTimeout(t.delayId);
            if (t.intervalId) clearInterval(t.intervalId);
        });
        this._repeatTimers.clear();
    }

    /**
     * Adjusts the global simulation speed by `delta` ticks-per-second, clamped by the controller.
     * @param {number} delta Signed tps change (+1 / -1).
     * @private
     */
    _nudgeSpeed(delta) {
        const current = this.appContext.simulationController?.getSpeed() ?? Config.DEFAULT_SPEED;
        EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, current + delta);
    }

    /**
     * Escape closes transient UI in order of "closeness to the pointer":
     * open popouts first, then only the top-most panel — not everything at once.
     * @private
     */
    _handleEscape() {
        if (this.toolbar && this.toolbar.closeAllPopouts()) {
            return;
        }
        const topPanel = this.panelManager?.getTopMostVisiblePanel?.();
        if (topPanel) {
            topPanel.hide();
        }
    }

    /**
     * Checks if an input element is currently focused to prevent shortcuts from firing.
     * @param {KeyboardEvent} event The native keyboard event.
     * @returns {boolean} True if an input element has focus.
     * @private
     */
    _isInputFocused(event) {
        const activeEl = document.activeElement;
        
        const targetEl = event.target; 
        
        const isFocusable = (el) => el && (
            el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            el.isContentEditable
        );

        return isFocusable(activeEl) || isFocusable(targetEl);
    }

    /**
     * @returns {boolean} True when the user has a non-empty text selection on the page.
     * @private
     */
    _hasTextSelection() {
        const sel = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null;
        return !!sel && sel.toString().length > 0;
    }
    


    /**
     * Auxiliary function to handle world selection via number keys (1-9).
     * Maps keyboard layout to the 3x3 grid layout.
     * @param {number} numKey The number key pressed (1-9).
     * @private
     */
    _handleNumericSelect(numKey) {
        const keyToWorldIndex = [6, 7, 8, 3, 4, 5, 0, 1, 2];
        const worldIndex = keyToWorldIndex[numKey - 1];
        EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndex);
    }

    /**
     * Copies the selected world's state onto the world at the numpad position (same 3x3 grid
     * mapping as {@link _handleNumericSelect}).
     * @param {number} numKey The numpad digit pressed (1-9).
     * @private
     */
    _handleCopyStateTo(numKey) {
        const keyToWorldIndex = [6, 7, 8, 3, 4, 5, 0, 1, 2];
        const targetWorldIndex = keyToWorldIndex[numKey - 1];
        EventBus.dispatch(EVENTS.COMMAND_COPY_WORLD_STATE, { targetWorldIndex });
    }


}