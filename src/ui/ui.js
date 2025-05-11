// hexlife00/src/ui/ui.js
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js';
import { RulesetEditor } from './components/RulesetEditor.js'; // Import the new component

// --- DOM Element References ---
let uiElements; // Object to hold references

// --- UI State ---
let simulationInterfaceRef; // Store reference for later use
let rulesetEditorComponent; // Reference to the RulesetEditor instance

// --- Initialization ---

/**
 * Initializes UI elements and sets up event listeners.
 * @param {object} simulationInterface - An object with functions to interact with the simulation
 */
export function initUI(simulationInterface) {
    simulationInterfaceRef = simulationInterface;
    uiElements = {
        canvas: document.getElementById('hexGridCanvas'),
        fileInput: document.getElementById('fileInput'),
        // Controls
        playPauseButton: document.getElementById('playPauseButton'),
        speedSlider: document.getElementById('speedSlider'),
        speedValueSpan: document.getElementById('speedValue'),
        neighborhoodSlider: document.getElementById('neighborhoodSize'),
        neighborhoodValueSpan: document.getElementById('neighborhoodValue'),
        // Ruleset
        randomRulesetButton: document.getElementById('randomRulesetButton'),
        generateSymmetricalCheckbox: document.getElementById('generateSymmetricalCheckbox'),
        copyRuleButton: document.getElementById('copyRuleButton'),
        rulesetInput: document.getElementById('rulesetInput'),
        setRuleButton: document.getElementById('setRuleButton'),
        rulesetDisplay: document.getElementById('rulesetDisplay'),
        resetOnNewRuleCheckbox: document.getElementById('resetOnNewRuleCheckbox'),
        editRuleButton: document.getElementById('editRuleButton'), // Button to open the editor
        // State
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetStatesButton: document.getElementById('resetStatesButton'),
        // Stats Display
        statRatio: document.getElementById('stat-ratio'),
        statAvgRatio: document.getElementById('stat-avg-ratio'),
        // Ruleset Editor Panel Element (the main container)
        rulesetEditorPanel: document.getElementById('rulesetEditorPanel'),
        // Bias Control Elements
        useCustomBiasCheckbox: document.getElementById('useCustomBiasCheckbox'),
        biasSlider: document.getElementById('biasSlider'),
        biasValueSpan: document.getElementById('biasValueSpan'),
        // Performance Indicators
        statFps: document.getElementById('stat-fps'),
        statActualTps: document.getElementById('stat-actual-tps'),
    };

    if (!validateElements()) return false;

    // Instantiate RulesetEditor component
    if (uiElements.rulesetEditorPanel) {
        rulesetEditorComponent = new RulesetEditor(uiElements.rulesetEditorPanel, simulationInterfaceRef);
    } else {
        console.warn("Ruleset editor panel element not found. Editor functionality will be disabled.");
        // Disable the button that opens the editor if the panel itself is missing
        if (uiElements.editRuleButton) {
            uiElements.editRuleButton.disabled = true;
            uiElements.editRuleButton.title = "Ruleset editor panel not found in HTML.";
        }
    }

    setupControlListeners(simulationInterface);
    setupRulesetListeners(simulationInterface); // General ruleset controls
    setupStateListeners(simulationInterface);
    setupEditorToggleListeners(); // Listeners for opening/closing the editor

    // Initial UI setup
    uiElements.speedSlider.max = Config.MAX_SIM_SPEED;
    uiElements.speedSlider.value = Config.DEFAULT_SPEED;
    uiElements.speedValueSpan.textContent = Config.DEFAULT_SPEED;

    uiElements.neighborhoodSlider.max = Config.MAX_NEIGHBORHOOD_SIZE;
    uiElements.neighborhoodSlider.min = 0;
    uiElements.neighborhoodSlider.value = Config.DEFAULT_NEIGHBORHOOD_SIZE;
    uiElements.neighborhoodValueSpan.textContent = Config.DEFAULT_NEIGHBORHOOD_SIZE;

    uiElements.playPauseButton.textContent = "[P]lay";
    uiElements.randomRulesetButton.textContent = "[N]ew Rules";
    uiElements.resetStatesButton.textContent = "[R]eset States";
    if (uiElements.editRuleButton) uiElements.editRuleButton.textContent = "[E]dit";


    uiElements.biasSlider.value = 0.5;
    uiElements.biasValueSpan.textContent = parseFloat(uiElements.biasSlider.value).toFixed(3);
    updateBiasSliderDisabledState();

    window.addEventListener('keydown', handleGlobalKeyDown);

    // Initial population of ruleset displays
    refreshAllRulesetViews(simulationInterfaceRef);

    console.log("UI Initialized.");
    return true;
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

// Helper to update all ruleset related displays
export function refreshAllRulesetViews(sim) {
    if (!sim) {
        console.warn("refreshAllRulesetViews called without simulation interface.");
        return;
    }
    const currentHex = sim.getCurrentRulesetHex();
    updateMainRulesetDisplay(currentHex);

    // Refresh the editor's internal views if the component exists
    if (rulesetEditorComponent) {
        rulesetEditorComponent.refreshViews();
    }
}

function updateBiasSliderDisabledState() {
    if (uiElements.useCustomBiasCheckbox && uiElements.biasSlider) {
        uiElements.biasSlider.disabled = !uiElements.useCustomBiasCheckbox.checked;
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

// --- Event Listener Setup ---

function handleSliderWheel(event, sliderElement, valueSpanElement, simulationUpdateFunction) {
    event.preventDefault();
    const slider = sliderElement;
    const step = parseFloat(slider.step) || 1;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    let currentValue = parseFloat(slider.value);

    if (event.deltaY < 0) { // Scroll up
        currentValue += step;
    } else { // Scroll down
        currentValue -= step;
    }

    currentValue = Math.max(min, Math.min(max, currentValue));

    if (slider.id === 'biasSlider') {
        currentValue = parseFloat(currentValue.toFixed(3));
    } else {
        currentValue = Math.round(currentValue / step) * step;
    }

    slider.value = currentValue;

    if (valueSpanElement) {
        if (slider.id === 'biasSlider') {
            valueSpanElement.textContent = currentValue.toFixed(3);
        } else {
            valueSpanElement.textContent = currentValue;
        }
    }

    if (simulationUpdateFunction) {
        simulationUpdateFunction(currentValue);
    }

    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    slider.dispatchEvent(inputEvent);
}

function setupControlListeners(sim) {
    uiElements.playPauseButton.addEventListener('click', () => {
        const nowPaused = sim.togglePause();
        updatePauseButton(nowPaused);
    });

    if (uiElements.useCustomBiasCheckbox) {
        uiElements.useCustomBiasCheckbox.addEventListener('change', updateBiasSliderDisabledState);
    }
    if (uiElements.biasSlider) {
        uiElements.biasSlider.addEventListener('input', (event) => {
           if(uiElements.biasValueSpan) uiElements.biasValueSpan.textContent = parseFloat(event.target.value).toFixed(3);
        });
        uiElements.biasSlider.addEventListener('wheel', (event) => {
            if (uiElements.biasSlider.disabled) return;
            handleSliderWheel(event, uiElements.biasSlider, uiElements.biasValueSpan, null);
        });
    }

    uiElements.speedSlider.addEventListener('input', (event) => {
        const speed = parseInt(event.target.value, 10);
        sim.setSpeed(speed);
        uiElements.speedValueSpan.textContent = speed;
    });
    uiElements.speedSlider.addEventListener('wheel', (event) => {
        handleSliderWheel(event, uiElements.speedSlider, uiElements.speedValueSpan, sim.setSpeed);
    });

    uiElements.neighborhoodSlider.addEventListener('input', (event) => {
        const size = parseInt(event.target.value, 10);
        sim.setNeighborhoodSize(size);
        uiElements.neighborhoodValueSpan.textContent = size;
    });
    uiElements.neighborhoodSlider.addEventListener('wheel', (event) => {
        handleSliderWheel(event, uiElements.neighborhoodSlider, uiElements.neighborhoodValueSpan, sim.setNeighborhoodSize);
    });
}

function setupRulesetListeners(sim) { // For general ruleset controls, not the editor panel itself
    uiElements.randomRulesetButton.addEventListener('click', () => {
        let biasToUse = uiElements.useCustomBiasCheckbox.checked ? parseFloat(uiElements.biasSlider.value) : Math.random();
        const generateSymmetrically = uiElements.generateSymmetricalCheckbox.checked;
        sim.generateRandomRuleset(biasToUse, generateSymmetrically);
        refreshAllRulesetViews(sim); // This will also update the editor if it's open

        if (uiElements.resetOnNewRuleCheckbox.checked) {
            sim.resetAllWorldStates();
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
        const success = sim.setRuleset(hexString);
        if (success) {
            uiElements.rulesetInput.value = '';
            uiElements.rulesetInput.blur();
        } else {
            alert("Error setting ruleset. Please check the code. The ruleset might have been rejected.");
            uiElements.rulesetInput.select();
        }
        refreshAllRulesetViews(sim); // Update editor and main display
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
                const success = sim.loadWorldState(sim.getSelectedWorldIndex(), loadedData);
                if (success) {
                    updatePauseButton(sim.isSimulationPaused());
                    refreshAllRulesetViews(sim); // Refresh editor and main display
                }
            } catch (error) {
                alert(`Error processing state file: ${error.message}`);
                console.error("File processing error:", error);
            } finally {
                event.target.value = null;
            }
        };
        reader.onerror = (e) => {
            alert(`Error reading file: ${e.target.error}`);
            event.target.value = null;
        };
        reader.readAsText(file);
    });

    uiElements.resetStatesButton.addEventListener('click', () => {
        sim.resetAllWorldStates();
    });
}

function setupEditorToggleListeners() {
    if (uiElements.editRuleButton && rulesetEditorComponent) {
        uiElements.editRuleButton.addEventListener('click', () => {
            rulesetEditorComponent.show(); // The component handles its own refresh
        });
    }
    // The close button listener is now inside the RulesetEditor component.
    // Global hotkey 'E' will handle toggling via handleGlobalKeyDown.
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
    const activeEl = document.activeElement;
    if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        const isInputElement = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
        const isContentEditable = activeEl.isContentEditable;

        // Allow Enter key specifically for the editorRulesetInput if it's active
        // This check might be redundant if editor's input handling is self-contained, but safe.
        if (event.key === 'Enter' && rulesetEditorComponent && activeEl === rulesetEditorComponent.uiElements.editorRulesetInput) {
            // Let the RulesetEditor component's listener handle this.
        } else if (isInputElement || isContentEditable) {
            return; // Don't trigger global hotkeys if typing in an input field
        }
    }

    switch (event.key.toUpperCase()) {
        case 'P':
            if (uiElements.playPauseButton) uiElements.playPauseButton.click();
            event.preventDefault();
            break;
        case 'N':
            if (uiElements.randomRulesetButton) uiElements.randomRulesetButton.click();
            event.preventDefault();
            break;
        case 'R':
            if (uiElements.resetStatesButton) uiElements.resetStatesButton.click();
            event.preventDefault();
            break;
        case 'E':
            if (rulesetEditorComponent) {
                rulesetEditorComponent.toggle();
            } else if (uiElements.editRuleButton) { // Fallback if component somehow failed but button exists
                uiElements.editRuleButton.click();
            }
            event.preventDefault();
            break;
    }
}