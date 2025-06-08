import * as Config from './config.js';

export class WorldProxy {
    constructor(worldIndex, initialSettings, worldManagerCallbacks) {
        this.worldIndex = worldIndex;
        this.worker = new Worker(new URL('./WorldWorker.js', import.meta.url), { type: 'module' });

        this.latestStateArray = null;
        this.latestRuleIndexArray = null;
        this.latestHoverStateArray = null;
        this.latestGhostStateArray = null;
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
            ruleUsage: new Uint32Array(128)
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
        
        const initialStateBuffer = new Uint8Array(initialSettings.config.NUM_CELLS).buffer;
        const initialRulesetBuffer = new Uint8Array(initialSettings.rulesetArray).buffer.slice(0);
        const initialHoverStateBuffer = new Uint8Array(initialSettings.config.NUM_CELLS).buffer;

        this.worker.postMessage({
            type: 'INIT',
            data: {
                worldIndex: this.worldIndex,
                config: initialConfig,
                initialStateBuffer: initialStateBuffer,
                initialRulesetBuffer: initialRulesetBuffer,
                initialHoverStateBuffer: initialHoverStateBuffer,
                initialDensity: initialSettings.density,
                initialIsEnabled: initialSettings.enabled,
                initialSpeed: initialSettings.speed,
                initialEntropySamplingEnabled: initialSettings.initialEntropySamplingEnabled,
                initialEntropySampleRate: initialSettings.initialEntropySampleRate,
            }
        }, [initialStateBuffer, initialRulesetBuffer, initialHoverStateBuffer]);
    }

    _handleWorkerMessage(data) {
        switch (data.type) {
            case 'INIT_ACK':
                this.isInitialized = true;
                this.tpsAggregator.startTime = performance.now(); 
                this.lastTickCountForServerUpdate = 0;
                this.latestStats.ratioHistory = [];
                this.latestStats.entropyHistory = [];
                this.latestStats.hexBlockEntropyHistory = [];
                this.onInitialized(this.worldIndex);
                break;
            case 'STATE_UPDATE':
                this.latestStateArray = new Uint8Array(data.stateBuffer);
                this.latestRuleIndexArray = new Uint8Array(data.ruleIndexBuffer);
                this.latestHoverStateArray = new Uint8Array(data.hoverStateBuffer);
                if (this.latestGhostStateArray) {
                    this.latestGhostStateArray.fill(0);
                }
                this.onUpdate(this.worldIndex, 'state');
                break;
            case 'STATS_UPDATE':
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
                    
                };

                this.lastTickCountForServerUpdate = data.tick; 

                this.onUpdate(this.worldIndex, 'stats');
                break;
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
    }

    clearGhostState() {
        if (this.latestGhostStateArray) {
            this.latestGhostStateArray.fill(0);
        }
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
    resetWorld(optionsOrDensity) {
        
        this.tpsAggregator.ticksCounted = 0;
        this.tpsAggregator.startTime = performance.now();
        this.lastTickCountForServerUpdate = 0; 
        this.latestStats.tps = 0; 

        this.latestStats.ratioHistory = [];
        this.latestStats.entropyHistory = [];
        this.latestStats.hexBlockEntropyHistory = [];
        this.latestStats.ruleUsage.fill(0);

        let commandPayload;
        if (typeof optionsOrDensity === 'object' && optionsOrDensity !== null && optionsOrDensity.hasOwnProperty('density')) {
            commandPayload = {
                density: optionsOrDensity.density,
                isClearOperation: optionsOrDensity.isClearOperation || false
            };
        } else {
            commandPayload = {
                density: optionsOrDensity,
                isClearOperation: false
            };
        }
        this.sendCommand('RESET_WORLD', commandPayload);
    }
    applyBrush(col, row, brushSize) {
        this.sendCommand('APPLY_BRUSH', { col, row, brushSize });
    }
    applySelectiveBrush(cellIndices) {
        this.sendCommand('APPLY_SELECTIVE_BRUSH', { cellIndices });
    }
    setHoverState(hoverAffectedIndices) {
        this.sendCommand('SET_HOVER_STATE', { hoverAffectedIndices });
    }
    clearHoverState() {
        this.sendCommand('CLEAR_HOVER_STATE', {});
    }

    getLatestRenderData() {
        return {
            jsStateArray: this.latestStateArray,
            jsRuleIndexArray: this.latestRuleIndexArray,
            jsHoverStateArray: this.latestHoverStateArray,
            jsGhostStateArray: this.latestGhostStateArray,
            enabled: this.latestStats.isEnabled,
        };
    }

    getLatestStats() {
        
        return { ...this.latestStats };
    }

    terminate() {
        this.worker.terminate();
    }
}