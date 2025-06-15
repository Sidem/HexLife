export class KeyboardShortcutManager {
    constructor(appContext, worldManagerInterface, panelManager, toolbar) {
        this.appContext = appContext;
        this.worldManager = worldManagerInterface;
        this.panelManager = panelManager;
        this.toolbar = toolbar;
        this.uiElements = null; // Will be set during init
    }

    init(uiElements) {
        this.uiElements = uiElements;
        document.addEventListener('keydown', this.handleGlobalKeyDown.bind(this));
    }

    handleGlobalKeyDown(event) {
        const activeEl = document.activeElement;
        const isInputFocused = activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            activeEl.isContentEditable
        );

        if (isInputFocused && activeEl !== this.uiElements.rulesetInputPopout && activeEl !== this.uiElements.editorRulesetInput) {
            if (activeEl.closest('.popout-panel') || activeEl.closest('.draggable-panel-base')) {
                if (event.key === "Escape") {
                    this.toolbar.closeAllPopouts();
                    this.panelManager.hideAllPanels();
                }
                return;
            }
        }

        if (isInputFocused && (activeEl === this.uiElements.rulesetInputPopout || activeEl === this.uiElements.editorRulesetInput)) {
            if (event.key === "Escape") {
                activeEl.blur();
                if (activeEl === this.uiElements.rulesetInputPopout) {
                    this.toolbar.getPopout('setHex').hide();
                }
            }
            return;
        }

        if (event.ctrlKey || event.metaKey) {
            if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
                event.preventDefault();
                this.uiElements.undoButton?.click();
                return;
            }
            if (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z')) {
                event.preventDefault();
                this.uiElements.redoButton?.click();
                return;
            }
        }

        const keyMap = {
            'P': () => this.appContext.simulationController.togglePause(),
            'M': () => this.toolbar.triggerMutation(),
            'N': () => { this.toolbar.closeAllPopouts(); this.toolbar.getPopout('newRules')?.toggle(); },
            'E': () => { this.toolbar.closeAllPopouts(); this.panelManager.getPanel('rulesetEditor')?.toggle(); },
            'S': () => { this.toolbar.closeAllPopouts(); this.panelManager.getPanel('setupPanel')?.toggle(); },
            'A': () => { this.toolbar.closeAllPopouts(); this.panelManager.getPanel('analysisPanel')?.toggle(); },
            'C': () => this.appContext.worldsController.clearWorlds('all'),
            'R': () => this.appContext.worldsController.resetAllWorldsToInitialDensities(),
            'G': () => this.toolbar.triggerGenerate(),
            'Escape': () => {
                const aPopoutWasOpen = this.toolbar ? this.toolbar.closeAllPopouts() : false;
                if (!aPopoutWasOpen) {
                    this.panelManager.hideAllPanels();
                }
            }
        };

        if (event.shiftKey) {
            const numKey = parseInt(event.key, 10);
            if (numKey >= 1 && numKey <= 9) {
                const worldIndex = { 1: 6, 2: 7, 3: 8, 4: 3, 5: 4, 6: 5, 7: 0, 8: 1, 9: 2 }[numKey];
                            const currentSettings = this.worldManager.getWorldSettingsForUI();
            if (currentSettings[worldIndex]) {
                this.appContext.worldsController.setWorldEnabled(worldIndex, !currentSettings[worldIndex].enabled);
            }
                event.preventDefault();
                return;
            }
            if (event.key.toUpperCase() === 'M') {
                this.appContext.rulesetActionController.cloneAndMutate();
                event.preventDefault();
                return;
            }
            if (event.key.toUpperCase() === 'R') {
                this.appContext.worldsController.resetWorldsWithCurrentRuleset('selected');
                event.preventDefault();
                return;
            }
            if (event.key.toUpperCase() === 'C') {
                this.appContext.worldsController.clearWorlds('selected');
                event.preventDefault();
                return;
            }
        } else {
            const numKey = parseInt(event.key, 10);
            if (numKey >= 1 && numKey <= 9) {
                            const worldIndex = { 1: 6, 2: 7, 3: 8, 4: 3, 5: 4, 6: 5, 7: 0, 8: 1, 9: 2 }[numKey];
            this.appContext.worldsController.selectWorld(worldIndex);
                event.preventDefault();
                return;
            }
        }

        const action = keyMap[event.key.toUpperCase()] || keyMap[event.key];
        if (action) {
            action();
            event.preventDefault();
        }
    }
}