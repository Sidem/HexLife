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
let hexBlockEntropyHistory = []; // New: History for hexagonal block entropy
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

/**
 * Calculates the block entropy for 7-cell hexagonal patterns.
 * A block consists of a center cell and its 6 immediate neighbors.
 * The pattern is a 7-bit number (0-127).
 * @param {Uint8Array} currentStateArray - The array of current cell states.
 * @param {object} config - The worker's configuration (GRID_ROWS, GRID_COLS, NUM_CELLS).
 * @param {Array<Array<number>>} N_DIRS_ODD - Neighbor directions for odd columns.
 * @param {Array<Array<number>>} N_DIRS_EVEN - Neighbor directions for even columns.
 * @returns {number} The calculated block entropy. Max entropy is log2(128) = 7.
 */
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

        const blockPattern = (cState << 6) | neighborMask; // 7-bit pattern
        blockCounts.set(blockPattern, (blockCounts.get(blockPattern) || 0) + 1);
    }

    if (totalBlocks === 0) {
        return 0;
    }

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
                break;
            case 'RESET_WORLD':
                worldTickCounter = 0;
                ratioHistory = [];
                entropyHistory = [];
                hexBlockEntropyHistory = []; // New: Clear block entropy history
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
                hexBlockEntropyHistory = []; // New: Clear block entropy history
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
            sendStateUpdate(undefined, undefined, undefined, undefined, rulesetChangedInQueue);
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
    let currentBinaryEntropy = undefined;
    let currentBlockEntropy = undefined; // New: Block entropy calculation
    const shouldSampleEntropy = workerIsEntropySamplingEnabled && (worldTickCounter % workerEntropySampleRate === 0);
    if (shouldSampleEntropy) {
        currentBinaryEntropy = calculateBinaryEntropy(ratio);
        // Calculate hex block entropy using the new state (jsStateArray now points to the result of the tick)
        currentBlockEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
    }

    // Record history if simulation is active
    if (isEnabled && isRunning) {
        ratioHistory.push(ratio); // Ratio history is still recorded every tick
        if (ratioHistory.length > MAX_HISTORY_SIZE) {
            ratioHistory.shift();
        }

        // Record entropy history only when we calculated it
        if (shouldSampleEntropy) {
            if (currentBinaryEntropy !== undefined) {
                entropyHistory.push(currentBinaryEntropy);
                if (entropyHistory.length > MAX_HISTORY_SIZE) {
                    entropyHistory.shift();
                }
            }
            if (currentBlockEntropy !== undefined) { // New: Record block entropy history
                hexBlockEntropyHistory.push(currentBlockEntropy);
                if (hexBlockEntropyHistory.length > MAX_HISTORY_SIZE) {
                    hexBlockEntropyHistory.shift();
                }
            }
        }
    }

    if (simulationPerformedUpdate || commandInducedUpdate) {
        sendStateUpdate(activeCount, ratio, currentBinaryEntropy, currentBlockEntropy, rulesetChangedInQueue);
    }
}

