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
let worldManagerInterfaceRef;
let rulesetEditorComponent, setupPanelComponent, analysisPanelInstance;

export function initUI(worldManagerInterface) {
    worldManagerInterfaceRef = worldManagerInterface;
    uiElements = {
        canvas: document.getElementById('hexGridCanvas'),
        fileInput: document.getElementById('fileInput'),
        playPauseButton: document.getElementById('playPauseButton'),
        randomRulesetButton: document.getElementById('randomRulesetButton'),
        generateModeSwitch: document.getElementById('generateModeSwitch'),
        copyRuleButton: document.getElementById('copyRuleButton'),
        rulesetInput: document.getElementById('rulesetInput'),
        setRuleButton: document.getElementById('setRuleButton'),
        rulesetDisplay: document.getElementById('rulesetDisplay'),
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
        statTick: document.getElementById('stat-tick'), // Ensure this exists in HTML
        rulesetEditorPanel: document.getElementById('rulesetEditorPanel'),
        setupPanel: document.getElementById('setupPanel'),
        analysisPanel: document.getElementById('analysisPanel'),
        useCustomBiasCheckbox: document.getElementById('useCustomBiasCheckbox'),
        statFps: document.getElementById('stat-fps'),
        statActualTps: document.getElementById('stat-actual-tps'),
        analysisPanelButton: document.getElementById('analysisPanelButton'),
        rulesetScopeSwitch: document.getElementById('rulesetScopeSwitch'),
        rulesetScopeLabel: document.querySelector('label[for="rulesetScopeSwitch"]'),
        speedSliderMount: document.getElementById('speedSliderMount'),
        neighborhoodSizeSliderMount: document.getElementById('neighborhoodSizeSliderMount'),
        biasSliderMount: document.getElementById('biasSliderMount'),
    };

    if (!validateElements()) return false;

    if (uiElements.rulesetEditorPanel) rulesetEditorComponent = new RulesetEditor(uiElements.rulesetEditorPanel, worldManagerInterfaceRef);
    if (uiElements.setupPanel) setupPanelComponent = new SetupPanel(uiElements.setupPanel, worldManagerInterfaceRef);
    if (uiElements.analysisPanel) analysisPanelInstance = new AnalysisPanel(uiElements.analysisPanel, worldManagerInterfaceRef, {});

    sliderComponents.speedSlider = new SliderComponent(uiElements.speedSliderMount, {
        id: 'speedSlider', label: 'Speed:', min: 1, max: Config.MAX_SIM_SPEED, step: 1,
        value: worldManagerInterfaceRef.getCurrentSimulationSpeed(), unit: 'tps', showValue: true,
        onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, val)
    });
    sliderComponents.neighborhoodSlider = new SliderComponent(uiElements.neighborhoodSizeSliderMount, {
        id: 'neighborhoodSize', label: 'Brush:', min: 0, max: Config.MAX_NEIGHBORHOOD_SIZE, step: 1,
        value: worldManagerInterfaceRef.getCurrentBrushSize(), unit: '', showValue: true,
        onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, val)
    });
    sliderComponents.biasSlider = new SliderComponent(uiElements.biasSliderMount, {
        id: 'biasSlider', min: 0, max: 1, step: 0.001, value: PersistenceService.loadUISetting('biasValue', 0.5),
        showValue: true, unit: '', disabled: !uiElements.useCustomBiasCheckbox.checked,
        onChange: val => PersistenceService.saveUISetting('biasValue', val)
    });

    setupGeneralListeners();
    setupPanelToggleListeners();
    setupStateListeners();
    loadAndApplyUISettings();
    window.addEventListener('keydown', handleGlobalKeyDown);
    updateBiasSliderDisabledState();
    setupUIEventListeners();

    updatePauseButton(worldManagerInterfaceRef.isSimulationPaused());
    updateMainRulesetDisplay(worldManagerInterfaceRef.getCurrentRulesetHex());
    updateStatsDisplay(worldManagerInterfaceRef.getSelectedWorldStats());

    console.log("UI Initialized (Worker Architecture).");
    return true;
}

function _updateRulesetScopeSwitchLabel() {
    if (uiElements.rulesetScopeSwitch && uiElements.rulesetScopeLabel) {
        const label = uiElements.rulesetScopeLabel;
        label.textContent = uiElements.rulesetScopeSwitch.checked ? (label.dataset.onText || "All Worlds") : (label.dataset.offText || "Selected World");
    }
}

