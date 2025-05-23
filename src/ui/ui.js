
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js';
import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js';
import { AnalysisPanel } from './components/AnalysisPanel.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { SliderComponent } from './components/SliderComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { PopoutPanel } from './components/PopoutPanel.js'; 

let uiElements;
let sliderComponents = {}; 
let popoutPanels = {};    
let worldManagerInterfaceRef;
let rulesetEditorComponent, setupPanelComponent, analysisPanelInstance;


let activePopouts = [];

function closeAllPopouts(excludePanel = null) {
    activePopouts.forEach(popout => {
        if (popout !== excludePanel) {
            popout.hide();
        }
    });
}
document.addEventListener('popoutinteraction', (event) => {
    closeAllPopouts(event.detail.panel);
});


export function initUI(worldManagerInterface) {
    worldManagerInterfaceRef = worldManagerInterface;
    
    uiElements = {
        
        rulesetDisplay: document.getElementById('rulesetDisplay'),
        statTick: document.getElementById('stat-tick'),
        statRatio: document.getElementById('stat-ratio'),
        
        statFps: document.getElementById('stat-fps'),
        statActualTps: document.getElementById('stat-actual-tps'),

        
        playPauseButton: document.getElementById('playPauseButton'),
        speedControlButton: document.getElementById('speedControlButton'),
        brushToolButton: document.getElementById('brushToolButton'),
        newRulesButton: document.getElementById('newRulesButton'),
        setRulesetButton: document.getElementById('setRulesetButton'), 
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetClearButton: document.getElementById('resetClearButton'), 
        editRuleButton: document.getElementById('editRuleButton'), 
        setupPanelButton: document.getElementById('setupPanelButton'), 
        analysisPanelButton: document.getElementById('analysisPanelButton'), 

        
        speedPopout: document.getElementById('speedPopout'),
        brushPopout: document.getElementById('brushPopout'),
        newRulesPopout: document.getElementById('newRulesPopout'),
        setHexPopout: document.getElementById('setHexPopout'),
        resetClearPopout: document.getElementById('resetClearPopout'),

        
        speedSliderMountPopout: document.getElementById('speedSliderMountPopout'),
        neighborhoodSizeSliderMountPopout: document.getElementById('neighborhoodSizeSliderMountPopout'),
        generateModeSwitchPopout: document.getElementById('generateModeSwitchPopout'),
        useCustomBiasCheckboxPopout: document.getElementById('useCustomBiasCheckboxPopout'),
        biasSliderMountPopout: document.getElementById('biasSliderMountPopout'),
        rulesetScopeSwitchPopout: document.getElementById('rulesetScopeSwitchPopout'), 
        resetOnNewRuleCheckboxPopout: document.getElementById('resetOnNewRuleCheckboxPopout'),
        generateRulesetFromPopoutButton: document.getElementById('generateRulesetFromPopoutButton'),
        rulesetInputPopout: document.getElementById('rulesetInputPopout'),
        setRuleFromPopoutButton: document.getElementById('setRuleFromPopoutButton'),
        copyRuleFromPopoutButton: document.getElementById('copyRuleFromPopoutButton'),
        resetCurrentButtonPopout: document.getElementById('resetCurrentButtonPopout'),
        resetAllButtonPopout: document.getElementById('resetAllButtonPopout'),
        clearCurrentButtonPopout: document.getElementById('clearCurrentButtonPopout'),
        clearAllButtonPopout: document.getElementById('clearAllButtonPopout'),
        
        
        editorRulesetInput: document.getElementById('editorRulesetInput'),

        
        rulesetEditorPanel: document.getElementById('rulesetEditorPanel'),
        setupPanel: document.getElementById('setupPanel'),
        analysisPanel: document.getElementById('analysisPanel'),

        
        fileInput: document.getElementById('fileInput'), 
        canvas: document.getElementById('hexGridCanvas'), 
    };

    if (!validateElements()) return false;

    
    if (uiElements.rulesetEditorPanel) rulesetEditorComponent = new RulesetEditor(uiElements.rulesetEditorPanel, worldManagerInterfaceRef);
    if (uiElements.setupPanel) setupPanelComponent = new SetupPanel(uiElements.setupPanel, worldManagerInterfaceRef);
    if (uiElements.analysisPanel) analysisPanelInstance = new AnalysisPanel(uiElements.analysisPanel, worldManagerInterfaceRef, {});

    _initPopoutPanels();
    _initPopoutControls();
    _setupToolbarButtonListeners();
    _setupStateListeners(); 
    
    loadAndApplyUISettings(); 
    window.addEventListener('keydown', handleGlobalKeyDown); 
    setupUIEventListeners(); 

    updatePauseButtonVisual(worldManagerInterfaceRef.isSimulationPaused());
    updateMainRulesetDisplay(worldManagerInterfaceRef.getCurrentRulesetHex());
    updateStatsDisplay(worldManagerInterfaceRef.getSelectedWorldStats());

    console.log("New Toolbar UI Initialized.");
    return true;
}

