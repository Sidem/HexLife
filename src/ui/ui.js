// hexlife00/src/ui/ui.js
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js';
import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js'; // Import the new SetupPanel

// --- DOM Element References ---
let uiElements;

// --- UI State ---
let simulationInterfaceRef;
let rulesetEditorComponent;
let setupPanelComponent; // Reference to the SetupPanel instance

// --- localStorage Helper for UI settings ---
function _saveUISetting(key, value) {
    try {
        const allUISettings = JSON.parse(localStorage.getItem(Config.LS_KEY_UI_SETTINGS)) || {};
        allUISettings[key] = value;
        localStorage.setItem(Config.LS_KEY_UI_SETTINGS, JSON.stringify(allUISettings));
    } catch (e) {
        console.error(`Error saving UI setting (key: ${key}):`, e);
    }
}

function _loadUISetting(key, defaultValue) {
    try {
        const allUISettings = JSON.parse(localStorage.getItem(Config.LS_KEY_UI_SETTINGS));
        if (allUISettings && allUISettings[key] !== undefined) {
            return allUISettings[key];
        }
    } catch (e) {
        console.error(`Error loading UI setting (key: ${key}):`, e);
    }
    return defaultValue;
}


// --- Initialization ---
export function initUI(simulationInterface) {
    simulationInterfaceRef = simulationInterface;
    uiElements = {
        canvas: document.getElementById('hexGridCanvas'),
        fileInput: document.getElementById('fileInput'),
        playPauseButton: document.getElementById('playPauseButton'),
        speedSlider: document.getElementById('speedSlider'),
        speedValueSpan: document.getElementById('speedValue'),
        neighborhoodSlider: document.getElementById('neighborhoodSize'),
        neighborhoodValueSpan: document.getElementById('neighborhoodValue'),
        randomRulesetButton: document.getElementById('randomRulesetButton'),
        generateSymmetricalCheckbox: document.getElementById('generateSymmetricalCheckbox'),
        copyRuleButton: document.getElementById('copyRuleButton'),
        rulesetInput: document.getElementById('rulesetInput'),
        setRuleButton: document.getElementById('setRuleButton'),
        rulesetDisplay: document.getElementById('rulesetDisplay'),
        resetOnNewRuleCheckbox: document.getElementById('resetOnNewRuleCheckbox'),
        editRuleButton: document.getElementById('editRuleButton'),
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetStatesButton: document.getElementById('resetStatesButton'),
        setupPanelButton: document.getElementById('setupPanelButton'), // New button
        statRatio: document.getElementById('stat-ratio'),
        statAvgRatio: document.getElementById('stat-avg-ratio'),
        rulesetEditorPanel: document.getElementById('rulesetEditorPanel'),
        setupPanel: document.getElementById('setupPanel'), // New panel element
        useCustomBiasCheckbox: document.getElementById('useCustomBiasCheckbox'),
        biasSlider: document.getElementById('biasSlider'),
        biasValueSpan: document.getElementById('biasValueSpan'),
        statFps: document.getElementById('stat-fps'),
        statActualTps: document.getElementById('stat-actual-tps'),
    };

    if (!validateElements()) return false;

    // Instantiate Components
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

    setupGeneralListeners(simulationInterface); // Renamed for clarity
    setupPanelToggleListeners();
    setupStateListeners(simulationInterface);

    // Initial UI setup from localStorage or defaults
    loadAndApplyUISettings(simulationInterface);


    window.addEventListener('keydown', handleGlobalKeyDown);
    refreshAllRulesetViews(simulationInterfaceRef); // Initial display
    console.log("UI Initialized.");
    return true;
}

