// ui.js
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js'; // Import formatting helper

// --- DOM Element References ---
let uiElements; // Object to hold references

// --- UI State ---
let simulationInterfaceRef; // Store reference for later use

// --- Draggable Function ---
function makeDraggable(panelElement, handleElement) {
    let initialMouseX, initialMouseY;
    let offsetX, offsetY;

    handleElement.style.cursor = 'move'; // Set cursor on the handle

    handleElement.addEventListener('mousedown', (e) => {
        // Prevent dragging if clicking on interactive elements within the panel itself
        // (inputs, buttons, or the rule visualizations)
        if (e.target.tagName === 'INPUT' ||
            e.target.tagName === 'BUTTON' ||
            e.target.tagName === 'SELECT' ||
            e.target.tagName === 'TEXTAREA' ||
            e.target.closest('.rule-viz')) {
            return;
        }

        e.preventDefault(); // Prevent text selection, etc.

        const rect = panelElement.getBoundingClientRect();

        // Calculate mouse offset relative to the panel's top-left corner
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        // If the panel uses transform for centering, explicitly set top/left
        // based on current visual position and remove transform for direct positioning.
        if (window.getComputedStyle(panelElement).transform !== 'none') {
            panelElement.style.left = `${rect.left}px`;
            panelElement.style.top = `${rect.top}px`;
            panelElement.style.transform = 'none';
        }

        document.addEventListener('mousemove', dragMouseMove);
        document.addEventListener('mouseup', dragMouseUp);
    });

    function dragMouseMove(e) {
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;

        // Optional: Constrain movement within viewport boundaries
        const panelWidth = panelElement.offsetWidth;
        const panelHeight = panelElement.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + panelWidth > viewportWidth) newLeft = viewportWidth - panelWidth;
        if (newTop + panelHeight > viewportHeight) newTop = viewportHeight - panelHeight;

        panelElement.style.left = `${newLeft}px`;
        panelElement.style.top = `${newTop}px`;
    }

    function dragMouseUp() {
        document.removeEventListener('mousemove', dragMouseMove);
        document.removeEventListener('mouseup', dragMouseUp);
    }
}


// --- Initialization ---

/**
 * Initializes UI elements and sets up event listeners.
 * @param {object} simulationInterface - An object with functions to interact with the simulation
 */
export function initUI(simulationInterface) {
    simulationInterfaceRef = simulationInterface; // Store for later use in editor interactions
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
        copyRuleButton: document.getElementById('copyRuleButton'),
        rulesetInput: document.getElementById('rulesetInput'),
        setRuleButton: document.getElementById('setRuleButton'),
        rulesetDisplay: document.getElementById('rulesetDisplay'),
        resetOnNewRuleCheckbox: document.getElementById('resetOnNewRuleCheckbox'),
        editRuleButton: document.getElementById('editRuleButton'), // Renamed
        // State
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetStatesButton: document.getElementById('resetStatesButton'),
        // Stats Display
        statRatio: document.getElementById('stat-ratio'),
        statAvgRatio: document.getElementById('stat-avg-ratio'),
        // Ruleset Editor Panel Elements
        rulesetEditorPanel: document.getElementById('rulesetEditorPanel'), // Renamed
        closeEditorButton: document.getElementById('closeEditorButton'), // Renamed
        rulesetEditorGrid: document.getElementById('rulesetEditorGrid'), // Renamed
        editorRulesetInput: document.getElementById('editorRulesetInput'), // New input in editor
        clearRulesButton: document.getElementById('clearRulesButton'), // Renamed from clearFillRulesButton if ID was that
        // Bias Control Elements
        useCustomBiasCheckbox: document.getElementById('useCustomBiasCheckbox'),
        biasSlider: document.getElementById('biasSlider'),
        biasValueSpan: document.getElementById('biasValueSpan'),
    };

    if (!validateElements()) return false;

    setupControlListeners(simulationInterface);
    setupRulesetListeners(simulationInterface);
    setupStateListeners(simulationInterface);
    setupEditorListeners(simulationInterface); // This will also set up dragging

    // Initial UI setup
    uiElements.speedSlider.max = Config.MAX_SIM_SPEED;
    uiElements.speedSlider.value = Config.DEFAULT_SPEED;
    // uiElements.speedValueSpan.textContent = Config.DEFAULT_SPEED; // Already handled by slider value display change

    uiElements.neighborhoodSlider.max = Config.MAX_NEIGHBORHOOD_SIZE;
    uiElements.neighborhoodSlider.min = 0;
    uiElements.neighborhoodSlider.value = Config.DEFAULT_NEIGHBORHOOD_SIZE;
    // uiElements.neighborhoodValueSpan.textContent = Config.DEFAULT_NEIGHBORHOOD_SIZE; // Already handled

    uiElements.playPauseButton.textContent = "[P]lay";
    uiElements.randomRulesetButton.textContent = "[N]ew Rules";
    uiElements.resetStatesButton.textContent = "[R]eset States";
    uiElements.editRuleButton.textContent = "[E]dit";

    uiElements.biasSlider.value = 0.5;
    // uiElements.biasValueSpan.textContent = parseFloat(uiElements.biasSlider.value).toFixed(2); // Already handled
    updateBiasSliderDisabledState();

    window.addEventListener('keydown', handleGlobalKeyDown);

    // Initial population of the ruleset editor and displays
    const initialHex = simulationInterface.getCurrentRulesetHex();
    const initialArr = simulationInterface.getCurrentRulesetArray();
    updateMainRulesetDisplay(initialHex); // Update main display
    if (uiElements.editorRulesetInput) {
        uiElements.editorRulesetInput.value = initialHex === "Error" ? "" : initialHex; // Update editor input
    }
    updateRulesetEditorGrid(initialArr); // Update editor grid

    console.log("UI Initialized.");
    return true;
}

