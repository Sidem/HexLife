import * as Config from '../core/config.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { PopoutPanel } from './components/PopoutPanel.js';
import { SliderComponent } from './components/SliderComponent.js';
import { OnboardingManager } from './OnboardingManager.js';
import { formatHexCode } from '../utils/utils.js';

export class Toolbar {
    constructor(worldManagerInterface, libraryData, isMobile = false) {
        this.worldManager = worldManagerInterface;
        this.libraryData = libraryData;
        this.isMobile = isMobile;
        
        this.uiElements = null;
        this.sliderComponents = {};
        this.popoutPanels = {};
        this.activePopouts = [];
    }

    init(uiElements) {
        this.uiElements = uiElements;

        if (!this.isMobile) {
            this._initPopoutPanels();
            this._initPopoutControls();
            this._populateLibraryPanel();
            this._setupGlobalPopoutListeners();
        }
        this._setupToolbarButtonListeners();
        this._setupStateListeners();
        
        if (!this.isMobile) {
            this._loadAndApplyUISettings();
        }
    }

    _setupGlobalPopoutListeners() {
        const closeAll = (excludePanel = null) => {
            this.activePopouts.forEach(popout => {
                if (popout !== excludePanel) popout.hide();
            });
        };
        document.addEventListener('popoutinteraction', (event) => closeAll(event.detail.panel));
        const handleClickOutside = (event) => {
            let onboardingTooltip = document.getElementById('onboarding-tooltip');
            if (onboardingTooltip && !onboardingTooltip.classList.contains('hidden') && (onboardingTooltip.contains(event.target) || event.target.id.includes("action"))) {
                return;
            }
            if (!this.activePopouts.some(p => !p.isHidden())) return;
            if (OnboardingManager.isActive()) return;

            const clickedInsidePopout = event.target.closest('.popout-panel');
            const clickedTriggerButton = this.activePopouts.some(p => p.triggerElement && p.triggerElement.contains(event.target));

            if (!clickedInsidePopout && !clickedTriggerButton) closeAll();
        };
        document.addEventListener('click', handleClickOutside);
        document.addEventListener('touchend', handleClickOutside);
    }
    
