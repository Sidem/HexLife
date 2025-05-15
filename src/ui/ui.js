// src/ui/ui.js
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js';
import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { SliderComponent } from './components/SliderComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { AnalysisPanel } from './components/AnalysisPanel.js';

let uiElements;
let sliderComponents = {};
let simulationInterfaceRef;
let rulesetEditorComponent, setupPanelComponent, analysisPanelInstance;

export function initUI(simInterface) {
    simulationInterfaceRef = simInterface;
    uiElements = {
        canvas: document.getElementById('hexGridCanvas'),
        fileInput: document.getElementById('fileInput'),
        playPauseButton: document.getElementById('playPauseButton'),
        randomRulesetButton: document.getElementById('randomRulesetButton'),
        generateModeSwitch: document.getElementById('generateModeSwitch'),
        copyRuleButton: document.getElementById('copyRuleButton'),
        rulesetInput: document.getElementById('rulesetInput'),
        setRuleButton: document.getElementById('setRuleButton'),
        rulesetDisplay: document.getElementById('rulesetDisplay'), // Shows selected world's ruleset
        resetOnNewRuleCheckbox: document.getElementById('resetOnNewRuleCheckbox'),
        editRuleButton: document.getElementById('editRuleButton'),
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetCurrentButton: document.getElementById('resetCurrentButton'),
        resetAllButtonNew: document.getElementById('resetAllButtonNew'),
        clearCurrentButton: document.getElementById('clearCurrentButton'),
        clearAllButton: document.getElementById('clearAllButton'),
        setupPanelButton: document.getElementById('setupPanelButton'),
        statRatio: document.getElementById('stat-ratio'),
        statAvgRatio: document.getElementById('stat-avg-ratio'),
        rulesetEditorPanel: document.getElementById('rulesetEditorPanel'),
        setupPanel: document.getElementById('setupPanel'),
        analysisPanel: document.getElementById('analysisPanel'),
        useCustomBiasCheckbox: document.getElementById('useCustomBiasCheckbox'),
        statFps: document.getElementById('stat-fps'),
        statActualTps: document.getElementById('stat-actual-tps'),
        analysisPanelButton: document.getElementById('analysisPanelButton'),
        rulesetScopeSwitch: document.getElementById('rulesetScopeSwitch'), // For main UI ruleset operations
        rulesetScopeLabel: document.querySelector('label[for="rulesetScopeSwitch"]'),
        speedSliderMount: document.getElementById('speedSliderMount'),
        neighborhoodSizeSliderMount: document.getElementById('neighborhoodSizeSliderMount'),
        biasSliderMount: document.getElementById('biasSliderMount'),
    };

    if (!validateElements()) return false;

    if (uiElements.rulesetEditorPanel) rulesetEditorComponent = new RulesetEditor(uiElements.rulesetEditorPanel, simInterface);
    if (uiElements.setupPanel) setupPanelComponent = new SetupPanel(uiElements.setupPanel, simInterface);
    if (uiElements.analysisPanel) analysisPanelInstance = new AnalysisPanel(uiElements.analysisPanel, simInterface, {});

    sliderComponents.speedSlider = new SliderComponent(uiElements.speedSliderMount, {
        id: 'speedSlider', label: 'Speed:', min: 1, max: Config.MAX_SIM_SPEED, step: 1,
        value: simInterface.getCurrentSimulationSpeed(), unit: 'tps', showValue: true,
        onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, val)
    });
    sliderComponents.neighborhoodSlider = new SliderComponent(uiElements.neighborhoodSizeSliderMount, {
        id: 'neighborhoodSize', label: 'Brush:', min: 0, max: Config.MAX_NEIGHBORHOOD_SIZE, step: 1,
        value: simInterface.getCurrentBrushSize(), unit: '', showValue: true,
        onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, val)
    });
    sliderComponents.biasSlider = new SliderComponent(uiElements.biasSliderMount, {
        id: 'biasSlider', min: 0, max: 1, step: 0.001, value: PersistenceService.loadUISetting('biasValue', 0.5),
        showValue: true, unit: '', disabled: !uiElements.useCustomBiasCheckbox.checked,
        onChange: val => PersistenceService.saveUISetting('biasValue', val)
    });

    setupGeneralListeners(simInterface);
    setupPanelToggleListeners();
    setupStateListeners(simInterface);
    loadAndApplyUISettings(simInterface);
    window.addEventListener('keydown', handleGlobalKeyDown);
    updateBiasSliderDisabledState();
    setupUIEventListeners(simInterface); // Setup after all elements are potentially modified by loadAndApplyUISettings
    
    // Initial UI state based on simulation
    updatePauseButton(simInterface.isSimulationPaused());
    updateMainRulesetDisplay(simInterface.getCurrentRulesetHex()); // Will show selected world's ruleset
    updateStatsDisplay(simInterface.getSelectedWorldStats());
    
    console.log("UI Initialized with per-world ruleset considerations.");
    return true;
}