// Helper to update all ruleset related displays
export function refreshAllRulesetViews(sim) {
    const currentHex = sim.getCurrentRulesetHex();
    const currentArr = sim.getCurrentRulesetArray();

    updateMainRulesetDisplay(currentHex);
    if (uiElements.editorRulesetInput) {
        uiElements.editorRulesetInput.value = currentHex === "Error" ? "" : currentHex;
    }
    updateRulesetEditorGrid(currentArr);
}

function updateBiasSliderDisabledState() {
    if (uiElements.useCustomBiasCheckbox && uiElements.biasSlider) {
        uiElements.biasSlider.disabled = !uiElements.useCustomBiasCheckbox.checked;
    }
}

function validateElements() {
    for (const key in uiElements) {
        if (!uiElements[key]) {
            if (key === 'rulesetEditorPanel' || key === 'closeEditorButton' || key === 'rulesetEditorGrid' || key === 'clearFillRulesButton') {
                console.warn(`UI Warning: Editor element '${key}' not found. Editor feature might be incomplete.`);
            } else {
                console.error(`UI Initialization Error: Element with ID '${key}' not found.`);
                alert(`UI Error: Element '${key}' not found. Check index.html.`);
                return false;
            }
        }
    }
    if (!uiElements.rulesetEditorPanel || !uiElements.closeEditorButton || !uiElements.rulesetEditorGrid || !uiElements.clearFillRulesButton) {
        console.warn(`UI Warning: Essential Ruleset Editor elements not found. Editor functionality will be impaired.`);
    }
    return true;
}

// --- Event Listener Setup ---

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
            uiElements.biasValueSpan.textContent = parseFloat(event.target.value).toFixed(2);
        });
    }

    uiElements.speedSlider.addEventListener('input', (event) => {
        const speed = parseInt(event.target.value, 10);
        sim.setSpeed(speed);
        uiElements.speedValueSpan.textContent = speed;
    });

    uiElements.neighborhoodSlider.addEventListener('input', (event) => {
        const size = parseInt(event.target.value, 10);
        sim.setNeighborhoodSize(size);
        uiElements.neighborhoodValueSpan.textContent = size;
    });
}

