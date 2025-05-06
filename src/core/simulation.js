// simulation.js
import * as Config from './config.js';
import { indexToCoords, coordsToIndex, hexCoordMap } from '../utils/utils.js'; // Use map from utils

// --- Module State ---

let worldsData = []; // Array to hold data for each world instance
// Each element: { jsStateArray, jsNextStateArray, jsHoverStateArray, stats: { ratio, avgRatio, history } }

let currentRuleset = new Uint8Array(128);
let currentRulesetHex = "N/A";

let isPaused = true;
let tickTimer = 0;
let currentSpeed = Config.DEFAULT_SPEED;
let tickDuration = 1.0 / currentSpeed;

let selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;

// --- Initialization ---

/**
 * Initializes the simulation state for all worlds.
 */
export function initSimulation() {
    console.log("Initializing Simulation...");
    worldsData = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const jsStateArray = new Uint8Array(Config.NUM_CELLS);
        const jsNextStateArray = new Uint8Array(Config.NUM_CELLS);
        const jsHoverStateArray = new Uint8Array(Config.NUM_CELLS); // For hover effect

        // Initialize state based on density
        const density = Config.INITIAL_DENSITIES[i] ?? 0; // Use configured density or 0
        let activeCount = 0;
        for (let cellIdx = 0; cellIdx < Config.NUM_CELLS; cellIdx++) {
            const state = Math.random() < density ? 1 : 0;
            jsStateArray[cellIdx] = state;
            if (state === 1) activeCount++;
        }
        jsNextStateArray.fill(0);
        jsHoverStateArray.fill(0);

        // Initialize statistics
        const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
        const stats = {
            ratio: initialRatio,
            avgRatio: initialRatio,
            history: new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio) // Pre-fill history
        };

        worldsData.push({
            jsStateArray,
            jsNextStateArray,
            jsHoverStateArray,
            stats
        });
    }

    // Set initial ruleset
    generateRandomRuleset();
    currentRulesetHex = rulesetToHex(currentRuleset);

    // Set initial simulation state
    isPaused = true;
    tickTimer = 0;
    currentSpeed = Config.DEFAULT_SPEED;
    tickDuration = currentSpeed > 0 ? 1.0 / currentSpeed : Infinity;
    selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;

    console.log(`Simulation initialized with ${Config.NUM_WORLDS} worlds.`);
}


// --- Simulation Step Logic ---

/**
 * Performs a single simulation step update for all worlds. (Internal)
 */
function runSingleStepForAllWorlds() {
    for (let worldIdx = 0; worldIdx < worldsData.length; worldIdx++) {
        const world = worldsData[worldIdx];
        const { jsStateArray, jsNextStateArray } = world;
        let activeCount = 0;

        for (let i = 0; i < Config.NUM_CELLS; i++) {
            const centerCoords = indexToCoords(i);
            if (!centerCoords) continue;

            const centerState = jsStateArray[i];
            let neighborStatesBitmask = 0;
            const potentialNeighbors = getNeighbors(centerCoords.col, centerCoords.row);

            for (let neighborOrder = 0; neighborOrder < 6; neighborOrder++) {
                const [nCol, nRow] = potentialNeighbors[neighborOrder] || [null, null];
                if (nCol !== null) {
                    const wrappedNCol = (nCol % Config.GRID_COLS + Config.GRID_COLS) % Config.GRID_COLS;
                    const wrappedNRow = (nRow % Config.GRID_ROWS + Config.GRID_ROWS) % Config.GRID_ROWS;
                    const neighborMapIndex = coordsToIndex(wrappedNCol, wrappedNRow);

                    if (neighborMapIndex !== undefined && jsStateArray[neighborMapIndex] === 1) {
                        neighborStatesBitmask |= (1 << neighborOrder);
                    }
                }
            }

            const ruleIndex = (centerState << 6) | neighborStatesBitmask;
            const nextState = currentRuleset[ruleIndex];
            jsNextStateArray[i] = nextState;

            if (nextState === 1) {
                activeCount++;
            }
        }

        // Update stats after calculating next state
        updateWorldStats(world, activeCount);

        // Swap buffers (copy next state to current state)
        world.jsStateArray.set(world.jsNextStateArray);
    }
}

/**
 * Updates the statistics for a given world.
 * @param {object} world World data object.
 * @param {number} activeCount Number of active cells in the *next* state.
 */
