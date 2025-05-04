// ui.js
import * as Config from './config.js';
import { formatHexCode } from './utils.js'; // Import formatting helper

// --- DOM Element References ---
let uiElements; // Object to hold references

// --- UI State ---
// (Could store things like last stats values to avoid unnecessary updates)

// --- Initialization ---

/**
 * Initializes UI elements and sets up event listeners.
 * @param {object} simulationInterface - An object with functions to interact with the simulation
 * (e.g., applyBrush, setSpeed, togglePause, etc.)
 * @param {object} rendererInterface - An object with functions for the renderer (optional, if UI needs it)
 */
export function initUI(simulationInterface, rendererInterface = {}) {
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
        resetOnNewRuleCheckbox: document.getElementById('resetOnNewRuleCheckbox'), // <-- NEW
        // State
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetStatesButton: document.getElementById('resetStatesButton'),
        // Stats Display
        statsContainer: document.getElementById('stats-container'),
        statRatio: document.getElementById('stat-ratio'),
        statAvgRatio: document.getElementById('stat-avg-ratio'),
    };

    if (!validateElements()) return false;

    setupControlListeners(simulationInterface);
    setupRulesetListeners(simulationInterface);
    setupStateListeners(simulationInterface); // Pass sim interface for save/load actions

    // Initial UI setup based on config/defaults
    uiElements.speedSlider.max = Config.MAX_SIM_SPEED;
    uiElements.speedSlider.value = Config.DEFAULT_SPEED;
    uiElements.speedValueSpan.textContent = Config.DEFAULT_SPEED;

    uiElements.neighborhoodSlider.max = Config.MAX_NEIGHBORHOOD_SIZE;
    uiElements.neighborhoodSlider.min = 0; // Allow 0 brush size (single cell)
    uiElements.neighborhoodSlider.value = Config.DEFAULT_NEIGHBORHOOD_SIZE;
    uiElements.neighborhoodValueSpan.textContent = Config.DEFAULT_NEIGHBORHOOD_SIZE;

    // Set initial button text with hotkeys
    uiElements.playPauseButton.textContent = "[P]lay"; // Assuming starts paused
    uiElements.randomRulesetButton.textContent = "[N]ew Ruleset";
    uiElements.resetStatesButton.textContent = "[R]eset States";

    // Add global key listener for hotkeys
    window.addEventListener('keydown', handleGlobalKeyDown);

    console.log("UI Initialized.");
    return true;
}

function validateElements() {
    for (const key in uiElements) {
        if (!uiElements[key]) {
            console.error(`UI Initialization Error: Element with ID '${key}' not found.`);
            alert(`UI Error: Element '${key}' not found. Check index.html.`);
            return false;
        }
    }
    return true;
}

// --- Event Listener Setup ---

function setupControlListeners(sim) {
    // Play/Pause
    uiElements.playPauseButton.addEventListener('click', () => {
        const nowPaused = sim.togglePause(); // Simulation should return new pause state
        updatePauseButton(nowPaused);
    });

    // Speed Slider
    uiElements.speedSlider.addEventListener('input', (event) => {
        const speed = parseInt(event.target.value, 10);
        sim.setSpeed(speed);
        uiElements.speedValueSpan.textContent = speed;
    });

    // Brush/Neighborhood Slider
    uiElements.neighborhoodSlider.addEventListener('input', (event) => {
        const size = parseInt(event.target.value, 10);
        sim.setNeighborhoodSize(size); // Simulation needs this setter
        uiElements.neighborhoodValueSpan.textContent = size;
    });
}

function setupRulesetListeners(sim) {
    // Random Ruleset
    uiElements.randomRulesetButton.addEventListener('click', () => {
        sim.generateRandomRuleset();
        updateRulesetDisplay(sim.getCurrentRulesetHex()); // Update display

        // Check if state reset is needed
        if (uiElements.resetOnNewRuleCheckbox.checked) { // <-- CHECK ADDED
            console.log("Resetting states due to new ruleset generation.");
            sim.resetAllWorldStates(); // Call the reset function
            // Update pause button state in UI if reset paused it
            //updatePauseButton(sim.isSimulationPaused());
        }
    });

    // Copy Ruleset
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

    // Set Ruleset from Input
    uiElements.setRuleButton.addEventListener('click', () => {
        const hexString = uiElements.rulesetInput.value;
        try {
            const success = sim.setRuleset(hexString); // Use sim function directly
            if (success) {
                updateRulesetDisplay(sim.getCurrentRulesetHex()); // Update display on success
                uiElements.rulesetInput.value = '';
                uiElements.rulesetInput.blur();
            } else {
                throw new Error("Invalid hex code or simulation error.");
            }
        } catch (error) {
            alert(`Error setting ruleset: ${error.message}`);
            uiElements.rulesetInput.select();
        }
    });
     // Allow pressing Enter in the input field
     uiElements.rulesetInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            uiElements.setRuleButton.click(); // Simulate button click
        }
    });
}

