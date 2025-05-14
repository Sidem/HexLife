// hexlife00/src/ui/ui.js
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js';
import { RulesetEditor } from './components/RulesetEditor.js';
import { SetupPanel } from './components/SetupPanel.js'; // Import the new SetupPanel
import { DraggablePanel } from './components/DraggablePanel.js'; // Import the new SetupPanel
import * as PersistenceService from '../services/PersistenceService.js'; // Import new service
import { SliderComponent } from './components/SliderComponent.js'; // Import new component

// --- DOM Element References ---
let uiElements;

// Add a new structure for slider component instances
let sliderComponents = {};

// --- UI State ---
let simulationInterfaceRef;
let rulesetEditorComponent;
let setupPanelComponent; // Reference to the SetupPanel instance
let analysisPanelComponent; // Reference for the new DraggablePanel instance

// --- Initialization ---
export function initUI(simulationInterface) {
    simulationInterfaceRef = simulationInterface;
    uiElements = {
        canvas: document.getElementById('hexGridCanvas'),
        fileInput: document.getElementById('fileInput'),
        playPauseButton: document.getElementById('playPauseButton'),
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
        closeAnalysisPanelButton: document.getElementById('closeAnalysisPanelButton'),
        statEntropy: document.getElementById('stat-entropy'),
        ratioPlotCanvas: document.getElementById('ratioPlotCanvas'),
        entropyPlotCanvas: document.getElementById('entropyPlotCanvas'),
        enableEntropySamplingCheckbox: document.getElementById('enableEntropySamplingCheckbox'),
    };
    // Mount points for sliders
    uiElements.speedSliderMount = document.getElementById('speedSliderMount');
    uiElements.neighborhoodSizeSliderMount = document.getElementById('neighborhoodSizeSliderMount');
    uiElements.biasSliderMount = document.getElementById('biasSliderMount');
    uiElements.entropySampleRateSliderMount = document.getElementById('entropySampleRateSliderMount');

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
    // Instantiate DraggablePanel for the new Analysis Panel
    if (uiElements.analysisPanel) {
        analysisPanelComponent = new DraggablePanel(uiElements.analysisPanel, 'h3');
        _loadAnalysisPanelState(); // Load state for analysis panel

        if (uiElements.closeAnalysisPanelButton) {
            uiElements.closeAnalysisPanelButton.addEventListener('click', () => {
                analysisPanelComponent.hide();
                _saveAnalysisPanelState();
            });
        }
        if (uiElements.enableEntropySamplingCheckbox) {
            uiElements.enableEntropySamplingCheckbox.addEventListener('change', handleSamplingControlsChange);
        }
    } else {
        console.warn("Analysis panel element not found. Analysis functionality will be disabled.");
        if (uiElements.analysisPanelButton) uiElements.analysisPanelButton.disabled = true;
    }

    // Instantiate Slider Components
    sliderComponents.speedSlider = new SliderComponent(uiElements.speedSliderMount, {
        id: 'speedSlider', // For specific styling if needed & label association
        label: 'Speed:',
        min: 1,
        max: Config.MAX_SIM_SPEED,
        step: 1,
        value: simulationInterface.getCurrentSimulationSpeed(),
        unit: 'tps',
        onChange: (value) => {
            simulationInterface.setSpeed(value);
        }
    });

    sliderComponents.neighborhoodSlider = new SliderComponent(uiElements.neighborhoodSizeSliderMount, {
        id: 'neighborhoodSize',
        label: 'Brush:',
        min: 0,
        max: Config.MAX_NEIGHBORHOOD_SIZE,
        step: 1,
        value: simulationInterface.getCurrentBrushSize(),
        unit: '',
        onChange: (value) => {
            simulationInterface.setBrushSize(value);
        }
    });

    sliderComponents.biasSlider = new SliderComponent(uiElements.biasSliderMount, {
        id: 'biasSlider',
        min: 0,
        max: 1,
        step: 0.001,
        value: PersistenceService.loadUISetting('biasValue', 0.5),
        isBias: true,
        showValue: true, // Explicitly show value
        unit: '',
        disabled: !uiElements.useCustomBiasCheckbox.checked,
        onChange: (value) => {
            PersistenceService.saveUISetting('biasValue', value);
        }
    });

    sliderComponents.entropySampleRateSlider = new SliderComponent(uiElements.entropySampleRateSliderMount, {
         id: 'entropySampleRateSlider',
         label: 'Rate (Ticks):',
         min: 1,
         max: 500, // Or a value from Config if preferred
         step: 1,
         value: simulationInterface.getEntropySamplingState().rate,
         unit: '',
         disabled: !uiElements.enableEntropySamplingCheckbox.checked,
         onChange: (value) => {
             handleSamplingControlsChange(); // This function will read from the component or be passed the value
         }
    });

    setupGeneralListeners(simulationInterface); // Renamed for clarity
    setupPanelToggleListeners();
    setupStateListeners(simulationInterface);
    loadAndApplyUISettings(simulationInterface);
    loadAndApplyAnalysisSettings();

    window.addEventListener('keydown', handleGlobalKeyDown);
    refreshAllRulesetViews(simulationInterfaceRef); // Initial display
    updateBiasSliderDisabledState();
    updateSamplingControlsState(); // Initialize slider disabled state
    console.log("UI Initialized.");
    return true;
}