function updateWorldStats(world, activeCount) {
    const stats = world.stats;
    stats.ratio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
    stats.history.push(stats.ratio);
    if (stats.history.length > Config.STATS_HISTORY_SIZE) {
        stats.history.shift(); // Remove oldest entry
    }
    const sum = stats.history.reduce((acc, val) => acc + val, 0);
    stats.avgRatio = stats.history.length > 0 ? sum / stats.history.length : 0;
}


/**
 * Advances the simulation based on time delta. Calls internal step if needed.
 * Limits the number of steps processed per frame to avoid freezing after inactivity.
 * @param {number} timeDelta Time elapsed since last frame in seconds.
 * @returns {boolean} True if at least one simulation step occurred, false otherwise.
 */
export function stepSimulation(timeDelta) {
    if (isPaused) return false;

    // --- Prevent massive catch-up ---
    // Cap the time delta to avoid excessive steps after long pauses (e.g., 1 second max)
    const maxDeltaTime = 1.0; // Maximum time to process per frame (in seconds)
    timeDelta = Math.min(timeDelta, maxDeltaTime);
    // Alternatively, or in addition, limit the number of steps directly:
    const maxStepsPerFrame = 10; // e.g., don't run more than 10 steps per render frame
    let stepsTakenThisFrame = 0;
    // --- End prevention ---


    tickTimer += timeDelta;
    let stepOccurred = false;

    // Original loop, but now respects maxStepsPerFrame
    while (tickTimer >= tickDuration && stepsTakenThisFrame < maxStepsPerFrame) {
        runSingleStepForAllWorlds();
        tickTimer -= tickDuration;
        stepOccurred = true;
        stepsTakenThisFrame++;
        if (isPaused) break; // Check pause state again in case it changed mid-frame
    }

    // Optional: If timer is still large after max steps, reset it partially or fully
    // to prevent it growing indefinitely if frame rate is too low for sim speed.
    if (tickTimer >= tickDuration) {
        // Example: Reset timer slightly ahead, keeps some accumulated time but avoids huge values
         tickTimer = tickDuration + (tickTimer % tickDuration);
        // Or simply clamp it:
        // tickTimer = Math.max(0, tickTimer); // Ensure non-negative
    }


    return stepOccurred;
}


// --- Ruleset Management ---

export function generateRandomRuleset(bias = 0.5) {
    console.log("Generating random ruleset with bias:", bias);
    for (let i = 0; i < 128; i++) {
        currentRuleset[i] = Math.random() < bias ? 1 : 0;
    }
    // Ensure non-flickering (optional)
     if (currentRuleset[0] === 1 && currentRuleset[127] === 0) {
       if(Math.random() < 0.5) currentRuleset[127] = 1; else currentRuleset[0] = 0;
    } else if (currentRuleset[0] === 0 && currentRuleset[127] === 1) {
       if(Math.random() < 0.5) currentRuleset[127] = 0; else currentRuleset[0] = 1;
    }
    currentRulesetHex = rulesetToHex(currentRuleset); // Update hex cache
    console.log("Generated random ruleset:", currentRulesetHex);
}

export function rulesetToHex(rulesetArray) {
    let binaryString = "";
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    for (let i = 0; i < 128; i++) {
        binaryString += rulesetArray[i];
    }
    try {
        const bigIntValue = BigInt('0b' + binaryString);
        let hexValue = bigIntValue.toString(16).toUpperCase();
        while (hexValue.length < 32) hexValue = "0" + hexValue;
        return hexValue;
    } catch (e) { return "Error"; }
}

export function hexToRuleset(hexString) {
    const ruleset = new Uint8Array(128);
    if (!hexString || !/^[0-9a-fA-F]{32}$/.test(hexString)) {
        console.error("Invalid hex string provided to hexToRuleset:", hexString);
        ruleset.fill(0); // Return default (all off) on error
        return ruleset;
    }
    try {
        const bigIntValue = BigInt('0x' + hexString);
        let binaryString = bigIntValue.toString(2);
        while (binaryString.length < 128) binaryString = "0" + binaryString;
        for (let i = 0; i < 128; i++) {
            ruleset[i] = binaryString[i] === '1' ? 1 : 0;
        }
        return ruleset;
    } catch (e) {
        console.error("Error converting hex to ruleset:", e);
        ruleset.fill(0);
        return ruleset;
    }
}

