// HexLife/src/core/WorldWorker.js

import * as Config from './config.js';

let worldIndex = -1;
let workerConfig = {};
let jsStateArray = null;
let jsNextStateArray = null;
let jsRuleIndexArray = null;
let jsNextRuleIndexArray = null;
let jsHoverStateArray = null;
let ruleset = null;
let commandQueue = [];
let isRunning = false;
let isEnabled = true;
let tickIntervalId = null;
let currentSpeedTarget = Config.DEFAULT_SPEED;
let targetTickDurationMs = 1000 / Config.DEFAULT_SPEED;
let worldTickCounter = 0;
let ruleUsageCounters = null;

let ratioHistory = [];
let entropyHistory = [];
let hexBlockEntropyHistory = [];
const MAX_HISTORY_SIZE = Config.STATS_HISTORY_SIZE || 100;

let workerIsEntropySamplingEnabled = false;
let workerEntropySampleRate = 10;

const NEIGHBOR_DIRS_ODD_R = Config.NEIGHBOR_DIRS_ODD_R;
const NEIGHBOR_DIRS_EVEN_R = Config.NEIGHBOR_DIRS_EVEN_R;

// Optimization: State change detection
let lastSentChecksum = null; // Checksum of the last state sent to the main thread
let stateHistoryChecksums = new Set(); // For internal cycle detection awareness
let stateChecksumQueue = []; // Manages the window for stateHistoryChecksums

/**
 * Calculates a simple checksum for a Uint8Array.
 * @param {Uint8Array} arr The array to process.
 * @returns {number} A 32-bit integer checksum.
 */
function calculateChecksum(arr) {
    if (!arr) return 0; // Should not happen with Uint8Array, but good practice
    let checksum = 0;
    for (let i = 0; i < arr.length; i++) {
        checksum = (checksum * 31 + arr[i]) | 0; // Keep it a 32-bit integer
    }
    return checksum;
}

function rulesetToHex(rulesetArray) {
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    let bin = ""; for (let i = 0; i < 128; i++) bin += rulesetArray[i];
    try { return BigInt('0b' + bin).toString(16).toUpperCase().padStart(32, '0'); }
    catch (e) { return "Error"; }
}

function calculateBinaryEntropy(p1) { if (p1 <= 0 || p1 >= 1) return 0; const p0 = 1 - p1; return -(p1 * Math.log2(p1) + p0 * Math.log2(p0)); }

function calculateHexBlockEntropy(currentStateArray, config, N_DIRS_ODD, N_DIRS_EVEN) {
    if (!currentStateArray || !config || !config.NUM_CELLS || config.NUM_CELLS === 0) {
        return 0;
    }
    const blockCounts = new Map();
    let totalBlocks = 0;
    const numCols = config.GRID_COLS;
    const numRows = config.GRID_ROWS;

    for (let i = 0; i < config.NUM_CELLS; i++) {
        totalBlocks++;
        const cCol = i % numCols;
        const cRow = Math.floor(i / numCols);
        const cState = currentStateArray[i];
        let neighborMask = 0;
        const dirs = (cCol % 2 !== 0) ? N_DIRS_ODD : N_DIRS_EVEN;
        for (let nOrder = 0; nOrder < 6; nOrder++) {
            const nCol = (cCol + dirs[nOrder][0] + numCols) % numCols;
            const nRow = (cRow + dirs[nOrder][1] + numRows) % numRows;
            if (currentStateArray[nRow * numCols + nCol] === 1) {
                neighborMask |= (1 << nOrder);
            }
        }
        const blockPattern = (cState << 6) | neighborMask;
        blockCounts.set(blockPattern, (blockCounts.get(blockPattern) || 0) + 1);
    }
    if (totalBlocks === 0) return 0;
    let entropy = 0;
    for (const count of blockCounts.values()) {
        const probability = count / totalBlocks;
        if (probability > 0) {
            entropy -= probability * Math.log2(probability);
        }
    }
    return entropy / 7.0;
}

