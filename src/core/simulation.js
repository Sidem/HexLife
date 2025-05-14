import * as Config from './config.js';
import { indexToCoords, coordsToIndex } from '../utils/utils.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

const NEIGHBOR_DIRS_ODD_R = [
    [+1,  0], [+1, +1], [ 0, +1],
    [-1, +1], [-1,  0], [ 0, -1]
];
const NEIGHBOR_DIRS_EVEN_R = [
    [+1, -1], [+1,  0], [ 0, +1],
    [-1,  0], [-1, -1], [ 0, -1]
];

let worldsData = [];
let currentRuleset = new Uint8Array(128);
let currentRulesetHex = "N/A";
let isPaused = true;
let tickTimer = 0;
let currentSpeed = Config.DEFAULT_SPEED;
let tickDuration = 1.0 / currentSpeed;
let selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;
let isEntropySamplingEnabled = false;
let entropySampleRate = 10; 
let globalTickCounter = 0;
let currentBrushSize = Config.DEFAULT_NEIGHBORHOOD_SIZE;

export function initSimulation() {
    console.log("Initializing Simulation...");

    currentSpeed = PersistenceService.loadSimSpeed();
    setSimulationSpeed(currentSpeed);

    const loadedRulesetHex = PersistenceService.loadRuleset();
    if (loadedRulesetHex) {
        setRuleset(loadedRulesetHex);
    } else {
        generateRandomRuleset();
    }

    currentBrushSize = PersistenceService.loadBrushSize();
    isEntropySamplingEnabled = PersistenceService.loadUISetting('entropySamplingEnabled', false);
    entropySampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);
    globalTickCounter = 0;
    let worldSettings = PersistenceService.loadWorldSettings();
    worldsData = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const settings = worldSettings[i];
        const jsStateArray = new Uint8Array(Config.NUM_CELLS);
        const jsNextStateArray = new Uint8Array(Config.NUM_CELLS).fill(0);
        const jsHoverStateArray = new Uint8Array(Config.NUM_CELLS).fill(0);
        const jsRuleIndexArray = new Uint8Array(Config.NUM_CELLS).fill(0);
        const jsNextRuleIndexArray = new Uint8Array(Config.NUM_CELLS).fill(0);

        let activeCount = 0;
        if (settings.enabled) {
            const density = settings.initialDensity;
            if (density === 0 && Config.NUM_CELLS > 0) {
                 jsStateArray.fill(0);
                 const middleIndex = Math.floor(Config.NUM_CELLS / 2) + Math.floor(Config.GRID_COLS / 2);
                 if(middleIndex < Config.NUM_CELLS) jsStateArray[middleIndex] = 1;
                 activeCount = 1;
            } else if (density === 1 && Config.NUM_CELLS > 0) {
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
            jsStateArray.fill(0); 
            activeCount = 0;
        }

        const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
        const initialEntropy = calculateBinaryEntropy(initialRatio); 
        const stats = {
            ratio: initialRatio,
            avgRatio: initialRatio,
            history: new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio),
            entropyHistory: new Array(Config.STATS_HISTORY_SIZE).fill(initialEntropy)
        };

        worldsData.push({
            jsStateArray, jsNextStateArray, jsHoverStateArray, jsRuleIndexArray, jsNextRuleIndexArray,
            stats,
            enabled: settings.enabled,
            initialDensity: settings.initialDensity
        });
    }

    isPaused = true;
    tickTimer = 0;
    selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;

    setSimulationSpeed(currentSpeed);
    if (loadedRulesetHex) setRuleset(loadedRulesetHex); else generateRandomRuleset();
    
    setupSimulationEventListeners();

    console.log(`Simulation initialized with ${Config.NUM_WORLDS} worlds.`);
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, getWorldSettings());
}