/**
 * Sets the current ruleset from a hex string.
 * @param {string} hexString 32-character hex ruleset code.
 */
export function setRuleset(hexString) {
    const newRuleset = hexToRuleset(hexString);
    // Check if conversion was successful (might return default on error)
    const newHex = rulesetToHex(newRuleset);
     if (newHex !== "Error" && newHex.toUpperCase() === hexString.toUpperCase()) {
          currentRuleset.set(newRuleset);
          currentRulesetHex = newHex;
          console.log("Ruleset updated to:", currentRulesetHex);
          return true; // Indicate success
     } else {
         console.error("Failed to apply ruleset from hex:", hexString);
         return false; // Indicate failure
     }
}

/**
 * Toggles the output state of a single rule.
 * @param {number} ruleIndex The index of the rule (0-127) to toggle.
 */
export function toggleRuleOutputState(ruleIndex) {
    if (ruleIndex >= 0 && ruleIndex < 128) {
        currentRuleset[ruleIndex] = 1 - currentRuleset[ruleIndex];
        currentRulesetHex = rulesetToHex(currentRuleset);
        console.log(`Rule ${ruleIndex} toggled. New hex: ${currentRulesetHex}`);
    }
}

/**
 * Sets all rule output states to a target state (0 or 1).
 * @param {0 | 1} targetState The state to set all rules to.
 */
export function setAllRulesState(targetState) {
    if (targetState === 0 || targetState === 1) {
        for (let i = 0; i < 128; i++) {
            currentRuleset[i] = targetState;
        }
        currentRulesetHex = rulesetToHex(currentRuleset);
        console.log(`All rules set to ${targetState}. New hex: ${currentRulesetHex}`);
    }
}


// --- Neighbor Finding (Adapted from previous main.js / utils.js) ---

/**
 * Gets potential neighbor coordinates for a given cell. (Flat-top, odd-r layout)
 * @param {number} col Column index.
 * @param {number} row Row index.
 * @returns {Array<[number, number]>} Array of [col, row] pairs for neighbors.
 */
function getNeighbors(col, row) {
    let neighbor_dirs;
     // Using odd-r layout directions from previous Java code logic
    if (col % 2 !== 0) { // Odd column (shifted down)
        neighbor_dirs = [
            [+1,  0], [+1, +1], [ 0, +1], // Right, Bottom-right, Bottom
            [-1, +1], [-1,  0], [ 0, -1]  // Bottom-left, Left, Top-left
        ];
    } else { // Even column
        neighbor_dirs = [
            [+1, -1], [+1,  0], [ 0, +1], // Top-right, Right, Bottom-right
            [-1,  0], [-1, -1], [ 0, -1]  // Left, Top-left, Top
        ];
    }

    const neighbors = [];
    for (const [dCol, dRow] of neighbor_dirs) {
        neighbors.push([col + dCol, row + dRow]);
    }
    return neighbors;
}

/**
 * Finds all cell indices within N steps from start coordinates using BFS (Toroidal).
 * @param {number} startCol Starting column.
 * @param {number} startRow Starting row.
 * @param {number} maxDistance Max steps (neighborhood size).
 * @returns {Array<number>} Array of affected cell indices.
 */
function findHexagonsInNeighborhood(startCol, startRow, maxDistance) {
    const startKey = `${startCol},${startRow}`;
    const startIndex = coordsToIndex(startCol, startRow);
    if (startIndex === undefined) return [];

    const affectedIndices = new Set([startIndex]); // Include center cell
    const queue = [[startCol, startRow, 0]]; // [col, row, distance]
    const visited = new Map([[startKey, 0]]);

    while (queue.length > 0) {
        const [ currentCol, currentRow, currentDistance ] = queue.shift();
        if (currentDistance >= maxDistance) continue;

        const potentialNeighbors = getNeighbors(currentCol, currentRow);
        for (const [nextCol, nextRow] of potentialNeighbors) {
            const wrappedCol = (nextCol % Config.GRID_COLS + Config.GRID_COLS) % Config.GRID_COLS;
            const wrappedRow = (nextRow % Config.GRID_ROWS + Config.GRID_ROWS) % Config.GRID_ROWS;
            const nextKey = `${wrappedCol},${wrappedRow}`;

            if (!visited.has(nextKey)) {
                const nextIndex = coordsToIndex(wrappedCol, wrappedRow);
                if (nextIndex !== undefined) {
                    visited.set(nextKey, currentDistance + 1);
                    affectedIndices.add(nextIndex);
                    queue.push([wrappedCol, wrappedRow, currentDistance + 1]);
                }
            }
        }
    }
    return Array.from(affectedIndices);
}

