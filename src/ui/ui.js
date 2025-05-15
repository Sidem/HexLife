// src/ui/ui.js
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js';
import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js';
// DraggablePanel is used internally by other components, not directly here.
import * as PersistenceService from '../services/PersistenceService.js';
import { SliderComponent } from './components/SliderComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { AnalysisPanel } from './components/AnalysisPanel.js';


let uiElements;
let sliderComponents = {};
let simulationInterfaceRef; // This will hold the interface passed from main.js
let rulesetEditorComponent;
let setupPanelComponent;
let analysisPanelInstance;


export function initUI(simulationInterface) { // simulationInterface is passed from main.js
    simulationInterfaceRef = simulationInterface;
    uiElements = {
        canvas: document.getElementById('hexGridCanvas'),
        fileInput: document.getElementById('fileInput'),
        playPauseButton: document.getElementById('playPauseButton'),
        randomRulesetButton: document.getElementById('randomRulesetButton'),
        // generateSymmetricalCheckbox: document.getElementById('generateSymmetricalCheckbox'), // Removed
        generateModeSwitch: document.getElementById('generateModeSwitch'), // Added
        copyRuleButton: document.getElementById('copyRuleButton'),
        rulesetInput: document.getElementById('rulesetInput'),
        setRuleButton: document.getElementById('setRuleButton'),
        rulesetDisplay: document.getElementById('rulesetDisplay'),
        resetOnNewRuleCheckbox: document.getElementById('resetOnNewRuleCheckbox'),
        editRuleButton: document.getElementById('editRuleButton'),
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetStatesButton: document.getElementById('resetStatesButton'),
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
        closeAnalysisPanelButton: document.getElementById('closeAnalysisPanelButton'), // Though handled by Panel
        statEntropy: document.getElementById('stat-entropy'), // Though handled by AnalysisPanel
        // enableEntropySamplingCheckbox: document.getElementById('enableEntropySamplingCheckbox'), // Handled by AnalysisPanel
    };

    uiElements.speedSliderMount = document.getElementById('speedSliderMount');
    uiElements.neighborhoodSizeSliderMount = document.getElementById('neighborhoodSizeSliderMount');
    uiElements.biasSliderMount = document.getElementById('biasSliderMount');
    // uiElements.entropySampleRateSliderMount = document.getElementById('entropySampleRateSliderMount'); // Handled by AnalysisPanel

    if (!validateElements()) return false;

    // Pass the simulationInterfaceRef to components that need it
    if (uiElements.rulesetEditorPanel) {
        rulesetEditorComponent = new RulesetEditor(uiElements.rulesetEditorPanel, simulationInterfaceRef);
    } else {
        console.warn("Ruleset editor panel element not found. Editor functionality will be disabled.");
        if (uiElements.editRuleButton) uiElements.editRuleButton.disabled = true;
    }
    if (uiElements.setupPanel) {
        setupPanelComponent = new SetupPanel(uiElements.setupPanel, simulationInterfaceRef);
    } else {
        console.warn("Setup panel element not found. World setup functionality will be disabled.");
        if (uiElements.setupPanelButton) uiElements.setupPanelButton.disabled = true;
    }

    if (uiElements.analysisPanel) {
        analysisPanelInstance = new AnalysisPanel(uiElements.analysisPanel, simulationInterfaceRef, { /* uiManager: this */ });
    } else {
        console.warn("Analysis panel element not found. Analysis functionality will be disabled.");
        if (uiElements.analysisPanelButton) uiElements.analysisPanelButton.disabled = true;
    }


    sliderComponents.speedSlider = new SliderComponent(uiElements.speedSliderMount, {
        id: 'speedSlider',
        label: 'Speed:',
        min: 1,
        max: Config.MAX_SIM_SPEED,
        step: 1,
        value: simulationInterfaceRef.getCurrentSimulationSpeed(), // Use ref
        unit: 'tps',
        showValue: true,
        onChange: (value) => {
            EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, value);
        }
    });

    sliderComponents.neighborhoodSlider = new SliderComponent(uiElements.neighborhoodSizeSliderMount, {
        id: 'neighborhoodSize',
        label: 'Brush:',
        min: 0,
        max: Config.MAX_NEIGHBORHOOD_SIZE,
        step: 1,
        value: simulationInterfaceRef.getCurrentBrushSize(), // Use ref
        unit: '',
        showValue: true,
        onChange: (value) => {
            EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, value);
        }
    });

    sliderComponents.biasSlider = new SliderComponent(uiElements.biasSliderMount, {
        id: 'biasSlider',
        min: 0,
        max: 1,
        step: 0.001,
        value: PersistenceService.loadUISetting('biasValue', 0.5),
        showValue: true,
        unit: '',
        disabled: !uiElements.useCustomBiasCheckbox.checked, // Initial state
        onChange: (value) => {
            PersistenceService.saveUISetting('biasValue', value);
        }
    });

    setupGeneralListeners(simulationInterfaceRef); // Pass ref
    setupPanelToggleListeners();
    setupStateListeners(simulationInterfaceRef); // Pass ref
    loadAndApplyUISettings(simulationInterfaceRef); // Pass ref
    window.addEventListener('keydown', handleGlobalKeyDown);
    refreshAllRulesetViews(simulationInterfaceRef); // Pass ref
    updateBiasSliderDisabledState(); // Initial check
    setupUIEventListeners(simulationInterfaceRef, uiElements, sliderComponents, rulesetEditorComponent, setupPanelComponent); // Pass ref
    updatePauseButton(simulationInterfaceRef.isSimulationPaused()); // Use ref
    updateMainRulesetDisplay(simulationInterfaceRef.getCurrentRulesetHex()); // Use ref
    updateStatsDisplay(simulationInterfaceRef.getSelectedWorldStats()); // Use ref


    console.log("UI Initialized.");
    return true;
}