function sendStateUpdate(activeCount, ratio, binaryEntropy, blockEntropy, rulesetHasChanged = false) {
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
            binaryEntropy: binaryEntropy, // Renamed for clarity
            blockEntropy: blockEntropy,   // New: Block entropy
            rulesetHex: currentRulesetHex, 
            isEnabled: isEnabled
        });
    } else if (rulesetHasChanged || !isEnabled) { 
        const currentActiveCount = jsStateArray.reduce((s, c) => s + c, 0);
        const currentRatio = workerConfig.NUM_CELLS > 0 ? currentActiveCount / workerConfig.NUM_CELLS : 0;
        
        // Only calculate entropy if sampling is enabled
        let currentBinaryEntropy = undefined;
        let currentBlockEntropy = undefined;
        if (workerIsEntropySamplingEnabled) {
            currentBinaryEntropy = calculateBinaryEntropy(currentRatio);
            currentBlockEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
        }
        
        self.postMessage({
            type: 'STATS_UPDATE',
            worldIndex: worldIndex,
            tick: worldTickCounter,
            activeCount: currentActiveCount,
            ratio: currentRatio,
            binaryEntropy: currentBinaryEntropy, // Renamed for clarity
            blockEntropy: currentBlockEntropy,   // New: Block entropy
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
            hexBlockEntropyHistory = []; // New: Initialize block entropy history

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
            let initialBinaryEntropy = undefined;
            let initialBlockEntropy = undefined; // New
            if (isEnabled && workerIsEntropySamplingEnabled) {
                initialBinaryEntropy = calculateBinaryEntropy(initialRatio);
                initialBlockEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R); // New
                // Record initial values in history
                ratioHistory.push(initialRatio);
                entropyHistory.push(initialBinaryEntropy);
                hexBlockEntropyHistory.push(initialBlockEntropy); // New
            } else if (isEnabled) {
                // Still record ratio history even if entropy sampling is disabled
                ratioHistory.push(initialRatio);
            }
            
            sendStateUpdate(initialActiveCount, initialRatio, initialBinaryEntropy, initialBlockEntropy, true); 
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
                const activeAfterEnable = jsStateArray.reduce((s, c) => s + c, 0);
                const ratioAfterEnable = workerConfig.NUM_CELLS > 0 ? activeAfterEnable / workerConfig.NUM_CELLS : 0;
                let binEntropyAfterEnable, blkEntropyAfterEnable;
                if (workerIsEntropySamplingEnabled) {
                    binEntropyAfterEnable = calculateBinaryEntropy(ratioAfterEnable);
                    blkEntropyAfterEnable = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
                }
                sendStateUpdate(activeAfterEnable, ratioAfterEnable, binEntropyAfterEnable, blkEntropyAfterEnable, false); 
            }
            break;

        case 'SET_ENTROPY_SAMPLING_PARAMS':
            workerIsEntropySamplingEnabled = command.data.enabled;
            workerEntropySampleRate = command.data.rate || 10; // Ensure rate is at least 1 if needed, or handle 0
            // Optional: If sampling is disabled, clear existing entropy history
            if (!workerIsEntropySamplingEnabled) {
                entropyHistory = [];
                hexBlockEntropyHistory = []; // New: Clear block entropy history too
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
                let binEntropy, blkEntropy;
                if (workerIsEntropySamplingEnabled) {
                    binEntropy = calculateBinaryEntropy(ratio);
                    blkEntropy = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
                }
                
                sendStateUpdate(active, ratio, binEntropy, blkEntropy, rsChanged);
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
                    let currentBinaryEntropyCalc, currentBlockEntropyCalc;
                    if (workerIsEntropySamplingEnabled) {
                        currentBinaryEntropyCalc = calculateBinaryEntropy(currentRatio);
                        currentBlockEntropyCalc = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
                    }
                    
                    sendStateUpdate(currentActiveCount, currentRatio, currentBinaryEntropyCalc, currentBlockEntropyCalc, rsChangedByQueue);
                }
            } else if (command.type === 'SET_HOVER_STATE' || command.type === 'CLEAR_HOVER_STATE' || command.type === 'APPLY_BRUSH') {
                const { needsStateUpdate: inducedUpdate, rulesetChangedInQueue: rsChangedByQueue } = processCommandQueue();
                if (inducedUpdate) {
                    const active = jsStateArray.reduce((s, c) => s + c, 0);
                    const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                    
                    // Only calculate entropy if sampling is enabled
                    let binaryEntropyCalc, blockEntropyCalc;
                    if (workerIsEntropySamplingEnabled) {
                        binaryEntropyCalc = calculateBinaryEntropy(ratio);
                        blockEntropyCalc = calculateHexBlockEntropy(jsStateArray, workerConfig, NEIGHBOR_DIRS_ODD_R, NEIGHBOR_DIRS_EVEN_R);
                    }
                    
                    sendStateUpdate(active, ratio, binaryEntropyCalc, blockEntropyCalc, rsChangedByQueue);
                }
            }
            break;
    }
};