function validateElements() {
    const critical = [
        'rulesetDisplay', 'statTick', 'statRatio', 'statFps', 'statActualTps',
        'playPauseButton', 'speedControlButton', 'brushToolButton', 'newRulesButton',
        'setRulesetButton', 'saveStateButton', 'loadStateButton', 'resetClearButton',
        'editRuleButton', 'setupPanelButton', 'analysisPanelButton',
        'speedPopout', 'brushPopout', 'newRulesPopout', 'setHexPopout', 'resetClearPopout',
        'rulesetEditorPanel', 'setupPanel', 'analysisPanel', 'fileInput', 'canvas'
    ];
    let allFound = true;
    critical.forEach(key => {
        if (!uiElements[key]) {
            console.error(`UI Rework Error: Critical Element '${key}' not found in HTML.`);
            allFound = false;
        }
    });
    
    const popoutControls = [
        'speedSliderMountPopout', 'neighborhoodSizeSliderMountPopout', 'generateModeSwitchPopout',
        'useCustomBiasCheckboxPopout', 'biasSliderMountPopout', 'rulesetScopeSwitchPopout',
        'resetOnNewRuleCheckboxPopout', 'generateRulesetFromPopoutButton', 'rulesetInputPopout',
        'setRuleFromPopoutButton', 'copyRuleFromPopoutButton', 'resetCurrentButtonPopout',
        'resetAllButtonPopout', 'clearCurrentButtonPopout', 'clearAllButtonPopout'
    ];
     popoutControls.forEach(key => {
        if (!uiElements[key]) {
            console.warn(`UI Rework Warning: Popout control Element '${key}' not found. Might affect functionality.`);
            
        }
    });
    return allFound;
}

function _initPopoutPanels() {
    popoutPanels.speed = new PopoutPanel(uiElements.speedPopout, uiElements.speedControlButton, { position: 'right', alignment: 'start'});
    popoutPanels.brush = new PopoutPanel(uiElements.brushPopout, uiElements.brushToolButton, { position: 'right', alignment: 'start'});
    popoutPanels.newRules = new PopoutPanel(uiElements.newRulesPopout, uiElements.newRulesButton, { position: 'right', alignment: 'start', offset: 5});
    popoutPanels.setHex = new PopoutPanel(uiElements.setHexPopout, uiElements.setRulesetButton, { position: 'right', alignment: 'start', offset: 5 });
    popoutPanels.resetClear = new PopoutPanel(uiElements.resetClearPopout, uiElements.resetClearButton, { position: 'right', alignment: 'start', offset: 5 });
    
    activePopouts = Object.values(popoutPanels);
}

