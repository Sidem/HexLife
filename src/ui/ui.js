// ui.js
import * as Config from '../core/config.js';
import { formatHexCode, downloadFile } from '../utils/utils.js'; // Import formatting helper

// --- DOM Element References ---
let uiElements; // Object to hold references

// --- UI State ---
// (Could store things like last stats values to avoid unnecessary updates)
let simulationInterfaceRef; // Store reference for later use

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
        resetOnNewRuleCheckbox: document.getElementById('resetOnNewRuleCheckbox'),
        explainRuleButton: document.getElementById('explainRuleButton'),
        // State
        saveStateButton: document.getElementById('saveStateButton'),
        loadStateButton: document.getElementById('loadStateButton'),
        resetStatesButton: document.getElementById('resetStatesButton'),
        // Stats Display
        statRatio: document.getElementById('stat-ratio'),
        statAvgRatio: document.getElementById('stat-avg-ratio'),
        // Ruleset Explainer Panel Elements <-- NEW
        rulesetExplainerPanel: document.getElementById('rulesetExplainerPanel'),
        closeExplainerButton: document.getElementById('closeExplainerButton'),
        rulesetExplainerGrid: document.getElementById('rulesetExplainerGrid'),
    };

    if (!validateElements()) return false;

    setupControlListeners(simulationInterface);
    setupRulesetListeners(simulationInterface);
    setupStateListeners(simulationInterface); // Pass sim interface for save/load actions
    setupExplainerListeners(); // <-- NEW

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

    // Initial population of the ruleset explainer
    updateRulesetExplanation(simulationInterface.getCurrentRulesetArray()); // <-- NEW

    console.log("UI Initialized.");
    return true;
}