function applyBrushLogic(col, row, brushSize) {
    if (!jsStateArray) return false;
    let changed = false;
    const q = [[col, row, 0]];
    const visited = new Map([[`${col},${row}`, 0]]);
    const affectedIndicesInBrush = new Set();
    const startIndex = row * workerConfig.GRID_COLS + col;
    if (startIndex !== undefined && startIndex >=0 && startIndex < workerConfig.NUM_CELLS) {
        affectedIndicesInBrush.add(startIndex);
    }
    while(q.length > 0) {
        const [cc, cr, cd] = q.shift();
        if (cd >= brushSize) continue;
        const dirs = (cc % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;
        for (const [dx, dy] of dirs) {
            const nc = cc + dx;
            const nr = cr + dy;
            const wc = (nc % workerConfig.GRID_COLS + workerConfig.GRID_COLS) % workerConfig.GRID_COLS;
            const wr = (nr % workerConfig.GRID_ROWS + workerConfig.GRID_ROWS) % workerConfig.GRID_ROWS;
            if (!visited.has(`${wc},${wr}`)) {
                const ni = wr * workerConfig.GRID_COLS + wc;
                if (ni !== undefined && ni >=0 && ni < workerConfig.NUM_CELLS) {
                    visited.set(`${wc},${wr}`, cd + 1);
                    affectedIndicesInBrush.add(ni);
                    q.push([wc, wr, cd + 1]);
                }
            }
        }
    }
    for (const idx of affectedIndicesInBrush) {
        if (idx >= 0 && idx < workerConfig.NUM_CELLS) {
            jsStateArray[idx] = 1 - jsStateArray[idx];
            if(jsRuleIndexArray) jsRuleIndexArray[idx] = 0;
            changed = true;
        }
    }
    return changed;
}

function applySelectiveBrushLogic(cellIndices) {
    if (!jsStateArray || !cellIndices || cellIndices.length === 0) return false;
    let changed = false;
    for (const idx of cellIndices) {
        if (idx >= 0 && idx < workerConfig.NUM_CELLS) {
            jsStateArray[idx] = 1 - jsStateArray[idx];
            if(jsRuleIndexArray) jsRuleIndexArray[idx] = 0;
            changed = true;
        }
    }
    return changed;
}

function setHoverStateLogic(hoverAffectedIndicesSet) {
    if (!jsHoverStateArray) return false;
    let changed = false;
    for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
        const shouldHover = hoverAffectedIndicesSet.has(i);
        if (jsHoverStateArray[i] !== (shouldHover ? 1 : 0)) {
            jsHoverStateArray[i] = shouldHover ? 1 : 0;
            changed = true;
        }
    }
    return changed;
}