function _initPopoutControls() {
    
    sliderComponents.speedSliderPopout = new SliderComponent(uiElements.speedSliderMountPopout, {
        id: 'speedSliderPopout', min: 1, max: Config.MAX_SIM_SPEED, step: 1,
        value: worldManagerInterfaceRef.getCurrentSimulationSpeed(), unit: 'tps', showValue: true,
        onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, val)
    });

    
    sliderComponents.neighborhoodSliderPopout = new SliderComponent(uiElements.neighborhoodSizeSliderMountPopout, {
        id: 'brushSliderPopout', min: 0, max: Config.MAX_NEIGHBORHOOD_SIZE, step: 1,
        value: worldManagerInterfaceRef.getCurrentBrushSize(), unit: '', showValue: true,
        onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, val)
    });

    
    uiElements.generateModeSwitchPopout.querySelectorAll('input[name="generateModePopout"]').forEach(r => {
        r.addEventListener('change', () => { if (r.checked) PersistenceService.saveUISetting('rulesetGenerationMode', r.value); });
    });
    uiElements.useCustomBiasCheckboxPopout.addEventListener('change', e => {
        PersistenceService.saveUISetting('useCustomBias', e.target.checked);
        updateBiasSliderDisabledStatePopout();
    });
    sliderComponents.biasSliderPopout = new SliderComponent(uiElements.biasSliderMountPopout, {
        id: 'biasSliderPopout', min: 0, max: 1, step: 0.001, value: PersistenceService.loadUISetting('biasValue', 0.5),
        showValue: true, unit: '', disabled: !uiElements.useCustomBiasCheckboxPopout.checked,
        onChange: val => PersistenceService.saveUISetting('biasValue', val)
    });
    uiElements.rulesetScopeSwitchPopout.querySelectorAll('input[name="rulesetScopePopout"]').forEach(r => {
        r.addEventListener('change', () => { if (r.checked) PersistenceService.saveUISetting('globalRulesetScopeAll', r.value === 'all'); });
    });
    uiElements.resetOnNewRuleCheckboxPopout.addEventListener('change', e => PersistenceService.saveUISetting('resetOnNewRule', e.target.checked));
    uiElements.generateRulesetFromPopoutButton.addEventListener('click', () => {
        const bias = uiElements.useCustomBiasCheckboxPopout.checked ? sliderComponents.biasSliderPopout.getValue() : Math.random();
        const mode = uiElements.generateModeSwitchPopout.querySelector('input[name="generateModePopout"]:checked')?.value || 'random';
        const targetScopeRadio = uiElements.rulesetScopeSwitchPopout.querySelector('input[name="rulesetScopePopout"]:checked');
        const targetScope = targetScopeRadio ? targetScopeRadio.value : 'selected';


        EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
            bias,
            generationMode: mode,
            resetScopeForThisChange: uiElements.resetOnNewRuleCheckboxPopout.checked ? targetScope : 'none'
        });
        
    });

    
    uiElements.setRuleFromPopoutButton.addEventListener('click', () => {
        const hex = uiElements.rulesetInputPopout.value.trim().toUpperCase();
        if (!hex || !/^[0-9A-F]{32}$/.test(hex)) {
            alert("Invalid Hex: Must be 32 hex chars."); uiElements.rulesetInputPopout.select(); return;
        }
        const targetScopeRadio = uiElements.rulesetScopeSwitchPopout.querySelector('input[name="rulesetScopePopout"]:checked'); 
        const targetScope = targetScopeRadio ? targetScopeRadio.value : 'selected';

        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
            hexString: hex,
            resetScopeForThisChange: uiElements.resetOnNewRuleCheckboxPopout.checked ? targetScope : 'none' 
        });
        uiElements.rulesetInputPopout.value = ''; 
        popoutPanels.setHex.hide();
    });
    uiElements.rulesetInputPopout.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); uiElements.setRuleFromPopoutButton.click(); }});
    uiElements.copyRuleFromPopoutButton.addEventListener('click', () => {
        const hex = worldManagerInterfaceRef.getCurrentRulesetHex();
        if (!hex || hex === "N/A" || hex === "Error") { alert("No ruleset for selected world to copy."); return; }
        navigator.clipboard.writeText(hex).then(() => {
            const oldTxt = uiElements.copyRuleFromPopoutButton.textContent;
            uiElements.copyRuleFromPopoutButton.textContent = "Copied!";
            setTimeout(() => uiElements.copyRuleFromPopoutButton.textContent = oldTxt, 1500);
        }).catch(err => alert('Failed to copy ruleset hex.'));
    });
    
    
    uiElements.resetCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' }); popoutPanels.resetClear.hide(); });
    uiElements.resetAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES); popoutPanels.resetClear.hide(); });
    uiElements.clearCurrentButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' }); popoutPanels.resetClear.hide(); });
    uiElements.clearAllButtonPopout.addEventListener('click', () => { EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'all' }); popoutPanels.resetClear.hide(); });
}

