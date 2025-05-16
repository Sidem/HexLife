// src/core/WorldWorker.js
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
let currentSpeedTarget = Config.DEFAULT_SPEED; // Store the target TPS
let targetTickDurationMs = 1000 / Config.DEFAULT_SPEED;
let worldTickCounter = 0;

const NEIGHBOR_DIRS_ODD_R = Config.NEIGHBOR_DIRS_ODD_R; // Assuming these are in Config
const NEIGHBOR_DIRS_EVEN_R = Config.NEIGHBOR_DIRS_EVEN_R;

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

    for (const command of commandQueue) {
        switch (command.type) {
            case 'SET_RULESET':
                ruleset = new Uint8Array(command.data.rulesetBuffer);
                rulesetChangedInQueue = true;
                break;
            case 'RESET_WORLD':
                worldTickCounter = 0;
                const density = command.data.initialDensity;
                let activeCount = 0;
                if (jsStateArray) {
                    if(density % 1 === 0) {
                        jsStateArray.fill(density);
                        const centerIdx = Math.floor((workerConfig.NUM_CELLS / 2)+workerConfig.GRID_COLS/2);
                        jsStateArray[centerIdx] = (jsStateArray[centerIdx]+1) % 2;
                        activeCount = 1;
                    } else {
                    for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
                        jsStateArray[i] = Math.random() < density ? 1 : 0;
                        if (jsStateArray[i] === 1) activeCount++;
                        }
                    }
                }
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                if(jsHoverStateArray) jsHoverStateArray.fill(0);
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
            case 'LOAD_STATE': // Added to handle loading state directly in worker
                jsStateArray = new Uint8Array(command.data.newStateBuffer);
                ruleset = new Uint8Array(command.data.newRulesetBuffer);
                worldTickCounter = command.data.worldTick || 0;
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0); // Or load if saved
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                if(jsHoverStateArray) jsHoverStateArray.fill(0);
                isEnabled = true; // Assume loading a state means enabling it
                needsStateUpdate = true;
                break;
        }
    }
    commandQueue = [];
    return { needsStateUpdate, rulesetChangedInQueue };
}

function runTick() {
    const { needsStateUpdate: commandInducedUpdate } = processCommandQueue();
    let simulationPerformedUpdate = false;

    if (!isEnabled || !isRunning || !jsStateArray || !ruleset || !workerConfig.NUM_CELLS) {
        if (commandInducedUpdate) {
            sendStateUpdate();
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
        sendStateUpdate(activeCount, ratio, currentEntropy);
    }
}

function sendStateUpdate(activeCount, ratio, entropy) {
    // Ensure all buffers are valid before attempting to slice and post
    if (!jsStateArray || !jsRuleIndexArray || !jsHoverStateArray) {
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

    if (activeCount !== undefined) {
         self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: activeCount,
            ratio: ratio,
            entropy: entropy,
            isEnabled: isEnabled
        });
    } else if (!isEnabled) {
        self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: 0, ratio:0, entropy:0,
            isEnabled: isEnabled
        });
    }
}

function updateSimulationInterval() {
    if (tickIntervalId) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
    }
    if (isRunning && isEnabled) { // Only run if globally running and this world is enabled
        targetTickDurationMs = Math.max(1, 1000 / currentSpeedTarget); // Ensure duration is at least 1ms
        tickIntervalId = setInterval(runTick, targetTickDurationMs);
    }
}


self.onmessage = function(event) {
    const command = event.data;
    switch (command.type) {
        case 'INIT':
            worldIndex = command.data.worldIndex;
            workerConfig = command.data.config;
            currentSpeedTarget = command.data.initialSpeed || Config.DEFAULT_SPEED; // Use initial speed
            targetTickDurationMs = 1000 / currentSpeedTarget;

            jsStateArray = new Uint8Array(command.data.initialStateBuffer);
            ruleset = new Uint8Array(command.data.initialRulesetBuffer);
            jsHoverStateArray = new Uint8Array(command.data.initialHoverStateBuffer);

            jsNextStateArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsNextRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);

            isEnabled = command.data.initialIsEnabled;

            if (isEnabled) {
                const density = command.data.initialDensity;
                for (let i = 0; i < workerConfig.NUM_CELLS; i++) {
                    jsStateArray[i] = Math.random() < density ? 1 : 0;
                }
                jsRuleIndexArray.fill(0);
            } else {
                jsStateArray.fill(0);
                jsRuleIndexArray.fill(0);
            }
            jsHoverStateArray.fill(0);

            self.postMessage({ type: 'INIT_ACK', worldIndex: worldIndex });
            sendStateUpdate(
                isEnabled ? jsStateArray.reduce((s, c) => s + c, 0) : 0,
                isEnabled && workerConfig.NUM_CELLS > 0 ? jsStateArray.reduce((s, c) => s + c, 0) / workerConfig.NUM_CELLS : 0,
                isEnabled ? calculateBinaryEntropy(workerConfig.NUM_CELLS > 0 ? jsStateArray.reduce((s, c) => s + c, 0) / workerConfig.NUM_CELLS : 0) : 0
            );
            break;
        case 'START_SIMULATION': // This means global play
            isRunning = true;
            updateSimulationInterval();
            break;
        case 'STOP_SIMULATION': // This means global pause
            isRunning = false;
            updateSimulationInterval();
            break;
        case 'SET_SPEED_TARGET':
            currentSpeedTarget = command.data.speed;
            updateSimulationInterval();
            break;
        case 'SET_ENABLED': // This comes from main thread's command for this specific world
            const prevEnabled = isEnabled;
            isEnabled = command.data.enabled;
            if (!isEnabled && jsStateArray) { // If disabling, clear state
                jsStateArray.fill(0);
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                 // Send update to reflect cleared state
                sendStateUpdate(0,0,0);
            } else if (isEnabled && !prevEnabled && jsStateArray) { // If enabling from disabled state
                // Re-initialize with its density, or just send current (likely zeroed) state
                // For simplicity, we assume it was zeroed and send that.
                // If it needs to re-randomize, that would be a 'RESET' command.
                sendStateUpdate(0,0,0);
            }
            updateSimulationInterval(); // This will stop/start interval if needed
            break;
        default:
            commandQueue.push(command);
            if (command.type === 'SET_HOVER_STATE' || command.type === 'CLEAR_HOVER_STATE' || command.type === 'APPLY_BRUSH') {
                const { needsStateUpdate: inducedUpdate } = processCommandQueue();
                if (inducedUpdate) {
                    const active = jsStateArray.reduce((s, c) => s + c, 0);
                    const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                    sendStateUpdate(active, ratio, calculateBinaryEntropy(ratio));
                }
            }
            break;
    }
};