function _updateRulesetScopeSwitchLabel() {
    if (uiElements.rulesetScopeSwitch && uiElements.rulesetScopeLabel) {
        const label = uiElements.rulesetScopeLabel;
        label.textContent = uiElements.rulesetScopeSwitch.checked ? (label.dataset.onText || "All Worlds") : (label.dataset.offText || "Selected World");
    }
}

function loadAndApplyUISettings(sim) {
    sliderComponents.speedSlider?.setValue(sim.getCurrentSimulationSpeed());
    sliderComponents.neighborhoodSlider?.setValue(sim.getCurrentBrushSize());
    const genMode = PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym');
    uiElements.generateModeSwitch.querySelectorAll('input[name="generateMode"]').forEach(r => r.checked = r.value === genMode);
    uiElements.resetOnNewRuleCheckbox.checked = PersistenceService.loadUISetting('resetOnNewRule', true);
    uiElements.useCustomBiasCheckbox.checked = PersistenceService.loadUISetting('useCustomBias', false);
    sliderComponents.biasSlider?.setValue(PersistenceService.loadUISetting('biasValue', 0.5));
    if (uiElements.rulesetScopeSwitch) {
        uiElements.rulesetScopeSwitch.checked = PersistenceService.loadUISetting('globalRulesetScopeAll', true);
        _updateRulesetScopeSwitchLabel();
    }
    updateBiasSliderDisabledState(); // Call after useCustomBiasCheckbox is set
    // Button texts
    if(uiElements.playPauseButton) uiElements.playPauseButton.textContent = sim.isSimulationPaused() ? "[P]lay" : "[P]ause";
    if(uiElements.randomRulesetButton) uiElements.randomRulesetButton.textContent = "[N]ew Rules";
    if(uiElements.resetCurrentButton) uiElements.resetCurrentButton.textContent = "[R]eset Current";
    if(uiElements.resetAllButtonNew) uiElements.resetAllButtonNew.textContent = "Reset All";
    if(uiElements.clearCurrentButton) uiElements.clearCurrentButton.textContent = "[C]lear Current";
    if(uiElements.clearAllButton) uiElements.clearAllButton.textContent = "Clear All";
    if(uiElements.editRuleButton) uiElements.editRuleButton.textContent = "[E]dit";
    if(uiElements.setupPanelButton) uiElements.setupPanelButton.textContent = "[S]etup";
    if(uiElements.analysisPanelButton) uiElements.analysisPanelButton.textContent = "[A]nalyse";
}

export function updatePerformanceDisplay(fps, tps) {
    if (uiElements?.statFps) uiElements.statFps.textContent = fps;
    if (uiElements?.statActualTps) uiElements.statActualTps.textContent = tps;
}

// This function is primarily for the RulesetEditor to refresh if it's open
// The main display is updated by the RULESET_CHANGED event handler
export function refreshAllRulesetViews(sim) {
    if (!sim) return;
    // Main display is handled by RULESET_CHANGED event
    rulesetEditorComponent?.refreshViews(); // Will load selected world's ruleset
}

function updateBiasSliderDisabledState() {
    sliderComponents.biasSlider?.setDisabled(!uiElements.useCustomBiasCheckbox.checked);
}

function validateElements() {
    const critical = ['canvas', 'fileInput', 'playPauseButton', 'randomRulesetButton', 'generateModeSwitch', 'copyRuleButton', 'rulesetInput', 'setRuleButton', 'rulesetDisplay', 'resetOnNewRuleCheckbox', 'editRuleButton', 'saveStateButton', 'loadStateButton', 'resetCurrentButton', 'resetAllButtonNew', 'clearCurrentButton', 'clearAllButton', 'setupPanelButton', 'statRatio', 'statAvgRatio', 'rulesetEditorPanel', 'setupPanel', 'analysisPanel', 'useCustomBiasCheckbox', 'statFps', 'statActualTps', 'analysisPanelButton', 'rulesetScopeSwitch', 'rulesetScopeLabel', 'speedSliderMount', 'neighborhoodSizeSliderMount', 'biasSliderMount'];
    return critical.every(key => {
        if (!uiElements[key]) console.error(`UI Error: Element '${key}' not found.`);
        return !!uiElements[key];
    });
}