function loadAndApplyUISettings() {
    sliderComponents.speedSlider?.setValue(worldManagerInterfaceRef.getCurrentSimulationSpeed());
    sliderComponents.neighborhoodSlider?.setValue(worldManagerInterfaceRef.getCurrentBrushSize());
    const genMode = PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym');
    uiElements.generateModeSwitch.querySelectorAll('input[name="generateMode"]').forEach(r => r.checked = r.value === genMode);
    uiElements.resetOnNewRuleCheckbox.checked = PersistenceService.loadUISetting('resetOnNewRule', true);
    uiElements.useCustomBiasCheckbox.checked = PersistenceService.loadUISetting('useCustomBias', false);
    sliderComponents.biasSlider?.setValue(PersistenceService.loadUISetting('biasValue', 0.5));
    if (uiElements.rulesetScopeSwitch) {
        uiElements.rulesetScopeSwitch.checked = PersistenceService.loadUISetting('globalRulesetScopeAll', true);
        _updateRulesetScopeSwitchLabel();
    }
    updateBiasSliderDisabledState();
    if(uiElements.playPauseButton) uiElements.playPauseButton.textContent = worldManagerInterfaceRef.isSimulationPaused() ? "[P]lay" : "[P]ause";
}

function updatePerformanceDisplay(fps, tpsOfSelectedWorld) {
    if (uiElements?.statFps) uiElements.statFps.textContent = fps !== undefined ? String(fps) : '--';
    if (uiElements?.statActualTps) uiElements.statActualTps.textContent = tpsOfSelectedWorld !== undefined ? String(tpsOfSelectedWorld) : '--';
}

function refreshAllRulesetViewsIfOpen() {
    if (worldManagerInterfaceRef) {
        rulesetEditorComponent?.refreshViews();
    }
}

function updateBiasSliderDisabledState() {
    sliderComponents.biasSlider?.setDisabled(!uiElements.useCustomBiasCheckbox.checked);
}

function validateElements() {
    const critical = ['canvas', 'playPauseButton', 'randomRulesetButton', 'rulesetDisplay', 'statRatio', 'statTick', 'rulesetEditorPanel', 'setupPanel', 'analysisPanel', 'speedSliderMount', 'neighborhoodSizeSliderMount'];
    return critical.every(key => {
        if (!uiElements[key]) console.error(`UI Error: Element '${key}' not found.`);
        return !!uiElements[key];
    });
}

function setupGeneralListeners() {
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
            EventBus.dispatch(EVENTS.UI_RULESET_SCOPE_CHANGED, { scope: e.target.checked ? 'all' : 'selected' });
        });
    }

    uiElements.randomRulesetButton.addEventListener('click', () => {
        const bias = uiElements.useCustomBiasCheckbox.checked ? sliderComponents.biasSlider.getValue() : Math.random();
        const mode = uiElements.generateModeSwitch.querySelector('input[name="generateMode"]:checked')?.value || 'random';
        const targetScope = uiElements.rulesetScopeSwitch.checked ? 'all' : 'selected';

        EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
            bias,
            generationMode: mode,
            resetScopeForThisChange: uiElements.resetOnNewRuleCheckbox.checked ? targetScope : 'none'
        });
    });

    uiElements.copyRuleButton.addEventListener('click', () => {
        const hex = worldManagerInterfaceRef.getCurrentRulesetHex();
        if (!hex || hex === "N/A" || hex === "Error") { alert("No ruleset for selected world to copy."); return; }
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

function setupStateListeners() {
    uiElements.saveStateButton.addEventListener('click', () => {
        EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE);
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
                EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, {
                    worldIndex: worldManagerInterfaceRef.getSelectedWorldIndex(),
                    loadedData: data
                });
            } catch (err) { alert(`Error processing file: ${err.message}`); }
            finally { e.target.value = null; }
        };
        reader.onerror = () => { alert(`Error reading file.`); e.target.value = null; };
        reader.readAsText(file);
    });

    uiElements.resetCurrentButton?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' }));
    uiElements.resetAllButtonNew?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES));
    uiElements.clearCurrentButton?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' }));
    uiElements.clearAllButton?.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' }));
}

