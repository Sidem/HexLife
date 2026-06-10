import * as Config from './config.js';

export class WorldProxy {
    constructor(worldIndex, initialSettings, worldManagerCallbacks) {
        this.worldIndex = worldIndex;
        this.worker = new Worker(new URL('./WorldWorker.js', import.meta.url), { type: 'module' });

        this.latestStateArray = null;
        this.latestRuleIndexArray = null;
        // Hover highlight now lives main-thread-only (no worker round-trip). Allocated eagerly and
        // zeroed so the renderer always has a valid per-cell buffer to bind; mutated by
        // setHoverState/clearHoverState. Mirrors latestGhostStateArray.
        this.latestHoverStateArray = new Uint8Array(Config.NUM_CELLS);
        this.latestGhostStateArray = null;
        // Renderer dirty flag: true means this world's FBO needs to be redrawn.
        // Set whenever the visual buffers change (state/hover via STATE_UPDATE, ghost
        // via setGhostState/clearGhostState); cleared by the renderer after the FBO draw.
        // Starts true so the first frame always draws.
        this.renderDirty = true;
        this.latestStats = {
            tick: 0,
            activeCount: 0,
            ratio: 0,
            binaryEntropy: 0,
            blockEntropy: 0,
            isEnabled: initialSettings.enabled,
            tps: 0,
            rulesetHex: initialSettings.rulesetHex || "0".repeat(32),
            ratioHistory: [],
            entropyHistory: [],
            hexBlockEntropyHistory: [],
            ruleUsage: new Uint32Array(128),
            isInCycle: false,
            cycleLength: 0
        };
        this.isInitialized = false;
        this.onUpdate = worldManagerCallbacks.onUpdate;
        this.onInitialized = worldManagerCallbacks.onInitialized;
        this.MAX_HISTORY_SIZE = Config.STATS_HISTORY_SIZE || 100;

        
        this.lastTickCountForServerUpdate = 0; 
        this.tpsAggregator = {
            ticksCounted: 0,
            startTime: performance.now(),
            calculationWindowSeconds: 0.5 
        };


        this.worker.onmessage = (event) => this._handleWorkerMessage(event.data);

        const initialConfig = {
            GRID_ROWS: initialSettings.config.GRID_ROWS,
            GRID_COLS: initialSettings.config.GRID_COLS,
            NUM_CELLS: initialSettings.config.NUM_CELLS,
        };
        
        // The cell state buffer now lives inside Wasm linear memory (allocated by the worker), and
        // hover is main-thread-only, so only the ruleset buffer needs to be handed over at init.
        const initialRulesetBuffer = new Uint8Array(initialSettings.rulesetArray).buffer.slice(0);

        this.worker.postMessage({
            type: 'INIT',
            data: {
                worldIndex: this.worldIndex,
                config: initialConfig,
                initialRulesetBuffer: initialRulesetBuffer,
                initialState: initialSettings.initialState, // Add this
                initialIsEnabled: initialSettings.enabled,
                speed: initialSettings.speed,
                initialEntropySamplingEnabled: initialSettings.initialEntropySamplingEnabled,
                initialEntropySampleRate: initialSettings.initialEntropySampleRate,
                seed: initialSettings.seed,
            }
        }, [initialRulesetBuffer]);
    }

    _handleWorkerMessage(data) {
        switch (data.type) {
            case 'INIT_ACK': {
                this.isInitialized = true;
                this.tpsAggregator.startTime = performance.now(); 
                this.lastTickCountForServerUpdate = 0;
                this.latestStats.ratioHistory = [];
                this.latestStats.entropyHistory = [];
                this.latestStats.hexBlockEntropyHistory = [];
                this.onInitialized(this.worldIndex);
                break;
            }
            case 'STATE_UPDATE': {
                this.latestStateArray = new Uint8Array(data.stateBuffer);
                this.latestRuleIndexArray = new Uint8Array(data.ruleIndexBuffer);
                if (this.latestGhostStateArray) {
                    this.latestGhostStateArray.fill(0);
                }
                this.renderDirty = true;
                this.onUpdate(this.worldIndex, 'state');
                break;
            }
            case 'STATS_UPDATE': {
                const currentTime = performance.now();
                
                const ticksSinceLastWorkerUpdate = data.tick - this.lastTickCountForServerUpdate;

                this.tpsAggregator.ticksCounted += ticksSinceLastWorkerUpdate;
                const elapsedAggregatorTimeSeconds = (currentTime - this.tpsAggregator.startTime) / 1000;

                let smoothedTPS = this.latestStats.tps; 

                if (elapsedAggregatorTimeSeconds >= this.tpsAggregator.calculationWindowSeconds) {
                    if (this.tpsAggregator.ticksCounted > 0 && elapsedAggregatorTimeSeconds > 0) {
                        smoothedTPS = parseFloat((this.tpsAggregator.ticksCounted / elapsedAggregatorTimeSeconds).toFixed(1));
                    } else if (elapsedAggregatorTimeSeconds > 0) { 
                        smoothedTPS = 0;
                    }
                    
                    this.tpsAggregator.ticksCounted = 0;
                    this.tpsAggregator.startTime = currentTime;
                }

                if (data.ruleUsageCounters) {
                    this.latestStats.ruleUsage = new Uint32Array(data.ruleUsageCounters);
                }

                if (data.isEnabled && data.ratio !== undefined) {
                    this.latestStats.ratioHistory.push(data.ratio);
                    if (this.latestStats.ratioHistory.length > this.MAX_HISTORY_SIZE) {
                        this.latestStats.ratioHistory.shift();
                    }
                }
                if (data.isEnabled && data.binaryEntropy !== undefined) {
                    this.latestStats.entropyHistory.push(data.binaryEntropy);
                    if (this.latestStats.entropyHistory.length > this.MAX_HISTORY_SIZE) {
                        this.latestStats.entropyHistory.shift();
                    }
                }
                if (data.isEnabled && data.blockEntropy !== undefined) {
                    this.latestStats.hexBlockEntropyHistory.push(data.blockEntropy);
                    if (this.latestStats.hexBlockEntropyHistory.length > this.MAX_HISTORY_SIZE) {
                        this.latestStats.hexBlockEntropyHistory.shift();
                    }
                }

                this.latestStats = {
                    ...this.latestStats, 
                    tick: data.tick,
                    activeCount: data.activeCount,
                    ratio: data.ratio,
                    binaryEntropy: data.binaryEntropy,
                    blockEntropy: data.blockEntropy,
                    isEnabled: data.isEnabled,
                    tps: smoothedTPS, 
                    rulesetHex: data.rulesetHex || this.latestStats.rulesetHex,
                    isInCycle: data.isInCycle,
                    cycleLength: data.cycleLength
                };

                this.lastTickCountForServerUpdate = data.tick; 

                this.onUpdate(this.worldIndex, 'stats');
                break;
            }
        }
    }