    _initPopoutPanels() {
        this.popoutPanels.speed = new PopoutPanel(this.uiElements.speedPopout, this.uiElements.speedControlButton, { position: 'right', alignment: 'start' });
        this.popoutPanels.brush = new PopoutPanel(this.uiElements.brushPopout, this.uiElements.brushToolButton, { position: 'right', alignment: 'start' });
        this.popoutPanels.newRules = new PopoutPanel(this.uiElements.newRulesPopout, this.uiElements.newRulesButton, { position: 'right', alignment: 'start', offset: 5 });
        this.popoutPanels.mutate = new PopoutPanel(this.uiElements.mutatePopout, this.uiElements.mutateButton, { position: 'right', alignment: 'start', offset: 5 });
        this.popoutPanels.setHex = new PopoutPanel(this.uiElements.setHexPopout, this.uiElements.setRulesetButton, { position: 'right', alignment: 'start', offset: 5 });
        this.popoutPanels.library = new PopoutPanel(this.uiElements.libraryPopout, this.uiElements.libraryButton, { position: 'right', alignment: 'start', offset: 5 });
        this.popoutPanels.resetClear = new PopoutPanel(this.uiElements.resetClearPopout, this.uiElements.resetClearButton, { position: 'right', alignment: 'start', offset: 5 });
        this.popoutPanels.share = new PopoutPanel(this.uiElements.sharePopout, this.uiElements.shareButton, { position: 'right', alignment: 'start' });
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
                const targetScope = this.uiElements.rulesetScopeSwitchPopout.querySelector('input[name="rulesetScopePopout"]:checked')?.value || 'selected';
                EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, { hexString: rule.hex, resetScopeForThisChange: this.uiElements.resetOnNewRuleCheckboxPopout.checked ? targetScope : 'none' });
                this.popoutPanels.library.hide();
            });
            rulesetContent.appendChild(item);
        });

        this.libraryData.patterns.forEach(pattern => {
            const item = document.createElement('div');
            item.className = 'library-item';
            item.innerHTML = `<div class="library-item-info"><div class="library-item-name">${pattern.name}</div><div class="library-item-desc">${pattern.description}</div></div><button class="button place-pattern-btn">Place</button>`;
            item.querySelector('.place-pattern-btn').addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_ENTER_PLACING_MODE, { cells: pattern.cells });
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

    _setupRadioSwitch(switchElement, persistenceKey, valueExtractor = (value => value)) {
        if (!switchElement) return;
        switchElement.querySelectorAll('input[type="radio"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    PersistenceService.saveUISetting(persistenceKey, valueExtractor(radio.value));
                }
            });
        });
    }
    
    _initPopoutControls() {
        this.sliderComponents.speedSliderPopout = new SliderComponent(this.uiElements.speedSliderMountPopout, { id: 'speedSliderPopout', min: 1, max: Config.MAX_SIM_SPEED, step: 1, value: this.worldManager.getCurrentSimulationSpeed(), unit: 'tps', showValue: true, onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, val) });
        this.sliderComponents.neighborhoodSliderPopout = new SliderComponent(this.uiElements.neighborhoodSizeSliderMountPopout, { id: 'brushSliderPopout', min: 0, max: Config.MAX_NEIGHBORHOOD_SIZE, step: 1, value: this.worldManager.getCurrentBrushSize(), unit: '', showValue: true, onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, val) });
        
        this._setupRadioSwitch(this.uiElements.generateModeSwitchPopout, 'rulesetGenerationMode');
        this.uiElements.useCustomBiasCheckboxPopout.addEventListener('change', e => {
            PersistenceService.saveUISetting('useCustomBias', e.target.checked);
            this.sliderComponents.biasSliderPopout?.setDisabled(!e.target.checked);
        });
        this.sliderComponents.biasSliderPopout = new SliderComponent(this.uiElements.biasSliderMountPopout, { id: 'biasSliderPopout', min: 0, max: 1, step: 0.001, value: PersistenceService.loadUISetting('biasValue', 0.33), showValue: true, unit: '', disabled: !this.uiElements.useCustomBiasCheckboxPopout.checked, onChange: val => PersistenceService.saveUISetting('biasValue', val) });
        this._setupRadioSwitch(this.uiElements.rulesetScopeSwitchPopout, 'globalRulesetScopeAll', value => value === 'all');
        this.uiElements.resetOnNewRuleCheckboxPopout.addEventListener('change', e => PersistenceService.saveUISetting('resetOnNewRule', e.target.checked));
        this.uiElements.generateRulesetFromPopoutButton.addEventListener('click', () => this.triggerGenerate());

        this.sliderComponents.mutationRateSlider = new SliderComponent(this.uiElements.mutationRateSliderMount, { id: 'mutationRateSlider', min: 1, max: 50, step: 1, value: 1, unit: '%', showValue: true, onChange: val => PersistenceService.saveUISetting('mutationRate', val) });
        this._setupRadioSwitch(this.uiElements.mutateModeSwitch, 'mutateMode');
        this._setupRadioSwitch(this.uiElements.mutateScopeSwitch, 'mutateScope');
        this.uiElements.triggerMutationButton.addEventListener('click', () => this.triggerMutation());
        this.uiElements.cloneAndMutateButton.addEventListener('click', () => this.triggerCloneAndMutate());

        this.uiElements.setRuleFromPopoutButton.addEventListener('click', () => {
            const hex = this.uiElements.rulesetInputPopout.value.trim().toUpperCase();
            if (!hex || !/^[0-9A-F]{32}$/.test(hex)) { alert("Invalid Hex: Must be 32 hex chars."); this.uiElements.rulesetInputPopout.select(); return; }
            const targetScope = this.uiElements.rulesetScopeSwitchPopout.querySelector('input[name="rulesetScopePopout"]:checked')?.value || 'selected';
            EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, { hexString: hex, resetScopeForThisChange: this.uiElements.resetOnNewRuleCheckboxPopout.checked ? targetScope : 'none' });
            this.uiElements.rulesetInputPopout.value = '';
            this.popoutPanels.setHex.hide();
        });
        this.uiElements.rulesetInputPopout.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.uiElements.setRuleFromPopoutButton.click(); } });
        this.uiElements.copyRuleFromPopoutButton.addEventListener('click', this._copyRuleset.bind(this));
        this.uiElements.rulesetInputPopout.addEventListener('input', () => {
            const hex = this.uiElements.rulesetInputPopout.value;
            if (hex && hex.length > 0) EventBus.dispatch(EVENTS.UI_RULESET_INPUT_CHANGED, { value: hex });
        });

        this.uiElements.resetCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' }); this.popoutPanels.resetClear.hide(); });
        this.uiElements.resetAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' }); this.popoutPanels.resetClear.hide(); });
        this.uiElements.clearAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' }); this.popoutPanels.resetClear.hide(); });
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
        this.uiElements.playPauseButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));

        const setupPopoutToggle = (button, popoutName, tourName) => {
            this.uiElements[button].addEventListener('click', () => {
                this.popoutPanels[popoutName].toggle();
                if (tourName) OnboardingManager.startTour(tourName);
            });
        };

        setupPopoutToggle('speedControlButton', 'speed', 'speedAndBrush');
        setupPopoutToggle('brushToolButton', 'brush', 'speedAndBrush');
        setupPopoutToggle('newRulesButton', 'newRules', 'rulesetGeneration');
        setupPopoutToggle('mutateButton', 'mutate', 'mutation');
        setupPopoutToggle('setRulesetButton', 'setHex', 'directInput');
        setupPopoutToggle('libraryButton', 'library', 'library');
        setupPopoutToggle('resetClearButton', 'resetClear', 'resetClear');
        
        this.uiElements.shareButton.addEventListener('click', () => {
            this._generateAndShowShareLink();
            this.popoutPanels.share.toggle();
        });
        

        this.uiElements.saveStateButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE));
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
                    EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, { worldIndex: this.worldManager.getSelectedWorldIndex(), loadedData: data });
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
        const genMode = PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym');
        this.uiElements.generateModeSwitchPopout.querySelectorAll('input[name="generateModePopout"]').forEach(r => r.checked = r.value === genMode);
        this.uiElements.useCustomBiasCheckboxPopout.checked = PersistenceService.loadUISetting('useCustomBias', true);
        this.sliderComponents.biasSliderPopout?.setValue(PersistenceService.loadUISetting('biasValue', 0.33));
        this.sliderComponents.biasSliderPopout?.setDisabled(!this.uiElements.useCustomBiasCheckboxPopout.checked);

        const scopeAll = PersistenceService.loadUISetting('globalRulesetScopeAll', true);
        this.uiElements.rulesetScopeSwitchPopout.querySelector(`input[value="${scopeAll ? 'all' : 'selected'}"]`).checked = true;
        this.uiElements.resetOnNewRuleCheckboxPopout.checked = PersistenceService.loadUISetting('resetOnNewRule', true);
        this.sliderComponents.mutationRateSlider?.setValue(PersistenceService.loadUISetting('mutationRate', 1));

        const mutateMode = PersistenceService.loadUISetting('mutateMode', 'single');
        if (this.uiElements.mutateModeSwitch.querySelector(`input[value="${mutateMode}"]`)) this.uiElements.mutateModeSwitch.querySelector(`input[value="${mutateMode}"]`).checked = true;
        const mutateScope = PersistenceService.loadUISetting('mutateScope', 'selected');
        if (this.uiElements.mutateScopeSwitch.querySelector(`input[value="${mutateScope}"]`)) this.uiElements.mutateScopeSwitch.querySelector(`input[value="${mutateScope}"]`).checked = true;
    }

    _generateAndShowShareLink() {
        const params = new URLSearchParams();
        const rulesetHex = this.worldManager.getCurrentRulesetHex();
        if (!rulesetHex || rulesetHex === "N/A" || rulesetHex === "Error") { alert("Cannot share: The selected world does not have a valid ruleset."); return; }
        params.set('r', rulesetHex);

        const selectedWorld = this.worldManager.getSelectedWorldIndex();
        if (selectedWorld !== Config.DEFAULT_SELECTED_WORLD_INDEX) params.set('w', selectedWorld);

        const speed = this.worldManager.getCurrentSimulationSpeed();
        if (speed !== Config.DEFAULT_SPEED) params.set('s', speed);

        const worldSettings = this.worldManager.getWorldSettingsForUI();
        let enabledBitmask = 0;
        worldSettings.forEach((ws, i) => { if (ws.enabled) enabledBitmask |= (1 << i); });
        if (enabledBitmask !== 511) params.set('e', enabledBitmask);

        const camera = this.worldManager.getCurrentCameraState();
        if (camera.zoom !== 1.0 || camera.x !== Config.RENDER_TEXTURE_SIZE / 2 || camera.y !== Config.RENDER_TEXTURE_SIZE / 2) {
            params.set('cam', `${parseFloat(camera.x.toFixed(1))},${parseFloat(camera.y.toFixed(1))},${parseFloat(camera.zoom.toFixed(2))}`);
        }
        
        this.uiElements.shareLinkInput.value = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
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

    triggerGenerate() {
        const bias = this.uiElements.useCustomBiasCheckboxPopout.checked ? this.sliderComponents.biasSliderPopout.getValue() : Math.random();
        const mode = this.uiElements.generateModeSwitchPopout.querySelector('input[name="generateModePopout"]:checked')?.value || 'random';
        const targetScope = this.uiElements.rulesetScopeSwitchPopout.querySelector('input[name="rulesetScopePopout"]:checked')?.value || 'selected';
        EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, { bias, generationMode: mode, resetScopeForThisChange: this.uiElements.resetOnNewRuleCheckboxPopout.checked ? targetScope : 'none' });
    }
    
    triggerMutation() {
        const mutationRate = this.sliderComponents.mutationRateSlider.getValue() / 100.0;
        const scope = this.uiElements.mutateScopeSwitch.querySelector('input[name="mutateScope"]:checked')?.value || 'selected';
        const mode = this.uiElements.mutateModeSwitch.querySelector('input[name="mutateMode"]:checked')?.value || 'single';
        EventBus.dispatch(EVENTS.COMMAND_MUTATE_RULESET, { mutationRate, scope, mode });
    }
    
    triggerCloneAndMutate() {
        const mutationRate = this.sliderComponents.mutationRateSlider.getValue() / 100.0;
        const mode = this.uiElements.mutateModeSwitch.querySelector('input[name="mutateMode"]:checked')?.value || 'single';
        EventBus.dispatch(EVENTS.COMMAND_CLONE_AND_MUTATE, { mutationRate, mode });
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