function setupPanelToggleListeners() {
    uiElements.editRuleButton?.addEventListener('click', () => rulesetEditorComponent?.toggle());
    uiElements.setupPanelButton?.addEventListener('click', () => setupPanelComponent?.toggle());
    uiElements.analysisPanelButton?.addEventListener('click', () => analysisPanelInstance?.toggle());
}

function updatePauseButton(isPaused) { if (uiElements?.playPauseButton) uiElements.playPauseButton.textContent = isPaused ? "[P]lay" : "[P]ause"; }
function updateMainRulesetDisplay(hex) { if (uiElements?.rulesetDisplay) uiElements.rulesetDisplay.textContent = formatHexCode(hex); }

function updateStatsDisplay(stats) {
    if (!stats || !uiElements || stats.worldIndex !== worldManagerInterfaceRef.getSelectedWorldIndex()) {
        // If stats are for a different world or null, clear/default the display for selected world
        if (uiElements.statTick) uiElements.statTick.textContent = '--';
        if (uiElements.statRatio) uiElements.statRatio.textContent = '--';
        if (uiElements.statAvgRatio) uiElements.statAvgRatio.textContent = '--'; // Or keep last known for selected
        return;
    }
    if (uiElements.statTick) uiElements.statTick.textContent = stats.tick !== undefined ? String(stats.tick) : '--';
    if (uiElements.statRatio) uiElements.statRatio.textContent = stats.ratio !== undefined ? (stats.ratio * 100).toFixed(2) : '--';
    if (uiElements.statAvgRatio) uiElements.statAvgRatio.textContent = stats.avgRatio !== undefined ? (stats.avgRatio * 100).toFixed(2) : '--'; // avgRatio needs to be calculated and provided in stats
    else if (uiElements.statAvgRatio) uiElements.statAvgRatio.textContent = 'N/A'; // Placeholder if avgRatio is removed/reworked
}


function handleGlobalKeyDown(event) {
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT' || activeEl.isContentEditable);
    if (isInputFocused && activeEl !== uiElements.rulesetInput) return;

    const keyMap = {
        'P': () => uiElements.playPauseButton?.click(),
        'N': () => uiElements.randomRulesetButton?.click(),
        'R': () => uiElements.resetCurrentButton?.click(),
        'C': () => uiElements.clearCurrentButton?.click(),
        'E': () => rulesetEditorComponent?.toggle(),
        'S': () => setupPanelComponent?.toggle(),
        'A': () => analysisPanelInstance?.toggle(),
    };
    const action = keyMap[event.key.toUpperCase()];
    if (action) {
        action();
        event.preventDefault();
    }
}

function setupUIEventListeners() {
    EventBus.subscribe(EVENTS.SIMULATION_PAUSED, updatePauseButton);
    EventBus.subscribe(EVENTS.SIMULATION_SPEED_CHANGED, speed => sliderComponents.speedSlider?.setValue(speed, false));
    EventBus.subscribe(EVENTS.RULESET_CHANGED, hex => {
        updateMainRulesetDisplay(hex);
        refreshAllRulesetViewsIfOpen();
    });
    EventBus.subscribe(EVENTS.BRUSH_SIZE_CHANGED, size => sliderComponents.neighborhoodSlider?.setValue(size, false));
    EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, updateStatsDisplay);
    EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
        setupPanelComponent?.refreshViews();
        if (worldManagerInterfaceRef) updateStatsDisplay(worldManagerInterfaceRef.getSelectedWorldStats());
    });
    EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => {
        setupPanelComponent?.refreshViews();
        if (worldManagerInterfaceRef) updateMainRulesetDisplay(worldManagerInterfaceRef.getCurrentRulesetHex());
    });
    EventBus.subscribe(EVENTS.PERFORMANCE_METRICS_UPDATED, data => updatePerformanceDisplay(data.fps, data.tps));
    EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, (newIndex) => {
        if (worldManagerInterfaceRef) {
            updateMainRulesetDisplay(worldManagerInterfaceRef.getCurrentRulesetHex());
            updateStatsDisplay(worldManagerInterfaceRef.getSelectedWorldStats());
            refreshAllRulesetViewsIfOpen();
        }
    });
    EventBus.subscribe(EVENTS.TRIGGER_DOWNLOAD, (data) => {
        downloadFile(data.filename, data.content, data.mimeType);
    });
}

export function getUIElements() { return uiElements; }