function loadAndApplyUISettings(sim) {
    if (sliderComponents.speedSlider) sliderComponents.speedSlider.setValue(sim.getCurrentSimulationSpeed());
    if (sliderComponents.neighborhoodSlider) sliderComponents.neighborhoodSlider.setValue(sim.getCurrentBrushSize());

    // Load and apply generation mode
    const savedGenMode = PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym'); // Default to r_sym
    const genModeRadios = uiElements.generateModeSwitch.querySelectorAll('input[name="generateMode"]');
    genModeRadios.forEach(radio => {
        if (radio.value === savedGenMode) {
            radio.checked = true;
        }
    });

    uiElements.resetOnNewRuleCheckbox.checked = PersistenceService.loadUISetting('resetOnNewRule', true);
    uiElements.useCustomBiasCheckbox.checked = PersistenceService.loadUISetting('useCustomBias', false);
    if (sliderComponents.biasSlider) sliderComponents.biasSlider.setValue(PersistenceService.loadUISetting('biasValue', 0.5));
    updateBiasSliderDisabledState(); // After loading useCustomBiasCheckbox
    uiElements.playPauseButton.textContent = sim.isSimulationPaused() ? "[P]lay" : "[P]ause";
    uiElements.randomRulesetButton.textContent = "[N]ew Rules";
    uiElements.resetStatesButton.textContent = "[R]eset";
    if (uiElements.editRuleButton) uiElements.editRuleButton.textContent = "[E]dit";
    if (uiElements.setupPanelButton) uiElements.setupPanelButton.textContent = "[S]etup";
    if (uiElements.analysisPanelButton) uiElements.analysisPanelButton.textContent = "[A]nalyse";
}

export function updatePerformanceDisplay(fps, actualTps) {
    if (uiElements) {
        if (uiElements.statFps) {
            uiElements.statFps.textContent = fps;
        }
        if (uiElements.statActualTps) {
            uiElements.statActualTps.textContent = actualTps;
        }
    }
}

export function refreshAllRulesetViews(sim) {
    if (!sim) { console.warn("refreshAllRulesetViews called without simulation interface."); return; }
    const currentHex = sim.getCurrentRulesetHex();
    updateMainRulesetDisplay(currentHex);
    if (rulesetEditorComponent && !rulesetEditorComponent.isHidden()) { // Check if panel is visible
         rulesetEditorComponent.refreshViews();
    }
}

