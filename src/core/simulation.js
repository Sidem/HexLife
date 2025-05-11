// src/core/simulation.js
import * as Config from './config.js';
import { indexToCoords, coordsToIndex } from '../utils/utils.js';

const NEIGHBOR_DIRS_ODD_R = [
    [+1,  0], [+1, +1], [ 0, +1],
    [-1, +1], [-1,  0], [ 0, -1]
];
const NEIGHBOR_DIRS_EVEN_R = [
    [+1, -1], [+1,  0], [ 0, +1],
    [-1,  0], [-1, -1], [ 0, -1]
];

// --- localStorage Helper Functions ---
function _saveToLocalStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error(`Error saving to localStorage (key: ${key}):`, e);
    }
}

function _loadFromLocalStorage(key, defaultValue) {
    try {
        const value = localStorage.getItem(key);
        if (value === null || value === undefined) {
            return defaultValue;
        }
        return JSON.parse(value);
    } catch (e) {
        console.error(`Error loading from localStorage (key: ${key}):`, e);
        return defaultValue;
    }
}

// --- Module State ---
let worldsData = []; // Each element: { jsStateArray, jsNextStateArray, jsHoverStateArray, jsRuleIndexArray, jsNextRuleIndexArray, stats, enabled, initialDensity }
let currentRuleset = new Uint8Array(128);
let currentRulesetHex = "N/A";

let isPaused = true;
let tickTimer = 0;
let currentSpeed = Config.DEFAULT_SPEED; // Will be loaded/set from LS
let tickDuration = 1.0 / currentSpeed;

let selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;

// --- Initialization ---
export function initSimulation() {
    console.log("Initializing Simulation...");

    // Load settings from localStorage or use defaults
    currentSpeed = _loadFromLocalStorage(Config.LS_KEY_SIM_SPEED, Config.DEFAULT_SPEED);
    setSimulationSpeed(currentSpeed); // This also sets tickDuration and saves

    const loadedRulesetHex = _loadFromLocalStorage(Config.LS_KEY_RULESET, null);
    if (loadedRulesetHex) {
        setRuleset(loadedRulesetHex); // This sets currentRuleset and currentRulesetHex, and saves
    } else {
        generateRandomRuleset(); // This sets and saves
    }

    let worldSettings = _loadFromLocalStorage(Config.LS_KEY_WORLD_SETTINGS, []);
    if (!worldSettings || worldSettings.length !== Config.NUM_WORLDS) {
        worldSettings = [];
        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            worldSettings.push({
                initialDensity: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0,
                enabled: Config.DEFAULT_WORLD_ENABLED_STATES[i] ?? true
            });
        }
        _saveToLocalStorage(Config.LS_KEY_WORLD_SETTINGS, worldSettings);
    }

    worldsData = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const settings = worldSettings[i];
        const jsStateArray = new Uint8Array(Config.NUM_CELLS);
        // Other arrays remain the same
        const jsNextStateArray = new Uint8Array(Config.NUM_CELLS).fill(0);
        const jsHoverStateArray = new Uint8Array(Config.NUM_CELLS).fill(0);
        const jsRuleIndexArray = new Uint8Array(Config.NUM_CELLS).fill(0);
        const jsNextRuleIndexArray = new Uint8Array(Config.NUM_CELLS).fill(0);

        let activeCount = 0;
        if (settings.enabled) {
            // Initialize state based on density for enabled worlds
            const density = settings.initialDensity;
            if (density === 0 && Config.NUM_CELLS > 0) { // Special case for 0 density: single cell
                 jsStateArray.fill(0);
                 const middleIndex = Math.floor(Config.NUM_CELLS / 2) + Math.floor(Config.GRID_COLS / 2);
                 if(middleIndex < Config.NUM_CELLS) jsStateArray[middleIndex] = 1;
                 activeCount = 1;
            } else if (density === 1 && Config.NUM_CELLS > 0) { // Special case for 1 density: all but one
                jsStateArray.fill(1);
                const middleIndex = Math.floor(Config.NUM_CELLS / 2) + Math.floor(Config.GRID_COLS / 2);
                if(middleIndex < Config.NUM_CELLS) jsStateArray[middleIndex] = 0;
                activeCount = Config.NUM_CELLS -1;
            } else {
                for (let cellIdx = 0; cellIdx < Config.NUM_CELLS; cellIdx++) {
                    const state = Math.random() < density ? 1 : 0;
                    jsStateArray[cellIdx] = state;
                    if (state === 1) activeCount++;
                }
            }
        } else {
            jsStateArray.fill(0); // Disabled worlds start empty
            activeCount = 0;
        }

        const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
        const stats = {
            ratio: initialRatio,
            avgRatio: initialRatio,
            history: new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio)
        };

        worldsData.push({
            jsStateArray, jsNextStateArray, jsHoverStateArray, jsRuleIndexArray, jsNextRuleIndexArray,
            stats,
            enabled: settings.enabled,
            initialDensity: settings.initialDensity
        });
    }

    isPaused = true; // Start paused
    tickTimer = 0;
    selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;

    console.log(`Simulation initialized with ${Config.NUM_WORLDS} worlds.`);
}