function _loadAnalysisPanelState() {
     if (!analysisPanelComponent || !uiElements.analysisPanel) return;
     const savedState = PersistenceService.loadPanelState('analysis');
     if (savedState.isOpen) {
         analysisPanelComponent.show(); // DraggablePanel's show handles class
     } else {
         analysisPanelComponent.hide();
     }
     if (savedState.x && savedState.x.endsWith('px')) uiElements.analysisPanel.style.left = savedState.x;
     if (savedState.y && savedState.y.endsWith('px')) uiElements.analysisPanel.style.top = savedState.y;
     if ((savedState.x || savedState.y) && parseFloat(uiElements.analysisPanel.style.left) > 0 && parseFloat(uiElements.analysisPanel.style.top) > 0) {
         uiElements.analysisPanel.style.transform = 'none';
     } else if (savedState.isOpen) { // Re-center if open but no explicit position
          uiElements.analysisPanel.style.left = '50%';
          uiElements.analysisPanel.style.top = '50%';
          uiElements.analysisPanel.style.transform = 'translate(-50%, -50%)';
     }
}

function _saveAnalysisPanelState() {
     if (!analysisPanelComponent || !uiElements.analysisPanel) return;
     const state = {
         isOpen: !uiElements.analysisPanel.classList.contains('hidden'),
         x: uiElements.analysisPanel.style.left,
         y: uiElements.analysisPanel.style.top,
     };
     PersistenceService.savePanelState('analysis', state);
}

function loadAndApplyAnalysisSettings() {
    if (!simulationInterfaceRef || !uiElements.enableEntropySamplingCheckbox || !sliderComponents.entropySampleRateSlider) return;
    const samplingState = simulationInterfaceRef.getEntropySamplingState();
    uiElements.enableEntropySamplingCheckbox.checked = samplingState.enabled;
    sliderComponents.entropySampleRateSlider.setValue(samplingState.rate);
    updateSamplingControlsState();
}

function updateSamplingControlsState() {
    if (uiElements.enableEntropySamplingCheckbox && sliderComponents.entropySampleRateSlider) {
       const isDisabled = !uiElements.enableEntropySamplingCheckbox.checked;
       sliderComponents.entropySampleRateSlider.setDisabled(isDisabled);
    }
}

