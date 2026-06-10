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
let lastSentChecksum = null;
let stateHistoryChecksums = new Set();
let stateChecksumQueue = [];

let statsThrottler;
let gridThrottler;
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

// Checksum of the current state buffer. The buffer lives in Wasm linear memory now, so this is
// computed entirely inside Wasm (no array is copied across the boundary).
function stateChecksum() {
    if (!wasm_world) return 0;
    return wasm_world.checksum_state();
}

// (Re)build the typed-array views over the World's buffers in Wasm linear memory. Called once after
// the World is constructed. The views are never copied per-tick; `run_tick` swaps the current/next
// buffers internally and the worker mirrors that by swapping its view references (see runTick).
function refreshSimViews() {
    const mem = _wasm_module.memory.buffer;
    const n = workerConfig.NUM_CELLS;
    jsStateArray = new Uint8Array(mem, wasm_world.state_ptr(), n);
    jsNextStateArray = new Uint8Array(mem, wasm_world.next_state_ptr(), n);
    jsRuleIndexArray = new Uint8Array(mem, wasm_world.rule_indices_ptr(), n);
    jsNextRuleIndexArray = new Uint8Array(mem, wasm_world.next_rule_indices_ptr(), n);
    ruleset = new Uint8Array(mem, wasm_world.ruleset_ptr(), 128);
    ruleUsageCounters = new Uint32Array(mem, wasm_world.rule_usage_counters_ptr(), 128);
}