function _setupToolbarButtonListeners() {
    uiElements.playPauseButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE));
    
    uiElements.editRuleButton?.addEventListener('click', () => rulesetEditorComponent?.toggle());
    uiElements.setupPanelButton?.addEventListener('click', () => setupPanelComponent?.toggle());
    uiElements.analysisPanelButton?.addEventListener('click', () => analysisPanelInstance?.toggle());
    
    uiElements.loadStateButton.addEventListener('click', () => { uiElements.fileInput.accept = ".txt,.json"; uiElements.fileInput.click(); });
    uiElements.saveStateButton.addEventListener('click', () => EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE));
}

function _setupStateListeners() { 
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
}

function loadAndApplyUISettings() {
    
    sliderComponents.speedSliderPopout?.setValue(worldManagerInterfaceRef.getCurrentSimulationSpeed());
    sliderComponents.neighborhoodSliderPopout?.setValue(worldManagerInterfaceRef.getCurrentBrushSize());
    
    const genMode = PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym');
    uiElements.generateModeSwitchPopout.querySelectorAll('input[name="generateModePopout"]').forEach(r => r.checked = r.value === genMode);
    
    uiElements.useCustomBiasCheckboxPopout.checked = PersistenceService.loadUISetting('useCustomBias', false);
    sliderComponents.biasSliderPopout?.setValue(PersistenceService.loadUISetting('biasValue', 0.5));
    updateBiasSliderDisabledStatePopout();

    const scopeAll = PersistenceService.loadUISetting('globalRulesetScopeAll', false); 
    uiElements.rulesetScopeSwitchPopout.querySelector(`input[value="${scopeAll ? 'all' : 'selected'}"]`).checked = true;
    
    uiElements.resetOnNewRuleCheckboxPopout.checked = PersistenceService.loadUISetting('resetOnNewRule', true);

    updatePauseButtonVisual(worldManagerInterfaceRef.isSimulationPaused());
}

function updateBiasSliderDisabledStatePopout() {
    sliderComponents.biasSliderPopout?.setDisabled(!uiElements.useCustomBiasCheckboxPopout.checked);
}

function updatePauseButtonVisual(isPaused) { 
    if (uiElements?.playPauseButton) {
        uiElements.playPauseButton.textContent = isPaused ? "▶" : "❚❚"; 
        uiElements.playPauseButton.title = isPaused ? "[P]lay Simulation" : "[P]ause Simulation";
    }
}
function updateMainRulesetDisplay(hex) { 
    if (uiElements?.rulesetDisplay) {
        uiElements.rulesetDisplay.textContent = formatHexCode(hex); 
    }
}

function updateStatsDisplay(stats) {
    if (!stats || !uiElements) return;

    if (stats.worldIndex !== undefined && stats.worldIndex !== worldManagerInterfaceRef.getSelectedWorldIndex()) {
      
      
      return;
    }
    
    uiElements.statTick.textContent = stats.tick !== undefined ? String(stats.tick) : '--';
    uiElements.statRatio.textContent = stats.ratio !== undefined ? (stats.ratio * 100).toFixed(2) : '--';
    
    
}

function updatePerformanceDisplay(fps, tpsOfSelectedWorld) {
    if (uiElements?.statFps) uiElements.statFps.textContent = fps !== undefined ? String(fps) : '--';
    if (uiElements?.statActualTps) uiElements.statActualTps.textContent = tpsOfSelectedWorld !== undefined ? String(tpsOfSelectedWorld) : '--';
}