function setupSimulationEventListeners() {
    EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PAUSE, () => {
        setSimulationPaused(!isPaused);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, (newSpeed) => {
        setSimulationSpeed(newSpeed);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_BRUSH_SIZE, (newSize) => {
        setBrushSize(newSize);
    });
    EventBus.subscribe(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, (data) => {
        generateRandomRuleset(data.bias, data.symmetrical);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_RULESET, (rulesetHex) => {
        const success = setRuleset(rulesetHex);
    });
    EventBus.subscribe(EVENTS.COMMAND_TOGGLE_RULE_OUTPUT, (ruleIndex) => {
        toggleRuleOutputState(ruleIndex);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_ALL_RULES_STATE, (targetState) => {
        setAllRulesState(targetState);
    });
     EventBus.subscribe(EVENTS.COMMAND_SET_RULES_FOR_NEIGHBOR_COUNT, (data) => {
         setRulesForNeighborCountCondition(data.centerState, data.numActive, data.outputState);
     });
    EventBus.subscribe(EVENTS.COMMAND_RESET_ALL_WORLDS, () => {
        resetAllWorldsToCurrentSettings();
    });
    EventBus.subscribe(EVENTS.COMMAND_LOAD_WORLD_STATE, (data) => {
        loadWorldState(data.worldIndex, data.loadedData);
    });
     EventBus.subscribe(EVENTS.COMMAND_APPLY_BRUSH, (data) => {
         applyBrush(data.worldIndex, data.col, data.row, data.brushSize);
     });
     EventBus.subscribe(EVENTS.COMMAND_SET_HOVER_STATE, (data) => {
         setHoverState(data.worldIndex, data.col, data.row, data.brushSize);
     });
     EventBus.subscribe(EVENTS.COMMAND_CLEAR_HOVER_STATE, (data) => {
         clearHoverState(data.worldIndex);
     });
     EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, (data) => {
         setWorldInitialDensity(data.worldIndex, data.density);
     });
     EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_ENABLED, (data) => {
         setWorldEnabled(data.worldIndex, data.isEnabled);
     });
     EventBus.subscribe(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, (data) => {
         setEntropySampling(data.enabled, data.rate);
     });
     EventBus.subscribe(EVENTS.COMMAND_SELECT_WORLD, (worldIndex) => {
         setSelectedWorldIndex(worldIndex);
     });
}

function countSetBits(n) {
    let count = 0;
    while (n > 0) {
        n &= (n - 1);
        count++;
    }
    return count;
}


/**
 * Calculates Shannon entropy for a binary distribution.
 * @param {number} p1 Probability of state 1 (e.g., ratio of active cells).
 * @returns {number} Shannon entropy (between 0 and 1).
 */
function calculateBinaryEntropy(p1) {
    if (p1 <= 0 || p1 >= 1) {
        return 0;
    }
    const p0 = 1 - p1;
    const log2 = Math.log2 || function(x) { return Math.log(x) / Math.LN2; };
    const entropy = - (p1 * log2(p1) + p0 * log2(p0));
    return Math.max(0, Math.min(1, entropy));
}


function runSingleStepForAllWorlds() {
    const numCols = Config.GRID_COLS;
    const numRows = Config.GRID_ROWS;
    globalTickCounter++;

    for (let worldIdx = 0; worldIdx < worldsData.length; worldIdx++) {
        const world = worldsData[worldIdx];
        if (!world.enabled) continue;

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

        if (isEntropySamplingEnabled && (globalTickCounter % entropySampleRate === 0)) {
            const currentEntropy = calculateBinaryEntropy(world.stats.ratio);
            world.stats.entropyHistory.push(currentEntropy);
            if (world.stats.entropyHistory.length > Config.STATS_HISTORY_SIZE) {
                world.stats.entropyHistory.shift();
            }
        }

        world.jsStateArray.set(world.jsNextStateArray);
        world.jsRuleIndexArray.set(world.jsNextRuleIndexArray);
    }

    if (worldsData[selectedWorldIndex]) {
        EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
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

export function generateRandomRuleset(bias = 0.5, generateSymmetrically = false) {
    console.log(`Generating random ruleset with bias: ${bias}, symmetrical: ${generateSymmetrically}`);
    if (generateSymmetrically) {
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
        if (currentRuleset[0] === 1 && currentRuleset[127] === 0) {
            if (Math.random() < 0.5) currentRuleset[127] = 1; else currentRuleset[0] = 0;
        } else if (currentRuleset[0] === 0 && currentRuleset[127] === 1) {
            if (Math.random() < 0.5) currentRuleset[127] = 0; else currentRuleset[0] = 1;
        }
    }
    currentRulesetHex = rulesetToHex(currentRuleset);
    PersistenceService.saveRuleset(currentRulesetHex);
    EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
    console.log("Generated random ruleset:", currentRulesetHex);
}

function _setRulesForNeighborCountConditionInternal(centerState, numActiveNeighbors, outputState) {
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
    PersistenceService.saveRuleset(currentRulesetHex);
    EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
    console.log(`Rules set for C=${centerState}, N=${numActiveNeighbors} -> ${outputState}. New hex: ${currentRulesetHex}`);
}

export function getEffectiveRuleForNeighborCount(centerState, numActiveNeighbors) {
    if (centerState !== 0 && centerState !== 1) return 2;
    if (numActiveNeighbors < 0 || numActiveNeighbors > 6) return 2;

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
                return 2;
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
        ruleset.fill(0);
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
        PersistenceService.saveRuleset(currentRulesetHex);
        EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
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
        PersistenceService.saveRuleset(currentRulesetHex);
        EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
        console.log(`Rule ${ruleIndex} toggled. New hex: ${currentRulesetHex}`);
    }
}

export function setAllRulesState(targetState) {
    if (targetState === 0 || targetState === 1) {
        currentRuleset.fill(targetState);
        currentRulesetHex = rulesetToHex(currentRuleset);
        PersistenceService.saveRuleset(currentRulesetHex);
        EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
        console.log(`All rules set to ${targetState}. New hex: ${currentRulesetHex}`);
    }
}

/**
 * Gets potential neighbor coordinates for a given cell. (Flat-top, odd-r layout)
 * Uses precomputed direction arrays.
 * @param {number} col Column index.
 * @param {number} row Row index.
 * @returns {Array<[number, number]>} Array of [col, row] pairs for neighbors.
 */
function getNeighbors(col, row) {
    const base_dirs = (col % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;
    const neighbors = []; 
    for (let i = 0; i < 6; i++) {
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

    const affectedIndices = new Set([startIndex]);
    const queue = [[startCol, startRow, 0]];
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
            stateArray[index] = 1 - stateArray[index];
            ruleIndexArray[index] = 0;
            changed = true;
        }
    }
    if(changed) {
        let activeCount = 0;
        for(let i=0; i < stateArray.length; i++) { if(stateArray[i] === 1) activeCount++; }
        updateWorldStats(world, activeCount);
        EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    }
    return changed;
}


export function setSimulationPaused(paused) {
    const oldPausedState = isPaused;
    isPaused = paused;
    if (!isPaused) tickTimer = 0;
    if (oldPausedState !== isPaused) {
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, isPaused);
    }
}

export function setSimulationSpeed(speed) {
    const oldSpeed = currentSpeed;
    currentSpeed = Math.max(0, Math.min(Config.MAX_SIM_SPEED, speed));
    tickDuration = currentSpeed > 0 ? 1.0 / currentSpeed : Infinity;
    PersistenceService.saveSimSpeed(currentSpeed);
    if (oldSpeed !== currentSpeed) {
        EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED, currentSpeed);
    }
}

