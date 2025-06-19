import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { ControlsComponent } from './components/ControlsComponent.js';
import { RulesetDirectInput } from './components/RulesetDirectInput.js';
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
            { name: 'newRules', buttonId: 'newRulesButton', popoutId: 'newRulesPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'mutate', buttonId: 'mutateButton', popoutId: 'mutatePopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'setHex', buttonId: 'setRulesetButton', popoutId: 'setHexPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'library', buttonId: 'libraryButton', popoutId: 'libraryPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
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
            newRulesButton: document.getElementById('newRulesButton'),
            mutateButton: document.getElementById('mutateButton'),
            setRulesetButton: document.getElementById('setRulesetButton'),
            libraryButton: document.getElementById('libraryButton'),
            resetClearButton: document.getElementById('resetClearButton'),
            shareButton: document.getElementById('shareButton'),
            // Popout Panels
            controlsPopout: document.getElementById('controlsPopout'),
            newRulesPopout: document.getElementById('newRulesPopout'),
            mutatePopout: document.getElementById('mutatePopout'),
            setHexPopout: document.getElementById('setHexPopout'),
            libraryPopout: document.getElementById('libraryPopout'),
            resetClearPopout: document.getElementById('resetClearPopout'),
            sharePopout: document.getElementById('sharePopout'),
            // Popout Content Mounts and Controls
            generateModeSwitchPopout: document.getElementById('generateModeSwitchPopout'),
            useCustomBiasCheckboxPopout: document.getElementById('useCustomBiasCheckboxPopout'),
            biasSliderMountPopout: document.getElementById('biasSliderMountPopout'),
            rulesetScopeSwitchPopout: document.getElementById('rulesetScopeSwitchPopout'),
            resetOnNewRuleCheckboxPopout: document.getElementById('resetOnNewRuleCheckboxPopout'),
            generateRulesetFromPopoutButton: document.getElementById('generateRulesetFromPopoutButton'),
            mutationRateSliderMount: document.getElementById('mutationRateSliderMount'),
            mutateModeSwitch: document.getElementById('mutateModeSwitch'),
            mutateScopeSwitch: document.getElementById('mutateScopeSwitch'),
            triggerMutationButton: document.getElementById('triggerMutationButton'),
            cloneButton: document.getElementById('cloneButton'),
            cloneAndMutateButton: document.getElementById('cloneAndMutateButton'),
            // rulesetInputPopout, setRuleFromPopoutButton, copyRuleFromPopoutButton removed - now handled by RulesetDirectInput component
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
        this.appContext.libraryController.init(this.libraryData);
        this._initPopoutPanels();
        this._initPopoutControls();
        this._populateLibraryPanel();
        this._setupEventBusListeners();
        this._setupToolbarButtonListeners();
        this._setupStateListeners();
        this._loadAndApplyUISettings();

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

    _populateLibraryPanel() {
        const rulesetContent = this.uiElements.libraryPopout.querySelector('#rulesetsLibraryContent');
        const patternContent = this.uiElements.libraryPopout.querySelector('#patternsLibraryContent');
        const tabs = this.uiElements.libraryPopout.querySelectorAll('.tab-button');
        if (!rulesetContent || !patternContent) return;

        rulesetContent.innerHTML = '';
        patternContent.innerHTML = '';

        this.libraryData.rulesets.forEach(rule => {
            const item = document.createElement('div');
            item.className = 'library-item';
            item.innerHTML = `<div class="library-item-info"><div class="library-item-name">${rule.name}</div><div class="library-item-desc">${rule.description}</div></div><button class="button load-rule-btn">Load</button>`;
            item.querySelector('.load-rule-btn').addEventListener('click', () => {
                            const currentState = this.appContext.rulesetActionController.getState();
            this.appContext.libraryController.loadRuleset(rule.hex, currentState.genScope, currentState.genAutoReset);
                this.popoutPanels.library.hide();
            });
            rulesetContent.appendChild(item);
        });

        this.libraryData.patterns.forEach(pattern => {
            const item = document.createElement('div');
            item.className = 'library-item';
            item.innerHTML = `<div class="library-item-info"><div class="library-item-name">${pattern.name}</div><div class="library-item-desc">${pattern.description}</div></div><button class="button place-pattern-btn">Place</button>`;
            item.querySelector('.place-pattern-btn').addEventListener('click', () => {
                this.appContext.libraryController.placePattern(pattern.name);
                this.popoutPanels.library.hide();
            });
            patternContent.appendChild(item);
        });

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const targetContent = this.uiElements.libraryPopout.querySelector(`#${tab.dataset.tab}LibraryContent`);
                this.uiElements.libraryPopout.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
                if (targetContent) targetContent.classList.remove('hidden');
            });
        });
    }


    
    _initPopoutControls() {
        // Initialize the new ControlsComponent for desktop
        const desktopControlsMount = this.uiElements.controlsPopout.querySelector('#desktopControlsMount');
        if (desktopControlsMount) {
            // MODIFIED: Pass the desktop context
            new ControlsComponent(desktopControlsMount, this.appContext, { context: 'desktop' });
        }

        const controllerState = this.appContext.rulesetActionController.getState();
        this.switchComponents.genMode = new SwitchComponent(this.uiElements.generateModeSwitchPopout, {
            type: 'radio',
            name: 'generateModePopout',
            initialValue: controllerState.genMode,
            // Fetch the configuration from the controller
            items: this.appContext.rulesetActionController.getGenerationConfig(),
            onChange: this.appContext.rulesetActionController.setGenMode
        });

        this.uiElements.useCustomBiasCheckboxPopout.addEventListener('change', e => {
            this.appContext.rulesetActionController.setUseCustomBias(e.target.checked);
            this.sliderComponents.biasSliderPopout?.setDisabled(!e.target.checked);
        });
        this.sliderComponents.biasSliderPopout = new SliderComponent(this.uiElements.biasSliderMountPopout, {
            ...this.appContext.rulesetActionController.getBiasSliderConfig(),
            id: 'biasSliderPopout',
            value: controllerState.bias,
            disabled: !controllerState.useCustomBias
        });

        this.switchComponents.genScope = new SwitchComponent(this.uiElements.rulesetScopeSwitchPopout, {
            ...this.appContext.rulesetActionController.getGenScopeSwitchConfig(),
            name: 'rulesetScopePopout',
            initialValue: controllerState.genScope,
        });

        this.switchComponents.genAutoReset = new SwitchComponent(this.uiElements.resetOnNewRuleCheckboxPopout, {
            ...this.appContext.rulesetActionController.getGenAutoResetSwitchConfig(),
            name: 'resetOnNewRulePopout',
            initialValue: controllerState.genAutoReset,
        });

        this.uiElements.generateRulesetFromPopoutButton.addEventListener('click', () => {
            EventBus.dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET);
        });
        this.sliderComponents.mutationRateSlider = new SliderComponent(this.uiElements.mutationRateSliderMount, {
            ...this.appContext.rulesetActionController.getMutationRateSliderConfig(),
            id: 'mutationRateSlider',
            value: controllerState.mutateRate
        });

        this.switchComponents.mutateMode = new SwitchComponent(this.uiElements.mutateModeSwitch, {
            type: 'radio',
            name: 'mutateMode',
            initialValue: controllerState.mutateMode,
            items: this.appContext.rulesetActionController.getMutationModeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateMode
        });

        this.switchComponents.mutateScope = new SwitchComponent(this.uiElements.mutateScopeSwitch, {
            type: 'radio',
            name: 'mutateScope',
            initialValue: controllerState.mutateScope,
            items: this.appContext.rulesetActionController.getMutationScopeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateScope
        });

        this.uiElements.triggerMutationButton.addEventListener('click', () => {
            EventBus.dispatch(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET);
        });
        this.uiElements.cloneButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_CLONE_RULESET));
        this.uiElements.cloneAndMutateButton.addEventListener('click', () => {
            EventBus.dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE);
        });
        
        // Initialize the setHex popout with the new RulesetDirectInput component
        const setHexContent = this.uiElements.setHexPopout;
        if (setHexContent) {
            // Clear the old, hardcoded HTML from index.html and replace with component
            setHexContent.innerHTML = `
                <h4>Set/Copy Ruleset Hex<button class="button-help-trigger" data-tour-name="directInput" title="Help with this feature">[?]</button></h4>
                <div id="desktop-direct-input-mount"></div>
            `;
            const mountPoint = setHexContent.querySelector('#desktop-direct-input-mount');
            new RulesetDirectInput(mountPoint, this.appContext, { context: 'desktop-direct' });
        }

        this.uiElements.resetCurrentButtonPopout.addEventListener('click', () => { this.appContext.worldsController.resetWorldsWithCurrentRuleset('selected'); this.popoutPanels.resetClear.hide(); });
        this.uiElements.resetAllButtonPopout.addEventListener('click', () => { this.appContext.worldsController.resetAllWorldsToInitialDensities(); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearCurrentButtonPopout.addEventListener('click', () => { this.appContext.worldsController.clearWorlds('selected'); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearAllButtonPopout.addEventListener('click', () => { this.appContext.worldsController.clearWorlds('all'); this.popoutPanels.resetClear.hide(); });
        
        // Visualization and interaction settings are now handled by ControlsComponent
    }
    
    // _copyRuleset method removed - now handled by RulesetDirectInput component

    _setupToolbarButtonListeners() {
        this.uiElements.playPauseButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));

        this.popoutConfig.forEach(config => {
            const tourName = {
                speed: 'speedAndBrush',
                brush: 'speedAndBrush',
                newRules: 'rulesetGeneration',
                mutate: 'mutation',
                setHex: 'directInput',
                library: 'library',
                resetClear: 'resetClear'
            }[config.name];
        
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

    _loadAndApplyUISettings() {
        const controllerState = this.appContext.rulesetActionController.getState();
        this.uiElements.useCustomBiasCheckboxPopout.checked = controllerState.useCustomBias;
        this.sliderComponents.biasSliderPopout?.setValue(controllerState.bias);
        this.sliderComponents.biasSliderPopout?.setDisabled(!controllerState.useCustomBias);
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