function setupRulesetListeners(sim) {
    uiElements.randomRulesetButton.addEventListener('click', () => {
        let biasToUse = uiElements.useCustomBiasCheckbox.checked ? parseFloat(uiElements.biasSlider.value) : Math.random();
        sim.generateRandomRuleset(biasToUse);
        refreshAllRulesetViews(sim); 

        if (uiElements.resetOnNewRuleCheckbox.checked) {
            sim.resetAllWorldStates();
        }
    });

    uiElements.copyRuleButton.addEventListener('click', () => {
        const hex = sim.getCurrentRulesetHex();
        if (!hex || hex === "N/A") {
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
                const success = sim.loadWorldState(sim.getSelectedWorldIndex(), loadedData);
                if (success) {
                    updatePauseButton(sim.isSimulationPaused());
                    refreshAllRulesetViews(sim); 
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

function setupEditorListeners(sim) {
    if (!uiElements.editRuleButton || !uiElements.rulesetEditorPanel || !uiElements.closeEditorButton || !uiElements.rulesetEditorGrid || !uiElements.clearRulesButton || !uiElements.editorRulesetInput) {
        console.warn("One or more editor elements missing, editor listeners not fully set up.");
        return;
    }

    uiElements.editRuleButton.addEventListener('click', () => {
        uiElements.rulesetEditorPanel.classList.remove('hidden');
        // Center panel on show if it's the first time or it was moved and hidden
        const panel = uiElements.rulesetEditorPanel;
        if (panel.style.transform !== 'none' || (!panel.style.left && !panel.style.top)) {
            // If still using transform or no explicit position, reset to centered
            panel.style.left = '50%';
            panel.style.top = '50%';
            panel.style.transform = 'translate(-50%, -50%)';
        }
        refreshAllRulesetViews(sim); 
    });

    uiElements.closeEditorButton.addEventListener('click', () => {
        uiElements.rulesetEditorPanel.classList.add('hidden');
    });

    // REMOVED: Click outside to close panel behavior
    // uiElements.rulesetEditorPanel.addEventListener('click', (event) => {
    //     if (event.target === uiElements.rulesetEditorPanel) {
    //         uiElements.rulesetEditorPanel.classList.add('hidden');
    //     }
    // });

    uiElements.rulesetEditorGrid.addEventListener('click', (event) => {
        const ruleVizElement = event.target.closest('.rule-viz');
        if (ruleVizElement && ruleVizElement.dataset.ruleIndex !== undefined) {
            const ruleIndex = parseInt(ruleVizElement.dataset.ruleIndex, 10);
            if (!isNaN(ruleIndex)) {
                sim.toggleRuleOutputState(ruleIndex);
                refreshAllRulesetViews(sim);
            }
        }
    });

    uiElements.clearRulesButton.addEventListener('click', () => {
        const currentArr = sim.getCurrentRulesetArray();
        const isCurrentlyAllInactive = currentArr.every(state => state === 0);
        const targetState = isCurrentlyAllInactive ? 1 : 0;
        sim.setAllRulesState(targetState);
        refreshAllRulesetViews(sim);
    });

    const handleEditorInputChange = () => {
        const hexString = uiElements.editorRulesetInput.value.trim().toUpperCase();
        if (!hexString) { 
            refreshAllRulesetViews(sim);
            return;
        }
        if (!/^[0-9A-F]{32}$/.test(hexString)) {
            alert("Invalid Hex Code in Editor: Must be 32 hexadecimal characters (0-9, A-F).\nReverting to current ruleset.");
        } else {
            const success = sim.setRuleset(hexString); 
            if (!success) {
                 alert("Error setting ruleset from editor. The ruleset might have been rejected.\nReverting to current ruleset.");
            }
        }
        refreshAllRulesetViews(sim); 
    };

    uiElements.editorRulesetInput.addEventListener('change', handleEditorInputChange); 
    uiElements.editorRulesetInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleEditorInputChange();
            uiElements.editorRulesetInput.blur(); 
        }
    });

    // Make the panel draggable
    const editorPanel = uiElements.rulesetEditorPanel;
    const editorHandle = editorPanel.querySelector('h3'); // Use the H3 title as the drag handle
    if (editorPanel && editorHandle) {
        makeDraggable(editorPanel, editorHandle);
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

export function updateRulesetEditorGrid(rulesetArray) {
    if (!uiElements || !uiElements.rulesetEditorGrid || !rulesetArray || rulesetArray.length !== 128) {
        console.warn("Cannot update ruleset editor grid - missing elements or invalid ruleset array.");
        if (uiElements && uiElements.rulesetEditorGrid) {
            uiElements.rulesetEditorGrid.innerHTML = '<p style="color:red; text-align:center;">Error loading editor grid.</p>';
        }
        return;
    }

    const grid = uiElements.rulesetEditorGrid;
    grid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < 128; i++) {
        const centerState = (i >> 6) & 1;
        const neighborMask = i & 0x3F;
        const outputState = rulesetArray[i];

        const ruleViz = document.createElement('div');
        ruleViz.className = 'rule-viz';
        ruleViz.title = `Rule ${i}: Input C=${centerState} N=${neighborMask.toString(2).padStart(6, '0')} -> Output C=${outputState}\n(Click to toggle output)`;
        ruleViz.dataset.ruleIndex = i;

        const centerHex = document.createElement('div');
        centerHex.className = `hexagon center-hex state-${centerState}`;

        const innerHex = document.createElement('div');
        innerHex.className = `hexagon inner-hex state-${outputState}`;
        centerHex.appendChild(innerHex);
        ruleViz.appendChild(centerHex);

        for (let n = 0; n < 6; n++) {
            const neighborState = (neighborMask >> n) & 1;
            const neighborHex = document.createElement('div');
            neighborHex.className = `hexagon neighbor-hex neighbor-${n} state-${neighborState}`;
            ruleViz.appendChild(neighborHex);
        }
        fragment.appendChild(ruleViz);
    }
    grid.appendChild(fragment);
}

// --- Hotkey Handler ---
function handleGlobalKeyDown(event) {
    // Check if focus is on an input element where typing should be allowed
    const activeEl = document.activeElement;
    if (activeEl) {
        const tagName = activeEl.tagName.toLowerCase();
        const isInputElement = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
        const isContentEditable = activeEl.isContentEditable;

        // Allow Enter key specifically for the editorRulesetInput if it's active
        if (event.key === 'Enter' && activeEl === uiElements.editorRulesetInput) {
            // Let the existing listener for editorRulesetInput handle this Enter key
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
            if (uiElements.rulesetEditorPanel.classList.contains('hidden')) {
                if (uiElements.editRuleButton) uiElements.editRuleButton.click();
            } else {
                if (uiElements.closeEditorButton) uiElements.closeEditorButton.click();
            }
            event.preventDefault();
            break;
    }
}