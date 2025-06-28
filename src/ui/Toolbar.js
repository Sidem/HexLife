import { EventBus, EVENTS } from '../services/EventBus.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { ControlsComponent } from './components/ControlsComponent.js';

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
            playPauseButton: document.getElementById('playPauseButton'),
            controlsButton: document.getElementById('controlsButton'),
            rulesetActionsButton: document.getElementById('rulesetActionsButton'),
            resetClearButton: document.getElementById('resetClearButton'),
            shareButton: document.getElementById('shareButton'),
            controlsPopout: document.getElementById('controlsPopout'),
            resetClearPopout: document.getElementById('resetClearPopout'),
            sharePopout: document.getElementById('sharePopout'),
            resetCurrentButtonPopout: document.getElementById('resetCurrentButtonPopout'),
            resetAllButtonPopout: document.getElementById('resetAllButtonPopout'),
            clearCurrentButtonPopout: document.getElementById('clearCurrentButtonPopout'),
            clearAllButtonPopout: document.getElementById('clearAllButtonPopout'),
            shareLinkInput: document.getElementById('shareLinkInput'),
            copyShareLinkButton: document.getElementById('copyShareLinkButton'),
            saveStateButton: document.getElementById('saveStateButton'),
            loadStateButton: document.getElementById('loadStateButton'),
            fileInput: document.getElementById('fileInput'),
            editRuleButton: document.getElementById('editRuleButton'),
            setupPanelButton: document.getElementById('setupPanelButton'),
            analysisPanelButton: document.getElementById('analysisPanelButton'),
            rankPanelButton: document.getElementById('rankPanelButton'),
            helpButton: document.getElementById('helpButton'),
        };
        this._initPopoutPanels();
        this._initPopoutControls();
        this._setupToolbarButtonListeners();
        this._setupStateListeners();

    }
    
    _initPopoutPanels() {
        this.popoutConfig.forEach(config => {
            const buttonElement = this.uiElements[config.buttonId];
            const popoutElement = this.uiElements[config.popoutId];
            if (buttonElement && popoutElement) {
                const options = { ...config.options };
                if (config.name === 'controls') {
                    const controlsMount = popoutElement.querySelector('#desktopControlsMount');
                    if (controlsMount) {
                        options.contentContainer = controlsMount;
                        options.contentComponentType = ControlsComponent;
                    }
                }
                
                this.popoutPanels[config.name] = new PopoutPanel(popoutElement, buttonElement, options);
            }
        });
        this.activePopouts = Object.values(this.popoutPanels);
    }

    _initPopoutControls() {
        this.uiElements.resetCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' }); this.popoutPanels.resetClear.hide(); });
        this.uiElements.resetAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' }); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' }); this.popoutPanels.resetClear.hide(); });
    }

    _setupToolbarButtonListeners() {
        const buttonToActionMap = {
            playPauseButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE),
            controlsButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'controls' }),
            rulesetActionsButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulesetactions' }),
            resetClearButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'resetClear' }),
            editRuleButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'ruleset' }),
            analysisPanelButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'analysis' }),
            rankPanelButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'rulerank' }),
            setupPanelButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'worldsetup' }),
            helpButton: () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PANEL, { panelName: 'learning' }),
            shareButton: () => { EventBus.dispatch(EVENTS.COMMAND_TOGGLE_POPOUT, { popoutName: 'share' }); EventBus.dispatch(EVENTS.COMMAND_SHARE_SETUP); },
            saveStateButton: () => EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE),
            loadStateButton: () => {
                this.uiElements.fileInput.accept = ".txt,.json";
                this.uiElements.fileInput.click();
            },
            copyShareLinkButton: this._copyShareLink.bind(this)
        };

        for (const [elementId, action] of Object.entries(buttonToActionMap)) {
            if (this.uiElements[elementId]) {
                this.uiElements[elementId].addEventListener('click', action);
            }
        }
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
                    EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, { worldIndex: this.worldManager.getSelectedWorldIndex(), loadedData: data });
                } catch (err) { alert(`Error processing file: ${err.message}`); }
                finally { e.target.value = null; }
            };
            reader.onerror = () => { alert(`Error reading file.`); e.target.value = null; };
            reader.readAsText(file);
        });

        EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => this.updatePauseButtonVisual(isPaused));
        
    }

    _copyShareLink() {
        if (this.uiElements.shareLinkInput.value) {
            this.uiElements.shareLinkInput.select();
            navigator.clipboard.writeText(this.uiElements.shareLinkInput.value).then(() => {
                this.uiElements.copyShareLinkButton.textContent = "Copied!";
                setTimeout(() => this.uiElements.copyShareLinkButton.textContent = "Copy to Clipboard", 1500);
            }).catch(_err => alert('Failed to copy link.'));
        }
    }

    updatePauseButtonVisual(isPaused) {
        if (this.uiElements?.playPauseButton) {
            this.uiElements.playPauseButton.textContent = isPaused ? "▶" : "❚❚";
            this.uiElements.playPauseButton.title = isPaused ? "[P]lay Simulation" : "[P]ause Simulation";
        }
    }

    getPopout(panelName) { 
        return this.popoutPanels[panelName]; 
    }

    closeAllPopouts(excludePopout = null) {
        let wasOpen = false;
        this.activePopouts.forEach(p => {
            if (p !== excludePopout && !p.isHidden()) {
                p.hide();
                wasOpen = true;
            }
        });
        return wasOpen;
    }
}