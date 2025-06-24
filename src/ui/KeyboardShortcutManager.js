import { EventBus, EVENTS } from '../services/EventBus.js';

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
    }

    /**
     * Initializes the manager by registering all shortcuts and attaching the global event listener.
     */
    init() {
        this._registerShortcuts();
        document.addEventListener('keydown', this._handleKeyDown.bind(this));
    }

    /**
     * Centralized registry for all keyboard shortcuts. Each shortcut is an object defining
     * its properties and the action to perform. This approach makes adding, removing,
     * or modifying shortcuts straightforward.
     * @private
     */
    _registerShortcuts() {
        
        this.shortcuts = [
            
            { key: 'e', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetEditor' }) },
            { key: 's', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'worldSetup' }) },
            { key: 'a', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'analysis' }) },
            { key: 'n', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetActions' }) },
            { key: 'Escape', handler: () => EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS) },
            { key: 'p', handler: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE) },
            { key: 'i', handler: () => EventBus.dispatch(EVENTS.COMMAND_INVERT_RULESET) },
            { key: 'g', handler: () => EventBus.dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET) },
            { key: 'o', handler: () => EventBus.dispatch(EVENTS.COMMAND_CLONE_RULESET) },
            { key: 'm', handler: () => EventBus.dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE)  },
            { key: 'm', shiftKey: true, handler: () => EventBus.dispatch(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET) },
            { key: 'd', handler: () => { EventBus.dispatch(EVENTS.COMMAND_RESET_DENSITIES_TO_DEFAULT); EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); } },
            { key: 'd', shiftKey: true, handler: () => { EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL); EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); } },
            { key: 'r', handler: () => EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES) },
            { key: 'r', shiftKey: true, handler: () => EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' }) },
            { key: 'c', handler: () => EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' }) },
            { key: 'c', shiftKey: true, handler: () => EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' }) },
            { key: 'z', ctrlKey: true, handler: () => EventBus.dispatch(EVENTS.COMMAND_UNDO_RULESET, { worldIndex: this.appContext.worldManager.getSelectedWorldIndex() }) },
            { key: 'z', ctrlKey: true, shiftKey: true, handler: () => EventBus.dispatch(EVENTS.COMMAND_REDO_RULESET, { worldIndex: this.appContext.worldManager.getSelectedWorldIndex() }) },

            
            ...Array.from({ length: 9 }, (_, i) => ({
                key: `${i + 1}`,
                handler: () => this._handleNumericSelect(i + 1)
            })),
            
            
            ...Array.from({ length: 9 }, (_, i) => ({
                key: `${i + 1}`,
                shiftKey: true,
                handler: () => this._handleNumericToggle(i + 1)
            }))
        ];
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
                 EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            }
            return;
        }

        const pressedKey = event.key.toLowerCase();
        
        const shortcut = this.shortcuts.find(s => {
            const keyMatch = s.key.toLowerCase() === pressedKey;
            const shiftMatch = (s.shiftKey || false) === event.shiftKey;
            const ctrlMatch = (s.ctrlKey || false) === (event.ctrlKey || event.metaKey); 
            return keyMatch && shiftMatch && ctrlMatch;
        });

        if (shortcut) {
            event.preventDefault();
            shortcut.handler();
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
     * Auxiliary function to toggle a world's enabled state (Shift + 1-9).
     * @param {number} numKey The number key pressed (1-9).
     * @private
     */
    _handleNumericToggle(numKey) {
        const keyToWorldIndex = [6, 7, 8, 3, 4, 5, 0, 1, 2]; 
        const worldIndex = keyToWorldIndex[numKey - 1];
        const currentSettings = this.worldManager.getWorldSettingsForUI();
        if (currentSettings[worldIndex]) {
            EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex, isEnabled: !currentSettings[worldIndex].enabled });
        }
    }


}