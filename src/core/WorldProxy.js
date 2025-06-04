import * as Config from './config.js';

export class WorldProxy {
    constructor(worldIndex, initialSettings, worldManagerCallbacks) {
        this.worldIndex = worldIndex;
        this.worker = new Worker(new URL('./WorldWorker.js', import.meta.url), { type: 'module' });

        this.latestStateArray = null;
        this.latestRuleIndexArray = null;
        this.latestHoverStateArray = null;
        this.latestStats = {
            tick: 0,
            activeCount: 0,
            ratio: 0,
            binaryEntropy: 0, // Renamed for clarity
            blockEntropy: 0,  // New: Block entropy
            isEnabled: initialSettings.enabled,
            tps: 0,
            rulesetHex: initialSettings.rulesetHex || "0".repeat(32),
            ratioHistory: [],
            entropyHistory: [],
            hexBlockEntropyHistory: [], // New: Block entropy history
            ruleUsage: new Uint32Array(128) // New: Rule usage counters
        };
        this.isInitialized = false;
        this.onUpdate = worldManagerCallbacks.onUpdate;
        this.onInitialized = worldManagerCallbacks.onInitialized;
        this.MAX_HISTORY_SIZE = Config.STATS_HISTORY_SIZE || 100;

        
        this.lastTickCountForTPS = 0;
        this.lastTickUpdateTimeForTPS = performance.now();

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
                this.lastTickUpdateTimeForTPS = performance.now();
                this.lastTickCountForTPS = 0;
                this.latestStats.ratioHistory = [];
                this.latestStats.entropyHistory = [];
                this.latestStats.hexBlockEntropyHistory = []; // New: Initialize block entropy history
                this.onInitialized(this.worldIndex);
                break;
            case 'STATE_UPDATE':
                this.latestStateArray = new Uint8Array(data.stateBuffer);
                this.latestRuleIndexArray = new Uint8Array(data.ruleIndexBuffer);
                this.latestHoverStateArray = new Uint8Array(data.hoverStateBuffer);
                this.onUpdate(this.worldIndex, 'state'); 
                break;
            case 'STATS_UPDATE':
                const currentTime = performance.now();
                const elapsedTimeSeconds = (currentTime - this.lastTickUpdateTimeForTPS) / 1000;
                const ticksSinceLastUpdate = data.tick - this.lastTickCountForTPS;
                let currentTPS = 0;
                if (elapsedTimeSeconds > 0.003 && ticksSinceLastUpdate > 0) {
                    currentTPS = parseFloat((ticksSinceLastUpdate / elapsedTimeSeconds).toFixed(1));
                } else if (ticksSinceLastUpdate === 0 && elapsedTimeSeconds > 0){
                    currentTPS = 0;
                } else {
                    currentTPS = this.latestStats.tps;
                }

                // Update rule usage counters if provided
                if (data.ruleUsageCounters) {
                    this.latestStats.ruleUsage = new Uint32Array(data.ruleUsageCounters);
                }

                // Update history if enabled and data exists
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
                if (data.isEnabled && data.blockEntropy !== undefined) { // New: Handle block entropy history
                    this.latestStats.hexBlockEntropyHistory.push(data.blockEntropy);
                    if (this.latestStats.hexBlockEntropyHistory.length > this.MAX_HISTORY_SIZE) {
                        this.latestStats.hexBlockEntropyHistory.shift();
                    }
                }

                this.latestStats = {
                    tick: data.tick,
                    activeCount: data.activeCount,
                    ratio: data.ratio,
                    binaryEntropy: data.binaryEntropy, // Renamed for clarity
                    blockEntropy: data.blockEntropy,   // New: Block entropy
                    isEnabled: data.isEnabled,
                    tps: currentTPS,
                    rulesetHex: data.rulesetHex || this.latestStats.rulesetHex,
                    ratioHistory: this.latestStats.ratioHistory,
                    entropyHistory: this.latestStats.entropyHistory,
                    hexBlockEntropyHistory: this.latestStats.hexBlockEntropyHistory, // New: Block entropy history
                    ruleUsage: this.latestStats.ruleUsage // New: Rule usage counters
                };

                this.lastTickCountForTPS = data.tick;
                this.lastTickUpdateTimeForTPS = currentTime;

                this.onUpdate(this.worldIndex, 'stats'); 
                break;
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
        this.lastTickCountForTPS = 0;
        this.lastTickUpdateTimeForTPS = performance.now();
        this.latestStats.tps = 0;
        this.latestStats.ratioHistory = [];
        this.latestStats.entropyHistory = [];
        this.latestStats.hexBlockEntropyHistory = []; // New: Clear block entropy history
        this.latestStats.ruleUsage.fill(0); // New: Clear rule usage counters

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
        this.sendCommand('SET_HOVER_STATE', { hoverAffectedIndices: Array.from(hoverAffectedIndices) });
    }
    clearHoverState() {
        this.sendCommand('CLEAR_HOVER_STATE', {});
    }

    getLatestRenderData() {
        return {
            jsStateArray: this.latestStateArray,
            jsRuleIndexArray: this.latestRuleIndexArray,
            jsHoverStateArray: this.latestHoverStateArray,
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