// src/core/WorldProxy.js

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
            entropy: 0,
            isEnabled: initialSettings.enabled,
            tps: 0, // Add tps field
        };
        this.isInitialized = false;
        this.onUpdate = worldManagerCallbacks.onUpdate;
        this.onInitialized = worldManagerCallbacks.onInitialized;

        // For TPS calculation
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
            }
        }, [initialStateBuffer, initialRulesetBuffer, initialHoverStateBuffer]);
    }

    _handleWorkerMessage(data) {
        switch (data.type) {
            case 'INIT_ACK':
                this.isInitialized = true;
                this.lastTickUpdateTimeForTPS = performance.now(); // Reset for first stats update
                this.lastTickCountForTPS = 0; // Reset for first stats update
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
                if (elapsedTimeSeconds > 0 && ticksSinceLastUpdate > 0) {
                    currentTPS = parseFloat((ticksSinceLastUpdate / elapsedTimeSeconds).toFixed(1));
                } else if (ticksSinceLastUpdate === 0 && elapsedTimeSeconds > 0){ // No ticks, but time passed
                    currentTPS = 0;
                } else { // First update or no time elapsed
                    currentTPS = this.latestStats.tps; // Keep previous or default
                }


                this.latestStats = {
                    tick: data.tick,
                    activeCount: data.activeCount,
                    ratio: data.ratio,
                    entropy: data.entropy,
                    isEnabled: data.isEnabled,
                    tps: currentTPS,
                };

                this.lastTickCountForTPS = data.tick;
                this.lastTickUpdateTimeForTPS = currentTime;

                this.onUpdate(this.worldIndex, 'stats');
                break;
        }
    }

    sendCommand(commandType, commandData) {
        if (!this.isInitialized && commandType !== 'INIT') {
            console.warn(`WorldProxy ${this.worldIndex}: Worker not ready for command ${commandType}.`);
            return;
        }
        this.worker.postMessage({ type: commandType, data: commandData });
    }

    startSimulation() { this.sendCommand('START_SIMULATION', {}); }
    stopSimulation() { this.sendCommand('STOP_SIMULATION', {}); }
    setSpeed(speed) { this.sendCommand('SET_SPEED_TARGET', { speed }); }
    setEnabled(enabled) { this.sendCommand('SET_ENABLED', { enabled }); }

    setRuleset(rulesetArrayBuffer) {
        this.sendCommand('SET_RULESET', { rulesetBuffer: rulesetArrayBuffer });
    }
    resetWorld(initialDensity) {
        this.lastTickCountForTPS = 0; // Reset TPS calculation on world reset
        this.lastTickUpdateTimeForTPS = performance.now();
        this.latestStats.tps = 0; // Reset displayed TPS immediately
        this.sendCommand('RESET_WORLD', { initialDensity });
    }
    applyBrush(col, row, brushSize) {
        this.sendCommand('APPLY_BRUSH', { col, row, brushSize });
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
            enabled: this.latestStats.isEnabled,
        };
    }

    getLatestStats() {
        return this.latestStats;
    }

    terminate() {
        this.worker.terminate();
    }
}