export function loadBrushSize() {
    currentBrushSize = PersistenceService.loadBrushSize();
    return currentBrushSize;
}
export function setBrushSize(size) {
    const oldBrushSize = currentBrushSize;
    currentBrushSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, size));
    PersistenceService.saveBrushSize(currentBrushSize);
    if (oldBrushSize !== currentBrushSize) {
        EventBus.dispatch(EVENTS.BRUSH_SIZE_CHANGED, currentBrushSize);
    }
}


export function setSelectedWorldIndex(index) {
    if (index >= 0 && index < worldsData.length && selectedWorldIndex !== index) {
        selectedWorldIndex = index;
        EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, selectedWorldIndex);
        EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    }
}

export function setWorldInitialDensity(worldIndex, density) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    density = Math.max(0, Math.min(1, density));
    worldsData[worldIndex].initialDensity = density;
    const allSettings = worldsData.map(w => ({ initialDensity: w.initialDensity, enabled: w.enabled }));
    PersistenceService.saveWorldSettings(allSettings);
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, allSettings);
    return true;
}

export function setWorldEnabled(worldIndex, isEnabled) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    worldsData[worldIndex].enabled = !!isEnabled;
    if (!worldsData[worldIndex].enabled) {
        worldsData[worldIndex].jsStateArray.fill(0);
        worldsData[worldIndex].jsRuleIndexArray.fill(0);
        updateWorldStats(worldsData[worldIndex], 0);
    }
    const allSettings = worldsData.map(w => ({ initialDensity: w.initialDensity, enabled: w.enabled }));
    PersistenceService.saveWorldSettings(allSettings);
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, allSettings);
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
    globalTickCounter = 0;

    for (let i = 0; i < worldsData.length; i++) {
        const world = worldsData[i];
        let activeCount = 0;

        if (world.enabled) {
            const density = world.initialDensity;
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
            world.jsStateArray.fill(0);
            activeCount = 0;
        }
        const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
        const initialEntropy = calculateBinaryEntropy(initialRatio);
        world.stats.ratio = initialRatio;
        world.stats.history = new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio);
        world.stats.avgRatio = initialRatio;
        world.stats.entropyHistory = new Array(Config.STATS_HISTORY_SIZE).fill(initialEntropy);

         world.jsRuleIndexArray.fill(0);
         world.jsNextStateArray.fill(0);
         world.jsNextRuleIndexArray.fill(0);
         world.jsHoverStateArray.fill(0);
    }
    console.log("All worlds reset based on their current settings.");
    EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    if (worldsData[selectedWorldIndex]) {
         EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    }
}

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

     let activeCount = 0;
     for(let i=0; i < world.jsStateArray.length; i++) { if(world.jsStateArray[i] === 1) activeCount++; }
     const newDensity = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
     setWorldInitialDensity(worldIndex, newDensity);

     if (stateData.ruleset) {
         setRuleset(stateData.ruleset);
     }

     const initialRatio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
     const initialEntropy = calculateBinaryEntropy(initialRatio);
     world.stats.ratio = initialRatio;
     world.stats.history = new Array(Config.STATS_HISTORY_SIZE).fill(initialRatio);
     world.stats.avgRatio = initialRatio;
     world.stats.entropyHistory = new Array(Config.STATS_HISTORY_SIZE).fill(initialEntropy);
     world.enabled = true;
     setWorldEnabled(worldIndex, true);

     if (worldIndex === selectedWorldIndex) {
         EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
     }
     EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, getWorldSettings());

     return true;
}

