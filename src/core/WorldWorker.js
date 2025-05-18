// src/core/WorldWorker.js
import * as Config from './config.js';

let worldIndex = -1;
let workerConfig = {};

let jsStateArray = null;
let jsNextStateArray = null;
let jsRuleIndexArray = null;
let jsNextRuleIndexArray = null;
let jsHoverStateArray = null;
let ruleset = null; // Uint8Array

let commandQueue = [];
let isRunning = false;
let isEnabled = true;
let tickIntervalId = null;
let currentSpeedTarget = Config.DEFAULT_SPEED; // Store the target TPS
let targetTickDurationMs = 1000 / Config.DEFAULT_SPEED;
let worldTickCounter = 0;

const NEIGHBOR_DIRS_ODD_R = Config.NEIGHBOR_DIRS_ODD_R;
const NEIGHBOR_DIRS_EVEN_R = Config.NEIGHBOR_DIRS_EVEN_R;

// --- Utility function for converting ruleset to hex (duplicated for worker context) ---
function rulesetToHex(rulesetArray) {
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    let bin = ""; for (let i = 0; i < 128; i++) bin += rulesetArray[i];
    try { return BigInt('0b' + bin).toString(16).toUpperCase().padStart(32, '0'); }
    catch (e) { return "Error"; } // Should not happen with Uint8Array
}
// --- End utility function ---

function calculateBinaryEntropy(p1) { if (p1 <= 0 || p1 >= 1) return 0; const p0 = 1 - p1; return -(p1 * Math.log2(p1) + p0 * Math.log2(p0)); }

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
    let activeCount = 0; // Ensure activeCount is scoped correctly if needed by multiple commands

    for (const command of commandQueue) {
        switch (command.type) {
            case 'SET_RULESET':
                ruleset = new Uint8Array(command.data.rulesetBuffer);
                rulesetChangedInQueue = true; // Mark that ruleset changed
                break;
            case 'RESET_WORLD':
                worldTickCounter = 0;
                const density = command.data.density;
                const isClearOp = command.data.isClearOperation || false;
                activeCount = 0; // Reset activeCount for this operation

                if (jsStateArray) {
                    if (isClearOp) {
                        // New "clear" logic: fill uniformly with the density (0 or 1)
                        // The density here is the target state (0 or 1) determined by WorldManager
                        jsStateArray.fill(density);
                        activeCount = (density === 1) ? workerConfig.NUM_CELLS : 0;
                    } else {
                        // Original "reset" logic
                        if (density === 0 || density === 1) { // Fill with 0 or 1 for reset
                            jsStateArray.fill(density);
                            // Only flip center for actual resets, not clears
                            const centerIdx = Math.floor((workerConfig.NUM_CELLS / 2) + (workerConfig.GRID_COLS / 2));
                            if (centerIdx >= 0 && centerIdx < workerConfig.NUM_CELLS) {
                                jsStateArray[centerIdx] = (jsStateArray[centerIdx] + 1) % 2;
                            }
                            // Recalculate activeCount after potential flip for reset
                            for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
                                if (jsStateArray[i] === 1) activeCount++;
                            }
                        } else { // Random density for reset
                            for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
                                jsStateArray[i] = Math.random() < density ? 1 : 0;
                                if (jsStateArray[i] === 1) activeCount++;
                            }
                        }
                    }
                }
                // Common reset actions for both clear and reset
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                if(jsNextStateArray) jsNextStateArray.fill(0); // Clear buffer for next state
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0); // Clear buffer for next rule indices
                if(jsHoverStateArray) jsHoverStateArray.fill(0); // Clear hover states
                needsStateUpdate = true;
                break;
            case 'APPLY_BRUSH':
                if (applyBrushLogic(command.data.col, command.data.row, command.data.brushSize)) {
                    needsStateUpdate = true;
                }
                break;
            case 'SET_HOVER_STATE':
                const hoverIndicesSet = new Set(command.data.hoverAffectedIndices);
                if (setHoverStateLogic(hoverIndicesSet)) {
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
                    needsStateUpdate = true;
                }
                break;
            case 'LOAD_STATE':
                jsStateArray = new Uint8Array(command.data.newStateBuffer);
                ruleset = new Uint8Array(command.data.newRulesetBuffer); // ruleset updated here
                worldTickCounter = command.data.worldTick || 0;
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                if(jsHoverStateArray) jsHoverStateArray.fill(0);
                isEnabled = true;
                needsStateUpdate = true;
                rulesetChangedInQueue = true; // Mark that ruleset changed
                break;
        }
    }
    commandQueue = []; // Clear the queue after processing
    // Return value might need to include activeCount if it's used by the caller of processCommandQueue
    // For now, assuming needsStateUpdate and rulesetChangedInQueue are sufficient.
    // If runTick needs activeCount, it calculates it after simulation step.
    // For immediate feedback after RESET_WORLD, it's calculated above and sendStateUpdate will use it.
    return { needsStateUpdate, rulesetChangedInQueue };
}