function updateBiasSliderDisabledState() {
    if (uiElements.useCustomBiasCheckbox && sliderComponents.biasSlider) {
        const isDisabled = !uiElements.useCustomBiasCheckbox.checked;
        sliderComponents.biasSlider.setDisabled(isDisabled);
    }
}

function validateElements() {
    let allEssentialFound = true;
    for (const key in uiElements) {
        if (!uiElements[key]) {
            // Allow some non-critical elements to be missing, but log them
            const nonCritical = ['closeAnalysisPanelButton', 'statEntropy', 'enableEntropySamplingCheckbox', 'entropySampleRateSliderMount'];
            if (key === 'rulesetEditorPanel' || key === 'setupPanel' || key === 'analysisPanel') {
                console.warn(`UI Warning: Main panel element '${key}' not found. Associated feature will be disabled.`);
            } else if (nonCritical.includes(key)) {
                console.warn(`UI Warning: Optional element '${key}' not found. May affect some AnalysisPanel features if not handled internally by the panel.`);
            } else {
             console.error(`UI Initialization Error: Element with ID '${key}' not found.`);
             // alert(`UI Error: Element '${key}' not found. Check index.html.`); // Too disruptive for optional elements
             allEssentialFound = false; // Only critical elements should make this false
            }
        }
    }
    return allEssentialFound;
}


function setupGeneralListeners(sim) {
    uiElements.playPauseButton.addEventListener('click', () => {
        EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
    });

    // Listener for generation mode switch
    if (uiElements.generateModeSwitch) {
        const genModeRadios = uiElements.generateModeSwitch.querySelectorAll('input[name="generateMode"]');
        genModeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    PersistenceService.saveUISetting('rulesetGenerationMode', radio.value);
                }
            });
        });
    }

    uiElements.resetOnNewRuleCheckbox.addEventListener('change', (e) => PersistenceService.saveUISetting('resetOnNewRule', e.target.checked));
    uiElements.useCustomBiasCheckbox.addEventListener('change', (e) => {
        PersistenceService.saveUISetting('useCustomBias', e.target.checked);
        updateBiasSliderDisabledState();
    });

    // Bias slider listeners are now handled by SliderComponent's internal logic for 'onChange'

    uiElements.randomRulesetButton.addEventListener('click', () => {
        let biasToUse = uiElements.useCustomBiasCheckbox.checked && sliderComponents.biasSlider ? sliderComponents.biasSlider.getValue() : Math.random();
        let selectedMode = 'random'; // Default
        if (uiElements.generateModeSwitch) {
            const checkedRadio = uiElements.generateModeSwitch.querySelector('input[name="generateMode"]:checked');
            if (checkedRadio) {
                selectedMode = checkedRadio.value;
            }
        }
        EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, { bias: biasToUse, generationMode: selectedMode });
        if (uiElements.resetOnNewRuleCheckbox.checked) {
            EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS);
        }
    });

    uiElements.copyRuleButton.addEventListener('click', () => {
        const hex = sim.getCurrentRulesetHex();
        if (!hex || hex === "N/A" || hex === "Error") {
            alert("No ruleset available to copy.");
            return;
        }
        navigator.clipboard.writeText(hex).then(() => {
            const originalText = uiElements.copyRuleButton.textContent;
            uiElements.copyRuleButton.textContent = "Copied!";
            setTimeout(() => { uiElements.copyRuleButton.textContent = originalText; }, 1500);
        }).catch(err => {
            alert('Failed to copy ruleset.');
            console.error('Clipboard copy failed: ', err);
        });
    });

    uiElements.setRuleButton.addEventListener('click', () => {
        const hexString = uiElements.rulesetInput.value.trim().toUpperCase();
        if (!hexString) return;
        if (!/^[0-9A-F]{32}$/.test(hexString)) {
            alert("Invalid Hex Code: Must be 32 hexadecimal characters (0-9, A-F).");
            uiElements.rulesetInput.select();
            return;
        }
        EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, hexString);
        uiElements.rulesetInput.value = '';
        uiElements.rulesetInput.blur();
    });

    uiElements.rulesetInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            uiElements.setRuleButton.click();
        }
    });
}