// --- Interaction Functions ---

/**
 * Updates the hover state for a specific world.
 * @param {number} worldIndex Index of the world.
 * @param {number|null} col Column under cursor (or null to clear).
 * @param {number|null} row Row under cursor (or null to clear).
 * @param {number} brushSize Current brush size.
 * @returns {boolean} True if the hover state changed.
 */
export function setHoverState(worldIndex, col, row, brushSize) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    const world = worldsData[worldIndex];
    const hoverState = world.jsHoverStateArray;
    let changed = false;

    // Calculate new hover indices
    let newHoverIndices = new Set();
    if (col !== null && row !== null) {
        const indices = findHexagonsInNeighborhood(col, row, brushSize);
        newHoverIndices = new Set(indices);
    }

    // Compare with current hover state and update if different
    // Check if sizes differ first for quick exit
    let currentHoverCount = 0;
     for(let i=0; i< hoverState.length; i++) { if(hoverState[i] === 1) currentHoverCount++; }

    if (newHoverIndices.size !== currentHoverCount) {
        changed = true;
    } else {
        // If sizes are same, check if elements differ
        for (const index of newHoverIndices) {
            if (hoverState[index] === 0) {
                changed = true;
                break;
            }
        }
    }

    if (changed) {
        hoverState.fill(0); // Clear previous
        for (const index of newHoverIndices) {
             if (index >= 0 && index < hoverState.length) { // Bounds check just in case
                 hoverState[index] = 1;
             }
        }
    }

    return changed;
}

/**
 * Clears the hover state for a specific world.
 * @param {number} worldIndex Index of the world.
 * @returns {boolean} True if hover state was cleared.
 */
export function clearHoverState(worldIndex) {
     if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
     const hoverState = worldsData[worldIndex].jsHoverStateArray;
     let changed = false;
     for(let i=0; i<hoverState.length; i++) {
         if (hoverState[i] === 1) {
             hoverState[i] = 0;
             changed = true;
         }
     }
     return changed;
}

/**
 * Applies the brush (toggles state) to a specific world.
 * @param {number} worldIndex Index of the world.
 * @param {number} col Column of the click center.
 * @param {number} row Row of the click center.
 * @param {number} brushSize Current brush size.
 * @returns {boolean} True if any state changed.
 */
export function applyBrush(worldIndex, col, row, brushSize) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    const world = worldsData[worldIndex];
    const stateArray = world.jsStateArray;
    let changed = false;

    const affectedIndices = findHexagonsInNeighborhood(col, row, brushSize);

    for (const index of affectedIndices) {
        if (index >= 0 && index < stateArray.length) {
            stateArray[index] = 1 - stateArray[index]; // Toggle
            changed = true;
        }
    }
    // If state changed, we might need to immediately recalculate stats for this world
    if(changed) {
        let activeCount = 0;
        for(let i=0; i < stateArray.length; i++) { if(stateArray[i] === 1) activeCount++; }
        updateWorldStats(world, activeCount);
        // Reset history to avoid averaging incorrect intermediate state? Or just let it flow? Let it flow for now.
    }

    return changed;
}

/**
 * Sets the simulation pause state.
 * @param {boolean} paused Desired pause state.
 */
export function setSimulationPaused(paused) {
    isPaused = paused;
    if (!isPaused) tickTimer = 0; // Reset timer when resuming to avoid jump
}

/**
 * Sets the simulation speed (ticks per second).
 * @param {number} speed Desired speed.
 */
export function setSimulationSpeed(speed) {
    currentSpeed = Math.max(0, Math.min(Config.MAX_SIM_SPEED, speed));
    tickDuration = currentSpeed > 0 ? 1.0 / currentSpeed : Infinity;
}

/**
 * Sets the index of the currently selected world.
 * @param {number} index The index to select.
 */