function countSetBits(n) {
    let count = 0;
    for (let i = 0; i < 6; i++) { if ((n >> i) & 1) count++; }
    return count;
}

// --- Simulation Step Logic ---
function runSingleStepForAllWorlds() {
    const numCols = Config.GRID_COLS;
    const numRows = Config.GRID_ROWS;

    for (let worldIdx = 0; worldIdx < worldsData.length; worldIdx++) {
        const world = worldsData[worldIdx];
        if (!world.enabled) continue; // Skip disabled worlds

        const { jsStateArray, jsNextStateArray, jsNextRuleIndexArray } = world;
        let activeCount = 0;

        for (let i = 0; i < Config.NUM_CELLS; i++) {
            const centerCol = i % numCols;
            const centerRow = Math.floor(i / numCols);
            const centerState = jsStateArray[i];
            let neighborStatesBitmask = 0;
            const base_dirs = (centerCol % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;

            for (let neighborOrder = 0; neighborOrder < 6; neighborOrder++) {
                const dCol = base_dirs[neighborOrder][0];
                const dRow = base_dirs[neighborOrder][1];
                const nCol = (centerCol + dCol + numCols) % numCols;
                const nRow = (centerRow + dRow + numRows) % numRows;
                const neighborMapIndex = nRow * numCols + nCol;
                if (jsStateArray[neighborMapIndex] === 1) {
                    neighborStatesBitmask |= (1 << neighborOrder);
                }
            }

            const ruleIndex = (centerState << 6) | neighborStatesBitmask;
            const nextState = currentRuleset[ruleIndex];
            jsNextStateArray[i] = nextState;
            jsNextRuleIndexArray[i] = ruleIndex;
            if (nextState === 1) activeCount++;
        }
        updateWorldStats(world, activeCount);
        world.jsStateArray.set(world.jsNextStateArray);
        world.jsRuleIndexArray.set(world.jsNextRuleIndexArray);
    }
}

function updateWorldStats(world, activeCount) {
    const stats = world.stats;
    stats.ratio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
    stats.history.push(stats.ratio);
    if (stats.history.length > Config.STATS_HISTORY_SIZE) stats.history.shift();
    const sum = stats.history.reduce((acc, val) => acc + val, 0);
    stats.avgRatio = stats.history.length > 0 ? sum / stats.history.length : 0;
}

export function stepSimulation(timeDelta) {
    if (isPaused) return 0;
    const maxDeltaTime = 1.0;
    timeDelta = Math.min(timeDelta, maxDeltaTime);
    const maxStepsPerFrame = 10;
    let stepsTakenThisFrame = 0;
    tickTimer += timeDelta;

    while (tickTimer >= tickDuration && stepsTakenThisFrame < maxStepsPerFrame) {
        runSingleStepForAllWorlds();
        tickTimer -= tickDuration;
        stepsTakenThisFrame++;
        if (isPaused) break;
    }
    if (tickTimer >= tickDuration && stepsTakenThisFrame >= maxStepsPerFrame) {
         tickTimer = tickDuration + (tickTimer % tickDuration);
    }
    return stepsTakenThisFrame;
}

// --- Ruleset Management ---
export function generateRandomRuleset(bias = 0.5, generateSymmetrically = false) {
    console.log(`Generating random ruleset with bias: ${bias}, symmetrical: ${generateSymmetrically}`);
    if (generateSymmetrically) {
        // ... (original symmetrical logic) ...
        for (let centerState = 0; centerState <= 1; centerState++) {
            for (let numActiveNeighbors = 0; numActiveNeighbors <= 6; numActiveNeighbors++) {
                const randomOutput = Math.random() < bias ? 1 : 0;
                _setRulesForNeighborCountConditionInternal(centerState, numActiveNeighbors, randomOutput);
            }
        }
    } else {
        for (let i = 0; i < 128; i++) {
            currentRuleset[i] = Math.random() < bias ? 1 : 0;
        }
        // ... (original anti-flicker logic) ...
        if (currentRuleset[0] === 1 && currentRuleset[127] === 0) {
            if (Math.random() < 0.5) currentRuleset[127] = 1; else currentRuleset[0] = 0;
        } else if (currentRuleset[0] === 0 && currentRuleset[127] === 1) {
            if (Math.random() < 0.5) currentRuleset[127] = 0; else currentRuleset[0] = 1;
        }
    }
    currentRulesetHex = rulesetToHex(currentRuleset);
    _saveToLocalStorage(Config.LS_KEY_RULESET, currentRulesetHex);
    console.log("Generated random ruleset:", currentRulesetHex);
}

function _setRulesForNeighborCountConditionInternal(centerState, numActiveNeighbors, outputState) {
    // ... (original internal logic) ...
    if (centerState !== 0 && centerState !== 1) return;
    if (numActiveNeighbors < 0 || numActiveNeighbors > 6) return;
    if (outputState !== 0 && outputState !== 1) return;

    for (let neighborMask = 0; neighborMask < 64; neighborMask++) {
        if (countSetBits(neighborMask) === numActiveNeighbors) {
            const ruleIndex = (centerState << 6) | neighborMask;
            currentRuleset[ruleIndex] = outputState;
        }
    }
}

export function setRulesForNeighborCountCondition(centerState, numActiveNeighbors, outputState) {
    _setRulesForNeighborCountConditionInternal(centerState, numActiveNeighbors, outputState);
    currentRulesetHex = rulesetToHex(currentRuleset);
    _saveToLocalStorage(Config.LS_KEY_RULESET, currentRulesetHex);
    console.log(`Rules set for C=${centerState}, N=${numActiveNeighbors} -> ${outputState}. New hex: ${currentRulesetHex}`);
}

export function getEffectiveRuleForNeighborCount(centerState, numActiveNeighbors) {
    // ... (original logic) ...
    if (centerState !== 0 && centerState !== 1) return 2; // Invalid input
    if (numActiveNeighbors < 0 || numActiveNeighbors > 6) return 2; // Invalid input

    let firstOutput = -1;
    let ruleFound = false;

    for (let neighborMask = 0; neighborMask < 64; neighborMask++) {
        if (countSetBits(neighborMask) === numActiveNeighbors) {
            ruleFound = true;
            const ruleIndex = (centerState << 6) | neighborMask;
            const currentOutput = currentRuleset[ruleIndex];

            if (firstOutput === -1) {
                firstOutput = currentOutput;
            } else if (firstOutput !== currentOutput) {
                return 2; // Mixed states
            }
        }
    }
    return ruleFound ? firstOutput : 2;
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
    const newHex = rulesetToHex(newRuleset);
    if (newHex !== "Error" && newHex.toUpperCase() === hexString.toUpperCase()) {
        currentRuleset.set(newRuleset);
        currentRulesetHex = newHex;
        _saveToLocalStorage(Config.LS_KEY_RULESET, currentRulesetHex);
        console.log("Ruleset updated to:", currentRulesetHex);
        return true;
    }
    console.error("Failed to apply ruleset from hex:", hexString);
    return false;
}

export function toggleRuleOutputState(ruleIndex) {
    if (ruleIndex >= 0 && ruleIndex < 128) {
        currentRuleset[ruleIndex] = 1 - currentRuleset[ruleIndex];
        currentRulesetHex = rulesetToHex(currentRuleset);
        _saveToLocalStorage(Config.LS_KEY_RULESET, currentRulesetHex);
        console.log(`Rule ${ruleIndex} toggled. New hex: ${currentRulesetHex}`);
    }
}

export function setAllRulesState(targetState) {
    if (targetState === 0 || targetState === 1) {
        currentRuleset.fill(targetState);
        currentRulesetHex = rulesetToHex(currentRuleset);
        _saveToLocalStorage(Config.LS_KEY_RULESET, currentRulesetHex);
        console.log(`All rules set to ${targetState}. New hex: ${currentRulesetHex}`);
    }
}


// --- Neighbor Finding (Adapted from previous main.js / utils.js) ---

/**
 * Gets potential neighbor coordinates for a given cell. (Flat-top, odd-r layout)
 * Uses precomputed direction arrays.
 * @param {number} col Column index.
 * @param {number} row Row index.
 * @returns {Array<[number, number]>} Array of [col, row] pairs for neighbors.
 */
function getNeighbors(col, row) { // This function is still used by findHexagonsInNeighborhood
    const base_dirs = (col % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;
    const neighbors = []; // Array creation is necessary here
    for (let i = 0; i < 6; i++) { // Loop 6 times explicitly
        neighbors.push([col + base_dirs[i][0], row + base_dirs[i][1]]);
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
    if (worldIndex < 0 || worldIndex >= worldsData.length || !worldsData[worldIndex].enabled) return false;
    const world = worldsData[worldIndex];
    const hoverState = world.jsHoverStateArray;
    let changed = false;

    let newHoverIndices = new Set();
    if (col !== null && row !== null) {
        const indices = findHexagonsInNeighborhood(col, row, brushSize);
        newHoverIndices = new Set(indices);
    }

    let currentHoverCount = 0;
     for(let i=0; i< hoverState.length; i++) { if(hoverState[i] === 1) currentHoverCount++; }

    if (newHoverIndices.size !== currentHoverCount) {
        changed = true;
    } else {
        for (const index of newHoverIndices) {
            if (hoverState[index] === 0) {
                changed = true;
                break;
            }
        }
    }
    if (changed) {
        hoverState.fill(0);
        for (const index of newHoverIndices) {
             if (index >= 0 && index < hoverState.length) {
                 hoverState[index] = 1;
             }
        }
    }
    return changed;
}

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

export function applyBrush(worldIndex, col, row, brushSize) {
    if (worldIndex < 0 || worldIndex >= worldsData.length || !worldsData[worldIndex].enabled) return false;
    const world = worldsData[worldIndex];
    const stateArray = world.jsStateArray;
    const ruleIndexArray = world.jsRuleIndexArray;
    let changed = false;

    const affectedIndices = findHexagonsInNeighborhood(col, row, brushSize);

    for (const index of affectedIndices) {
        if (index >= 0 && index < stateArray.length) {
            stateArray[index] = 1 - stateArray[index]; // Toggle
            ruleIndexArray[index] = 0; // Assign default rule for manual toggle
            changed = true;
        }
    }
    if(changed) {
        let activeCount = 0;
        for(let i=0; i < stateArray.length; i++) { if(stateArray[i] === 1) activeCount++; }
        updateWorldStats(world, activeCount);
    }
    return changed;
}

// --- Simulation Control & Settings ---
export function setSimulationPaused(paused) {
    isPaused = paused;
    if (!isPaused) tickTimer = 0;
}

export function setSimulationSpeed(speed) {
    currentSpeed = Math.max(0, Math.min(Config.MAX_SIM_SPEED, speed));
    tickDuration = currentSpeed > 0 ? 1.0 / currentSpeed : Infinity;
    _saveToLocalStorage(Config.LS_KEY_SIM_SPEED, currentSpeed);
}
// BRUSH SIZE is managed by main.js and UI, but simulation needs to save/load it.
// Let's add a setter here for main.js to call, which also saves it.
let currentBrushSize = Config.DEFAULT_NEIGHBORHOOD_SIZE; // Local cache

export function loadBrushSize() { // Called by main.js during its init
    currentBrushSize = _loadFromLocalStorage(Config.LS_KEY_BRUSH_SIZE, Config.DEFAULT_NEIGHBORHOOD_SIZE);
    return currentBrushSize;
}
export function setBrushSize(size) { // Called by main.js when UI changes it
    currentBrushSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, size));
    _saveToLocalStorage(Config.LS_KEY_BRUSH_SIZE, currentBrushSize);
}


export function setSelectedWorldIndex(index) {
    if (index >= 0 && index < worldsData.length) {
        selectedWorldIndex = index;
    }
}

export function setWorldInitialDensity(worldIndex, density) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    density = Math.max(0, Math.min(1, density)); // Clamp density
    worldsData[worldIndex].initialDensity = density;
    const allSettings = worldsData.map(w => ({ initialDensity: w.initialDensity, enabled: w.enabled }));
    _saveToLocalStorage(Config.LS_KEY_WORLD_SETTINGS, allSettings);
    return true;
}

