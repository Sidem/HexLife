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

        // For TPS calculation
        this.lastTickCountForServerUpdate = 0; // Renamed for clarity
        this.tpsAggregator = {
            ticksCounted: 0,
            startTime: performance.now(),
            calculationWindowSeconds: 0.5 // Calculate TPS over this period (e.g., 500ms)
        };


        this.worker.onmessage = (event) => this._handleWorkerMessage(event.data);

        const initialConfig = {
            GRID_ROWS: initialSettings.config.GRID_ROWS,
            GRID_COLS: initialSettings.config.GRID_COLS,
            NUM_CELLS: initialSettings.config.NUM_CELLS,
        };
        // Ensure .slice(0) is used for rulesetBuffer if it's from an existing buffer that might be modified elsewhere
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
                this.tpsAggregator.startTime = performance.now(); // Reset TPS aggregator start time
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
                this.onUpdate(this.worldIndex, 'state');
                break;
            case 'STATS_UPDATE':
                const currentTime = performance.now();
                // Calculate ticks performed by worker since its last STATS_UPDATE processed by this proxy
                const ticksSinceLastWorkerUpdate = data.tick - this.lastTickCountForServerUpdate;

                this.tpsAggregator.ticksCounted += ticksSinceLastWorkerUpdate;
                const elapsedAggregatorTimeSeconds = (currentTime - this.tpsAggregator.startTime) / 1000;

                let smoothedTPS = this.latestStats.tps; // Default to previous value

                if (elapsedAggregatorTimeSeconds >= this.tpsAggregator.calculationWindowSeconds) {
                    if (this.tpsAggregator.ticksCounted > 0 && elapsedAggregatorTimeSeconds > 0) {
                        smoothedTPS = parseFloat((this.tpsAggregator.ticksCounted / elapsedAggregatorTimeSeconds).toFixed(1));
                    } else if (elapsedAggregatorTimeSeconds > 0) { // Time passed, but no ticks
                        smoothedTPS = 0;
                    }
                    // Reset aggregator for the next window
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
                    ...this.latestStats, // Preserve history arrays and other potentially unchanged stats
                    tick: data.tick,
                    activeCount: data.activeCount,
                    ratio: data.ratio,
                    binaryEntropy: data.binaryEntropy,
                    blockEntropy: data.blockEntropy,
                    isEnabled: data.isEnabled,
                    tps: smoothedTPS, // Use the smoothed TPS
                    rulesetHex: data.rulesetHex || this.latestStats.rulesetHex,
                    // ruleUsage is updated above if present
                };

                this.lastTickCountForServerUpdate = data.tick; // Update for the next calculation

                this.onUpdate(this.worldIndex, 'stats');
                break;
        }
    }

    sendCommand(commandType, commandData, transferList = []) {
        if (!this.isInitialized && commandType !== 'INIT') {
            // console.warn(`WorldProxy ${this.worldIndex}: Worker not initialized, command '${commandType}' buffered or ignored.`);
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
        // Optimistically update local state, worker will confirm via STATS_UPDATE
        this.latestStats.isEnabled = enabled;
        this.sendCommand('SET_ENABLED', { enabled });
    }

    setRuleset(rulesetArrayBuffer) {
        this.sendCommand('SET_RULESET', { rulesetBuffer: rulesetArrayBuffer }, [rulesetArrayBuffer]);
    }
    resetWorld(optionsOrDensity) {
        // Reset TPS aggregator on world reset
        this.tpsAggregator.ticksCounted = 0;
        this.tpsAggregator.startTime = performance.now();
        this.lastTickCountForServerUpdate = 0; // Reset tick count as worker's tick will reset
        this.latestStats.tps = 0; // Display 0 until new calculation window completes

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
        // Return a copy to prevent external modification
        return { ...this.latestStats };
    }

    terminate() {
        this.worker.terminate();
    }
}