function processCommandQueue() {
    let needsStateUpdate = false;
    let rulesetChangedInQueue = false;
    let activeCount = 0;

    for (const command of commandQueue) {
        switch (command.type) {
            case 'SET_RULESET':
                ruleset = new Uint8Array(command.data.rulesetBuffer);
                rulesetChangedInQueue = true;
                needsStateUpdate = true; // Ruleset change implies potential visual change even if grid is same
                break;
            case 'RESET_WORLD':
                worldTickCounter = 0;
                ratioHistory = [];
                entropyHistory = [];
                hexBlockEntropyHistory = [];
                const density = command.data.density;
                const isClearOp = command.data.isClearOperation || false;
                activeCount = 0;
                if (ruleUsageCounters) ruleUsageCounters.fill(0);
                if (jsStateArray) {
                    if (isClearOp) {
                        jsStateArray.fill(density);
                        activeCount = (density === 1) ? workerConfig.NUM_CELLS : 0;
                    } else {
                        if (density === 0 || density === 1) {
                            jsStateArray.fill(density);
                            const centerIdx = Math.floor((workerConfig.NUM_CELLS / 2) + (workerConfig.GRID_COLS / 2));
                            if (centerIdx >= 0 && centerIdx < workerConfig.NUM_CELLS) {
                                jsStateArray[centerIdx] = (jsStateArray[centerIdx] + 1) % 2;
                            }
                            for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
                                if (jsStateArray[i] === 1) activeCount++;
                            }
                        } else {
                            for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
                                jsStateArray[i] = Math.random() < density ? 1 : 0;
                                if (jsStateArray[i] === 1) activeCount++;
                            }
                        }
                    }
                }
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                if(jsHoverStateArray) jsHoverStateArray.fill(0);
                
                // Reset checksum tracking
                stateHistoryChecksums.clear();
                stateChecksumQueue = [];
                lastSentChecksum = null; // Force next update
                needsStateUpdate = true;
                break;
            case 'APPLY_BRUSH':
                if (applyBrushLogic(command.data.col, command.data.row, command.data.brushSize)) {
                    stateHistoryChecksums.clear();
                    stateChecksumQueue = [];
                    lastSentChecksum = null;
                    needsStateUpdate = true;
                }
                break;
            case 'APPLY_SELECTIVE_BRUSH':
                if (applySelectiveBrushLogic(command.data.cellIndices)) {
                    stateHistoryChecksums.clear();
                    stateChecksumQueue = [];
                    lastSentChecksum = null;
                    needsStateUpdate = true;
                }
                break;
            case 'SET_HOVER_STATE':
                const hoverIndicesSet = new Set(command.data.hoverAffectedIndices);
                if (setHoverStateLogic(hoverIndicesSet)) {
                    needsStateUpdate = true; // This only affects hover buffer, not grid state checksum
                }
                break;
            case 'CLEAR_HOVER_STATE':
                if (jsHoverStateArray && jsHoverStateArray.some(s => s === 1)) {
                    jsHoverStateArray.fill(0);
                    needsStateUpdate = true; // Affects hover buffer
                }
                break;
            case 'SET_ENABLED': // Handled in onmessage directly
                isEnabled = command.data.enabled;
                 if (!isEnabled && jsStateArray) { // If disabling, clear state
                    jsStateArray.fill(0);
                    if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                    stateHistoryChecksums.clear();
                    stateChecksumQueue = [];
                    lastSentChecksum = null; // Force update of cleared state
                    needsStateUpdate = true;
                } else if (isEnabled && jsStateArray) { // If enabling, ensure current state is sent
                    lastSentChecksum = null; // Force update of current state
                    needsStateUpdate = true;
                }
                break;
            case 'LOAD_STATE':
                jsStateArray = new Uint8Array(command.data.newStateBuffer);
                ruleset = new Uint8Array(command.data.newRulesetBuffer);
                worldTickCounter = command.data.worldTick || 0;
                ratioHistory = [];
                entropyHistory = [];
                hexBlockEntropyHistory = [];
                if (ruleUsageCounters) ruleUsageCounters.fill(0);
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                if(jsHoverStateArray) jsHoverStateArray.fill(0);
                isEnabled = true;
                
                stateHistoryChecksums.clear();
                stateChecksumQueue = [];
                lastSentChecksum = null; // Will be set when sendStateUpdate is called after this command
                needsStateUpdate = true;
                rulesetChangedInQueue = true;
                break;
        }
    }
    commandQueue = [];
    return { needsStateUpdate, rulesetChangedInQueue };
}