function setupGeneralListeners(sim) {
    uiElements.playPauseButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));
    uiElements.generateModeSwitch.querySelectorAll('input[name="generateMode"]').forEach(r => {
        r.addEventListener('change', () => { if (r.checked) PersistenceService.saveUISetting('rulesetGenerationMode', r.value); });
    });
    uiElements.resetOnNewRuleCheckbox.addEventListener('change', e => PersistenceService.saveUISetting('resetOnNewRule', e.target.checked));
    uiElements.useCustomBiasCheckbox.addEventListener('change', e => {
        PersistenceService.saveUISetting('useCustomBias', e.target.checked);
        updateBiasSliderDisabledState();
    });
    if (uiElements.rulesetScopeSwitch) {
        uiElements.rulesetScopeSwitch.addEventListener('change', e => {
            PersistenceService.saveUISetting('globalRulesetScopeAll', e.target.checked);
            _updateRulesetScopeSwitchLabel();
        });
    }

    uiElements.randomRulesetButton.addEventListener('click', () => {
        const bias = uiElements.useCustomBiasCheckbox.checked ? sliderComponents.biasSlider.getValue() : Math.random();
        const mode = uiElements.generateModeSwitch.querySelector('input[name="generateMode"]:checked')?.value || 'random';
        const targetScope = uiElements.rulesetScopeSwitch.checked ? 'all' : 'selected';
        
        EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
            bias, generationMode: mode,
            resetScopeForThisChange: uiElements.resetOnNewRuleCheckbox.checked ? targetScope : 'none'
        });
    });

    uiElements.copyRuleButton.addEventListener('click', () => {
        const hex = sim.getCurrentRulesetHex(); // Gets selected world's ruleset
        if (!hex || hex === "N/A" || hex === "Error") { alert("No ruleset to copy."); return; }
        navigator.clipboard.writeText(hex).then(() => {
            const oldTxt = uiElements.copyRuleButton.textContent;
            uiElements.copyRuleButton.textContent = "Copied!";
            setTimeout(() => uiElements.copyRuleButton.textContent = oldTxt, 1500);
        }).catch(err => alert('Failed to copy.'));
    });

    uiElements.setRuleButton.addEventListener('click', () => {
        const hex = uiElements.rulesetInput.value.trim().toUpperCase();
        if (!hex || !/^[0-9A-F]{32}$/.test(hex)) {
            alert("Invalid Hex: Must be 32 hex chars."); uiElements.rulesetInput.select(); return;
        }
        const targetScope = uiElements.rulesetScopeSwitch.checked ? 'all' : 'selected';
        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
            hexString: hex,
            resetScopeForThisChange: uiElements.resetOnNewRuleCheckbox.checked ? targetScope : 'none'
        });
        uiElements.rulesetInput.value = ''; uiElements.rulesetInput.blur();
    });
    uiElements.rulesetInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); uiElements.setRuleButton.click(); }});
}

function setupStateListeners(sim) {
    uiElements.saveStateButton.addEventListener('click', () => {
        const data = sim.getWorldStateForSave(sim.getSelectedWorldIndex()); // Saves selected world's state + its rulesetHex
        if (!data) { alert("Could not get state data."); return; }
        let json = JSON.stringify(data, null, 2);
        json = json.replace(/("state"\s*:\s*)\[(\s*[\s\S]*?\s*)\]/m, (_, p, arr) => `${p}[${arr.replace(/[\r\n\s]+/g,' ').trim()}]`);
        downloadFile(`hex_state_world${sim.getSelectedWorldIndex()}_${data.rulesetHex}_${new Date().toISOString().slice(0,-4).replace(/[:.-]/g,'')}.json`, json, 'application/json');
    });
    uiElements.loadStateButton.addEventListener('click', () => { uiElements.fileInput.accept = ".txt,.json"; uiElements.fileInput.click(); });
    uiElements.fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) { e.target.value = null; return; }
        const reader = new FileReader();
        reader.onload = re => {
            try {
                const data = JSON.parse(re.target.result);
                if (!data?.rows || !data?.cols || !Array.isArray(data.state) || !data.rulesetHex) throw new Error("Invalid format or missing rulesetHex.");
                // COMMAND_LOAD_WORLD_STATE will make simulation.js load this state and rulesetHex into the target world.
                EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, { worldIndex: sim.getSelectedWorldIndex(), loadedData: data });
            } catch (err) { alert(`Error processing file: ${err.message}`); }
            finally { e.target.value = null; }
        };
        reader.onerror = () => { alert(`Error reading file.`); e.target.value = null; };
        reader.readAsText(file);
    });

    uiElements.resetCurrentButton?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: sim.getSelectedWorldIndex() }));
    uiElements.resetAllButtonNew?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES));
    uiElements.clearCurrentButton?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' }));
    uiElements.clearAllButton?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' }));
}