// Copies a view's bytes into a fresh, transferable ArrayBuffer. Required because the views are
// backed by Wasm linear memory: transferring `view.buffer` directly would detach all of Wasm
// memory, and slicing `view.buffer` would copy the entire heap rather than just the cells.
function copyOutBuffer(view) {
    return view.slice().buffer;
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

// Abort an in-progress cycle-detection attempt without discarding the checksum history. Used when a
// candidate "cycle" turns out to be a spurious 32-bit checksum collision (states differ) or grows
// past CYCLE_DETECTION_MAX_PERIOD. The simulation keeps running normally and may legitimately
// detect a real cycle later.
function abortCycleDetection() {
    isDetectingCycle = false;
    detectedCycle = [];
    cycleStartChecksum = null;
}

// Byte-for-byte equality of two Uint8Array views over the same logical length. Used to confirm a
// recurring checksum reflects a genuinely identical state before committing to cycle playback.
function statesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function calculateBinaryEntropy(p1) { if (p1 <= 0 || p1 >= 1) return 0; const p0 = 1 - p1; return -(p1 * Math.log2(p1) + p0 * Math.log2(p0)); }

// Hex block entropy is computed in Wasm over the state buffer it already owns (see World::block_entropy).
function calculateHexBlockEntropy() {
    return wasm_world ? wasm_world.block_entropy() : 0;
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
                ruleset.set(new Uint8Array(command.data.rulesetBuffer));
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
                jsStateArray.set(new Uint8Array(command.data.newStateBuffer));
                ruleset.set(new Uint8Array(command.data.newRulesetBuffer));
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
    
    let activeCount;
    if (isCyclePlaybackMode) {
        worldTickCounter++;
        const nextFrame = detectedCycle[cyclePlaybackIndex];
        // Playback writes directly into the current state buffer (no run_tick, no buffer swap),
        // so the Wasm-owned `state` and the worker's views stay in sync.
        jsStateArray.set(nextFrame.state);
        jsRuleIndexArray.set(nextFrame.rules);
        cyclePlaybackIndex = (cyclePlaybackIndex + 1) % detectedCycle.length;
        activeCount = jsStateArray.reduce((s, c) => s + c, 0);
    } else {
        worldTickCounter++;
        // run_tick advances the simulation inside Wasm and swaps the current/next buffers
        // internally, returning the active-cell count of the new generation. Mirror that swap on
        // the worker's views so they keep tracking the now-current buffers in linear memory.
        activeCount = wasm_world.run_tick();
        [jsStateArray, jsNextStateArray] = [jsNextStateArray, jsStateArray];
        [jsRuleIndexArray, jsNextRuleIndexArray] = [jsNextRuleIndexArray, jsRuleIndexArray];
    }

    const newStateChecksum = stateChecksum();


    if (isDetectingCycle) {
        if (newStateChecksum === cycleStartChecksum && statesEqual(jsStateArray, detectedCycle[0].state)) {
            // Verified: the recurring checksum reflects a genuinely identical state, so the frames
            // collected so far form one true period of the cycle. Commit to playback.
            isCyclePlaybackMode = true;
            isDetectingCycle = false;
            cyclePlaybackIndex = 0;
        } else if (detectedCycle.length >= Config.CYCLE_DETECTION_MAX_PERIOD) {
            // The candidate cycle grew past the cap without closing — almost certainly a spurious
            // checksum collision. Abort so we stop copying a full state every tick.
            abortCycleDetection();
        } else {
            detectedCycle.push({
                state: jsStateArray.slice(),
                rules: jsRuleIndexArray.slice()
            });
        }
    } else if (!isCyclePlaybackMode && stateHistoryChecksums.has(newStateChecksum)) {
        isDetectingCycle = true;
        cycleStartChecksum = newStateChecksum;
        detectedCycle = [{
            state: jsStateArray.slice(),
            rules: jsRuleIndexArray.slice()
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

    if (newStateChecksum !== lastSentChecksum) {
        simulationPerformedUpdate = true;
    }

    

    const ratio = workerConfig.NUM_CELLS > 0 ? activeCount / workerConfig.NUM_CELLS : 0;
    let currentBinaryEntropy, currentBlockEntropy;
    const shouldSampleEntropy = workerIsEntropySamplingEnabled && (worldTickCounter % workerEntropySampleRate === 0);

    if (shouldSampleEntropy) {
        currentBinaryEntropy = calculateBinaryEntropy(ratio);
        currentBlockEntropy = calculateHexBlockEntropy();
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
        // Throttled to ~display rate. sendGridUpdate reads the current buffers at fire time, so a
        // deferred send always carries the latest frame, never a stale one.
        gridThrottler.schedule();
    }
}


function sendGridUpdate() {
    // Any actual send (throttled or forced) clears a pending throttled send so forced syncs don't
    // get followed by a redundant duplicate frame.
    if (gridThrottler) gridThrottler.cancel();
    if (!jsStateArray || !jsRuleIndexArray || !jsHoverStateArray) {
        console.warn(`Worker ${worldIndex}: Attempted to send grid update with invalid/missing buffers.`);
        return;
    }

    // State and rule-index views are backed by Wasm linear memory, so copy out just their cells
    // into fresh transferable buffers (never transfer/slice the whole Wasm heap).
    const statePayload = {
        type: 'STATE_UPDATE',
        worldIndex: worldIndex,
        stateBuffer: copyOutBuffer(jsStateArray),
        ruleIndexBuffer: copyOutBuffer(jsRuleIndexArray),
        hoverStateBuffer: jsHoverStateArray.buffer.slice(0),
    };
    const transferListState = [statePayload.stateBuffer, statePayload.ruleIndexBuffer, statePayload.hoverStateBuffer];
    self.postMessage(statePayload, transferListState);
}

function sendStatsUpdate(forceUpdate = false) {
    
    if (!isRunning && !forceUpdate) return;

    // ruleUsageCounters is a view into Wasm memory; copy only its 128 entries out.
    const ruleUsageCountersBuffer = ruleUsageCounters ? copyOutBuffer(ruleUsageCounters) : null;
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
    lastSentChecksum = stateChecksum();
    sendGridUpdate();

    const active = jsStateArray.reduce((s, c) => s + c, 0);
    const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
    let binaryEntropy, blockEntropy;

    if (workerIsEntropySamplingEnabled) {
        binaryEntropy = calculateBinaryEntropy(ratio);
        blockEntropy = calculateHexBlockEntropy();
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
            _wasm_module = await init();
            wasm_world = new World(command.data.config.GRID_COLS, command.data.config.GRID_ROWS);
            worldIndex = command.data.worldIndex;
            workerConfig = command.data.config;
            currentSpeedTarget = command.data.initialSpeed || Config.DEFAULT_SPEED;
            targetTickDurationMs = 1000 / currentSpeedTarget;
            ratioHistory = [];
            entropyHistory = [];
            hexBlockEntropyHistory = [];
            // State, next-state, rule-index, ruleset and usage-counter buffers all live in Wasm
            // linear memory; build typed-array views over them rather than allocating in JS.
            refreshSimViews();
            ruleset.set(new Uint8Array(command.data.initialRulesetBuffer));
            jsHoverStateArray = new Uint8Array(command.data.initialHoverStateBuffer);
            isEnabled = command.data.initialIsEnabled;
            workerIsEntropySamplingEnabled = command.data.initialEntropySamplingEnabled;
            workerEntropySampleRate = command.data.initialEntropySampleRate || 10;

            statsThrottler = new Throttler(sendStatsUpdate, Config.STATS_UPDATE_INTERVAL_MS);
            gridThrottler = new Throttler(sendGridUpdate, Config.GRID_UPDATE_INTERVAL_MS);

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

            const initialChecksum = stateChecksum();
            stateHistoryChecksums.add(initialChecksum);
            stateChecksumQueue.push(initialChecksum);
            lastSentChecksum = initialChecksum;

            const initialActiveCount = isEnabled && jsStateArray ? jsStateArray.reduce((s, c) => s + c, 0) : 0;
            const initialRatio = isEnabled && workerConfig.NUM_CELLS > 0 ? initialActiveCount / workerConfig.NUM_CELLS : 0; 
            let initialBinaryEntropy, initialBlockEntropy;
            if (isEnabled && workerIsEntropySamplingEnabled) {
                initialBinaryEntropy = calculateBinaryEntropy(initialRatio);
                initialBlockEntropy = calculateHexBlockEntropy();
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
                lastSentChecksum = stateChecksum();
                const activeAfterEnable = jsStateArray.reduce((s, c) => s + c, 0);
                const ratioAfterEnable = workerConfig.NUM_CELLS > 0 ? activeAfterEnable / workerConfig.NUM_CELLS : 0; 
                
                
                lastKnownStats = {
                    tick: worldTickCounter,
                    activeCount: activeAfterEnable,
                    ratio: ratioAfterEnable,
                    binaryEntropy: workerIsEntropySamplingEnabled ? calculateBinaryEntropy(ratioAfterEnable) : undefined,
                    blockEntropy: workerIsEntropySamplingEnabled ? calculateHexBlockEntropy() : undefined,
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
                lastSentChecksum = stateChecksum();
                const active = jsStateArray.reduce((s, c) => s + c, 0);
                const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                
                
                lastKnownStats = {
                    tick: worldTickCounter,
                    activeCount: active,
                    ratio: ratio,
                    binaryEntropy: workerIsEntropySamplingEnabled ? calculateBinaryEntropy(ratio) : undefined,
                    blockEntropy: workerIsEntropySamplingEnabled ? calculateHexBlockEntropy() : undefined,
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