function setupStateListeners(sim) {
    // Save State
    uiElements.saveStateButton.addEventListener('click', () => {
        const stateData = sim.getWorldStateForSave(sim.getSelectedWorldIndex());
        if (!stateData) {
            alert("Could not get state data for selected world.");
            return;
        }
        const jsonString = JSON.stringify(stateData, null, 2);
        const timestamp = new Date().toISOString().replace(/[:.-]/g, '').slice(0, -4);
        const filename = `hex_state_${sim.getCurrentRulesetHex()}_${timestamp}.json`;
        Utils.downloadFile(filename, jsonString, 'application/json'); // Use Utils helper
    });

    // Load State Button (triggers hidden input)
    uiElements.loadStateButton.addEventListener('click', () => {
        uiElements.fileInput.accept = ".txt,.json"; // Accept both
        uiElements.fileInput.click();
    });

    // File Input Handler (moved from main, simplified)
    uiElements.fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) { event.target.value = null; return; } // No file selected

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            try {
                const loadedData = JSON.parse(content);
                // Basic validation before passing to simulation
                if (!loadedData || typeof loadedData.rows !== 'number' || typeof loadedData.cols !== 'number' || !Array.isArray(loadedData.state)) {
                     throw new Error("Invalid state file format.");
                }
                const success = sim.loadWorldState(sim.getSelectedWorldIndex(), loadedData); // Try loading into selected world
                if (success) {
                    alert("State loaded successfully!");
                    // Update UI to reflect loaded state (pause button, stats, ruleset display if loaded)
                    updatePauseButton(sim.isSimulationPaused());
                    updateRulesetDisplay(sim.getCurrentRulesetHex());
                    // Stats will update on next frame
                } else {
                    // Error handled by simulation, maybe alert was already shown
                }

            } catch (error) {
                alert(`Error processing state file: ${error.message}`);
                console.error("File processing error:", error);
            } finally {
                event.target.value = null; // Clear input value
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


// --- UI Update Functions ---

export function updatePauseButton(isPaused) {
    if (uiElements && uiElements.playPauseButton) {
        uiElements.playPauseButton.textContent = isPaused ? "[P]lay" : "[P]ause"; // Update with hotkey
    }
}

export function updateRulesetDisplay(hexCode) {
     if (uiElements && uiElements.rulesetDisplay) {
        uiElements.rulesetDisplay.textContent = formatHexCode(hexCode); // Use Utils helper
     }
}

export function updateStatsDisplay(statsData) {
    if (!statsData || !uiElements || !uiElements.statsContainer) return;

    if (uiElements.statRatio) {
        uiElements.statRatio.textContent = (statsData.ratio * 100).toFixed(2);
    }
    if (uiElements.statAvgRatio) {
        uiElements.statAvgRatio.textContent = (statsData.avgRatio * 100).toFixed(2);
    }
}

// Optional: Update slider/value if changed programmatically (e.g., loading state)
export function updateBrushSlider(size) {
    if (uiElements && uiElements.neighborhoodSlider) {
        uiElements.neighborhoodSlider.value = size;
        uiElements.neighborhoodValueSpan.textContent = size;
    }
}
export function updateSpeedSlider(speed) {
     if (uiElements && uiElements.speedSlider) {
        uiElements.speedSlider.value = speed;
        uiElements.speedValueSpan.textContent = speed;
    }
}

// --- Hotkey Handler ---

function handleGlobalKeyDown(event) {
    // Ignore key presses if an input element is focused
    if (document.activeElement && (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'SELECT')
    ) {
        return;
    }

    // Handle hotkeys (case-insensitive)
    switch (event.key.toUpperCase()) {
        case 'P':
            if (uiElements.playPauseButton) {
                uiElements.playPauseButton.click();
                event.preventDefault(); // Prevent potential browser default actions
            }
            break;
        case 'N':
            if (uiElements.randomRulesetButton) {
                uiElements.randomRulesetButton.click();
                event.preventDefault();
            }
            break;
        case 'R':
            if (uiElements.resetStatesButton) {
                uiElements.resetStatesButton.click();
                event.preventDefault();
            }
            break;
        // Add more cases here if needed
    }
}