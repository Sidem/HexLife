import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { SliderComponent } from './components/SliderComponent.js';
import { SwitchComponent } from './components/SwitchComponent.js';

import { onboardingManager } from './ui.js';
import { generateShareUrl } from '../utils/utils.js';
import { uiManager } from './UIManager.js';
export class Toolbar {
    constructor(appContext, worldManagerInterface, libraryData) {
        this.appContext = appContext;
        this.worldManager = worldManagerInterface;
        this.libraryData = libraryData;
        
        this.uiElements = null;
        this.sliderComponents = {};
        this.switchComponents = {};
        this.popoutPanels = {};
        this.activePopouts = [];
        this.toolbarElement = document.getElementById('vertical-toolbar');
        this.popoutConfig = [
            { name: 'speed', buttonId: 'speedControlButton', popoutId: 'speedPopout', options: { position: 'right', alignment: 'start' } },
            { name: 'brush', buttonId: 'brushToolButton', popoutId: 'brushPopout', options: { position: 'right', alignment: 'start' } },
            { name: 'newRules', buttonId: 'newRulesButton', popoutId: 'newRulesPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'mutate', buttonId: 'mutateButton', popoutId: 'mutatePopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'setHex', buttonId: 'setRulesetButton', popoutId: 'setHexPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'library', buttonId: 'libraryButton', popoutId: 'libraryPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'resetClear', buttonId: 'resetClearButton', popoutId: 'resetClearPopout', options: { position: 'right', alignment: 'start', offset: 5 } },
            { name: 'share', buttonId: 'shareButton', popoutId: 'sharePopout', options: { position: 'right', alignment: 'start' } },
            { name: 'settings', buttonId: 'settingsButton', popoutId: 'settingsPopout', options: { position: 'right', alignment: 'start' } }
        ];
    }

    init(uiElements) {
        this.uiElements = uiElements;
        this.appContext.libraryController.init(this.libraryData);
        this._initPopoutPanels();
        this._initPopoutControls();
        this._populateLibraryPanel();
        this._setupGlobalPopoutListeners();
        this._setupToolbarButtonListeners();
        this._setupStateListeners();
        this._loadAndApplyUISettings();
        EventBus.subscribe(EVENTS.UI_MODE_CHANGED, ({ mode }) => this.updateVisibility(mode));
        this.updateVisibility(uiManager.getMode());
    }