function runTick() {
    const { needsStateUpdate: commandInducedUpdate, rulesetChangedInQueue } = processCommandQueue();
    let simulationPerformedUpdate = false;

    if (!isEnabled || !isRunning || !jsStateArray || !ruleset || !workerConfig.NUM_CELLS) {
        if (commandInducedUpdate) { // e.g. SET_HOVER_STATE on a paused world
            // If command induced an update (like hover), send it.
            // Checksum logic mostly applies to simulation ticks.
            // If it was a state-altering command, lastSentChecksum would be null.
            const currentChecksum = calculateChecksum(jsStateArray);
            if (currentChecksum !== lastSentChecksum || rulesetChangedInQueue || commandInducedUpdate ) { // Ensure hover updates still go through even if grid is same
                 if (jsStateArray) lastSentChecksum = currentChecksum; // Update if we are about to send due to command
                 sendStateUpdate(undefined, undefined, undefined, undefined, rulesetChangedInQueue, commandInducedUpdate);
            }
        }
        return;
    }

    worldTickCounter++;
    let activeCount = 0;
    const numCols = workerConfig.GRID_COLS;

    for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
        const cCol = i % numCols;
        const cRow = Math.floor(i / numCols);
        const cState = jsStateArray[i];
        let neighborMask = 0;
        const dirs = (cCol % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;
        for (let nOrder = 0; nOrder < 6; nOrder++) {
            const nCol = (cCol + dirs[nOrder][0] + numCols) % numCols;
            const nRow = (cRow + dirs[nOrder][1] + workerConfig.GRID_ROWS) % workerConfig.GRID_ROWS;
            if (jsStateArray[nRow * numCols + nCol] === 1) {
                neighborMask |= (1 << nOrder);
            }
        }
        const ruleIdx = (cState << 6) | neighborMask;
        if (isRunning && ruleUsageCounters) ruleUsageCounters[ruleIdx]++;
        const nextStateValue = ruleset[ruleIdx];
        jsNextStateArray[i] = nextStateValue;
        jsNextRuleIndexArray[i] = ruleIdx;
        if (nextStateValue === 1) activeCount++;
    }

    const newStateChecksum = calculateChecksum(jsNextStateArray);

    // Internal tracking for cycle detection awareness
    if (!stateHistoryChecksums.has(newStateChecksum)) {
        stateHistoryChecksums.add(newStateChecksum);
        stateChecksumQueue.push(newStateChecksum);
        if (stateChecksumQueue.length > Config.CYCLE_DETECTION_HISTORY_SIZE) {
            const oldestChecksum = stateChecksumQueue.shift();
            if (!stateChecksumQueue.includes(oldestChecksum)) { // Avoid removing if still in recent queue window
                stateHistoryChecksums.delete(oldestChecksum);
            }
        }
    }

    let tempState = jsStateArray;
    jsStateArray = jsNextStateArray;
    jsNextStateArray = tempState;

    let tempRuleIndex = jsRuleIndexArray;
    jsRuleIndexArray = jsNextRuleIndexArray;
    jsNextRuleIndexArray = tempRuleIndex;

    if (newStateChecksum !== lastSentChecksum) {
        simulationPerformedUpdate = true;
    }

    const ratio = workerConfig.NUM_CELLS > 0 ? activeCount / workerConfig.NUM_CELLS : 0;
    let currentBinaryEntropy = undefined;
    let currentBlockEntropy = undefined;
    const shouldSampleEntropy = workerIsEntropySamplingEnabled && (worldTickCounter % workerEntropySampleRate === 0);
    if (shouldSampleEntropy) {
        currentBinaryEntropy = calculateBinaryEntropy(ratio);
        currentBlockEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    }

    if (isEnabled && isRunning) {
        ratioHistory.push(ratio);
        if (ratioHistory.length > MAX_HISTORY_SIZE) ratioHistory.shift();
        if (shouldSampleEntropy) {
            if (currentBinaryEntropy !== undefined) {
                entropyHistory.push(currentBinaryEntropy);
                if (entropyHistory.length > MAX_HISTORY_SIZE) entropyHistory.shift();
            }
            if (currentBlockEntropy !== undefined) {
                hexBlockEntropyHistory.push(currentBlockEntropy);
                if (hexBlockEntropyHistory.length > MAX_HISTORY_SIZE) hexBlockEntropyHistory.shift();
            }
        }
    }

    if (simulationPerformedUpdate || commandInducedUpdate) {
        lastSentChecksum = calculateChecksum(jsStateArray); // Update with the checksum of the state *being sent*
        sendStateUpdate(activeCount, ratio, currentBinaryEntropy, currentBlockEntropy, rulesetChangedInQueue, commandInducedUpdate);
    }
}

function sendStateUpdate(activeCount, ratio, binaryEntropy, blockEntropy, rulesetHasChanged = false, commandInducedGridChange = false) {
    if (!jsStateArray || !jsRuleIndexArray || !jsHoverStateArray || !ruleset) {
        console.warn(`Worker ${worldIndex}: Attempted to send state update with invalid/missing buffers.`);
        return;
    }

    const statePayload = {
        type: 'STATE_UPDATE',
        worldIndex: worldIndex,
        stateBuffer: jsStateArray.buffer.slice(0), // Always send a fresh copy
        ruleIndexBuffer: jsRuleIndexArray.buffer.slice(0),
        hoverStateBuffer: jsHoverStateArray.buffer.slice(0),
    };
    const transferListState = [statePayload.stateBuffer, statePayload.ruleIndexBuffer, statePayload.hoverStateBuffer];
    self.postMessage(statePayload, transferListState);

    const currentRulesetHex = rulesetToHex(ruleset);

    // Stats are usually tied to simulation ticks or significant state changes.
    if (activeCount !== undefined) { // Indicates a simulation tick or a command that recalculated activeCount
        const ruleUsageCountersBuffer = ruleUsageCounters ? ruleUsageCounters.buffer.slice(0) : null;
        const transferListStats = ruleUsageCountersBuffer ? [ruleUsageCountersBuffer] : [];
        self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: activeCount,
            ratio: ratio,
            binaryEntropy: binaryEntropy,
            blockEntropy: blockEntropy,
            rulesetHex: currentRulesetHex,
            isEnabled: isEnabled,
            ruleUsageCounters: ruleUsageCountersBuffer
        }, transferListStats);
    } else if (rulesetHasChanged || !isEnabled || commandInducedGridChange) {
        // Fallback for commands that change ruleset or enabled state, or directly alter grid
        const currentActiveCount = jsStateArray.reduce((s, c) => s + c, 0);
        const currentRatio = workerConfig.NUM_CELLS > 0 ? currentActiveCount / workerConfig.NUM_CELLS : 0;
        let currentBinaryEntropyStats, currentBlockEntropyStats;
        if (workerIsEntropySamplingEnabled) {
            currentBinaryEntropyStats = calculateBinaryEntropy(currentRatio);
            currentBlockEntropyStats = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
        }
        const ruleUsageCountersBuffer = ruleUsageCounters ? ruleUsageCounters.buffer.slice(0) : null;
        const transferListStats = ruleUsageCountersBuffer ? [ruleUsageCountersBuffer] : [];
        self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: currentActiveCount,
            ratio: currentRatio,
            binaryEntropy: currentBinaryEntropyStats,
            blockEntropy: currentBlockEntropyStats,
            rulesetHex: currentRulesetHex,
            isEnabled: isEnabled,
            ruleUsageCounters: ruleUsageCountersBuffer
        }, transferListStats);
    }
}