function setupStateListeners(sim) {
    uiElements.saveStateButton.addEventListener('click', () => {
        const stateData = sim.getWorldStateForSave(sim.getSelectedWorldIndex());
        if (!stateData) {
            alert("Could not get state data for selected world.");
            return;
        }
        let jsonString = JSON.stringify(stateData, null, 2);
        const stateArrayRegex = /("state"\s*:\s*)\[(\s*[\s\S]*?\s*)\]/m;
        jsonString = jsonString.replace(stateArrayRegex, (match, prefix, arrayContent) => {
            const compactArray = arrayContent.replace(/[\r\n]+/g, '').replace(/\s+/g, ' ').trim();
            return `${prefix}[${compactArray}]`;
        });
        const timestamp = new Date().toISOString().replace(/[:.-]/g, '').slice(0, -4);
        const filename = `hex_state_${sim.getCurrentRulesetHex()}_${timestamp}.json`;
        downloadFile(filename, jsonString, 'application/json');
    });

    uiElements.loadStateButton.addEventListener('click', () => {
        uiElements.fileInput.accept = ".txt,.json";
        uiElements.fileInput.click();
    });

    uiElements.fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) { event.target.value = null; return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            try {
                const loadedData = JSON.parse(content);
                if (!loadedData || typeof loadedData.rows !== 'number' || typeof loadedData.cols !== 'number' || !Array.isArray(loadedData.state)) {
                    throw new Error("Invalid state file format.");
                }
                EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, {
                    worldIndex: sim.getSelectedWorldIndex(),
                    loadedData: loadedData
                });
            } catch (error) {
                alert(`Error processing state file: ${error.message}`); console.error("File processing error:", error);
            } finally { event.target.value = null; }
        };
        reader.onerror = (e) => { alert(`Error reading file: ${e.target.error}`); event.target.value = null; };
        reader.readAsText(file);
    });
    uiElements.resetStatesButton.addEventListener('click', () => {
        EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS);
    });
}

function setupPanelToggleListeners() {
     if (uiElements.editRuleButton && rulesetEditorComponent) {
         uiElements.editRuleButton.addEventListener('click', () => {
             rulesetEditorComponent.toggle();
         });
     }
     if (uiElements.setupPanelButton && setupPanelComponent) {
         uiElements.setupPanelButton.addEventListener('click', () => {
             setupPanelComponent.toggle();
         });
     }
    if (uiElements.analysisPanelButton && analysisPanelInstance) {
        uiElements.analysisPanelButton.addEventListener('click', () => {
             analysisPanelInstance.toggle();
        });
    }
}

export function updatePauseButton(isPaused) {
    if (uiElements && uiElements.playPauseButton) {
        uiElements.playPauseButton.textContent = isPaused ? "[P]lay" : "[P]ause";
    }
}

export function updateMainRulesetDisplay(hexCode) {
    if (uiElements && uiElements.rulesetDisplay) {
        uiElements.rulesetDisplay.textContent = formatHexCode(hexCode);
    }
}

export function updateStatsDisplay(statsData) {
    if (!statsData || !uiElements) return;
    if (uiElements.statRatio) {
        uiElements.statRatio.textContent = (statsData.ratio * 100).toFixed(2);
    }
    if (uiElements.statAvgRatio) {
        uiElements.statAvgRatio.textContent = (statsData.avgRatio * 100).toFixed(2);
    }
    // Current entropy display is now handled by AnalysisPanel
}

export function updateBrushSlider(size) { // This function might be redundant if slider updates itself via event
    if (sliderComponents.neighborhoodSlider) {
        sliderComponents.neighborhoodSlider.setValue(size);
    }
}
export function updateSpeedSlider(speed) { // This function might be redundant
    if (sliderComponents.speedSlider) {
        sliderComponents.speedSlider.setValue(speed);
    }
}