function loadAndApplyUISettings(sim) {
    sliderComponents.speedSlider.setValue(sim.getCurrentSimulationSpeed());
    sliderComponents.neighborhoodSlider.setValue(sim.getCurrentBrushSize());

    uiElements.generateSymmetricalCheckbox.checked = PersistenceService.loadUISetting('generateSymmetrical', true);
    uiElements.resetOnNewRuleCheckbox.checked = PersistenceService.loadUISetting('resetOnNewRule', true);
    uiElements.useCustomBiasCheckbox.checked = PersistenceService.loadUISetting('useCustomBias', false);
    sliderComponents.biasSlider.setValue(PersistenceService.loadUISetting('biasValue', 0.5));
    updateBiasSliderDisabledState();

    // Button texts (static, but set here for consistency)
    uiElements.playPauseButton.textContent = sim.isSimulationPaused() ? "Play" : "Pause";
    uiElements.randomRulesetButton.textContent = "[N]ew Rules";
    uiElements.resetStatesButton.textContent = "[R]eset"; // Matched HTML more closely
    if (uiElements.editRuleButton) uiElements.editRuleButton.textContent = "[E]dit";
    if (uiElements.setupPanelButton) uiElements.setupPanelButton.textContent = "[S]etup";
    if (uiElements.analysisPanelButton) uiElements.analysisPanelButton.textContent = "[A]nalyse"; // Set button text
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
    if (uiElements.useCustomBiasCheckbox && sliderComponents.biasSlider) {
        const isDisabled = !uiElements.useCustomBiasCheckbox.checked;
        sliderComponents.biasSlider.setDisabled(isDisabled);
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
    if (!uiElements.analysisPanel) {
        if (uiElements.analysisPanelButton) uiElements.analysisPanelButton.disabled = true;
        if (uiElements.calculateEntropyButton) uiElements.calculateEntropyButton.disabled = true;
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
        // Ensure integer steps for non-bias sliders like speed, brush, rate
        currentValue = Math.round(currentValue / step) * step;
        currentValue = Math.max(min, Math.min(max, currentValue)); // Re-clamp after rounding
    }
    slider.value = currentValue;

    if (valueSpanElement) {
        valueSpanElement.textContent = isBias ? currentValue.toFixed(3) : currentValue;
    }
    if (simulationUpdateFunction) simulationUpdateFunction(currentValue);
    else if (isBias) PersistenceService.saveUISetting('biasValue', currentValue); // Save bias if no direct sim update

    // Dispatch an 'input' event so other listeners (like handleSamplingControlsChange) are triggered
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    slider.dispatchEvent(inputEvent);
}

function setupGeneralListeners(sim) {
    uiElements.playPauseButton.addEventListener('click', () => {
        const nowPaused = sim.togglePause();
        updatePauseButton(nowPaused);
    });

    uiElements.generateSymmetricalCheckbox.addEventListener('change', (e) => PersistenceService.saveUISetting('generateSymmetrical', e.target.checked));
    uiElements.resetOnNewRuleCheckbox.addEventListener('change', (e) => PersistenceService.saveUISetting('resetOnNewRule', e.target.checked));
    uiElements.useCustomBiasCheckbox.addEventListener('change', (e) => {
        PersistenceService.saveUISetting('useCustomBias', e.target.checked);
        updateBiasSliderDisabledState();
    });

    if (uiElements.biasSlider) {
        uiElements.biasSlider.addEventListener('input', (event) => {
           const val = parseFloat(event.target.value);
           if(uiElements.biasValueSpan) uiElements.biasValueSpan.textContent = val.toFixed(3);
           PersistenceService.saveUISetting('biasValue', val);
        });
        uiElements.biasSlider.addEventListener('wheel', (event) => {
            if (uiElements.biasSlider.disabled) return;
            handleSliderWheel(event, uiElements.biasSlider, uiElements.biasValueSpan, (value) => {
                PersistenceService.saveUISetting('biasValue', value);
            }, true);
        });
    }



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

function setupPanelToggleListeners() {
     if (uiElements.editRuleButton && rulesetEditorComponent) {
         uiElements.editRuleButton.addEventListener('click', () => {
             rulesetEditorComponent.toggle(); // toggle method in component will handle saving its own state
         });
     }
     if (uiElements.setupPanelButton && setupPanelComponent) {
         uiElements.setupPanelButton.addEventListener('click', () => {
             setupPanelComponent.toggle(); // toggle method in component will handle saving its own state
         });
     }
    if (uiElements.analysisPanelButton && analysisPanelComponent) {
        uiElements.analysisPanelButton.addEventListener('click', () => {
             const panelNowVisible = analysisPanelComponent.toggle();
             if (panelNowVisible) {
                 updateAnalysisPanel();
             }
             _saveAnalysisPanelState(); // Save analysis panel state on toggle
        });
    }
}

/**
 * Updates the entropy display and redraws the history plots
 * in the analysis panel based on current simulation data.
 */
export function updateAnalysisPanel() {
    // Check if panel exists and is visible
    if (!analysisPanelComponent || !uiElements.analysisPanel || uiElements.analysisPanel.classList.contains('hidden') || !simulationInterfaceRef) {
        return;
    }

    // Get latest stats (includes last sampled entropy)
    const stats = simulationInterfaceRef.getSelectedWorldStats();
    if (stats && uiElements.statEntropy) {
        uiElements.statEntropy.textContent = stats.entropy.toFixed(4);
    } else if (uiElements.statEntropy) {
        uiElements.statEntropy.textContent = "N/A";
    }

    // Get histories
    const ratioHistory = simulationInterfaceRef.getSelectedWorldRatioHistory();
    const entropyHistory = simulationInterfaceRef.getSelectedWorldEntropyHistory();

    // Draw plots
    if (uiElements.ratioPlotCanvas) {
        drawMinimalistPlot(uiElements.ratioPlotCanvas, ratioHistory, '#00FFFF'); // Cyan for ratio
    }
    if (uiElements.entropyPlotCanvas) {
        drawMinimalistPlot(uiElements.entropyPlotCanvas, entropyHistory, '#FFA500'); // Orange for entropy
    }
}

function handleSamplingControlsChange() {
    if (!simulationInterfaceRef || !uiElements.enableEntropySamplingCheckbox || !sliderComponents.entropySampleRateSlider) return;
    const enabled = uiElements.enableEntropySamplingCheckbox.checked;
    const rate = sliderComponents.entropySampleRateSlider.getValue(); // Get value from component
    
    updateSamplingControlsState(); // Update slider enabled state based on checkbox
    simulationInterfaceRef.setEntropySampling(enabled, rate);
}

function handleCalculateAndPlot() {
    if (!simulationInterfaceRef || !uiElements.statEntropy || !uiElements.ratioPlotCanvas) return;

    // 1. Get current stats (which includes on-demand entropy calculation)
    const stats = simulationInterfaceRef.getSelectedWorldStats();
    if (!stats) {
        uiElements.statEntropy.textContent = "N/A";
        // Clear plot maybe?
        const ctx = uiElements.ratioPlotCanvas.getContext('2d');
        ctx.clearRect(0, 0, uiElements.ratioPlotCanvas.width, uiElements.ratioPlotCanvas.height);
        return;
    }

    // 2. Update the entropy display
    uiElements.statEntropy.textContent = stats.entropy.toFixed(4);

    // 3. Get the ratio history for plotting
    const history = stats.history; // Use the ratio history from the stats object
    if (!history || history.length === 0) {
        // Clear plot if no history
        const ctx = uiElements.ratioPlotCanvas.getContext('2d');
        ctx.clearRect(0, 0, uiElements.ratioPlotCanvas.width, uiElements.ratioPlotCanvas.height);
        return;
    }

    // 4. Draw the plot
    drawMinimalistPlot(uiElements.ratioPlotCanvas, history);
}

// --- Minimalistic Plotting Function (Updated) ---
/**
 * Draws a simple line graph. Assumes data values 0-1.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} dataHistory
 * @param {string} color Line color
 */
function drawMinimalistPlot(canvas, dataHistory, color = '#FFFFFF') {
    if (!canvas || !dataHistory ) { // Allow empty history, just clear canvas
         if(canvas) {
             const ctx = canvas.getContext('2d');
             ctx.fillStyle = '#2a2a2a';
             ctx.fillRect(0, 0, canvas.width, canvas.height);
         }
         return;
    }
    if (dataHistory.length === 0) { // Explicitly handle empty history after check
         const ctx = canvas.getContext('2d');
         ctx.fillStyle = '#2a2a2a';
         ctx.fillRect(0, 0, canvas.width, canvas.height);
         return;
    }


    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 5;

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, width, height);

    const plotWidth = width - 2 * padding;
    const plotHeight = height - 2 * padding;
    const dataLength = dataHistory.length;

    // Draw bounds
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(padding, padding); ctx.lineTo(width - padding, padding); // Top (1.0)
    ctx.moveTo(padding, height - padding); ctx.lineTo(width - padding, height - padding); // Bottom (0.0)
    ctx.stroke();

    // Draw data line
    ctx.strokeStyle = color; // Use provided color
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < dataLength; i++) {
        const x = padding + (i / (dataLength - 1 || 1)) * plotWidth;
        const yValue = Math.max(0, Math.min(1, dataHistory[i])); // Clamp data just in case
        const y = padding + (1 - yValue) * plotHeight; // Map 0-1 to inverted canvas Y

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
     if (dataLength > 0) { // Only stroke if there's data
        ctx.stroke();
     }
}

// --- UI Update Functions ---

export function updatePauseButton(isPaused) {
    if (uiElements && uiElements.playPauseButton) {
        uiElements.playPauseButton.textContent = isPaused ? "Play" : "Pause";
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
    if (sliderComponents.neighborhoodSlider) {
        sliderComponents.neighborhoodSlider.setValue(size);
    }
}
export function updateSpeedSlider(speed) {
    if (sliderComponents.speedSlider) {
        sliderComponents.speedSlider.setValue(speed);
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
        } else if (isInputElement || isContentEditable) {
            return;
        }
    }

    switch (event.key.toUpperCase()) {
        case 'P': uiElements.playPauseButton?.click(); event.preventDefault(); break;
        case 'N': uiElements.randomRulesetButton?.click(); event.preventDefault(); break;
        case 'R': uiElements.resetStatesButton?.click(); event.preventDefault(); break;
        case 'E': rulesetEditorComponent?.toggle(); event.preventDefault(); break;
        case 'S': setupPanelComponent?.toggle(); event.preventDefault(); break;
        case 'A': analysisPanelComponent?.toggle(); event.preventDefault(); break;
    }
}