export function setWorldEnabled(worldIndex, isEnabled) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    worldsData[worldIndex].enabled = !!isEnabled; // Ensure boolean
    if (!worldsData[worldIndex].enabled) { // If disabling, clear its state
        worldsData[worldIndex].jsStateArray.fill(0);
        worldsData[worldIndex].jsRuleIndexArray.fill(0);
        updateWorldStats(worldsData[worldIndex], 0);
    }
    const allSettings = worldsData.map(w => ({ initialDensity: w.initialDensity, enabled: w.enabled }));
    _saveToLocalStorage(Config.LS_KEY_WORLD_SETTINGS, allSettings);
    return true;
}

export function getWorldSettings() {
    return worldsData.map(w => ({
        initialDensity: w.initialDensity,
        enabled: w.enabled
    }));
}

export function resetAllWorldsToCurrentSettings() {
    console.log("Resetting all worlds to current settings...");
    if (!worldsData) return;

    for (let i = 0; i < worldsData.length; i++) {
        const world = worldsData[i];
        let activeCount = 0;

        if (world.enabled) {
            const density = world.initialDensity;
            // Apply density logic (copied from initSimulation for consistency)
            if (density === 0 && Config.NUM_CELLS > 0) {
                 world.jsStateArray.fill(0);
                 const middleIndex = Math.floor(Config.NUM_CELLS / 2) + Math.floor(Config.GRID_COLS / 2);
                 if(middleIndex < Config.NUM_CELLS) world.jsStateArray[middleIndex] = 1;
                 activeCount = 1;
            } else if (density === 1 && Config.NUM_CELLS > 0) {
                world.jsStateArray.fill(1);
                const middleIndex = Math.floor(Config.NUM_CELLS / 2) + Math.floor(Config.GRID_COLS / 2);
                if(middleIndex < Config.NUM_CELLS) world.jsStateArray[middleIndex] = 0;
                activeCount = Config.NUM_CELLS -1;
            } else {
                for (let cellIdx = 0; cellIdx < Config.NUM_CELLS; cellIdx++) {
                    const state = Math.random() < density ? 1 : 0;
                    world.jsStateArray[cellIdx] = state;
                    if (state === 1) activeCount++;
                }
            }
        } else {
            world.jsStateArray.fill(0); // Disabled worlds are reset to empty
            activeCount = 0;
        }
        world.jsRuleIndexArray.fill(0);
        world.jsNextStateArray.fill(0);
        world.jsNextRuleIndexArray.fill(0);
        world.jsHoverStateArray.fill(0);

        const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
        world.stats.ratio = initialRatio;
        world.stats.history = new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio);
        world.stats.avgRatio = initialRatio;
    }
    console.log("All worlds reset based on their current settings.");
}