export function setSelectedWorldIndex(index) {
    if (index >= 0 && index < worldsData.length) {
        selectedWorldIndex = index;
    }
}

/**
 * Loads state data into a specific world.
 * @param {number} worldIndex The index of the world to load into.
 * @param {object} stateData Parsed state object {rows, cols, state, ruleset?}.
 * @returns {boolean} True on success, false on failure (e.g., dimension mismatch).
 */
export function loadWorldState(worldIndex, stateData) {
     if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
     if (!stateData || typeof stateData.rows !== 'number' || typeof stateData.cols !== 'number' || !Array.isArray(stateData.state)) {
         console.error("Invalid state data format for loadWorldState.");
         return false;
     }
     // Dimension Check (Phase 3: Still require match)
     if (stateData.rows !== Config.GRID_ROWS || stateData.cols !== Config.GRID_COLS) {
         console.error(`Dimension mismatch! File: ${stateData.cols}x${stateData.rows}, Grid: ${Config.GRID_COLS}x${Config.GRID_ROWS}.`);
         alert(`Dimension mismatch! Cannot load state for ${stateData.cols}x${stateData.rows} grid into current ${Config.GRID_COLS}x${Config.GRID_ROWS} setup.`);
         return false;
     }
     if (stateData.state.length !== Config.NUM_CELLS) {
         console.error("State data length mismatch.");
         return false;
     }

     const world = worldsData[worldIndex];
     world.jsStateArray = Uint8Array.from(stateData.state);
     world.jsNextStateArray.fill(0); // Clear next state
     world.jsHoverStateArray.fill(0); // Clear hover state

     // Load associated ruleset if present
     if (stateData.ruleset) {
         setRuleset(stateData.ruleset);
     }

      // Reset and recalculate stats
     let activeCount = 0;
     for(let i=0; i < world.jsStateArray.length; i++) { if(world.jsStateArray[i] === 1) activeCount++; }
     const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
     world.stats.ratio = initialRatio;
     world.stats.history = new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio);
     world.stats.avgRatio = initialRatio;

     return true;
}

/**
 * Gets the state data for a specific world, formatted for saving.
 * @param {number} worldIndex Index of the world.
 * @returns {object|null} State data object or null if index is invalid.
 */
export function getWorldStateForSave(worldIndex) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return null;
    const world = worldsData[worldIndex];
    return {
        rows: Config.GRID_ROWS,
        cols: Config.GRID_COLS,
        ruleset: currentRulesetHex,
        state: Array.from(world.jsStateArray) // Convert to standard array for JSON
    };
}

/**
 * Resets all world states back to their initial densities.
 * Also pauses the simulation.
 */
export function resetAllWorldStates() {
    console.log("Resetting all world states...");
    if (!worldsData) return;

    for (let i = 0; i < worldsData.length; i++) {
        const world = worldsData[i];
        const density = Config.INITIAL_DENSITIES[i] ?? 0;
        let activeCount = 0;

        for (let cellIdx = 0; cellIdx < Config.NUM_CELLS; cellIdx++) {
            const state = Math.random() < density ? 1 : 0;
            world.jsStateArray[cellIdx] = state; // Reset state
            if (state === 1) activeCount++;
        }
        world.jsNextStateArray.fill(0); // Clear next state buffer
        world.jsHoverStateArray.fill(0); // Clear hover state

        // Reset statistics
        const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
        world.stats.ratio = initialRatio;
        world.stats.history = new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio);
        world.stats.avgRatio = initialRatio;
    }

    // Pause simulation after reset
    //setSimulationPaused(true); // Use the exported setter

    console.log("All world states reset.");
    // Note: Need to ensure renderer updates buffers on next frame
}


// --- Getters ---

export function getWorldsData() { return worldsData; }
export function getCurrentRulesetHex() { return currentRulesetHex; }
export function isSimulationPaused() { return isPaused; }
export function getTickDuration() { return tickDuration; } // May not be needed externally
export function getSelectedWorldIndex() { return selectedWorldIndex; }
export function getSelectedWorldStats() {
    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldsData.length) {
        return worldsData[selectedWorldIndex].stats;
    }
    return null; // Or return default stats object
}
// ADDED: Getter for the raw ruleset array
export function getCurrentRulesetArray() {
    // Return a copy to prevent accidental modification outside the module
    return new Uint8Array(currentRuleset);
}