function handleGlobalKeyDown(event) {
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.tagName === 'SELECT' || 
        activeEl.isContentEditable
    );
    
    if (isInputFocused && activeEl !== uiElements.rulesetInputPopout && activeEl !== uiElements.editorRulesetInput) {
         
        if (activeEl.closest('.popout-panel') || activeEl.closest('.draggable-panel-base')) {
            
             if (event.key === "Escape") { 
                closeAllPopouts();
                
                if (rulesetEditorComponent && !rulesetEditorComponent.isHidden()) rulesetEditorComponent.hide();
                else if (setupPanelComponent && !setupPanelComponent.isHidden()) setupPanelComponent.hide();
                else if (analysisPanelInstance && !analysisPanelInstance.isHidden()) analysisPanelInstance.hide();
             }
            return;
        }
    }


    
    
    if (isInputFocused && (activeEl === uiElements.rulesetInputPopout || activeEl === uiElements.editorRulesetInput)) {
        if (event.key === "Escape") {
            activeEl.blur(); 
            
            if (activeEl === uiElements.rulesetInputPopout) popoutPanels.setHex.hide();
        }
        return; 
    }


    const keyMap = {
        'P': () => uiElements.playPauseButton?.click(),
        'N': () => { closeAllPopouts(); popoutPanels.newRules?.toggle(); },
        'E': () => { closeAllPopouts(); rulesetEditorComponent?.toggle(); },
        'S': () => { closeAllPopouts(); setupPanelComponent?.toggle(); },
        'A': () => { closeAllPopouts(); analysisPanelInstance?.toggle(); },
        'Escape': () => { 
            let aPopoutWasOpen = false;
            activePopouts.forEach(p => { if (!p.isHidden()) { p.hide(); aPopoutWasOpen = true; }});
            if (!aPopoutWasOpen) { 
                if (rulesetEditorComponent && !rulesetEditorComponent.isHidden()) rulesetEditorComponent.hide();
                else if (setupPanelComponent && !setupPanelComponent.isHidden()) setupPanelComponent.hide();
                else if (analysisPanelInstance && !analysisPanelInstance.isHidden()) analysisPanelInstance.hide();
            }
        }
        
    };
    const action = keyMap[event.key.toUpperCase()] || keyMap[event.key]; 
    if (action) {
        action();
        event.preventDefault();
    }
}

function setupUIEventListeners() {
    EventBus.subscribe(EVENTS.SIMULATION_PAUSED, updatePauseButtonVisual);
    EventBus.subscribe(EVENTS.SIMULATION_SPEED_CHANGED, speed => sliderComponents.speedSliderPopout?.setValue(speed, false));
    EventBus.subscribe(EVENTS.RULESET_CHANGED, hex => {
        updateMainRulesetDisplay(hex);
        
        if (rulesetEditorComponent && !rulesetEditorComponent.isHidden()) {
            if (document.activeElement !== uiElements.editorRulesetInput) {
                uiElements.editorRulesetInput.value = (hex === "Error" || hex === "N/A") ? "" : hex;
            }
            rulesetEditorComponent.refreshViews(); 
        }
        if (uiElements.rulesetInputPopout && document.activeElement !== uiElements.rulesetInputPopout) {
             uiElements.rulesetInputPopout.value = (hex === "Error" || hex === "N/A") ? "" : hex;
        }
    });
    EventBus.subscribe(EVENTS.BRUSH_SIZE_CHANGED, size => sliderComponents.neighborhoodSliderPopout?.setValue(size, false));
    EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, updateStatsDisplay); 
    EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
        setupPanelComponent?.refreshViews(); 
        if (worldManagerInterfaceRef) updateStatsDisplay(worldManagerInterfaceRef.getSelectedWorldStats());
    });
    EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => { 
        setupPanelComponent?.refreshViews();
        if (worldManagerInterfaceRef) { 
             updateMainRulesetDisplay(worldManagerInterfaceRef.getCurrentRulesetHex());
        }
    });
    EventBus.subscribe(EVENTS.PERFORMANCE_METRICS_UPDATED, data => updatePerformanceDisplay(data.fps, data.tps));
    EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, (newIndex) => {
        if (worldManagerInterfaceRef) {
            updateMainRulesetDisplay(worldManagerInterfaceRef.getCurrentRulesetHex());
            updateStatsDisplay(worldManagerInterfaceRef.getSelectedWorldStats());
            if (rulesetEditorComponent && !rulesetEditorComponent.isHidden()) rulesetEditorComponent.refreshViews();
            if (analysisPanelInstance && !analysisPanelInstance.isHidden()) analysisPanelInstance.refreshViews();

        }
    });
    EventBus.subscribe(EVENTS.TRIGGER_DOWNLOAD, (data) => {
        downloadFile(data.filename, data.content, data.mimeType);
    });
}


export function getUIElements() { return uiElements; }
