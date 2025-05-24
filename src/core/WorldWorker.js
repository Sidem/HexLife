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

// History arrays for analysis
let ratioHistory = [];
let entropyHistory = [];
const MAX_HISTORY_SIZE = Config.STATS_HISTORY_SIZE || 100;

// Worker-specific entropy sampling settings
let workerIsEntropySamplingEnabled = false;
let workerEntropySampleRate = 10; // Default, will be overwritten by INIT

const NEIGHBOR_DIRS_ODD_R = Config.NEIGHBOR_DIRS_ODD_R;
const NEIGHBOR_DIRS_EVEN_R = Config.NEIGHBOR_DIRS_EVEN_R;

function rulesetToHex(rulesetArray) {
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    let bin = ""; for (let i = 0; i < 128; i++) bin += rulesetArray[i];
    try { return BigInt('0b' + bin).toString(16).toUpperCase().padStart(32, '0'); }
    catch (e) { return "Error"; } 
}


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
                break;
            case 'RESET_WORLD':
                worldTickCounter = 0;
                ratioHistory = [];
                entropyHistory = [];
                const density = command.data.density;
                const isClearOp = command.data.isClearOperation || false;
                activeCount = 0;
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
                needsStateUpdate = true;
                break;
            case 'APPLY_BRUSH':
                if (applyBrushLogic(command.data.col, command.data.row, command.data.brushSize)) {
                    needsStateUpdate = true;
                }
                break;
            case 'APPLY_SELECTIVE_BRUSH':
                if (applySelectiveBrushLogic(command.data.cellIndices)) {
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
                ruleset = new Uint8Array(command.data.newRulesetBuffer); 
                worldTickCounter = command.data.worldTick || 0;
                ratioHistory = [];
                entropyHistory = [];
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                if(jsHoverStateArray) jsHoverStateArray.fill(0);
                isEnabled = true;
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
    
    // Only calculate entropy when sampling is enabled and it's a sampling tick
    let currentEntropy = undefined;
    const shouldSampleEntropy = workerIsEntropySamplingEnabled && (worldTickCounter % workerEntropySampleRate === 0);
    if (shouldSampleEntropy) {
        currentEntropy = calculateBinaryEntropy(ratio);
    }

    // Record history if simulation is active
    if (isEnabled && isRunning) {
        ratioHistory.push(ratio); // Ratio history is still recorded every tick
        if (ratioHistory.length > MAX_HISTORY_SIZE) {
            ratioHistory.shift();
        }

        // Record entropy history only when we calculated it
        if (shouldSampleEntropy && currentEntropy !== undefined) {
            entropyHistory.push(currentEntropy);
            if (entropyHistory.length > MAX_HISTORY_SIZE) {
                entropyHistory.shift();
            }
        }
    }

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
            rulesetHex: currentRulesetHex, 
            isEnabled: isEnabled
        });
    } else if (rulesetHasChanged || !isEnabled) { 
        const currentActiveCount = jsStateArray.reduce((s, c) => s + c, 0);
        const currentRatio = workerConfig.NUM_CELLS > 0 ? currentActiveCount / workerConfig.NUM_CELLS : 0;
        
        // Only calculate entropy if sampling is enabled
        let currentEntropy = undefined;
        if (workerIsEntropySamplingEnabled) {
            currentEntropy = calculateBinaryEntropy(currentRatio);
        }
        
        self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: currentActiveCount,
            ratio: currentRatio,
            entropy: currentEntropy,
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
    let rulesetChangedByCommand = false; 

    switch (command.type) {
        case 'INIT':
            worldIndex = command.data.worldIndex;
            workerConfig = command.data.config;
            currentSpeedTarget = command.data.initialSpeed || Config.DEFAULT_SPEED;
            targetTickDurationMs = 1000 / currentSpeedTarget;

            // Initialize history arrays
            ratioHistory = [];
            entropyHistory = [];

            jsStateArray = new Uint8Array(command.data.initialStateBuffer);
            ruleset = new Uint8Array(command.data.initialRulesetBuffer); 
            jsHoverStateArray = new Uint8Array(command.data.initialHoverStateBuffer);

            jsNextStateArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);
            jsNextRuleIndexArray = new Uint8Array(workerConfig.NUM_CELLS);

            isEnabled = command.data.initialIsEnabled;
            workerIsEntropySamplingEnabled = command.data.initialEntropySamplingEnabled;
            workerEntropySampleRate = command.data.initialEntropySampleRate || 10;

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
            
            const initialActiveCount = isEnabled ? jsStateArray.reduce((s, c) => s + c, 0) : 0;
            const initialRatio = isEnabled && workerConfig.NUM_CELLS > 0 ? initialActiveCount / workerConfig.NUM_CELLS : 0;
            
            // Only calculate initial entropy if sampling is enabled
            let initialEntropy = undefined;
            if (isEnabled && workerIsEntropySamplingEnabled) {
                initialEntropy = calculateBinaryEntropy(initialRatio);
                // Record initial values in history
                ratioHistory.push(initialRatio);
                entropyHistory.push(initialEntropy);
            } else if (isEnabled) {
                // Still record ratio history even if entropy sampling is disabled
                ratioHistory.push(initialRatio);
            }
            
            sendStateUpdate(initialActiveCount, initialRatio, initialEntropy, true); 
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
                sendUpdateForSetEnabled = true; 
            }
            updateSimulationInterval();
            if (sendUpdateForSetEnabled) {
                 sendStateUpdate(0,0,0, false); 
            }
            break;

        case 'SET_ENTROPY_SAMPLING_PARAMS':
            workerIsEntropySamplingEnabled = command.data.enabled;
            workerEntropySampleRate = command.data.rate || 10; // Ensure rate is at least 1 if needed, or handle 0
            // Optional: If sampling is disabled, clear existing entropy history
            if (!workerIsEntropySamplingEnabled) {
                entropyHistory = [];
                // If you send a STATS_UPDATE here, ensure plugins expect potentially empty history
            }
            break;

        case 'SET_RULESET':
        case 'LOAD_STATE':
            commandQueue.push(command);
            const { needsStateUpdate: updateAfterComplexCmd, rulesetChangedInQueue: rsChanged } = processCommandQueue();
            if (updateAfterComplexCmd) {
                const active = jsStateArray.reduce((s, c) => s + c, 0);
                const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                
                // Only calculate entropy if sampling is enabled
                let entropy = undefined;
                if (workerIsEntropySamplingEnabled) {
                    entropy = calculateBinaryEntropy(ratio);
                }
                
                sendStateUpdate(active, ratio, entropy, rsChanged);
            }
            break;

        default: 
            commandQueue.push(command);
            
            
            if (command.type === 'RESET_WORLD') {
                const { needsStateUpdate: inducedUpdate, rulesetChangedInQueue: rsChangedByQueue } = processCommandQueue();
                if (inducedUpdate) {
                    const currentActiveCount = jsStateArray.reduce((sum, val) => sum + val, 0);
                    const currentRatio = workerConfig.NUM_CELLS > 0 ? currentActiveCount / workerConfig.NUM_CELLS : 0;
                    
                    // Only calculate entropy if sampling is enabled
                    let currentEntropy = undefined;
                    if (workerIsEntropySamplingEnabled) {
                        currentEntropy = calculateBinaryEntropy(currentRatio);
                    }
                    
                    sendStateUpdate(currentActiveCount, currentRatio, currentEntropy, rsChangedByQueue);
                }
            } else if (command.type === 'SET_HOVER_STATE' || command.type === 'CLEAR_HOVER_STATE' || command.type === 'APPLY_BRUSH') {
                const { needsStateUpdate: inducedUpdate, rulesetChangedInQueue: rsChangedByQueue } = processCommandQueue();
                if (inducedUpdate) {
                    const active = jsStateArray.reduce((s, c) => s + c, 0);
                    const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                    
                    // Only calculate entropy if sampling is enabled
                    let entropy = undefined;
                    if (workerIsEntropySamplingEnabled) {
                        entropy = calculateBinaryEntropy(ratio);
                    }
                    
                    sendStateUpdate(active, ratio, entropy, rsChangedByQueue);
                }
            }
            break;
    }
};