function setupPanelToggleListeners() {
    uiElements.editRuleButton?.addEventListener('click', () => rulesetEditorComponent?.toggle());
    uiElements.setupPanelButton?.addEventListener('click', () => setupPanelComponent?.toggle());
    uiElements.analysisPanelButton?.addEventListener('click', () => analysisPanelInstance?.toggle());
}

export function updatePauseButton(isPaused) { if (uiElements?.playPauseButton) uiElements.playPauseButton.textContent = isPaused ? "[P]lay" : "[P]ause"; }
export function updateMainRulesetDisplay(hex) { if (uiElements?.rulesetDisplay) uiElements.rulesetDisplay.textContent = formatHexCode(hex); }
export function updateStatsDisplay(stats) {
    if (!stats || !uiElements) return;
    if (uiElements.statRatio) uiElements.statRatio.textContent = (stats.ratio * 100).toFixed(2);
    if (uiElements.statAvgRatio) uiElements.statAvgRatio.textContent = (stats.avgRatio * 100).toFixed(2);
}
export function updateBrushSlider(size) { sliderComponents.neighborhoodSlider?.setValue(size); }
export function updateSpeedSlider(speed) { sliderComponents.speedSlider?.setValue(speed); }

function handleGlobalKeyDown(event) {
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable);
    const isEditorHexInput = rulesetEditorComponent && rulesetEditorComponent.uiElements.editorRulesetInput === activeEl;
    if (event.key === 'Enter' && isEditorHexInput) { /* Let editor handle */ }
    else if (isInputFocused) return;

    const keyMap = { 'P': uiElements.playPauseButton, 'N': uiElements.randomRulesetButton, 'R': uiElements.resetCurrentButton, 'C': uiElements.clearCurrentButton, 'E': rulesetEditorComponent, 'S': setupPanelComponent, 'A': analysisPanelInstance };
    const action = keyMap[event.key.toUpperCase()];
    if (action) {
        if (typeof action.click === 'function') action.click();
        else if (typeof action.toggle === 'function') action.toggle();
        event.preventDefault();
    }
}

function setupUIEventListeners(simInterface) {
    EventBus.subscribe(EVENTS.SIMULATION_PAUSED, updatePauseButton);
    EventBus.subscribe(EVENTS.SIMULATION_SPEED_CHANGED, speed => sliderComponents.speedSlider?.setValue(speed, false));
    EventBus.subscribe(EVENTS.RULESET_CHANGED, hex => { // This is now fired when SELECTED world's ruleset changes
        updateMainRulesetDisplay(hex);
        rulesetEditorComponent?.refreshViews(); // Ensure editor updates if it's showing this ruleset
    });
    EventBus.subscribe(EVENTS.BRUSH_SIZE_CHANGED, size => sliderComponents.neighborhoodSlider?.setValue(size, false));
    EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, updateStatsDisplay);
    EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
        setupPanelComponent?.refreshViews();
        if (simInterface) updateStatsDisplay(simInterface.getSelectedWorldStats());
        // When all worlds reset, the selected world's ruleset might have changed if it was part of a global ruleset application.
        // So, ensure the main ruleset display is also updated.
        if (simInterface) updateMainRulesetDisplay(simInterface.getCurrentRulesetHex());
    });
    EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => setupPanelComponent?.refreshViews());
    EventBus.subscribe(EVENTS.PERFORMANCE_METRICS_UPDATED, data => updatePerformanceDisplay(data.fps, data.tps));
}

export function getUIElements() { return uiElements; }
export function getAnalysisPanelInstance() { return analysisPanelInstance; }