    _setupGlobalPopoutListeners() {
        const closeAll = (excludePanel = null) => {
            this.activePopouts.forEach(popout => {
                if (popout !== excludePanel) popout.hide();
            });
        };
        document.addEventListener('popoutinteraction', (event) => closeAll(event.detail.panel));
        
        const handleClickOutside = (event) => {
            if (onboardingManager.isActive()) {
                const tooltip = document.getElementById('onboarding-tooltip');
                if (tooltip) {
                    const rect = tooltip.getBoundingClientRect();
                    if (event.target.id.includes('action') || (event.clientX >= rect.left && event.clientX <= rect.right &&
                        event.clientY >= rect.top && event.clientY <= rect.bottom)) {
                        return;
                    }
                }
            }

            if (!this.activePopouts.some(p => !p.isHidden())) return;
            const clickedInsidePopout = event.target.closest('.popout-panel');
            const clickedTriggerButton = this.activePopouts.some(p => p.triggerElement && p.triggerElement.contains(event.target));
            
            if (!clickedInsidePopout && !clickedTriggerButton) {
                closeAll();
            }
        };
        document.addEventListener('click', handleClickOutside);
        document.addEventListener('touchend', handleClickOutside);
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
        const controllerState = this.appContext.rulesetActionController.getState();
        this.sliderComponents.speedSliderPopout = new SliderComponent(this.uiElements.speedSliderMountPopout, { id: 'speedSliderPopout', min: 1, max: Config.MAX_SIM_SPEED, step: 1, value: this.appContext.simulationController.getState().speed, unit: 'tps', showValue: true, onChange: this.appContext.simulationController.setSpeed });
        this.sliderComponents.neighborhoodSliderPopout = new SliderComponent(this.uiElements.neighborhoodSizeSliderMountPopout, { id: 'brushSliderPopout', min: 0, max: Config.MAX_NEIGHBORHOOD_SIZE, step: 1, value: this.appContext.brushController.getState().brushSize, unit: '', showValue: true, onChange: this.appContext.brushController.setBrushSize });
        this.switchComponents.genMode = new SwitchComponent(this.uiElements.generateModeSwitchPopout, {
            type: 'radio',
            name: 'generateModePopout',
            initialValue: controllerState.genMode,
            items: [
                { value: 'random', text: 'Random' },
                { value: 'n_count', text: 'N-Count' },
                { value: 'r_sym', text: 'R-Sym' }
            ],
            onChange: this.appContext.rulesetActionController.setGenMode
        });

        this.uiElements.useCustomBiasCheckboxPopout.addEventListener('change', e => {
            this.appContext.rulesetActionController.setUseCustomBias(e.target.checked);
            this.sliderComponents.biasSliderPopout?.setDisabled(!e.target.checked);
        });
        this.sliderComponents.biasSliderPopout = new SliderComponent(this.uiElements.biasSliderMountPopout, { 
            id: 'biasSliderPopout', min: 0, max: 1, step: 0.001, 
            value: controllerState.bias, 
            showValue: true, unit: '', 
            disabled: !controllerState.useCustomBias, 
            onChange: this.appContext.rulesetActionController.setBias 
        });

        this.switchComponents.genScope = new SwitchComponent(this.uiElements.rulesetScopeSwitchPopout, {
            type: 'radio',
            name: 'rulesetScopePopout',
            initialValue: controllerState.genScope,
            items: [
                { value: 'selected', text: 'Selected' },
                { value: 'all', text: 'All' }
            ],
            onChange: this.appContext.rulesetActionController.setGenScope
        });

        this.switchComponents.genAutoReset = new SwitchComponent(this.uiElements.resetOnNewRuleCheckboxPopout, {
            type: 'checkbox',
            name: 'resetOnNewRulePopout',
            initialValue: controllerState.genAutoReset,
            items: [{ value: 'reset', text: 'Auto-Reset World(s)' }],
            onChange: this.appContext.rulesetActionController.setGenAutoReset
        });

        this.uiElements.generateRulesetFromPopoutButton.addEventListener('click', () => this.appContext.rulesetActionController.generate());
        this.sliderComponents.mutationRateSlider = new SliderComponent(this.uiElements.mutationRateSliderMount, { 
            id: 'mutationRateSlider', min: 1, max: 50, step: 1, 
            value: controllerState.mutateRate, 
            unit: '%', showValue: true, 
            onChange: this.appContext.rulesetActionController.setMutateRate 
        });

        this.switchComponents.mutateMode = new SwitchComponent(this.uiElements.mutateModeSwitch, {
            type: 'radio',
            name: 'mutateMode',
            initialValue: controllerState.mutateMode,
            items: [
                { value: 'single', text: 'Single' },
                { value: 'r_sym', text: 'R-Sym' },
                { value: 'n_count', text: 'N-Count' }
            ],
            onChange: this.appContext.rulesetActionController.setMutateMode
        });

        this.switchComponents.mutateScope = new SwitchComponent(this.uiElements.mutateScopeSwitch, {
            type: 'radio',
            name: 'mutateScope',
            initialValue: controllerState.mutateScope,
            items: [
                { value: 'selected', text: 'Selected' },
                { value: 'all', text: 'All' }
            ],
            onChange: this.appContext.rulesetActionController.setMutateScope
        });

        this.uiElements.triggerMutationButton.addEventListener('click', () => this.appContext.rulesetActionController.mutate());
        this.uiElements.cloneAndMutateButton.addEventListener('click', () => this.appContext.rulesetActionController.cloneAndMutate());
        this.uiElements.setRuleFromPopoutButton.addEventListener('click', () => {
            const hex = this.uiElements.rulesetInputPopout.value.trim().toUpperCase();
            if (!hex || !/^[0-9A-F]{32}$/.test(hex)) { alert("Invalid Hex: Must be 32 hex chars."); this.uiElements.rulesetInputPopout.select(); return; }
            const currentState = this.appContext.rulesetActionController.getState();
            this.appContext.libraryController.loadRuleset(hex, currentState.genScope, currentState.genAutoReset);
            this.uiElements.rulesetInputPopout.value = '';
            this.popoutPanels.setHex.hide();
        });
        this.uiElements.rulesetInputPopout.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.uiElements.setRuleFromPopoutButton.click(); } });
        this.uiElements.copyRuleFromPopoutButton.addEventListener('click', this._copyRuleset.bind(this));
        this.uiElements.rulesetInputPopout.addEventListener('input', () => {
            const hex = this.uiElements.rulesetInputPopout.value;
            if (hex && hex.length > 0) EventBus.dispatch(EVENTS.UI_RULESET_INPUT_CHANGED, { value: hex });
        });

        this.uiElements.resetCurrentButtonPopout.addEventListener('click', () => { this.appContext.worldsController.resetWorldsWithCurrentRuleset('selected'); this.popoutPanels.resetClear.hide(); });
        this.uiElements.resetAllButtonPopout.addEventListener('click', () => { this.appContext.worldsController.resetAllWorldsToInitialDensities(); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearCurrentButtonPopout.addEventListener('click', () => { this.appContext.worldsController.clearWorlds('selected'); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearAllButtonPopout.addEventListener('click', () => { this.appContext.worldsController.clearWorlds('all'); this.popoutPanels.resetClear.hide(); });
        const vizState = this.appContext.visualizationController.getState();

        new SwitchComponent(this.uiElements.settingsPopout.querySelector('#vizTypeSwitchMount'), {
            type: 'radio',
            label: 'Ruleset Visualization:',
            name: 'rulesetVizDesktop',
            initialValue: vizState.vizType,
            items: [
                { value: 'binary', text: 'Binary' },
                { value: 'color', text: 'Color' }
            ],
            onChange: this.appContext.visualizationController.setVisualizationType
        });
        
        new SwitchComponent(this.uiElements.settingsPopout.querySelector('#vizOverlaySwitchMount'), {
            type: 'checkbox',
            name: 'showMinimapOverlayDesktop',
            initialValue: vizState.showMinimapOverlay,
            items: [{ value: 'show', text: 'Show Minimap Overlays' }],
            onChange: this.appContext.visualizationController.setShowMinimapOverlay
        });
        
        new SwitchComponent(this.uiElements.settingsPopout.querySelector('#vizCycleIndicatorSwitchMount'), {
            type: 'checkbox',
            name: 'showCycleIndicatorDesktop',
            initialValue: vizState.showCycleIndicator,
            items: [{ value: 'show', text: 'Show Cycle Indicators' }],
            onChange: this.appContext.visualizationController.setShowCycleIndicator
        });

        const interactionState = this.appContext.interactionController.getState();
        new SwitchComponent(this.uiElements.settingsPopout.querySelector('#pauseWhileDrawingSwitchMount'), {
            type: 'checkbox',
            name: 'pauseWhileDrawingDesktop',
            initialValue: interactionState.pauseWhileDrawing,
            items: [{ value: 'pause', text: 'Pause While Drawing' }],
            onChange: this.appContext.interactionController.setPauseWhileDrawing
        });
    }
    
    _copyRuleset() {
        const hex = this.worldManager.getCurrentRulesetHex();
        if (!hex || hex === "N/A" || hex === "Error") { alert("No ruleset for selected world to copy."); return; }
        navigator.clipboard.writeText(hex).then(() => {
            const oldTxt = this.uiElements.copyRuleFromPopoutButton.textContent;
            this.uiElements.copyRuleFromPopoutButton.textContent = "Copied!";
            setTimeout(() => this.uiElements.copyRuleFromPopoutButton.textContent = oldTxt, 1500);
        }).catch(err => alert('Failed to copy ruleset hex.'));
    }

    _setupToolbarButtonListeners() {
        this.uiElements.playPauseButton.addEventListener('click', this.appContext.simulationController.togglePause);

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
                    if (tourName) {
                        onboardingManager.startTour(tourName);
                    }
                });
            }
        });
        
        this.uiElements.shareButton.addEventListener('click', () => this._generateAndShowShareLink());
        
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
        EventBus.subscribe(EVENTS.SIMULATION_SPEED_CHANGED, (speed) => this.sliderComponents.speedSliderPopout?.setValue(speed, false));
        EventBus.subscribe(EVENTS.BRUSH_SIZE_CHANGED, (size) => this.sliderComponents.neighborhoodSliderPopout?.setValue(size, false));
    }

    _loadAndApplyUISettings() {
        const controllerState = this.appContext.rulesetActionController.getState();
        this.uiElements.useCustomBiasCheckboxPopout.checked = controllerState.useCustomBias;
        this.sliderComponents.biasSliderPopout?.setValue(controllerState.bias);
        this.sliderComponents.biasSliderPopout?.setDisabled(!controllerState.useCustomBias);
    }

    _generateAndShowShareLink() {
        const url = generateShareUrl(this.worldManager);
        if (url) {
            this.uiElements.shareLinkInput.value = url;
            return true; 
        }
        return false; 
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



    updateVisibility(mode) {
        if (this.toolbarElement) {
            const isVisible = (mode === 'desktop');
            this.toolbarElement.classList.toggle('hidden', !isVisible);
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