function loadAndApplyUISettings(sim) {
    // Speed
    const loadedSpeed = sim.getCurrentSimulationSpeed(); // Simulation now loads its own speed
    uiElements.speedSlider.max = Config.MAX_SIM_SPEED;
    uiElements.speedSlider.value = loadedSpeed;
    uiElements.speedValueSpan.textContent = loadedSpeed;

    // Brush Size
    const loadedBrushSize = sim.getCurrentBrushSize(); // Simulation now loads its own brush size
    uiElements.neighborhoodSlider.max = Config.MAX_NEIGHBORHOOD_SIZE;
    uiElements.neighborhoodSlider.min = 0;
    uiElements.neighborhoodSlider.value = loadedBrushSize;
    uiElements.neighborhoodValueSpan.textContent = loadedBrushSize;

    // Checkboxes & Bias
    uiElements.generateSymmetricalCheckbox.checked = _loadUISetting('generateSymmetrical', true);
    uiElements.resetOnNewRuleCheckbox.checked = _loadUISetting('resetOnNewRule', true);
    uiElements.useCustomBiasCheckbox.checked = _loadUISetting('useCustomBias', false);
    uiElements.biasSlider.value = _loadUISetting('biasValue', 0.5);
    uiElements.biasValueSpan.textContent = parseFloat(uiElements.biasSlider.value).toFixed(3);
    updateBiasSliderDisabledState();

    // Button texts (static, but set here for consistency)
    uiElements.playPauseButton.textContent = "[P]lay"; // Will be updated by pause state
    uiElements.randomRulesetButton.textContent = "[N]ew Rules";
    uiElements.resetStatesButton.textContent = "[R]eset"; // Matched HTML more closely
    if (uiElements.editRuleButton) uiElements.editRuleButton.textContent = "[E]dit";
    if (uiElements.setupPanelButton) uiElements.setupPanelButton.textContent = "[S]etup";
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
    if (rulesetEditorComponent) rulesetEditorComponent.refreshViews();
    // Setup panel doesn't typically need refresh on ruleset change, but on show.
}

function updateBiasSliderDisabledState() {
    if (uiElements.useCustomBiasCheckbox && uiElements.biasSlider) {
        const isDisabled = !uiElements.useCustomBiasCheckbox.checked;
        uiElements.biasSlider.disabled = isDisabled;
        // Also visually indicate disabled state for the span if desired
        if (uiElements.biasValueSpan) {
            uiElements.biasValueSpan.style.opacity = isDisabled ? '0.5' : '1';
        }
    }
}

function validateElements() {
    let allEssentialFound = true;
    for (const key in uiElements) {
        if (!uiElements[key]) {
            // RulesetEditorPanel is handled separately now for component instantiation
            if (key === 'rulesetEditorPanel') {
                console.warn(`UI Warning: Main panel element '${key}' not found. Editor feature will be disabled.`);
            } else {
                console.error(`UI Initialization Error: Element with ID '${key}' not found.`);
            alert(`UI Error: Element '${key}' not found. Check index.html.`);
            allEssentialFound = false;
            }
        }
    }
    return allEssentialFound;
}


function handleSliderWheel(event, sliderElement, valueSpanElement, simulationUpdateFunction, isBias = false) {
    event.preventDefault();
    const slider = sliderElement;
    const step = parseFloat(slider.step) || 1;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    let currentValue = parseFloat(slider.value);

    if (event.deltaY < 0) { currentValue += step; }
    else { currentValue -= step; }

    currentValue = Math.max(min, Math.min(max, currentValue));

    if (isBias) { // Check if it's the bias slider
        currentValue = parseFloat(currentValue.toFixed(3));
    } else {
        currentValue = Math.round(currentValue / step) * step;
    }
    slider.value = currentValue;

    if (valueSpanElement) {
        valueSpanElement.textContent = isBias ? currentValue.toFixed(3) : currentValue;
    }
    if (simulationUpdateFunction) simulationUpdateFunction(currentValue);
    else if (isBias) _saveUISetting('biasValue', currentValue); // Save bias if no direct sim update

    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    slider.dispatchEvent(inputEvent);
}

