import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { ControlsComponent } from './components/ControlsComponent.js';
import { RulesetDirectInput } from './components/RulesetDirectInput.js';
import { RulesetActionsComponent } from './components/RulesetActionsComponent.js';
import { SliderComponent } from './components/SliderComponent.js';
import { SwitchComponent } from './components/SwitchComponent.js';
import { generateShareUrl } from '../utils/utils.js';

export class Toolbar {
    constructor(appContext, libraryData) {
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.libraryData = libraryData;
        
        this.uiElements = null;
        this.sliderComponents = {};
        this.switchComponents = {};
        this.popoutPanels = {};
        this.activePopouts = [];
        this.toolbarElement = document.getElementById('vertical-toolbar');
        this.popoutConfig = [
            { name: 'controls', buttonId: 'controlsButton', popoutId: 'controlsPopout', options: { position: 'right', alignment: 'start' } },
            { name: 'resetClear', buttonId: 'resetClearButton', popoutId: 'resetClearPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'share', buttonId: 'shareButton', popoutId: 'sharePopout', options: { position: 'right', alignment: 'start' } }
        ];
    }

    init() {
        this.uiElements = {
            // Main Toolbar Buttons
            playPauseButton: document.getElementById('playPauseButton'),
            // Popout Trigger Buttons
            controlsButton: document.getElementById('controlsButton'),
            rulesetActionsButton: document.getElementById('rulesetActionsButton'),
            resetClearButton: document.getElementById('resetClearButton'),
            shareButton: document.getElementById('shareButton'),
            // Popout Panels
            controlsPopout: document.getElementById('controlsPopout'),
            resetClearPopout: document.getElementById('resetClearPopout'),
            sharePopout: document.getElementById('sharePopout'),
            // Reset/Clear Popout Content
            resetCurrentButtonPopout: document.getElementById('resetCurrentButtonPopout'),
            resetAllButtonPopout: document.getElementById('resetAllButtonPopout'),
            clearCurrentButtonPopout: document.getElementById('clearCurrentButtonPopout'),
            clearAllButtonPopout: document.getElementById('clearAllButtonPopout'),
            shareLinkInput: document.getElementById('shareLinkInput'),
            copyShareLinkButton: document.getElementById('copyShareLinkButton'),
            saveStateButton: document.getElementById('saveStateButton'),
            loadStateButton: document.getElementById('loadStateButton'),
            fileInput: document.getElementById('fileInput'),
        };
        this._initPopoutPanels();
        this._initPopoutControls();
        this._setupEventBusListeners();
        this._setupToolbarButtonListeners();
        this._setupStateListeners();

    }

    _setupEventBusListeners() {
        const closeAll = (excludePanel = null) => {
            this.activePopouts.forEach(popout => {
                if (popout !== excludePanel) popout.hide();
            });
        };

        // This event ensures that opening one popout closes any others.
        EventBus.subscribe(EVENTS.POPOUT_INTERACTION, (data) => closeAll(data.panel));
        
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PANEL, (data) => {
            const panel = this.getPanel(data.panelName);
            if (!panel) return;
        
            if (data.show === true) {
                panel.show();
            } else if (data.show === false) {
                panel.hide();
            } else {
                panel.toggle();
            }
        });

        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_POPOUT, (data) => {
            const popout = this.getPopout(data.popoutName);
            if (!popout) return;
        
            if (data.show === true) {
                popout.show();
            } else if (data.show === false) {
                popout.hide();
            } else {
                popout.toggle();
            }
        });
        
