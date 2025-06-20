import * as Config from './config.js';
import { WorldProxy } from './WorldProxy.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Symmetry from './Symmetry.js';
import { rulesetToHex, hexToRuleset, findHexagonsInNeighborhood, mutateRandomBitsInHex } from '../utils/utils.js';

export class WorldManager {
    constructor(sharedSettings = {}) {
        this.worlds = [];
        this.cameraStates = [];
        this.sharedSettings = sharedSettings;
        this.simulationController = null;
        this.brushController = null;
        this.selectedWorldIndex = sharedSettings.selectedWorldIndex ?? Config.DEFAULT_SELECTED_WORLD_INDEX;
        this.isGloballyPaused = true;
        this._hoverAffectedIndicesSet = new Set();
        this.isEntropySamplingEnabled = PersistenceService.loadUISetting('entropySamplingEnabled', false);
        this.entropySampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);
        this.symmetryData = Symmetry.precomputeSymmetryGroups();
        this.worldSettings = [];
        this.initialDefaultRulesetHex = "";
        this._initWorlds();
        this._initCameraStates(sharedSettings.camera);
        this._setupEventListeners();
    }

    setControllerReferences(simulationController, brushController) {
        this.simulationController = simulationController;
        this.brushController = brushController;
    }

    _initWorlds = () => {
        const hasSharedSettings = this.sharedSettings.rulesetHex;

        if (hasSharedSettings) {
            console.log("Applying shared settings from URL.");
            this.initialDefaultRulesetHex = this.sharedSettings.rulesetHex;
            const enabledMask = this.sharedSettings.enabledMask ?? 0b111111111;
            for (let i = 0; i < Config.NUM_WORLDS; i++) {
                const rulesetHex = this.initialDefaultRulesetHex;
                this.worldSettings.push({
                    initialDensity: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0.5,
                    enabled: (enabledMask & (1 << i)) !== 0,
                    rulesetHex: rulesetHex,
                    rulesetHistory: [rulesetHex], 
                    rulesetFuture: []
                });
            }
            PersistenceService.saveWorldSettings(this.worldSettings);
            PersistenceService.saveRuleset(this.initialDefaultRulesetHex);
        } else {
            this.worldSettings = PersistenceService.loadWorldSettings();
            
            this.worldSettings.forEach(setting => {
                if (!setting.rulesetHistory) {
                    setting.rulesetHistory = [setting.rulesetHex];
                }
                if (!setting.rulesetFuture) {
                    setting.rulesetFuture = [];
                }
            });
            this.initialDefaultRulesetHex = PersistenceService.loadRuleset() || Config.INITIAL_RULESET_CODE;
        }

        const worldManagerCallbacks = {
            onUpdate: (worldIndex, updateType) => this._handleProxyUpdate(worldIndex, updateType),
            onInitialized: (worldIndex) => this._handleProxyInitialized(worldIndex)
        };

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = this.worldSettings[i] || {
                initialDensity: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0.5,
                enabled: Config.DEFAULT_WORLD_ENABLED_STATES[i] ?? true,
                rulesetHex: this.initialDefaultRulesetHex,
                rulesetHistory: [this.initialDefaultRulesetHex],
                rulesetFuture: []
            };

            const rulesetArray = hexToRuleset(settings.rulesetHex);

            const proxy = new WorldProxy(i, {
                config: { GRID_ROWS: Config.GRID_ROWS, GRID_COLS: Config.GRID_COLS, NUM_CELLS: Config.NUM_CELLS },
                density: settings.initialDensity,
                enabled: settings.enabled,
                rulesetArray: rulesetArray,
                rulesetHex: settings.rulesetHex,
                speed: this.simulationController?.getState()?.speed || 1,
                initialEntropySamplingEnabled: this.isEntropySamplingEnabled,
                initialEntropySampleRate: this.entropySampleRate,
            }, worldManagerCallbacks);
            this.worlds.push(proxy);
        }
    }

    _addRulesetToHistory = (worldIndex, rulesetHex) => {
        const worldSetting = this.worldSettings[worldIndex];
        if (!worldSetting) return;

        if (worldSetting.rulesetHistory[worldSetting.rulesetHistory.length - 1] === rulesetHex) {
            return;
        }
        
        worldSetting.rulesetHistory.push(rulesetHex);

        if (worldSetting.rulesetHistory.length > Config.RULESET_HISTORY_SIZE) {
            worldSetting.rulesetHistory.shift();
        }

        if (worldSetting.rulesetFuture.length > 0) {
            worldSetting.rulesetFuture = [];
        }
        EventBus.dispatch(EVENTS.HISTORY_CHANGED, { worldIndex });
    }

    _handleProxyInitialized = (worldIndex) => {
        EventBus.dispatch(EVENTS.WORKER_INITIALIZED, { worldIndex });
        if (worldIndex === this.selectedWorldIndex) {
            this.dispatchSelectedWorldUpdates();
        }
        if (!this.isGloballyPaused && this.worlds[worldIndex]?.getLatestStats().isEnabled) {
            this.worlds[worldIndex].startSimulation();
            this.worlds[worldIndex].setSpeed(this.simulationController.getState().speed);
        }
    }

    _handleProxyUpdate = (worldIndex, updateType) => {
        const proxy = this.worlds[worldIndex];
        if (!proxy) return;

        const stats = proxy.getLatestStats();

        if (stats.rulesetHex && stats.rulesetHex !== "Error" && this.worldSettings[worldIndex]?.rulesetHex !== stats.rulesetHex) {
            this.worldSettings[worldIndex].rulesetHex = stats.rulesetHex;
            PersistenceService.saveWorldSettings(this.worldSettings);
            if (worldIndex === this.selectedWorldIndex) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, stats.rulesetHex);
            }
            EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        }

        if (worldIndex === this.selectedWorldIndex) {
            EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, { ...stats, worldIndex });
        }
    }

    dispatchSelectedWorldUpdates = () => {
        const selectedProxy = this.worlds[this.selectedWorldIndex];
        if (selectedProxy && selectedProxy.isInitialized) {
            const stats = selectedProxy.getLatestStats();
            EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, { ...stats, worldIndex: this.selectedWorldIndex });

            if (stats.rulesetHex && stats.rulesetHex !== "Error" && this.worldSettings[this.selectedWorldIndex]?.rulesetHex !== stats.rulesetHex) {
                this.worldSettings[this.selectedWorldIndex].rulesetHex = stats.rulesetHex;
                PersistenceService.saveWorldSettings(this.worldSettings);
                EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
            }
            EventBus.dispatch(EVENTS.RULESET_CHANGED, this.worldSettings[this.selectedWorldIndex]?.rulesetHex);
        }
    }

    _setupEventListeners = () => {
        EventBus.subscribe(EVENTS.SIMULATION_PAUSED, this.setGlobalPause);
        EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, (speed) => this.setGlobalSpeed(speed));
        EventBus.subscribe(EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL, this._applySelectedDensityToAll);
        EventBus.subscribe(EVENTS.COMMAND_RESET_DENSITIES_TO_DEFAULT, this._resetDensitiesToDefault);

        EventBus.subscribe(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, (data) => {
            const newRulesetHex = this._generateRandomRulesetHex(data.bias, data.generationMode);
            this.#applyRulesetToWorlds(newRulesetHex, data.applyScope, data.shouldReset);
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_RULESET, (data) => {
            this.#applyRulesetToWorlds(data.hexString, data.scope, data.resetOnNewRule);
        });

        EventBus.subscribe(EVENTS.COMMAND_MUTATE_RULESET, (data) => {
            this._mutateRulesetForScope(data.scope, data.mutationRate, data.mode);
        });

        EventBus.subscribe(EVENTS.COMMAND_CLONE_AND_MUTATE, (data) => {
            this._cloneAndMutateOthers(data.mutationRate, data.mode);
        });

        EventBus.subscribe(EVENTS.COMMAND_CLONE_RULESET, () => {
            this._cloneRuleset();
        });

        EventBus.subscribe(EVENTS.COMMAND_UNDO_RULESET, (data) => this.undoRulesetChange(data.worldIndex));
        EventBus.subscribe(EVENTS.COMMAND_REDO_RULESET, (data) => this.redoRulesetChange(data.worldIndex));
        EventBus.subscribe(EVENTS.COMMAND_REVERT_TO_HISTORY_STATE, (data) => this.revertToHistoryState(data.worldIndex, data.historyIndex));

        EventBus.subscribe(EVENTS.COMMAND_EDITOR_TOGGLE_RULE_OUTPUT, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = hexToRuleset(currentRulesetHex);
                if (data.ruleIndex >= 0 && data.ruleIndex < 128) {
                    rules[data.ruleIndex] = 1 - rules[data.ruleIndex];
                }
                return rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
        EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_ALL_RULES_STATE, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = hexToRuleset(currentRulesetHex);
                rules.fill(data.targetState);
                return rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
        EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_NEIGHBOR_COUNT, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = hexToRuleset(currentRulesetHex);
                for (let mask = 0; mask < 64; mask++) {
                    if (Symmetry.countSetBits(mask) === data.numActive) {
                        const idx = (data.centerState << 6) | mask;
                        rules[idx] = data.outputState;
                    }
                }
                return rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
        EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = hexToRuleset(currentRulesetHex);
                const group = this.symmetryData.canonicalRepresentatives.find(g => g.representative === data.canonicalBitmask);
                if (group) {
                    for (const member of group.members) {
                        const idx = (data.centerState << 6) | member;
                        rules[idx] = data.outputState;
                    }
                }
                return rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
        EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULESET_HEX, (data) => {
            const shouldReset = data.conditionalResetScope !== 'none';
            this.#applyRulesetToWorlds(data.hexString, data.modificationScope, shouldReset);
        });

        EventBus.subscribe(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, () => {
            this.worlds.forEach((proxy, idx) => {
                if (this.worldSettings[idx]) {
                    proxy.resetWorld(this.worldSettings[idx].initialDensity);
                    if (!this.isGloballyPaused && this.worldSettings[idx].enabled) proxy.startSimulation();
                }
            });
            EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        });

        EventBus.subscribe(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, (data) => {
            const primaryRulesetHex = this.worldSettings[this.selectedWorldIndex]?.rulesetHex;
            if (!primaryRulesetHex) {
                console.error("Cannot reset with current ruleset: Selected world's ruleset is undefined.");
                return;
            }
            const indicesToReset = this._getAffectedWorldIndices(data.scope);

            indicesToReset.forEach(idx => {
                if (data.copyPrimaryRuleset && idx !== this.selectedWorldIndex) {
                    const newRulesetBuffer = hexToRuleset(primaryRulesetHex).buffer.slice(0);
                    this.worlds[idx].setRuleset(newRulesetBuffer);
                    this.worldSettings[idx].rulesetHex = primaryRulesetHex;
                }
                if (this.worldSettings[idx]) {
                    this.worlds[idx].resetWorld(this.worldSettings[idx].initialDensity);
                    if (!this.isGloballyPaused && this.worldSettings[idx].enabled) this.worlds[idx].startSimulation();
                }
            });

            if (data.scope === 'all' || indicesToReset.includes(this.selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
            }
            this.dispatchSelectedWorldUpdates();
            PersistenceService.saveWorldSettings(this.worldSettings);
        });

        EventBus.subscribe(EVENTS.COMMAND_CLEAR_WORLDS, (data) => {
            const indicesToClear = this._getAffectedWorldIndices(data.scope);
            indicesToClear.forEach(idx => {
                const proxy = this.worlds[idx];
                if (proxy) {
                    let targetStateForClear = 0;
                    if (proxy.latestStateArray) {
                        const currentState = proxy.latestStateArray;
                        let allCurrentlyInactive = true;
                        for (let i = 0; i < currentState.length; i++) {
                            if (currentState[i] !== 0) {
                                allCurrentlyInactive = false;
                                break;
                            }
                        }
                        if (allCurrentlyInactive) {
                            targetStateForClear = 1;
                        }
                    }
                    proxy.resetWorld({ density: targetStateForClear, isClearOperation: true });
                }

                if (this.worldSettings[idx] && !this.isGloballyPaused && this.worldSettings[idx].enabled) {
                    this.worlds[idx].startSimulation();
                }
            });
            if (data.scope === 'all') EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
            this.dispatchSelectedWorldUpdates();
        });

        EventBus.subscribe(EVENTS.COMMAND_APPLY_BRUSH, (data) => {
            this.worlds[data.worldIndex]?.applyBrush(data.col, data.row, this.brushController.getState().brushSize);
        });
        EventBus.subscribe(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, (data) => {
            this.worlds[data.worldIndex]?.applySelectiveBrush(data.cellIndices);
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_HOVER_STATE, (data) => {
            findHexagonsInNeighborhood(data.col, data.row, this.brushController.getState().brushSize, this._hoverAffectedIndicesSet);
            this.worlds[data.worldIndex]?.setHoverState(this._hoverAffectedIndicesSet);
        });
        EventBus.subscribe(EVENTS.COMMAND_CLEAR_HOVER_STATE, (data) => {
            this.worlds[data.worldIndex]?.clearHoverState();
        });
        EventBus.subscribe(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, (data) => {
            const selectedProxy = this.worlds[this.selectedWorldIndex];
            selectedProxy?.setGhostState(data.indices);
        });
        EventBus.subscribe(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW, () => {
            const selectedProxy = this.worlds[this.selectedWorldIndex];
            selectedProxy?.clearGhostState();
        });

        EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, (data) => {
            if (this.worldSettings[data.worldIndex]) {
                this.worldSettings[data.worldIndex].initialDensity = data.density;
                PersistenceService.saveWorldSettings(this.worldSettings);
                EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
            }
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_ENABLED, (data) => {
            if (this.worldSettings[data.worldIndex] && this.worlds[data.worldIndex]) {
                this.worldSettings[data.worldIndex].enabled = data.isEnabled;
                this.worlds[data.worldIndex].setEnabled(data.isEnabled);

                if (data.isEnabled && !this.isGloballyPaused) {
                    this.worlds[data.worldIndex].startSimulation();
                    this.worlds[data.worldIndex].setSpeed(this.simulationController.getState().speed);
                } else if (!data.isEnabled) {
                    this.worlds[data.worldIndex].stopSimulation();
                }
                PersistenceService.saveWorldSettings(this.worldSettings);
                EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
            }
        });
        EventBus.subscribe(EVENTS.COMMAND_SELECT_WORLD, (newIndex) => {
            this.selectedWorldIndex = newIndex;
            this.dispatchSelectedWorldUpdates();
            EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, newIndex);
        });

        EventBus.subscribe(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE, this.saveSelectedWorldState);
        EventBus.subscribe(EVENTS.COMMAND_LOAD_WORLD_STATE, (data) => this.loadWorldState(data.worldIndex, data.loadedData));

        EventBus.subscribe(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, (data) => {
            this.isEntropySamplingEnabled = data.enabled;
            this.entropySampleRate = data.rate;
            PersistenceService.saveUISetting('entropySamplingEnabled', data.enabled);
            PersistenceService.saveUISetting('entropySampleRate', data.rate);

            this.worlds.forEach(proxy => {
                proxy.sendCommand('SET_ENTROPY_SAMPLING_PARAMS', {
                    enabled: this.isEntropySamplingEnabled,
                    rate: this.entropySampleRate
                });
            });
            EventBus.dispatch(EVENTS.ENTROPY_SAMPLING_CHANGED, { enabled: this.isEntropySamplingEnabled, rate: this.entropySampleRate });
        });
    }

    _applySelectedDensityToAll = () => {
        const selectedDensity = this.worldSettings[this.selectedWorldIndex]?.initialDensity;
        if (selectedDensity === undefined) {
            console.error("Could not apply density: selected world's density is not available.");
            return;
        }

        this.worldSettings.forEach(setting => {
            setting.initialDensity = selectedDensity;
        });

        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    _resetDensitiesToDefault = () => {
        this.worldSettings.forEach((setting, idx) => {
            setting.initialDensity = Config.DEFAULT_INITIAL_DENSITIES[idx] ?? 0.5;
        });

        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    _getAffectedWorldIndices = (scope) => {
        if (scope === 'none') return [];
        if (scope === 'all') return this.worlds.map((_, i) => i);
        if (scope === 'selected') return [this.selectedWorldIndex];
        if (typeof scope === 'number' && scope >= 0 && scope < this.worlds.length) return [scope];
        console.warn("Invalid scope for _getAffectedWorldIndices:", scope);
        return [];
    }

    #applyRulesetToWorlds = (rulesetHex, scope, shouldReset) => {
        const newRulesetArray = hexToRuleset(rulesetHex);
        if (rulesetHex === "Error" || newRulesetArray.length !== 128) {
            console.error("Cannot apply invalid ruleset hex:", rulesetHex);
            return;
        }

        const indicesToAffect = this._getAffectedWorldIndices(scope);

        indicesToAffect.forEach(idx => {
            
            this._addRulesetToHistory(idx, rulesetHex);
            
            const newRulesetBuffer = newRulesetArray.buffer.slice(0);
            this.worlds[idx].setRuleset(newRulesetBuffer);
            this.worldSettings[idx].rulesetHex = rulesetHex;

            
            if (shouldReset && this.worldSettings[idx]) {
                this.worlds[idx].resetWorld(this.worldSettings[idx].initialDensity);
            }
        });

        if (indicesToAffect.includes(this.selectedWorldIndex)) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, rulesetHex);
            PersistenceService.saveRuleset(rulesetHex);
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    _generateMutatedHex = (sourceHex, mutationRate, mutationMode) => {
        const rules = hexToRuleset(sourceHex);

        if (mutationMode === 'single') {
            
            for (let i = 0; i < 128; i++) {
                if (Math.random() < mutationRate) {
                    rules[i] = 1 - rules[i];
                }
            }
        } else if (mutationMode === 'r_sym') {
            
            const canonicalGroups = this.symmetryData.canonicalRepresentatives;
            if (!canonicalGroups || canonicalGroups.length === 0) return sourceHex;

            for (const group of canonicalGroups) {
                for (let cs = 0; cs <= 1; cs++) {
                    if (Math.random() < mutationRate) {
                        
                        const currentOutput = rules[(cs << 6) | group.representative];
                        const newOutput = 1 - currentOutput;
                        for (const member of group.members) {
                            const idx = (cs << 6) | member;
                            rules[idx] = newOutput;
                        }
                    }
                }
            }
        } else if (mutationMode === 'n_count') {
            
            for (let cs = 0; cs <= 1; cs++) {
                for (let nan = 0; nan <= 6; nan++) {
                    if (Math.random() < mutationRate) {
                        
                        const currentEffectiveOutput = this.getEffectiveRuleForNeighborCount(cs, nan);
                        const newOutput = (currentEffectiveOutput === 2) ? Math.round(Math.random()) : 1 - currentEffectiveOutput;
                        
                        for (let mask = 0; mask < 64; mask++) {
                            if (Symmetry.countSetBits(mask) === nan) {
                                const idx = (cs << 6) | mask;
                                rules[idx] = newOutput;
                            }
                        }
                    }
                }
            }
        }
        
        return rulesetToHex(rules);
    }

    _mutateRulesetForScope = (scope, mutationRate, mutationMode = 'single') => {
        const indices = this._getAffectedWorldIndices(scope);

        indices.forEach(idx => {
            const proxyStats = this.worlds[idx]?.getLatestStats();
            let currentHex = (proxyStats?.rulesetHex && proxyStats.rulesetHex !== "Error")
                ? proxyStats.rulesetHex
                : this.worldSettings[idx]?.rulesetHex;
            
            if (!currentHex) {
                console.warn(`_mutateRulesetForScope: No current hex for world ${idx}, skipping mutation.`);
                return;
            }

            const newHex = this._generateMutatedHex(currentHex, mutationRate, mutationMode);

            if (newHex !== currentHex && newHex !== "Error") {
                this._addRulesetToHistory(idx, newHex);
                const newRulesetArray = hexToRuleset(newHex);
                const newRulesetBuffer = newRulesetArray.buffer.slice(0);
                this.worlds[idx].setRuleset(newRulesetBuffer);
                this.worldSettings[idx].rulesetHex = newHex;
            }
        });

        if (indices.includes(this.selectedWorldIndex)) {
            this.dispatchSelectedWorldUpdates();
            if (this.worldSettings[this.selectedWorldIndex]) {
                PersistenceService.saveRuleset(this.worldSettings[this.selectedWorldIndex].rulesetHex);
            }
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    };

    _cloneAndMutateOthers = (mutationRate, mutationMode = 'single') => {
        const selectedProxy = this.worlds[this.selectedWorldIndex];
        if (!selectedProxy) {
            console.error("Cannot clone/mutate: selected world proxy is not available.");
            return;
        }

        const sourceRulesetHex = this.getCurrentRulesetHex();

        if (sourceRulesetHex === "Error" || sourceRulesetHex === "N/A") {
             console.error("Cannot clone/mutate: selected world's ruleset is invalid.");
             alert("Selected world has an invalid ruleset and cannot be cloned.");
             return;
        }

        this.worlds.forEach((proxy, idx) => {
            let newHex = sourceRulesetHex;
            if (idx !== this.selectedWorldIndex) {
                newHex = this._generateMutatedHex(sourceRulesetHex, mutationRate, mutationMode);
                if (newHex !== "Error") {
                    const newRulesetBuffer = hexToRuleset(newHex).buffer.slice(0);
                    proxy.setRuleset(newRulesetBuffer);
                }
            }
            
            
            this._addRulesetToHistory(idx, newHex);
            this.worldSettings[idx].rulesetHex = newHex;

            if (this.worldSettings[idx]) {
                proxy.resetWorld(this.worldSettings[idx].initialDensity);
                
                if (!this.worldSettings[idx].enabled) {
                    this.worldSettings[idx].enabled = true;
                    proxy.setEnabled(true);
                }
                if (!this.isGloballyPaused) {
                    proxy.startSimulation();
                }
            }
        });

        
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET); 
    }

    _cloneRuleset = () => {
        const selectedProxy = this.worlds[this.selectedWorldIndex];
        if (!selectedProxy) {
            console.error("Cannot clone: selected world proxy is not available.");
            return;
        }

        const sourceRulesetHex = this.getCurrentRulesetHex();
        if (sourceRulesetHex === "Error" || sourceRulesetHex === "N/A") {
             console.error("Cannot clone: selected world's ruleset is invalid.");
             alert("Selected world has an invalid ruleset and cannot be cloned.");
             return;
        }

        this.worlds.forEach((proxy, idx) => {
            if (idx !== this.selectedWorldIndex) {
                const newRulesetBuffer = hexToRuleset(sourceRulesetHex).buffer.slice(0);
                proxy.setRuleset(newRulesetBuffer);
            }
            
            this._addRulesetToHistory(idx, sourceRulesetHex);
            this.worldSettings[idx].rulesetHex = sourceRulesetHex;

            if (this.worldSettings[idx]) {
                proxy.resetWorld(this.worldSettings[idx].initialDensity);
                
                if (!this.worldSettings[idx].enabled) {
                    this.worldSettings[idx].enabled = true;
                    proxy.setEnabled(true);
                }
                if (!this.isGloballyPaused) {
                    proxy.startSimulation();
                }
            }
        });

        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET); 
    }

    _modifyRulesetForScope = (scope, modifierFunc, conditionalResetScope) => {
        const indices = this._getAffectedWorldIndices(scope);
        indices.forEach(idx => {
            const proxyStats = this.worlds[idx]?.getLatestStats();
            let currentHex = (proxyStats?.rulesetHex && proxyStats.rulesetHex !== "Error")
                ? proxyStats.rulesetHex
                : this.worldSettings[idx]?.rulesetHex;

            if (!currentHex) {
                console.warn(`_modifyRulesetForScope: No current hex for world ${idx}, skipping modification.`);
                return;
            }

            const newHex = modifierFunc(currentHex);

            if (newHex !== currentHex && newHex !== "Error") {
                this._addRulesetToHistory(idx, newHex);
                const newRulesetArray = hexToRuleset(newHex);
                const newRulesetBuffer = newRulesetArray.buffer.slice(0);
                this.worlds[idx].setRuleset(newRulesetBuffer);
                this.worldSettings[idx].rulesetHex = newHex;

                if (conditionalResetScope !== 'none') {
                    const resetTargetIndices = this._getAffectedWorldIndices(conditionalResetScope);
                    if (resetTargetIndices.includes(idx) && this.worldSettings[idx]) {
                        this.worlds[idx].resetWorld(this.worldSettings[idx].initialDensity);
                    }
                }
            }
        });

        if (indices.includes(this.selectedWorldIndex)) {
            this.dispatchSelectedWorldUpdates();
            if (this.worldSettings[this.selectedWorldIndex]) {
                PersistenceService.saveRuleset(this.worldSettings[this.selectedWorldIndex].rulesetHex);
            }
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    setGlobalPause = (isPaused) => {
        this.isGloballyPaused = isPaused;
        this.worlds.forEach(proxy => {
            if (this.isGloballyPaused || !proxy.getLatestStats().isEnabled) {
                proxy.stopSimulation();
            } else {
                proxy.startSimulation();
                proxy.setSpeed(this.simulationController.getState().speed);
            }
        });
        this.simulationController._syncPauseState(this.isGloballyPaused);
    }

    setGlobalSpeed = (speed) => {
        const newSpeed = Math.max(1, Math.min(Config.MAX_SIM_SPEED, speed));
        this.worlds.forEach(proxy => proxy.setSpeed(newSpeed));
        
    }

    getWorldsRenderData = () => {
        return this.worlds.map(proxy => proxy.getLatestRenderData());
    }

    getWorldsFullStatus = () => {
        return this.worlds.map(proxy => proxy.getFullStatus());
    }


    getSelectedWorldIndex = () => this.selectedWorldIndex;

    getCurrentRulesetHex = () => {
        const proxy = this.worlds[this.selectedWorldIndex];
        if (proxy && proxy.isInitialized) {
            const stats = proxy.getLatestStats();
            if (stats.rulesetHex && stats.rulesetHex !== "Error") {
                return stats.rulesetHex;
            }
        }
        return this.worldSettings[this.selectedWorldIndex]?.rulesetHex || "N/A";
    }
    getCurrentRulesetArray = () => hexToRuleset(this.getCurrentRulesetHex());

    getSelectedWorldStats = () => {
        const proxy = this.worlds[this.selectedWorldIndex];
        return proxy ? proxy.getLatestStats() : { tick: 0, ratio: 0, entropy: 0, isEnabled: false, rulesetHex: "0".repeat(32), tps: 0, ruleUsage: new Uint32Array(128) };
    }
    getWorldSettingsForUI = () => this.worldSettings.map(ws => ({
        initialDensity: ws.initialDensity,
        enabled: ws.enabled,
        rulesetHex: ws.rulesetHex
    }));

    getSymmetryData = () => this.symmetryData;

    getEffectiveRuleForNeighborCount = (centerState, numActiveNeighbors) => {
        const currentHex = this.getCurrentRulesetHex();
        if (currentHex === "N/A" || currentHex === "Error") return 2;
        const ruleset = hexToRuleset(currentHex);

        if (!ruleset || ruleset.length !== 128) return 2;
        let firstOutput = -1;
        for (let mask = 0; mask < 64; mask++) {
            if (Symmetry.countSetBits(mask) === numActiveNeighbors) {
                const output = ruleset[(centerState << 6) | mask];
                if (firstOutput === -1) firstOutput = output;
                else if (firstOutput !== output) return 2;
            }
        }
        return firstOutput === -1 ? 2 : firstOutput;
    }

    getCanonicalRuleDetails = () => {
        if (!this.symmetryData) {
            console.error("getCanonicalRuleDetails: this.symmetryData is undefined.");
            return [];
        }
        const currentHex = this.getCurrentRulesetHex();
        if (currentHex === "N/A" || currentHex === "Error") return [];
        const ruleset = hexToRuleset(currentHex);

        if (!ruleset || ruleset.length !== 128) return [];

        return this.symmetryData.canonicalRepresentatives.flatMap(group => {
            let outputState0 = -1, outputState1 = -1;
            let mixed0 = false, mixed1 = false;

            for (const member of group.members) {
                const currentOut0 = ruleset[(0 << 6) | member];
                if (outputState0 === -1) outputState0 = currentOut0;
                else if (outputState0 !== currentOut0) mixed0 = true;

                const currentOut1 = ruleset[(1 << 6) | member];
                if (outputState1 === -1) outputState1 = currentOut1;
                else if (outputState1 !== currentOut1) mixed1 = true;
            }
            return [
                { canonicalBitmask: group.representative, centerState: 0, orbitSize: group.orbitSize, effectiveOutput: mixed0 ? 2 : outputState0, members: group.members },
                { canonicalBitmask: group.representative, centerState: 1, orbitSize: group.orbitSize, effectiveOutput: mixed1 ? 2 : outputState1, members: group.members }
            ];
        });
    }

    _generateRandomRulesetHex = (bias, generationMode) => {
        const tempRuleset = new Uint8Array(128);
        if (generationMode === 'n_count') {
            for (let cs = 0; cs <= 1; cs++) {
                for (let nan = 0; nan <= 6; nan++) {
                    const out = Math.random() < bias ? 1 : 0;
                    for (let m = 0; m < 64; m++) if (Symmetry.countSetBits(m) === nan) tempRuleset[(cs << 6) | m] = out;
                }
            }
        } else if (generationMode === 'r_sym') {
            if (!this.symmetryData || !this.symmetryData.canonicalRepresentatives) {
                console.warn("_generateRandomRulesetHex: symmetryData not available for r_sym, falling back to random.");
                for (let i = 0; i < 128; i++) tempRuleset[i] = Math.random() < bias ? 1 : 0;
            } else {
                tempRuleset.fill(0);
                for (const group of this.symmetryData.canonicalRepresentatives) {
                    for (let cs = 0; cs <= 1; cs++) {
                        const out = Math.random() < bias ? 1 : 0;
                        for (const member of group.members) tempRuleset[(cs << 6) | member] = out;
                    }
                }
            }
        } else {
            for (let i = 0; i < 128; i++) tempRuleset[i] = Math.random() < bias ? 1 : 0;
        }
        return rulesetToHex(tempRuleset);
    }

    saveSelectedWorldState = () => {
        const proxy = this.worlds[this.selectedWorldIndex];
        if (!proxy) return;

        const stateArray = proxy.latestStateArray ? Array.from(proxy.latestStateArray) : [];
        const rulesetHex = this.getCurrentRulesetHex();
        const stats = proxy.getLatestStats();

        const data = {
            rows: Config.GRID_ROWS,
            cols: Config.GRID_COLS,
            rulesetHex: rulesetHex,
            state: stateArray,
            worldTick: stats.tick
        };
        EventBus.dispatch(EVENTS.TRIGGER_DOWNLOAD, {
            filename: `hex_state_world${this.selectedWorldIndex}_${rulesetHex}_${new Date().toISOString().slice(0, -4).replace(/[:.-]/g, '')}.json`,
            content: JSON.stringify(data, null, 2),
            mimeType: 'application/json'
        });
    }

    loadWorldState = (worldIndex, loadedData) => {
        if (worldIndex < 0 || worldIndex >= this.worlds.length) return;
        if (loadedData.rows !== Config.GRID_ROWS || loadedData.cols !== Config.GRID_COLS) {
            alert("Grid dimensions in file do not match current configuration.");
            return;
        }
        const proxy = this.worlds[worldIndex];
        const newRulesetArray = hexToRuleset(loadedData.rulesetHex);
        const newStateArray = Uint8Array.from(loadedData.state);

        if (this.worldSettings[worldIndex]) {
            this._addRulesetToHistory(worldIndex, loadedData.rulesetHex); 
            this.worldSettings[worldIndex].rulesetHex = loadedData.rulesetHex;
            const newDensity = newStateArray.reduce((sum, val) => sum + val, 0) / (newStateArray.length || 1);
            this.worldSettings[worldIndex].initialDensity = newDensity;
            this.worldSettings[worldIndex].enabled = true;
        }

        proxy.sendCommand('LOAD_STATE', {
            newStateBuffer: newStateArray.buffer.slice(0),
            newRulesetBuffer: newRulesetArray.buffer.slice(0),
            worldTick: loadedData.worldTick || 0
        }, [newStateArray.buffer.slice(0), newRulesetArray.buffer.slice(0)]);

        proxy.setEnabled(true);
                    if (!this.isGloballyPaused) {
                proxy.startSimulation();
                proxy.setSpeed(this.simulationController.getState().speed);
            }

        PersistenceService.saveWorldSettings(this.worldSettings);
        if (worldIndex === this.selectedWorldIndex) {
            this.dispatchSelectedWorldUpdates();
        }
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    }

    revertToHistoryState = (worldIndex, historyIndex) => {
        const settings = this.worldSettings[worldIndex];
        if (!settings || historyIndex < 0 || historyIndex >= settings.rulesetHistory.length) return;

        const currentIndex = settings.rulesetHistory.length - 1;
        if (historyIndex === currentIndex) return; 

        
        const itemsToMove = settings.rulesetHistory.splice(historyIndex + 1);
        settings.rulesetFuture.unshift(...itemsToMove.reverse());

        const targetRuleset = settings.rulesetHistory[historyIndex];
        settings.rulesetHex = targetRuleset;

        const newRulesetBuffer = hexToRuleset(targetRuleset).buffer.slice(0);
        this.worlds[worldIndex].setRuleset(newRulesetBuffer);

        if (worldIndex === this.selectedWorldIndex) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, targetRuleset);
            PersistenceService.saveRuleset(targetRuleset);
        }
        EventBus.dispatch(EVENTS.HISTORY_CHANGED, { worldIndex });
        PersistenceService.saveWorldSettings(this.worldSettings);
    }

    undoRulesetChange = (worldIndex) => {
        const settings = this.worldSettings[worldIndex];
        if (!settings || settings.rulesetHistory.length < 2) return;

        
        const targetIndex = settings.rulesetHistory.length - 2;
        
        const currentRuleset = settings.rulesetHistory.pop();
        settings.rulesetFuture.unshift(currentRuleset); 

        const previousRuleset = settings.rulesetHistory[targetIndex];
        settings.rulesetHex = previousRuleset;
        
        const newRulesetBuffer = hexToRuleset(previousRuleset).buffer.slice(0);
        this.worlds[worldIndex].setRuleset(newRulesetBuffer);

        if (worldIndex === this.selectedWorldIndex) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, previousRuleset);
            PersistenceService.saveRuleset(previousRuleset);
        }
        EventBus.dispatch(EVENTS.HISTORY_CHANGED, { worldIndex });
        PersistenceService.saveWorldSettings(this.worldSettings);
    }

    redoRulesetChange = (worldIndex) => {
        const settings = this.worldSettings[worldIndex];
        if (!settings || settings.rulesetFuture.length === 0) return;

        const nextRuleset = settings.rulesetFuture.shift(); 
        settings.rulesetHistory.push(nextRuleset);
        settings.rulesetHex = nextRuleset;

        const newRulesetBuffer = hexToRuleset(nextRuleset).buffer.slice(0);
        this.worlds[worldIndex].setRuleset(newRulesetBuffer);

        if (worldIndex === this.selectedWorldIndex) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, nextRuleset);
            PersistenceService.saveRuleset(nextRuleset);
        }
        EventBus.dispatch(EVENTS.HISTORY_CHANGED, { worldIndex });
        PersistenceService.saveWorldSettings(this.worldSettings);
    }

    getRulesetHistoryArrays = (worldIndex) => {
        const settings = this.worldSettings[worldIndex];
        if (!settings) return { history: [], future: [] };
        return {
            history: [...settings.rulesetHistory], 
            future: [...settings.rulesetFuture],
        };
    }

    getEntropySamplingState = () => {
        return { enabled: this.isEntropySamplingEnabled, rate: this.entropySampleRate };
    }

    areAllWorkersInitialized = () => {
        return this.worlds.length > 0 && this.worlds.every(proxy => proxy && proxy.isInitialized);
    }

    terminateAllWorkers = () => {
        this.worlds.forEach(proxy => proxy.terminate());
    }

    _initCameraStates(sharedCameraSettings) {
        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const defaultCamera = {
                x: Config.RENDER_TEXTURE_SIZE / 2,
                y: Config.RENDER_TEXTURE_SIZE / 2,
                zoom: 1.0
            };

            if (sharedCameraSettings && i === this.selectedWorldIndex) {
                this.cameraStates.push(sharedCameraSettings);
            } else {
                this.cameraStates.push(defaultCamera);
            }
        }
    }

    getCurrentCameraState = () => {
        return this.cameraStates[this.selectedWorldIndex];
    }
}