function updateSimulationInterval() {
    if (tickIntervalId) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
    }
    if (isRunning && isEnabled) {
        targetTickDurationMs = Math.max(1, 1000 / currentSpeedTarget);
        tickIntervalId = setInterval(runTick, targetTickDurationMs);
    }
}

self.onmessage = function(event) {
    const command = event.data;
    let commandCausedGridChange = false; // Flag if command directly altered jsStateArray

    switch (command.type) {
        case 'INIT':
            worldIndex = command.data.worldIndex;
            workerConfig = command.data.config;
            currentSpeedTarget = command.data.initialSpeed || Config.DEFAULT_SPEED;
            targetTickDurationMs = 1000 / currentSpeedTarget;
            ratioHistory = [];
            entropyHistory = [];
            hexBlockEntropyHistory = [];
            jsStateArray = new Uint8Array(command.data.initialStateBuffer);
            ruleset = new Uint8Array(command.data.initialRulesetBuffer);
            jsHoverStateArray = new Uint8Array(command.data.initialHoverStateBuffer);
            jsNextStateArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsNextRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);
            ruleUsageCounters = new Uint32Array(128);
            isEnabled = command.data.initialIsEnabled;
            workerIsEntropySamplingEnabled = command.data.initialEntropySamplingEnabled;
            workerEntropySampleRate = command.data.initialEntropySampleRate || 10;

            stateHistoryChecksums.clear();
            stateChecksumQueue = [];
            lastSentChecksum = null; // Will be set by the first sendStateUpdate

            if (isEnabled) {
                const density = command.data.initialDensity;
                if(density % 1 === 0) {
                    jsStateArray.fill(density);
                    const centerIdx = Math.floor((workerConfig.NUM_CELLS / 2)+workerConfig.GRID_COLS/2);
                    if (centerIdx >=0 && centerIdx < workerConfig.NUM_CELLS) {
                       jsStateArray[centerIdx] = (jsStateArray[centerIdx]+1) % 2;
                    }
                } else {
                    for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
                        jsStateArray[i] = Math.random() < density ? 1 : 0;
                    }
                }
                jsRuleIndexArray.fill(0);
            } else {
                jsStateArray.fill(0);
                jsRuleIndexArray.fill(0);
            }
            jsHoverStateArray.fill(0);

            const initialChecksum = calculateChecksum(jsStateArray);
            stateHistoryChecksums.add(initialChecksum);
            stateChecksumQueue.push(initialChecksum);
            lastSentChecksum = initialChecksum; // Set for the initial state being sent

            self.postMessage({ type: 'INIT_ACK', worldIndex: worldIndex });
            const initialActiveCount = isEnabled ? jsStateArray.reduce((s, c) => s + c, 0) : 0;
            const initialRatio = isEnabled && workerConfig.NUM_CELLS > 0 ? initialActiveCount / workerConfig.NUM_CELLS : 0;
            let initialBinaryEntropy, initialBlockEntropy;
            if (isEnabled && workerIsEntropySamplingEnabled) {
                initialBinaryEntropy = calculateBinaryEntropy(initialRatio);
                initialBlockEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
                ratioHistory.push(initialRatio);
                entropyHistory.push(initialBinaryEntropy);
                hexBlockEntropyHistory.push(initialBlockEntropy);
            } else if (isEnabled) {
                ratioHistory.push(initialRatio);
            }
            sendStateUpdate(initialActiveCount, initialRatio, initialBinaryEntropy, initialBlockEntropy, true, true);
            break;

        case 'START_SIMULATION':
            isRunning = true;
            updateSimulationInterval();
            break;
        case 'STOP_SIMULATION':
            isRunning = false;
            updateSimulationInterval();
            break;
        case 'SET_SPEED_TARGET':
            currentSpeedTarget = command.data.speed;
            updateSimulationInterval();
            break;
        case 'SET_ENABLED':
            const prevEnabled = isEnabled;
            isEnabled = command.data.enabled;
            commandCausedGridChange = false;
            if (!isEnabled && jsStateArray) {
                jsStateArray.fill(0);
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                stateHistoryChecksums.clear();
                stateChecksumQueue = [];
                commandCausedGridChange = true; // Grid content changed to all 0s
            } else if (isEnabled && !prevEnabled && jsStateArray) {
                 // No direct grid change, but we want to send current state if it wasn't sending before
                 commandCausedGridChange = true; // Treat as if grid content might be "new" to main thread
            }
            updateSimulationInterval();
            if (commandCausedGridChange) {
                lastSentChecksum = calculateChecksum(jsStateArray);
                const activeAfterEnable = jsStateArray.reduce((s, c) => s + c, 0);
                const ratioAfterEnable = workerConfig.NUM_CELLS > 0 ? activeAfterEnable / workerConfig.NUM_CELLS : 0;
                let binEntropyAfterEnable, blkEntropyAfterEnable;
                if (workerIsEntropySamplingEnabled) {
                    binEntropyAfterEnable = calculateBinaryEntropy(ratioAfterEnable);
                    blkEntropyAfterEnable = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
                }
                sendStateUpdate(activeAfterEnable, ratioAfterEnable, binEntropyAfterEnable, blkEntropyAfterEnable, false, true);
            }
            break;

        case 'SET_ENTROPY_SAMPLING_PARAMS':
            workerIsEntropySamplingEnabled = command.data.enabled;
            workerEntropySampleRate = command.data.rate || 10;
            if (!workerIsEntropySamplingEnabled) {
                entropyHistory = [];
                hexBlockEntropyHistory = [];
            }
            break;

        // Commands that directly modify state and need immediate update handling
        case 'RESET_WORLD':
        case 'APPLY_BRUSH':
        case 'APPLY_SELECTIVE_BRUSH':
        case 'LOAD_STATE':
            commandQueue.push(command);
            const { needsStateUpdate: inducedUpdateOnGrid, rulesetChangedInQueue: rsChangedByGridCmd } = processCommandQueue();
            if (inducedUpdateOnGrid) { // processCommandQueue already cleared checksums if needed
                lastSentChecksum = calculateChecksum(jsStateArray);
                const active = jsStateArray.reduce((s, c) => s + c, 0);
                const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                let binEntropy, blkEntropy;
                if (workerIsEntropySamplingEnabled) {
                    binEntropy = calculateBinaryEntropy(ratio);
                    blkEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
                }
                sendStateUpdate(active, ratio, binEntropy, blkEntropy, rsChangedByGridCmd, true);
            }
            break;

        // Commands that might not change grid state but queue for processing
        default:
            commandQueue.push(command);
            // For non-grid-altering commands that queue, runTick will handle updates.
            // Example: SET_RULESET (if grid doesn't change, but rules do, runTick will send)
            // Example: SET_HOVER_STATE (processCommandQueue handles hover, runTick might send if grid also changes)
            // If a command like SET_HOVER_STATE needs an immediate visual update for hover only,
            // it should ideally send a specific hover-only message or be handled by processCommandQueue
            // and runTick's logic for commandInducedUpdate.
            // The current processCommandQueue handles SET_HOVER_STATE and returns needsStateUpdate=true for hover buffer.
            // This will trigger sendStateUpdate in runTick, which is fine as it sends all buffers.
            break;
    }
};