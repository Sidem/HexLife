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
        // This array maps key combinations to specific commands, implementing the Command Pattern.
        this.shortcuts = [
            // Panel & Popout Toggles
            { key: 'e', handler: () => this.panelManager.getPanel('rulesetEditor')?.toggle() },
            { key: 's', handler: () => this.panelManager.getPanel('setupPanel')?.toggle() },
            { key: 'a', handler: () => this.panelManager.getPanel('analysisPanel')?.toggle() },
            { key: 'n', handler: () => this.toolbar.getPopout('newRules')?.toggle() },
            { key: 'Escape', handler: () => this._handleEscape() },

            // Simulation Actions
            { key: 'p', handler: () => this.appContext.simulationController.togglePause() },
            { key: 'g', handler: () => this.appContext.rulesetActionController.generate() },
            { key: 'o', handler: () => this.appContext.rulesetActionController.clone() },
            { key: 'm', handler: () => this.appContext.rulesetActionController.cloneAndMutate() },
            { key: 'm', shiftKey: true, handler: () => this.appContext.rulesetActionController.mutate() },
            
            // World State Actions
            { key: 'd', handler: () => { this.appContext.worldsController.resetDensitiesToDefault(); this.appContext.worldsController.resetAllWorldsToInitialDensities(); } },
            { key: 'd', shiftKey: true, handler: () => { this.appContext.worldsController.applySelectedDensityToAll(); this.appContext.worldsController.resetAllWorldsToInitialDensities(); } },
            { key: 'r', handler: () => this.appContext.worldsController.resetAllWorldsToInitialDensities() },
            { key: 'r', shiftKey: true, handler: () => this.appContext.worldsController.resetWorldsWithCurrentRuleset('selected') },
            { key: 'c', handler: () => this.appContext.worldsController.clearWorlds('all') },
            { key: 'c', shiftKey: true, handler: () => this.appContext.worldsController.clearWorlds('selected') },

            // History Actions
            { key: 'z', ctrlKey: true, handler: () => document.getElementById('undoButton')?.click() },
            { key: 'z', ctrlKey: true, shiftKey: true, handler: () => document.getElementById('redoButton')?.click() },

            // Numeric World Selection (1-9)
            ...Array.from({ length: 9 }, (_, i) => ({
                key: `${i + 1}`,
                handler: () => this._handleNumericSelect(i + 1)
            })),
            
            // Numeric World Toggle (Shift + 1-9)
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
            // Allow Escape to work for closing panels/popouts even when an input is focused.
            if (event.key.toLowerCase() === 'escape') {
                 this._handleEscape();
            }
            return;
        }

        const pressedKey = event.key.toLowerCase();
        
        const shortcut = this.shortcuts.find(s => {
            const keyMatch = s.key.toLowerCase() === pressedKey;
            const shiftMatch = (s.shiftKey || false) === event.shiftKey;
            const ctrlMatch = (s.ctrlKey || false) === (event.ctrlKey || event.metaKey); // metaKey for macOS
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
        // The check for the event target handles cases where focus might not have shifted yet.
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
     * Auxiliary function to handle closing popouts and panels with the Escape key.
     * @private
     */
    _handleEscape() {
        const wasPopoutOpen = this.toolbar ? this.toolbar.closeAllPopouts() : false;
        // Only close all panels if a popout wasn't just closed.
        if (!wasPopoutOpen) {
            this.panelManager.hideAllPanels();
        }
    }

    /**
     * Auxiliary function to handle world selection via number keys (1-9).
     * Maps keyboard layout to the 3x3 grid layout.
     * @param {number} numKey The number key pressed (1-9).
     * @private
     */
    _handleNumericSelect(numKey) {
        const keyToWorldIndex = [6, 7, 8, 3, 4, 5, 0, 1, 2]; // Numpad layout mapping
        const worldIndex = keyToWorldIndex[numKey - 1];
        this.appContext.worldsController.selectWorld(worldIndex);
    }

    /**
     * Auxiliary function to toggle a world's enabled state (Shift + 1-9).
     * @param {number} numKey The number key pressed (1-9).
     * @private
     */
    _handleNumericToggle(numKey) {
        const keyToWorldIndex = [6, 7, 8, 3, 4, 5, 0, 1, 2]; // Numpad layout mapping
        const worldIndex = keyToWorldIndex[numKey - 1];
        const currentSettings = this.worldManager.getWorldSettingsForUI();
        if (currentSettings[worldIndex]) {
            this.appContext.worldsController.setWorldEnabled(worldIndex, !currentSettings[worldIndex].enabled);
        }
    }
}