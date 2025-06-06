import * as Config from './config.js';
import init, { World } from './wasm-engine/hexlife_wasm.js';
import { rulesetToHex, findHexagonsInNeighborhood } from '../utils/utils.js';

let wasm_module;
let wasm_world;
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


let lastSentChecksum = null;
let stateHistoryChecksums = new Set();
let stateChecksumQueue = [];

function calculateChecksum(arr) {
    if (!arr || !wasm_world) return 0;
    return wasm_world.calculate_checksum(arr);
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

function applySelectiveBrushLogic(cellIndices) {
    if (!jsStateArray || !cellIndices || cellIndices.size === 0) return false;
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
                needsStateUpdate = true;
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
                stateHistoryChecksums.clear();
                stateChecksumQueue = [];
                lastSentChecksum = null;
                needsStateUpdate = true;
                break;
            case 'APPLY_BRUSH':
            case 'APPLY_SELECTIVE_BRUSH':
                let brushChanged = false;
                if (command.type === 'APPLY_BRUSH') {
                    const affectedIndicesInBrush = new Set();
                    findHexagonsInNeighborhood(command.data.col, command.data.row, command.data.brushSize, affectedIndicesInBrush);
                    brushChanged = applySelectiveBrushLogic(affectedIndicesInBrush);
                } else {
                    brushChanged = applySelectiveBrushLogic(command.data.cellIndices);
                }
                if (brushChanged) {
                    stateHistoryChecksums.clear();
                    stateChecksumQueue = [];
                    lastSentChecksum = null;
                    needsStateUpdate = true;
                }
                break;
            case 'SET_HOVER_STATE':
                if (setHoverStateLogic(command.data.hoverAffectedIndices)) {
                    needsStateUpdate = true;
                }
                break;
            case 'CLEAR_HOVER_STATE':
                if (jsHoverStateArray && jsHoverStateArray.some(s => s === 1)) {
                    jsHoverStateArray.fill(0);
                    needsStateUpdate = true;
                }
                break;
            case 'SET_ENABLED':
                isEnabled = command.data.enabled;
                 if (!isEnabled && jsStateArray) {
                    jsStateArray.fill(0);
                    if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                    stateHistoryChecksums.clear();
                    stateChecksumQueue = [];
                    lastSentChecksum = null;
                    needsStateUpdate = true;
                } else if (isEnabled && jsStateArray) {
                    lastSentChecksum = null;
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
                lastSentChecksum = null;
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

    if (!isEnabled || !jsStateArray || !ruleset || !workerConfig.NUM_CELLS) { 
        if (commandInducedUpdate) { 
            const currentGridChecksum = calculateChecksum(jsStateArray);
            if (currentGridChecksum !== lastSentChecksum || rulesetChangedInQueue || commandInducedUpdate) { 
                lastSentChecksum = currentGridChecksum; 
                sendStateUpdate(undefined, undefined, undefined, undefined, rulesetChangedInQueue, true); 
            }
        }
        return;
    }

    if (!isRunning) { 
        if (commandInducedUpdate) { 
            sendStateUpdate(undefined, undefined, undefined, undefined, rulesetChangedInQueue, false);
        }
        return;
    }
    
    worldTickCounter++;

    if (isRunning && wasm_world) {
        wasm_world.run_tick(
            ruleset,
            jsStateArray,
            jsNextStateArray,
            jsNextRuleIndexArray,
            ruleUsageCounters
        );
    }

    let activeCount = 0;
    for(let i = 0; i < jsNextStateArray.length; i++) {
        if (jsNextStateArray[i] === 1) activeCount++;
    }

    const newStateChecksum = calculateChecksum(jsNextStateArray);

    if (!stateHistoryChecksums.has(newStateChecksum)) {
        stateHistoryChecksums.add(newStateChecksum);
        stateChecksumQueue.push(newStateChecksum);
        if (stateChecksumQueue.length > Config.CYCLE_DETECTION_HISTORY_SIZE) { 
            const oldestChecksum = stateChecksumQueue.shift();
            if (!stateChecksumQueue.includes(oldestChecksum)) {
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
        lastSentChecksum = calculateChecksum(jsStateArray);
        sendStateUpdate(activeCount, ratio, currentBinaryEntropy, currentBlockEntropy, rulesetChangedInQueue, commandInducedUpdate || simulationPerformedUpdate);
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
        stateBuffer: jsStateArray.buffer.slice(0),
        ruleIndexBuffer: jsRuleIndexArray.buffer.slice(0),
        hoverStateBuffer: jsHoverStateArray.buffer.slice(0),
    };
    const transferListState = [statePayload.stateBuffer, statePayload.ruleIndexBuffer, statePayload.hoverStateBuffer];
    self.postMessage(statePayload, transferListState);

    const currentRulesetHex = rulesetToHex(ruleset);

    if (activeCount !== undefined) {
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
        const currentActiveCount = jsStateArray ? jsStateArray.reduce((s, c) => s + c, 0) : 0;
        const currentRatio = workerConfig.NUM_CELLS > 0 ? currentActiveCount / workerConfig.NUM_CELLS : 0; 
        let currentBinaryEntropyStats, currentBlockEntropyStats;
        if (workerIsEntropySamplingEnabled && jsStateArray) { 
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

self.onmessage = async function(event) {
    const command = event.data;
    let processQueueAndForceTickForPausedState = false;

    switch (command.type) {
        case 'INIT':
            await init(); 
            wasm_world = new World(command.data.config.GRID_COLS, command.data.config.GRID_ROWS);
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
            lastSentChecksum = null;

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
            lastSentChecksum = initialChecksum;

            self.postMessage({ type: 'INIT_ACK', worldIndex: worldIndex });
            const initialActiveCount = isEnabled && jsStateArray ? jsStateArray.reduce((s, c) => s + c, 0) : 0;
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
            let sendUpdateForSetEnabled = false;
            if (!isEnabled && jsStateArray) {
                jsStateArray.fill(0);
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                stateHistoryChecksums.clear();
                stateChecksumQueue = [];
                
                sendUpdateForSetEnabled = true;
            } else if (isEnabled && !prevEnabled && jsStateArray) {
                 lastSentChecksum = null; 
                 sendUpdateForSetEnabled = true;
            }
            updateSimulationInterval(); 
            if (sendUpdateForSetEnabled) {
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

        case 'RESET_WORLD':
        case 'APPLY_BRUSH':
        case 'APPLY_SELECTIVE_BRUSH':
        case 'LOAD_STATE':
            commandQueue.push(command);
            const { needsStateUpdate: inducedUpdateOnGrid, rulesetChangedInQueue: rsChangedByGridCmd } = processCommandQueue();
            if (inducedUpdateOnGrid) {
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

        case 'SET_HOVER_STATE':
        case 'CLEAR_HOVER_STATE':
        case 'SET_RULESET':
            commandQueue.push(command);
            processQueueAndForceTickForPausedState = true;
            break;

        default:
            commandQueue.push(command);
            break;
    }

    if (processQueueAndForceTickForPausedState && (!isRunning || !isEnabled)) {
        runTick();
    }
};