function runTick() {
    const { needsStateUpdate: commandInducedUpdate, rulesetChangedInQueue } = processCommandQueue();
    let simulationPerformedUpdate = false;

    if (!isEnabled || !isRunning || !jsStateArray || !ruleset || !workerConfig.NUM_CELLS) {
        if (commandInducedUpdate) {
            sendStateUpdate(undefined, undefined, undefined, rulesetChangedInQueue);
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
        const nextStateValue = ruleset[ruleIdx];
        jsNextStateArray[i] = nextStateValue;
        jsNextRuleIndexArray[i] = ruleIdx;
        if (nextStateValue === 1) activeCount++;
    }

    let tempState = jsStateArray;
    jsStateArray = jsNextStateArray;
    jsNextStateArray = tempState;

    let tempRuleIndex = jsRuleIndexArray;
    jsRuleIndexArray = jsNextRuleIndexArray;
    jsNextRuleIndexArray = tempRuleIndex;
    simulationPerformedUpdate = true;

    const ratio = workerConfig.NUM_CELLS > 0 ? activeCount / workerConfig.NUM_CELLS : 0;
    const currentEntropy = calculateBinaryEntropy(ratio);

    if (simulationPerformedUpdate || commandInducedUpdate) {
        sendStateUpdate(activeCount, ratio, currentEntropy, rulesetChangedInQueue);
    }
}

function sendStateUpdate(activeCount, ratio, entropy, rulesetHasChanged = false) {
    if (!jsStateArray || !jsRuleIndexArray || !jsHoverStateArray || !ruleset) {
        console.warn(`Worker ${worldIndex}: Attempted to send state update with invalid buffers.`);
        return;
    }
    const statePayload = {
        type: 'STATE_UPDATE',
        worldIndex: worldIndex,
        stateBuffer: jsStateArray.buffer.slice(0),
        ruleIndexBuffer: jsRuleIndexArray.buffer.slice(0),
        hoverStateBuffer: jsHoverStateArray.buffer.slice(0),
    };
    const transferList = [statePayload.stateBuffer, statePayload.ruleIndexBuffer, statePayload.hoverStateBuffer];
    self.postMessage(statePayload, transferList);

    const currentRulesetHex = rulesetToHex(ruleset);

    if (activeCount !== undefined) {
         self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: activeCount,
            ratio: ratio,
            entropy: entropy,
            rulesetHex: currentRulesetHex, // Send current ruleset hex
            isEnabled: isEnabled
        });
    } else if (rulesetHasChanged || !isEnabled) { // If only ruleset changed, or disabled, send stats update
        self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: jsStateArray.reduce((s, c) => s + c, 0), // Recalculate if not provided
            ratio: workerConfig.NUM_CELLS > 0 ? jsStateArray.reduce((s, c) => s + c, 0) / workerConfig.NUM_CELLS : 0,
            entropy: calculateBinaryEntropy(workerConfig.NUM_CELLS > 0 ? jsStateArray.reduce((s, c) => s + c, 0) / workerConfig.NUM_CELLS : 0),
            rulesetHex: currentRulesetHex,
            isEnabled: isEnabled
        });
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
    let rulesetChangedByCommand = false; // Track if ruleset changed in this message cycle

    switch (command.type) {
        case 'INIT':
            worldIndex = command.data.worldIndex;
            workerConfig = command.data.config;
            currentSpeedTarget = command.data.initialSpeed || Config.DEFAULT_SPEED;
            targetTickDurationMs = 1000 / currentSpeedTarget;

            jsStateArray = new Uint8Array(command.data.initialStateBuffer);
            ruleset = new Uint8Array(command.data.initialRulesetBuffer); // Initial ruleset
            jsHoverStateArray = new Uint8Array(command.data.initialHoverStateBuffer);

            jsNextStateArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsNextRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);

            isEnabled = command.data.initialIsEnabled;

            if (isEnabled) {
                const density = command.data.initialDensity;
                 let activeCells = 0;
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

            self.postMessage({ type: 'INIT_ACK', worldIndex: worldIndex });
            // Send initial state and stats, including rulesetHex
            const initialActiveCount = isEnabled ? jsStateArray.reduce((s, c) => s + c, 0) : 0;
            const initialRatio = isEnabled && workerConfig.NUM_CELLS > 0 ? initialActiveCount / workerConfig.NUM_CELLS : 0;
            const initialEntropy = isEnabled ? calculateBinaryEntropy(initialRatio) : 0;
            sendStateUpdate(initialActiveCount, initialRatio, initialEntropy, true); // true indicates ruleset is "new" here
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
                sendUpdateForSetEnabled = true;
            } else if (isEnabled && !prevEnabled && jsStateArray) {
                sendUpdateForSetEnabled = true; // Send update to reflect current (possibly zeroed) state
            }
            updateSimulationInterval();
            if (sendUpdateForSetEnabled) {
                 sendStateUpdate(0,0,0, false); // Ruleset itself didn't change by this command
            }
            break;

        // Commands that might change ruleset or require immediate state feedback
        case 'SET_RULESET':
        case 'LOAD_STATE':
            commandQueue.push(command);
            const { needsStateUpdate: updateAfterComplexCmd, rulesetChangedInQueue: rsChanged } = processCommandQueue();
            if (updateAfterComplexCmd) {
                const active = jsStateArray.reduce((s, c) => s + c, 0);
                const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                sendStateUpdate(active, ratio, calculateBinaryEntropy(ratio), rsChanged);
            }
            break;

        default: // APPLY_BRUSH, SET_HOVER_STATE, CLEAR_HOVER_STATE, RESET_WORLD
            commandQueue.push(command);
            // For RESET_WORLD, the state update is now handled within processCommandQueue if needsStateUpdate is true.
            // We need to ensure sendStateUpdate is called with correct parameters.
            if (command.type === 'RESET_WORLD') {
                const { needsStateUpdate: inducedUpdate, rulesetChangedInQueue: rsChangedByQueue } = processCommandQueue();
                if (inducedUpdate) {
                    // activeCount for reset/clear is calculated inside the RESET_WORLD case now
                    // We need to retrieve it or re-calculate it here if processCommandQueue doesn't return it
                    // For simplicity, let's assume activeCount is correctly handled and passed to sendStateUpdate
                    // or sendStateUpdate itself calculates it from jsStateArray if activeCount is undefined.
                    const currentActiveCount = jsStateArray.reduce((sum, val) => sum + val, 0);
                    const currentRatio = workerConfig.NUM_CELLS > 0 ? currentActiveCount / workerConfig.NUM_CELLS : 0;
                    const currentEntropy = calculateBinaryEntropy(currentRatio);
                    sendStateUpdate(currentActiveCount, currentRatio, currentEntropy, rsChangedByQueue);
                }
            } else if (command.type === 'SET_HOVER_STATE' || command.type === 'CLEAR_HOVER_STATE' || command.type === 'APPLY_BRUSH') {
                const { needsStateUpdate: inducedUpdate, rulesetChangedInQueue: rsChangedByQueue } = processCommandQueue();
                if (inducedUpdate) {
                    const active = jsStateArray.reduce((s, c) => s + c, 0);
                    const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                    sendStateUpdate(active, ratio, calculateBinaryEntropy(ratio), rsChangedByQueue);
                }
            }
            break;
    }
};