export function getWorldStateForSave(worldIndex) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return null;
    const world = worldsData[worldIndex];
    return {
        rows: Config.GRID_ROWS,
        cols: Config.GRID_COLS,
        ruleset: currentRulesetHex,
        state: Array.from(world.jsStateArray)
    };
}


export function getWorldsData() { return worldsData; }
export function getCurrentRulesetHex() { return currentRulesetHex; }
export function isSimulationPaused() { return isPaused; }
export function getSelectedWorldIndex() { return selectedWorldIndex; }
export function getCurrentSimulationSpeed() { return currentSpeed; }
export function getCurrentBrushSize() { return currentBrushSize; }
export function getEntropySamplingState() {
    return {
        enabled: isEntropySamplingEnabled,
        rate: entropySampleRate
    };
}

/**
 * Sets the entropy sampling parameters.
 * @param {boolean} enabled Whether to enable continuous sampling.
 * @param {number} rate The sampling rate (sample every 'rate' ticks). Must be >= 1.
 */
export function setEntropySampling(enabled, rate) {
    const oldEnabled = isEntropySamplingEnabled;
    const oldRate = entropySampleRate;
    isEntropySamplingEnabled = !!enabled;
    entropySampleRate = Math.max(1, Math.floor(rate));
    PersistenceService.saveUISetting('entropySamplingEnabled', isEntropySamplingEnabled);
    PersistenceService.saveUISetting('entropySampleRate', entropySampleRate);
    if (oldEnabled !== isEntropySamplingEnabled || oldRate !== entropySampleRate) {
        EventBus.dispatch(EVENTS.ENTROPY_SAMPLING_CHANGED, { enabled: isEntropySamplingEnabled, rate: entropySampleRate });
    }
    console.log(`Entropy Sampling: ${isEntropySamplingEnabled ? 'ON' : 'OFF'}, Rate: ${entropySampleRate}`);
}

/**
 * Gets statistics for the currently selected world, including calculated entropy.
 * @returns {{ratio: number, avgRatio: number, history: number[], entropy: number}|null} Stats object or null if no world selected.
 */
export function getSelectedWorldStats() {
    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldsData.length) {
        const stats = worldsData[selectedWorldIndex].stats;
        const lastEntropy = stats.entropyHistory.length > 0
            ? stats.entropyHistory[stats.entropyHistory.length - 1]
            : 0;

        return {
            ratio: stats.ratio,
            avgRatio: stats.avgRatio,
            history: stats.history,
            entropy: lastEntropy
        };
    }
    return { ratio: 0, avgRatio: 0, history: [], entropy: 0 }; 
}
export function getCurrentRulesetArray() {
    return new Uint8Array(currentRuleset);
}

export function getSelectedWorldEntropyHistory() {
    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldsData.length) {
        return worldsData[selectedWorldIndex].stats.entropyHistory;
    }
    return null;
}


/**
 * Gets the ratio history for the selected world.
 * @returns {number[]|null} Array of historical ratios or null.
 */
export function getSelectedWorldRatioHistory() {
    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldsData.length) {
        return worldsData[selectedWorldIndex].stats.history;
    }
    return null;
}