        EventBus.subscribe(EVENTS.COMMAND_HIDE_ALL_OVERLAYS, () => {
            this.closeAllPopouts();
        });
    }
    
    _initPopoutPanels() {
        this.popoutConfig.forEach(config => {
            const buttonElement = this.uiElements[config.buttonId];
            const popoutElement = this.uiElements[config.popoutId];
            if (buttonElement && popoutElement) {
                this.popoutPanels[config.name] = new PopoutPanel(popoutElement, buttonElement, config.options);
            }
        });
        this.activePopouts = Object.values(this.popoutPanels);
    }




    
    _initPopoutControls() {
        // Initialize the new ControlsComponent for desktop
        const desktopControlsMount = this.uiElements.controlsPopout.querySelector('#desktopControlsMount');
        if (desktopControlsMount) {
            new ControlsComponent(desktopControlsMount, this.appContext, { context: 'desktop' });
        }

        // Initialize the new RulesetActionsComponent for desktop
        const rulesetActionsMount = document.getElementById('ruleset-actions-content-mount');
        if (rulesetActionsMount) {
            new RulesetActionsComponent(rulesetActionsMount, this.appContext, { context: 'desktop', libraryData: this.libraryData });
        }

        // Initialize reset/clear popout controls
        this.uiElements.resetCurrentButtonPopout.addEventListener('click', () => { this.appContext.worldsController.resetWorldsWithCurrentRuleset('selected'); this.popoutPanels.resetClear.hide(); });
        this.uiElements.resetAllButtonPopout.addEventListener('click', () => { this.appContext.worldsController.resetAllWorldsToInitialDensities(); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearCurrentButtonPopout.addEventListener('click', () => { this.appContext.worldsController.clearWorlds('selected'); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearAllButtonPopout.addEventListener('click', () => { this.appContext.worldsController.clearWorlds('all'); this.popoutPanels.resetClear.hide(); });
    }
    
    // _copyRuleset method removed - now handled by RulesetDirectInput component

    _setupToolbarButtonListeners() {
        this.uiElements.playPauseButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));

        // Setup remaining popout buttons
        this.popoutConfig.forEach(config => {
            const buttonElement = this.uiElements[config.buttonId];
            if (buttonElement) {
                buttonElement.addEventListener('click', () => {
                    this.popoutPanels[config.name]?.toggle();
                });
            }
        });
        
        this.uiElements.shareButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_SHARE_SETUP));
        
        this.uiElements.saveStateButton.addEventListener('click', this.appContext.worldsController.saveSelectedWorldState);
        this.uiElements.loadStateButton.addEventListener('click', () => {
            this.uiElements.fileInput.accept = ".txt,.json";
            this.uiElements.fileInput.click();
        });
        
        this.uiElements.copyShareLinkButton.addEventListener('click', this._copyShareLink.bind(this));
    }

    _setupStateListeners() {
        this.uiElements.fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) { e.target.value = null; return; }
            const reader = new FileReader();
            reader.onload = re => {
                try {
                    const data = JSON.parse(re.target.result);
                    if (!data?.rows || !data?.cols || !Array.isArray(data.state) || !data.rulesetHex) throw new Error("Invalid format or missing rulesetHex.");
                    this.appContext.worldsController.loadWorldState(this.worldManager.getSelectedWorldIndex(), data);
                } catch (err) { alert(`Error processing file: ${err.message}`); }
                finally { e.target.value = null; }
            };
            reader.onerror = () => { alert(`Error reading file.`); e.target.value = null; };
            reader.readAsText(file);
        });

        EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => this.updatePauseButtonVisual(isPaused));
        // Speed and brush size changes are now handled by ControlsComponent
    }





    _copyShareLink() {
        if (this.uiElements.shareLinkInput.value) {
            this.uiElements.shareLinkInput.select();
            navigator.clipboard.writeText(this.uiElements.shareLinkInput.value).then(() => {
                this.uiElements.copyShareLinkButton.textContent = "Copied!";
                setTimeout(() => this.uiElements.copyShareLinkButton.textContent = "Copy to Clipboard", 1500);
            }).catch(err => alert('Failed to copy link.'));
        }
    }

    updatePauseButtonVisual(isPaused) {
        if (this.uiElements?.playPauseButton) {
            this.uiElements.playPauseButton.textContent = isPaused ? "▶" : "❚❚";
            this.uiElements.playPauseButton.title = isPaused ? "[P]lay Simulation" : "[P]ause Simulation";
        }
    }





    getPopout(panelName) { return this.popoutPanels[panelName]; }

    closeAllPopouts() {
        let wasOpen = false;
        this.activePopouts.forEach(p => {
            if (!p.isHidden()) {
                p.hide();
                wasOpen = true;
            }
        });
        return wasOpen;
    }
}