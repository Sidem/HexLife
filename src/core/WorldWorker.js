import * as Config from './config.js';
import init, { World } from './wasm-engine/hexlife_wasm.js';
import { rulesetToHex, findHexagonsInNeighborhood } from '../utils/utils.js';
import { Throttler } from '../utils/throttler.js';
import { DensityStrategy } from './initialStateStrategies/DensityStrategy.js';
import { ClusterStrategy } from './initialStateStrategies/ClusterStrategy.js';

let _wasm_module;
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

let statsThrottler;
let lastKnownStats = {};

let isCyclePlaybackMode = false;
let isDetectingCycle = false;
let detectedCycle = []; 
let cyclePlaybackIndex = 0;
let cycleStartChecksum = null;

const strategies = {
    density: new DensityStrategy(),
    clusters: new ClusterStrategy()
};

function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function calculateChecksum(arr) {
    if (!arr || !wasm_world) return 0;
    return wasm_world.calculate_checksum(arr);
}

function resetCycleState() {
    isCyclePlaybackMode = false;
    isDetectingCycle = false;
    detectedCycle = [];
    cyclePlaybackIndex = 0;
    cycleStartChecksum = null;
    stateHistoryChecksums.clear();
    stateChecksumQueue = [];
    lastSentChecksum = null;
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

function applySelectiveBrushLogic(cellIndices, brushMode = 'invert') {
    if (!jsStateArray || !cellIndices || cellIndices.size === 0) return false;
    let changed = false;
    for (const idx of cellIndices) {
        if (idx >= 0 && idx < workerConfig.NUM_CELLS) {
            const previousState = jsStateArray[idx];
            let newState = previousState;

            if (brushMode === 'invert') {
                newState = 1 - previousState;
            } else if (brushMode === 'draw') {
                newState = 1;
            } else if (brushMode === 'erase') {
                newState = 0;
            }

            if (newState !== previousState) {
                jsStateArray[idx] = newState;
                if(jsRuleIndexArray) jsRuleIndexArray[idx] = 255; // Use 255 to signal a manual change
                changed = true;
            }
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
    let needsGridUpdate = false;
    let needsVisualUpdate = false;
    let rulesetChangedInQueue = false;

    for (const command of commandQueue) {
        switch (command.type) {
            case 'SET_RULESET': {
                ruleset = new Uint8Array(command.data.rulesetBuffer);
                rulesetChangedInQueue = true;
                needsGridUpdate = true;
                resetCycleState();
                break;
            }
            case 'RESET_WORLD': {
                worldTickCounter = 0;
                ratioHistory = [];
                entropyHistory = [];
                hexBlockEntropyHistory = [];
                const config = command.data.initialState;
                const isClearOp = command.data.isClearOperation || false;
                const seed = command.data.seed;
                const rng = seed ? mulberry32(seed) : Math.random;

                if (ruleUsageCounters) ruleUsageCounters.fill(0);
                if (jsStateArray) {
                    if (isClearOp) {
                        jsStateArray.fill(config.params.density);
                    } else {
                        const strategy = strategies[config.mode];
                        if (strategy) {
                            strategy.generate(jsStateArray, config.params, rng, workerConfig);
                        } else {
                            // Fallback to density
                            strategies.density.generate(jsStateArray, config.params, rng, workerConfig);
                        }
                    }
                }
                if(jsRuleIndexArray) jsRuleIndexArray.fill(255); // Use 255 as a flag for "initial state"
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                if(jsHoverStateArray) jsHoverStateArray.fill(0);
                resetCycleState();
                needsGridUpdate = true;
                break;
            }
            case 'APPLY_BRUSH':
            case 'APPLY_SELECTIVE_BRUSH': {
                let brushChanged = false;
                if (command.type === 'APPLY_BRUSH') {
                    const affectedIndicesInBrush = new Set();
                    findHexagonsInNeighborhood(command.data.col, command.data.row, command.data.brushSize, affectedIndicesInBrush);
                    brushChanged = applySelectiveBrushLogic(affectedIndicesInBrush);
                } else {
                    brushChanged = applySelectiveBrushLogic(command.data.cellIndices, command.data.brushMode);
                }
                if (brushChanged) {
                    resetCycleState();
                    needsGridUpdate = true;
                }
                break;
            }
            case 'SET_HOVER_STATE': {
                if (setHoverStateLogic(command.data.hoverAffectedIndices)) {
                    needsVisualUpdate = true; 
                }
                break;
            }
            case 'CLEAR_HOVER_STATE': {
                if (jsHoverStateArray && jsHoverStateArray.some(s => s === 1)) {
                    jsHoverStateArray.fill(0);
                    needsVisualUpdate = true; 
                }
                break;
            }
            case 'SET_ENABLED': {
                isEnabled = command.data.enabled;
                 if (!isEnabled && jsStateArray) {
                    jsStateArray.fill(0);
                    if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                    resetCycleState();
                    needsGridUpdate = true;
                } else if (isEnabled && jsStateArray) {
                    lastSentChecksum = null;
                    needsGridUpdate = true;
                }
                break;
            }
            case 'LOAD_STATE': {
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
                resetCycleState();
                needsGridUpdate = true;
                rulesetChangedInQueue = true;
                break;
            }
        }
    }
    commandQueue = [];
    
    return { needsGridUpdate, needsVisualUpdate, rulesetChangedInQueue };
}

function runTick() {
    const { needsGridUpdate, needsVisualUpdate, rulesetChangedInQueue } = processCommandQueue();
    let simulationPerformedUpdate = false;
    if (!isEnabled || !isRunning) {
        if (needsGridUpdate || needsVisualUpdate || rulesetChangedInQueue) {
            forceSyncUpdate();
        }
        return; 
    }
    
    if (isCyclePlaybackMode) {
        worldTickCounter++;
        const nextFrame = detectedCycle[cyclePlaybackIndex];
        jsNextStateArray.set(nextFrame.state);
        jsNextRuleIndexArray.set(nextFrame.rules);
        cyclePlaybackIndex = (cyclePlaybackIndex + 1) % detectedCycle.length;
    } else {
        worldTickCounter++;
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

    
    if (isDetectingCycle) {
        if (newStateChecksum === cycleStartChecksum) {
            isCyclePlaybackMode = true;
            isDetectingCycle = false;
            cyclePlaybackIndex = 0;
        } else {
            detectedCycle.push({
                state: jsNextStateArray.slice(),
                rules: jsNextRuleIndexArray.slice()
            });
        }
    } else if (!isCyclePlaybackMode && stateHistoryChecksums.has(newStateChecksum)) {
        isDetectingCycle = true;
        cycleStartChecksum = newStateChecksum;
        detectedCycle = [{
            state: jsNextStateArray.slice(),
            rules: jsNextRuleIndexArray.slice()
        }];
    }

    if (!isCyclePlaybackMode) {
        stateHistoryChecksums.add(newStateChecksum);
        stateChecksumQueue.push(newStateChecksum);
        if (stateChecksumQueue.length > Config.CYCLE_DETECTION_HISTORY_SIZE) {
            const oldestChecksum = stateChecksumQueue.shift();
            if (!stateChecksumQueue.includes(oldestChecksum)) {
                stateHistoryChecksums.delete(oldestChecksum);
            }
        }
    }
    
    
    [jsStateArray, jsNextStateArray] = [jsNextStateArray, jsStateArray];
    [jsRuleIndexArray, jsNextRuleIndexArray] = [jsNextRuleIndexArray, jsRuleIndexArray];

    if (newStateChecksum !== lastSentChecksum) {
        simulationPerformedUpdate = true;
    }

    

    const ratio = workerConfig.NUM_CELLS > 0 ? activeCount / workerConfig.NUM_CELLS : 0;
    let currentBinaryEntropy, currentBlockEntropy;
    const shouldSampleEntropy = workerIsEntropySamplingEnabled && (worldTickCounter % workerEntropySampleRate === 0);

    if (shouldSampleEntropy) {
        currentBinaryEntropy = calculateBinaryEntropy(ratio);
        currentBlockEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
        entropyHistory.push(currentBinaryEntropy);
        hexBlockEntropyHistory.push(currentBlockEntropy);
        if (entropyHistory.length > MAX_HISTORY_SIZE) entropyHistory.shift();
        if (hexBlockEntropyHistory.length > MAX_HISTORY_SIZE) hexBlockEntropyHistory.shift();
    }

    ratioHistory.push(ratio);
    if (ratioHistory.length > MAX_HISTORY_SIZE) ratioHistory.shift();
    
    
    lastKnownStats = {
        tick: worldTickCounter,
        activeCount: activeCount,
        ratio: ratio,
        binaryEntropy: currentBinaryEntropy ?? lastKnownStats.binaryEntropy,
        blockEntropy: currentBlockEntropy ?? lastKnownStats.blockEntropy,
        rulesetHex: rulesetToHex(ruleset),
        isEnabled: isEnabled,
        isInCycle: isCyclePlaybackMode,
        cycleLength: isCyclePlaybackMode ? detectedCycle.length : 0,
    };

    
    statsThrottler.schedule();

    
    if (simulationPerformedUpdate) {
        lastSentChecksum = newStateChecksum;
        sendGridUpdate();
    }
}


function sendGridUpdate() {
    if (!jsStateArray || !jsRuleIndexArray || !jsHoverStateArray) {
        console.warn(`Worker ${worldIndex}: Attempted to send grid update with invalid/missing buffers.`);
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
}

function sendStatsUpdate(forceUpdate = false) {
    
    if (!isRunning && !forceUpdate) return;

    const ruleUsageCountersBuffer = ruleUsageCounters ? ruleUsageCounters.buffer.slice(0) : null;
    const transferListStats = ruleUsageCountersBuffer ? [ruleUsageCountersBuffer] : [];

    self.postMessage({
        type: 'STATS_UPDATE',
        worldIndex: worldIndex,
        ...lastKnownStats,
        ruleUsageCounters: ruleUsageCountersBuffer,
    }, transferListStats);
}

function forceSyncUpdate() {
    
    
    if (!jsStateArray) return;
    lastSentChecksum = calculateChecksum(jsStateArray);
    sendGridUpdate();

    const active = jsStateArray.reduce((s, c) => s + c, 0);
    const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
    let binaryEntropy, blockEntropy;

    if (workerIsEntropySamplingEnabled) {
        binaryEntropy = calculateBinaryEntropy(ratio);
        blockEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    }

    
    lastKnownStats = {
        tick: worldTickCounter,
        activeCount: active,
        ratio: ratio,
        binaryEntropy: binaryEntropy,
        blockEntropy: blockEntropy,
        rulesetHex: rulesetToHex(ruleset),
        isEnabled: isEnabled,
        isInCycle: isCyclePlaybackMode,
        cycleLength: isCyclePlaybackMode ? detectedCycle.length : 0,
    };
    
    
    sendStatsUpdate(true);
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

    switch (command.type) {
        case 'INIT': {
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

            statsThrottler = new Throttler(sendStatsUpdate, Config.STATS_UPDATE_INTERVAL_MS);

            resetCycleState();

            if (isEnabled) {
                const initialState = command.data.initialState;
                const seed = command.data.seed || Date.now();
                const rng = seed ? mulberry32(seed) : Math.random;
                const strategy = strategies[initialState.mode];
                if (strategy) {
                    strategy.generate(jsStateArray, initialState.params, rng, workerConfig);
                } else {
                    strategies.density.generate(jsStateArray, initialState.params, rng, workerConfig);
                }
                jsRuleIndexArray.fill(255); // Use 255 as a flag for "initial state"
            } else {
                jsStateArray.fill(0);
                jsRuleIndexArray.fill(255); // Use 255 as a flag for "initial state"
            }
            jsHoverStateArray.fill(0);

            const initialChecksum = calculateChecksum(jsStateArray);
            stateHistoryChecksums.add(initialChecksum);
            stateChecksumQueue.push(initialChecksum);
            lastSentChecksum = initialChecksum;

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

            
            lastKnownStats = {
                tick: worldTickCounter,
                activeCount: initialActiveCount,
                ratio: initialRatio,
                binaryEntropy: initialBinaryEntropy,
                blockEntropy: initialBlockEntropy,
                rulesetHex: rulesetToHex(ruleset),
                isEnabled: isEnabled,
                isInCycle: false,
                cycleLength: 0
            };

            self.postMessage({ type: 'INIT_ACK', worldIndex: worldIndex });
            sendGridUpdate();
            sendStatsUpdate(true); 
            break;
        }

        case 'START_SIMULATION': {
            isRunning = true;
            updateSimulationInterval();
            break;
        }
        case 'STOP_SIMULATION': {
            isRunning = false;
            updateSimulationInterval();
            break;
        }
        case 'SET_SPEED_TARGET': {
            currentSpeedTarget = command.data.speed;
            updateSimulationInterval();
            break;
        }
        case 'SET_ENABLED': {
            const prevEnabled = isEnabled;
            isEnabled = command.data.enabled;
            let sendUpdateForSetEnabled = false;
            if (!isEnabled && jsStateArray) {
                jsStateArray.fill(0);
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                resetCycleState();
                
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
                
                
                lastKnownStats = {
                    tick: worldTickCounter,
                    activeCount: activeAfterEnable,
                    ratio: ratioAfterEnable,
                    binaryEntropy: workerIsEntropySamplingEnabled ? calculateBinaryEntropy(ratioAfterEnable) : undefined,
                    blockEntropy: workerIsEntropySamplingEnabled ? calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R) : undefined,
                    rulesetHex: rulesetToHex(ruleset),
                    isEnabled: isEnabled,
                    isInCycle: isCyclePlaybackMode,
                    cycleLength: isCyclePlaybackMode ? detectedCycle.length : 0,
                };

                sendGridUpdate();
                sendStatsUpdate(true); 
            }
            break;
        }

        case 'SET_ENTROPY_SAMPLING_PARAMS': {
            workerIsEntropySamplingEnabled = command.data.enabled;
            workerEntropySampleRate = command.data.rate || 10;
            if (!workerIsEntropySamplingEnabled) {
                entropyHistory = [];
                hexBlockEntropyHistory = [];
            }
            break;
        }

        case 'RESET_WORLD':
        case 'APPLY_BRUSH':
        case 'APPLY_SELECTIVE_BRUSH':
        case 'LOAD_STATE': {
            commandQueue.push(command);
            const { needsGridUpdate: inducedUpdateOnGrid } = processCommandQueue();
            if (inducedUpdateOnGrid) {
                lastSentChecksum = calculateChecksum(jsStateArray);
                const active = jsStateArray.reduce((s, c) => s + c, 0);
                const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                
                
                lastKnownStats = {
                    tick: worldTickCounter,
                    activeCount: active,
                    ratio: ratio,
                    binaryEntropy: workerIsEntropySamplingEnabled ? calculateBinaryEntropy(ratio) : undefined,
                    blockEntropy: workerIsEntropySamplingEnabled ? calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R) : undefined,
                    rulesetHex: rulesetToHex(ruleset),
                    isEnabled: isEnabled,
                    isInCycle: isCyclePlaybackMode,
                    cycleLength: isCyclePlaybackMode ? detectedCycle.length : 0,
                };

                sendGridUpdate();
                sendStatsUpdate(true); 
            }
            break;
        }

        case 'SET_HOVER_STATE':
        case 'CLEAR_HOVER_STATE':
        case 'SET_RULESET': {
            commandQueue.push(command);
            if (!isRunning || !isEnabled) {
                runTick();
            }
            break;
        }
        default: {
            commandQueue.push(command);
            break;
        }
    }
};