function validateElements() {
    for (const key in uiElements) {
        // Allow rulesetExplainerPanel to be initially null if validation happens early
        if (!uiElements[key] && key !== 'rulesetExplainerPanel' && key !== 'closeExplainerButton' && key !== 'rulesetExplainerGrid') {
             console.error(`UI Initialization Error: Element with ID '${key}' not found.`);
            alert(`UI Error: Element '${key}' not found. Check index.html.`);
            return false;
        }
         // Specific check for explainer elements after main validation
         if (!uiElements.rulesetExplainerPanel || !uiElements.closeExplainerButton || !uiElements.rulesetExplainerGrid) {
            console.warn(`UI Warning: Ruleset explainer elements not found. Feature disabled.`);
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
        sim.generateRandomRuleset(Math.random());
        const newRulesetHex = sim.getCurrentRulesetHex();
        const newRulesetArr = sim.getCurrentRulesetArray(); // Get the array
        updateRulesetDisplay(newRulesetHex); // Update display
        updateRulesetExplanation(newRulesetArr); // <-- UPDATE EXPLAINER

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
        const hexString = uiElements.rulesetInput.value.trim().toUpperCase(); // Trim and uppercase
        if (!hexString) return; // Ignore empty input

        // Basic validation before calling simulation
         if (!/^[0-9A-F]{32}$/.test(hexString)) {
             alert("Invalid Hex Code: Must be 32 hexadecimal characters (0-9, A-F).");
             uiElements.rulesetInput.select();
             return;
         }


        try {
            const success = sim.setRuleset(hexString);
            if (success) {
                const currentHex = sim.getCurrentRulesetHex(); // Get hex after setting
                const currentArr = sim.getCurrentRulesetArray(); // Get array after setting
                updateRulesetDisplay(currentHex);
                updateRulesetExplanation(currentArr); // <-- UPDATE EXPLAINER
                uiElements.rulesetInput.value = '';
                uiElements.rulesetInput.blur();
                 // Check if state reset is needed (Optional: could add a checkbox for this)
                 // if (uiElements.resetOnSetRuleCheckbox.checked) { sim.resetAllWorldStates(); }
            } else {
                // Simulation's setRuleset might handle errors, but add fallback
                 alert("Error setting ruleset. Please check the code.");
                 uiElements.rulesetInput.select();
            }
        } catch (error) {
            // Catch potential errors from hexToRuleset called within sim.setRuleset
            alert(`Error setting ruleset: ${error.message}`);
            uiElements.rulesetInput.select();
        }
    });
     // Allow pressing Enter in the input field
     uiElements.rulesetInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent form submission if applicable
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
        downloadFile(filename, jsonString, 'application/json'); // Use Utils helper
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
                    // Update UI to reflect loaded state (pause button, stats, ruleset display if loaded)
                    updatePauseButton(sim.isSimulationPaused());
                    const currentHex = sim.getCurrentRulesetHex(); // Get ruleset potentially loaded
                    const currentArr = sim.getCurrentRulesetArray();
                    updateRulesetDisplay(currentHex);
                    updateRulesetExplanation(currentArr); // <-- UPDATE EXPLAINER
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

// --- NEW: Ruleset Explainer Listeners ---
function setupExplainerListeners() {
    if (!uiElements.explainRuleButton || !uiElements.rulesetExplainerPanel || !uiElements.closeExplainerButton) return; // Exit if elements don't exist

   uiElements.explainRuleButton.addEventListener('click', () => {
       uiElements.rulesetExplainerPanel.classList.remove('hidden');
       // Optional: Regenerate explanation every time it's opened, in case ruleset changed while hidden
       // updateRulesetExplanation(simulationInterfaceRef.getCurrentRulesetArray());
   });

   uiElements.closeExplainerButton.addEventListener('click', () => {
       uiElements.rulesetExplainerPanel.classList.add('hidden');
   });

    // Optional: Close panel if clicking outside of it
    uiElements.rulesetExplainerPanel.addEventListener('click', (event) => {
        if (event.target === uiElements.rulesetExplainerPanel) { // Clicked on the backdrop, not content
           uiElements.rulesetExplainerPanel.classList.add('hidden');
        }
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
    if (!statsData || !uiElements) return;

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

// --- NEW: Ruleset Explainer Generation ---

/**
 * Generates the visual explanation grid for the given ruleset.
 * @param {Uint8Array} rulesetArray The 128-element ruleset array.
 */
export function updateRulesetExplanation(rulesetArray) {
    if (!uiElements || !uiElements.rulesetExplainerGrid || !rulesetArray || rulesetArray.length !== 128) {
        console.log("uiElements:", uiElements);
        console.log("rulesetArray:", rulesetArray);
        console.log("rulesetExplainerGrid:", uiElements.rulesetExplainerGrid);
        console.log("rulesetExplainerPanel:", uiElements.rulesetExplainerPanel);
        console.warn("Cannot update ruleset explanation - missing elements or invalid ruleset array.");
        return;
    }

   const grid = uiElements.rulesetExplainerGrid;
   grid.innerHTML = ''; // Clear previous content
   const fragment = document.createDocumentFragment(); // Use fragment for performance

   for (let i = 0; i < 128; i++) {
       const centerState = (i >> 6) & 1;
       const neighborMask = i & 0x3F; // 0b00111111
       const outputState = rulesetArray[i];

       // Create main container for this rule viz
       const ruleViz = document.createElement('div');
       ruleViz.className = 'rule-viz';
       ruleViz.title = `Rule ${i}: Input C=${centerState} N=${neighborMask.toString(2).padStart(6,'0')} -> Output C=${outputState}`; // Tooltip

       // Create center hexagon (input state)
       const centerHex = document.createElement('div');
       centerHex.className = `hexagon center-hex state-${centerState}`;

       // Create inner hexagon (output state)
       const innerHex = document.createElement('div');
       innerHex.className = `hexagon inner-hex state-${outputState}`;
       centerHex.appendChild(innerHex); // Add inner hex to center hex

       ruleViz.appendChild(centerHex);

       // Create neighbor hexagons
       for (let n = 0; n < 6; n++) {
           const neighborState = (neighborMask >> n) & 1;
           const neighborHex = document.createElement('div');
           // Class names match the CSS positioning rules
           neighborHex.className = `hexagon neighbor-hex neighbor-${n} state-${neighborState}`;
           ruleViz.appendChild(neighborHex);
       }

       fragment.appendChild(ruleViz);
   }

   grid.appendChild(fragment); // Append all generated elements at once
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