// --- State Load/Save (Per World) ---
export function loadWorldState(worldIndex, stateData) {
     if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
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
     world.jsRuleIndexArray.fill(0);
     world.jsNextStateArray.fill(0);
     world.jsNextRuleIndexArray.fill(0);
     world.jsHoverStateArray.fill(0);

     // If loaded state implies a density, update the world's initialDensity setting
     let activeCount = 0;
     for(let i=0; i < world.jsStateArray.length; i++) { if(world.jsStateArray[i] === 1) activeCount++; }
     const newDensity = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
     setWorldInitialDensity(worldIndex, newDensity); // This will also save all world settings

     if (stateData.ruleset) { // Load and save ruleset globally
         setRuleset(stateData.ruleset);
     }

     // Reset and recalculate stats for the loaded world
     const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
     world.stats.ratio = initialRatio;
     world.stats.history = new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio);
     world.stats.avgRatio = initialRatio;
     world.enabled = true; // Loading a state into a world implies enabling it
     setWorldEnabled(worldIndex, true); // Save this change

     return true;
}

export function getWorldStateForSave(worldIndex) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return null;
    const world = worldsData[worldIndex];
    return {
        rows: Config.GRID_ROWS,
        cols: Config.GRID_COLS,
        ruleset: currentRulesetHex,
        state: Array.from(world.jsStateArray) // Convert to standard array for JSON
        // Not saving jsRuleIndexArray as it's determined by the ruleset and state
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

        const middleIndex = Math.floor(Config.NUM_CELLS / 2) + Math.floor(Config.GRID_COLS / 2);
        if (density === 0) {
            world.jsStateArray.fill(0);
            world.jsStateArray[middleIndex] = 1;
            activeCount = 1;
        } else if (density === 1) {
            world.jsStateArray.fill(1);
            world.jsStateArray[middleIndex] = 0;
            activeCount = Config.NUM_CELLS - 1;
        } else {
            for (let cellIdx = 0; cellIdx < Config.NUM_CELLS; cellIdx++) {
                const state = Math.random() < density ? 1 : 0;
                world.jsStateArray[cellIdx] = state;
                if (state === 1) activeCount++;
            }
        }
        world.jsRuleIndexArray.fill(0); // Reset rule indices
        world.jsNextStateArray.fill(0); // Clear next state buffer
        world.jsNextRuleIndexArray.fill(0); // Clear next rule index buffer
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
export function getWorldsData() { return worldsData; } // Note: Now includes 'enabled' and 'initialDensity'
export function getCurrentRulesetHex() { return currentRulesetHex; }
export function isSimulationPaused() { return isPaused; }
// export function getTickDuration() { return tickDuration; } // Not typically needed externally
export function getSelectedWorldIndex() { return selectedWorldIndex; }
export function getCurrentSimulationSpeed() { return currentSpeed; } // For UI to init
export function getCurrentBrushSize() { return currentBrushSize; } // For UI to init

export function getSelectedWorldStats() {
    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldsData.length) {
        return worldsData[selectedWorldIndex].stats;
    }
    // Return a default/empty stats object if selection is invalid or world disabled
    return { ratio: 0, avgRatio: 0, history: new Array(Config.STATS_HISTORY_SIZE).fill(0) };
}
export function getCurrentRulesetArray() {
    return new Uint8Array(currentRuleset);
}