function handleGlobalKeyDown(event) {
    const activeEl = document.activeElement;
    if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        const isInputElement = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
        const isContentEditable = activeEl.isContentEditable;
        // Special case for ruleset editor input still needs to be handled if it's a direct child of uiElements
        const isRulesetEditorHexInput = rulesetEditorComponent && rulesetEditorComponent.uiElements.editorRulesetInput === activeEl;

        if (event.key === 'Enter' && isRulesetEditorHexInput) {
            // Let RulesetEditor handle its Enter key press
        } else if (isInputElement || isContentEditable) {
            return; // Ignore global keybinds if typing in an input field
        }
    }

    switch (event.key.toUpperCase()) {
        case 'P': uiElements.playPauseButton?.click(); event.preventDefault(); break;
        case 'N': uiElements.randomRulesetButton?.click(); event.preventDefault(); break;
        case 'R': uiElements.resetStatesButton?.click(); event.preventDefault(); break;
        case 'E': rulesetEditorComponent?.toggle(); event.preventDefault(); break;
        case 'S': setupPanelComponent?.toggle(); event.preventDefault(); break;
        case 'A': analysisPanelInstance?.toggle(); event.preventDefault(); break;
    }
}

function setupUIEventListeners(simulationInterface, uiElements, sliderComponents, rulesetEditorComponent, setupPanelComponent) {
    // EventBus.subscribe(EVENTS.SIMULATION_STARTED, () => { // This event is not currently dispatched
    //     uiElements.playPauseButton.textContent = '[P]ause';
    // });
    EventBus.subscribe(EVENTS.SIMULATION_PAUSED, (isPaused) => {
        updatePauseButton(isPaused);
    });
    EventBus.subscribe(EVENTS.SIMULATION_SPEED_CHANGED, (newSpeed) => {
        if (sliderComponents.speedSlider) sliderComponents.speedSlider.setValue(newSpeed, false); // false to prevent re-dispatch
    });
    EventBus.subscribe(EVENTS.RULESET_CHANGED, (newRulesetHex) => {
        updateMainRulesetDisplay(newRulesetHex);
        if (rulesetEditorComponent && !rulesetEditorComponent.isHidden()) { // Only refresh if visible
            rulesetEditorComponent.refreshViews();
        }
    });
    EventBus.subscribe(EVENTS.BRUSH_SIZE_CHANGED, (newBrushSize) => {
        if (sliderComponents.neighborhoodSlider) sliderComponents.neighborhoodSlider.setValue(newBrushSize, false); // false to prevent re-dispatch
    });
    EventBus.subscribe(EVENTS.SELECTED_WORLD_CHANGED, (newWorldIndex) => {
        // console.log("UI: Selected world changed to", newWorldIndex); // Handled by main.js for hover/click, stats updated by WORLD_STATS_UPDATED
    });
    EventBus.subscribe(EVENTS.WORLD_STATS_UPDATED, (statsData) => {
        updateStatsDisplay(statsData);
        // AnalysisPanel also subscribes to this for its internal updates
    });
    EventBus.subscribe(EVENTS.ALL_WORLDS_RESET, () => {
        if (setupPanelComponent && !setupPanelComponent.isHidden()) {
            setupPanelComponent.refreshViews();
        }
        // AnalysisPanel also subscribes
    });
    EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, (worldSettings) => {
        if (setupPanelComponent && !setupPanelComponent.isHidden()) {
            setupPanelComponent.refreshViews();
        }
    });
    EventBus.subscribe(EVENTS.PERFORMANCE_METRICS_UPDATED, (data) => {
        updatePerformanceDisplay(data.fps, data.tps);
    });
    // EventBus.subscribe(EVENTS.RULESET_LOADED, (newRuleset) => { // This event is not currently dispatched by simulation.js
    //     if (rulesetEditorComponent) {
    //         // rulesetEditorComponent.loadRuleset(newRuleset); // RulesetEditor directly uses simInterface.getCurrentRulesetArray()
    //         rulesetEditorComponent.refreshViews();
    //     }
    // });
    EventBus.subscribe(EVENTS.ENTROPY_SAMPLING_CHANGED, (samplingData) => {
        // This is handled by AnalysisPanel directly
    });

}

export function getUIElements() { // For debugging or external access if ever needed
    return uiElements;
}

export function getAnalysisPanelInstance() { // For potential external interaction, e.g., by a GA module
    return analysisPanelInstance;
}