    setGhostState(indices) {
        if (!this.latestGhostStateArray) {
            this.latestGhostStateArray = new Uint8Array(Config.NUM_CELLS);
        }
        this.latestGhostStateArray.fill(0);
        for (const index of indices) {
            if (index >= 0 && index < Config.NUM_CELLS) {
                this.latestGhostStateArray[index] = 1;
            }
        }
        this.renderDirty = true;
    }

    clearGhostState() {
        if (this.latestGhostStateArray) {
            this.latestGhostStateArray.fill(0);
        }
        this.renderDirty = true;
    }

    sendCommand(commandType, commandData, transferList = []) {
        if (!this.isInitialized && commandType !== 'INIT') {
            
            return;
        }
        if (transferList.length > 0) {
            this.worker.postMessage({ type: commandType, data: commandData }, transferList);
        } else {
            this.worker.postMessage({ type: commandType, data: commandData });
        }
    }

    startSimulation() { this.sendCommand('START_SIMULATION', {}); }
    stopSimulation() { this.sendCommand('STOP_SIMULATION', {}); }
    setSpeed(speed) { this.sendCommand('SET_SPEED_TARGET', { speed }); }
    setEnabled(enabled) {
        
        this.latestStats.isEnabled = enabled;
        this.sendCommand('SET_ENABLED', { enabled });
    }

    setRuleset(rulesetArrayBuffer) {
        this.sendCommand('SET_RULESET', { rulesetBuffer: rulesetArrayBuffer }, [rulesetArrayBuffer]);
    }
    resetWorld(initialState, seed) {
        
        this.tpsAggregator.ticksCounted = 0;
        this.tpsAggregator.startTime = performance.now();
        this.lastTickCountForServerUpdate = 0; 
        this.latestStats.tps = 0; 

        this.latestStats.ratioHistory = [];
        this.latestStats.entropyHistory = [];
        this.latestStats.hexBlockEntropyHistory = [];
        this.latestStats.ruleUsage.fill(0);

        this.sendCommand('RESET_WORLD', { initialState, seed });
    }
    applyBrush(col, row, brushSize) {
        this.sendCommand('APPLY_BRUSH', { col, row, brushSize });
    }
    applySelectiveBrush(cellIndices, brushMode = 'invert') {
        this.sendCommand('APPLY_SELECTIVE_BRUSH', { cellIndices, brushMode });
    }
    // Hover is purely visual, so it's computed and stored main-thread-only (like the ghost preview)
    // instead of round-tripping the worker. Writes the per-cell highlight buffer directly and marks
    // the FBO dirty so the renderer redraws on the next frame.
    setHoverState(hoverAffectedIndices) {
        this.latestHoverStateArray.fill(0);
        for (const index of hoverAffectedIndices) {
            if (index >= 0 && index < this.latestHoverStateArray.length) {
                this.latestHoverStateArray[index] = 1;
            }
        }
        this.renderDirty = true;
    }
    clearHoverState() {
        this.latestHoverStateArray.fill(0);
        this.renderDirty = true;
    }

    getLatestRenderData() {
        return {
            jsStateArray: this.latestStateArray,
            jsRuleIndexArray: this.latestRuleIndexArray,
            jsHoverStateArray: this.latestHoverStateArray,
            jsGhostStateArray: this.latestGhostStateArray,
            enabled: this.latestStats.isEnabled,
            dirty: this.renderDirty,
        };
    }

    clearRenderDirty() {
        this.renderDirty = false;
    }

    markRenderDirty() {
        this.renderDirty = true;
    }

    getLatestStats() {
        
        return { ...this.latestStats };
    }

    getFullStatus() {
        return {
            renderData: this.getLatestRenderData(),
            stats: this.getLatestStats()
        };
    }

    terminate() {
        this.worker.terminate();
    }
}