function setupGeneralListeners(sim) { // Renamed from setupControlListeners
    uiElements.playPauseButton.addEventListener('click', () => {
        const nowPaused = sim.togglePause();
        updatePauseButton(nowPaused);
    });

    // Checkbox Listeners for localStorage
    uiElements.generateSymmetricalCheckbox.addEventListener('change', (e) => _saveUISetting('generateSymmetrical', e.target.checked));
    uiElements.resetOnNewRuleCheckbox.addEventListener('change', (e) => _saveUISetting('resetOnNewRule', e.target.checked));
    uiElements.useCustomBiasCheckbox.addEventListener('change', (e) => {
        _saveUISetting('useCustomBias', e.target.checked);
        updateBiasSliderDisabledState();
    });

    if (uiElements.biasSlider) {
        uiElements.biasSlider.addEventListener('input', (event) => {
           const val = parseFloat(event.target.value);
           if(uiElements.biasValueSpan) uiElements.biasValueSpan.textContent = val.toFixed(3);
           _saveUISetting('biasValue', val);
        });
        uiElements.biasSlider.addEventListener('wheel', (event) => {
            if (uiElements.biasSlider.disabled) return;
            handleSliderWheel(event, uiElements.biasSlider, uiElements.biasValueSpan, null, true); // true for isBias
        });
    }

    uiElements.speedSlider.addEventListener('input', (event) => {
        const speed = parseInt(event.target.value, 10);
        sim.setSpeed(speed); // This now saves to LS via simulation.js
        uiElements.speedValueSpan.textContent = speed;
    });
    uiElements.speedSlider.addEventListener('wheel', (event) => {
        handleSliderWheel(event, uiElements.speedSlider, uiElements.speedValueSpan, sim.setSpeed);
    });

    uiElements.neighborhoodSlider.addEventListener('input', (event) => {
        const size = parseInt(event.target.value, 10);
        sim.setBrushSize(size); // This now saves to LS via simulation.js
        uiElements.neighborhoodValueSpan.textContent = size;
    });
    uiElements.neighborhoodSlider.addEventListener('wheel', (event) => {
        handleSliderWheel(event, uiElements.neighborhoodSlider, uiElements.neighborhoodValueSpan, sim.setBrushSize);
    });

    // --- Ruleset (non-editor) controls ---
    uiElements.randomRulesetButton.addEventListener('click', () => {
        let biasToUse = uiElements.useCustomBiasCheckbox.checked ? parseFloat(uiElements.biasSlider.value) : Math.random();
        const generateSymmetrically = uiElements.generateSymmetricalCheckbox.checked;
        sim.generateRandomRuleset(biasToUse, generateSymmetrically); // Saves LS in sim.js
        refreshAllRulesetViews(sim);
        if (uiElements.resetOnNewRuleCheckbox.checked) sim.resetAllWorldsToCurrentSettings();
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
        const success = sim.setRuleset(hexString);
        if (success) {
            uiElements.rulesetInput.value = '';
            uiElements.rulesetInput.blur();
        } else {
            alert("Error setting ruleset. Please check the code.");
            uiElements.rulesetInput.select();
        }
        refreshAllRulesetViews(sim);
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
        const jsonString = JSON.stringify(stateData, null, 2);
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
                const success = sim.loadWorldState(sim.getSelectedWorldIndex(), loadedData); // Sim handles LS updates
                if (success) {
                    updatePauseButton(sim.isSimulationPaused());
                    refreshAllRulesetViews(sim);
                }
            } catch (error) {
                alert(`Error processing state file: ${error.message}`); console.error("File processing error:", error);
            } finally { event.target.value = null; }
        };
        reader.onerror = (e) => { alert(`Error reading file: ${e.target.error}`); event.target.value = null; };
        reader.readAsText(file);
    });
    uiElements.resetStatesButton.addEventListener('click', () => sim.resetAllWorldsToCurrentSettings());
}

function setupPanelToggleListeners() { // Renamed from setupEditorListeners
    if (uiElements.editRuleButton && rulesetEditorComponent) {
        uiElements.editRuleButton.addEventListener('click', () => {
            rulesetEditorComponent.show();
        });
    }
    if (uiElements.setupPanelButton && setupPanelComponent) { // Listener for the new Setup Panel button
        uiElements.setupPanelButton.addEventListener('click', () => {
            setupPanelComponent.show();
        });
    }
}

// --- UI Update Functions ---

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
}

export function updateBrushSlider(size) {
    if (uiElements && uiElements.neighborhoodSlider) {
        uiElements.neighborhoodSlider.value = size;
        if(uiElements.neighborhoodValueSpan) uiElements.neighborhoodValueSpan.textContent = size;
    }
}
export function updateSpeedSlider(speed) {
    if (uiElements && uiElements.speedSlider) {
        uiElements.speedSlider.value = speed;
        if(uiElements.speedValueSpan) uiElements.speedValueSpan.textContent = speed;
    }
}

// --- Hotkey Handler ---
function handleGlobalKeyDown(event) {
    // ... (logic to check if input field is active, unchanged) ...
    const activeEl = document.activeElement;
    if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        const isInputElement = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
        const isContentEditable = activeEl.isContentEditable;
        if (event.key === 'Enter' && rulesetEditorComponent && activeEl === rulesetEditorComponent.uiElements.editorRulesetInput) {
            // Let component handle
        } else if (isInputElement || isContentEditable) {
            return;
        }
    }

    switch (event.key.toUpperCase()) {
        case 'P': uiElements.playPauseButton?.click(); event.preventDefault(); break;
        case 'N': uiElements.randomRulesetButton?.click(); event.preventDefault(); break;
        case 'R': uiElements.resetStatesButton?.click(); event.preventDefault(); break;
        case 'E': rulesetEditorComponent?.toggle(); event.preventDefault(); break;
        case 'S': setupPanelComponent?.toggle(); event.preventDefault(); break; // New hotkey for Setup Panel
    }
}