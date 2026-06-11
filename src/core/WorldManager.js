import * as Config from './config.js';
import { WorldProxy } from './WorldProxy.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Symmetry from './Symmetry.js';
import { RulesetService } from './RulesetService.js';
import { AutoExploreService } from './AutoExploreService.js';
import { ShareCodec } from '../services/ShareCodec.js';
import { rulesetToHex, hexToRuleset, findHexagonsInNeighborhood, cellsToBase64, base64ToCells } from '../utils/utils.js';

export class WorldManager {
    constructor(sharedSettings = {}) {
        this.worlds = [];
        this.cameraStates = [];
        this.sharedSettings = sharedSettings;
        this.simulationController = null;
        this.brushController = null;
        this.selectedWorldIndex = sharedSettings.selectedWorldIndex ?? Config.DEFAULT_SELECTED_WORLD_INDEX;
        this.isGloballyPaused = true;
        this.deterministic = PersistenceService.loadUISetting('deterministic', true); // Add this
        this._hoverAffectedIndicesSet = new Set();
        this.isEntropySamplingEnabled = PersistenceService.loadUISetting('entropySamplingEnabled', false);
        this.entropySampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);
        this.symmetryData = Symmetry.precomputeSymmetryGroups();
        this.rulesetService = new RulesetService(this.symmetryData);
        this.worldSettings = [];
        this.initialDefaultRulesetHex = "";
        this._initWorlds();
        this._initCameraStates(sharedSettings.camera);
        // Auto-explore (Phase 4): generation loop + session gallery. Constructed after worlds exist;
        // it only references the proxies/ruleset service lazily once started.
        this.autoExploreService = new AutoExploreService(this);
        this._setupEventListeners();
    }

    setControllerReferences(simulationController, brushController) {
        this.simulationController = simulationController;
        this.brushController = brushController;
    }

    _initWorlds = () => {
        const hasSharedSettings = this.sharedSettings.fromUrl;

        if (hasSharedSettings) {
            console.log("Applying shared settings from URL.");
            this.worldSettings = [];

            const sharedRulesets = this.sharedSettings.rulesets; 
            const singleRuleset = this.sharedSettings.rulesetHex; 
            const sharedInitialStates = this.sharedSettings.initialStates;
            const sharedDensities = this.sharedSettings.densities; // Backward compatibility
            const enabledMask = this.sharedSettings.enabledMask ?? 0b111111111;

            for (let i = 0; i < Config.NUM_WORLDS; i++) {
                const rulesetHex = sharedRulesets ? sharedRulesets[i] : (singleRuleset || Config.INITIAL_RULESET_CODE);
                const enabled = (enabledMask & (1 << i)) !== 0;

                // Determine initial state - prefer new format, fall back to legacy density format
                let initialState;
                if (sharedInitialStates && sharedInitialStates[i]) {
                    initialState = sharedInitialStates[i];
                } else if (sharedDensities && sharedDensities[i] !== undefined) {
                    // Backward compatibility: convert density to new format
                    initialState = {
                        mode: 'density',
                        params: { density: sharedDensities[i] }
                    };
                } else {
                    // Default fallback
                    initialState = {
                        mode: 'density',
                        params: { density: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0.5 }
                    };
                }

                this.worldSettings.push({
                    initialState: initialState,
                    enabled: enabled,
                    rulesetHex: rulesetHex,
                    rulesetHistory: [rulesetHex],
                    rulesetFuture: []
                });
            }
            PersistenceService.saveWorldSettings(this.worldSettings);
            
            PersistenceService.saveRuleset(this.worldSettings[this.selectedWorldIndex].rulesetHex);
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
            onUpdate: (worldIndex, _updateType) => this._handleProxyUpdate(worldIndex, _updateType),
            onInitialized: (worldIndex) => this._handleProxyInitialized(worldIndex)
        };

        // One base seed for the whole initial-load batch so that, in deterministic mode, worlds
        // sharing an initial-state config seed identically from first paint (no explicit Reset
        // required). Matches the per-reset seeding done by every other reset path via _getResetSeed.
        const initialBaseSeed = Date.now();

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = this.worldSettings[i] || {
                initialState: {
                    mode: 'density',
                    params: { density: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0.5 }
                },
                enabled: Config.DEFAULT_WORLD_ENABLED_STATES[i] ?? true,
                rulesetHex: this.initialDefaultRulesetHex,
                rulesetHistory: [this.initialDefaultRulesetHex],
                rulesetFuture: []
            };

            const rulesetArray = hexToRuleset(settings.rulesetHex);

            const proxy = new WorldProxy(i, {
                config: { GRID_ROWS: Config.GRID_ROWS, GRID_COLS: Config.GRID_COLS, NUM_CELLS: Config.NUM_CELLS },
                initialState: settings.initialState, // Modify this
                enabled: settings.enabled,
                rulesetArray: rulesetArray,
                rulesetHex: settings.rulesetHex,
                speed: this.simulationController?.getSpeed() || 1,
                initialEntropySamplingEnabled: this.isEntropySamplingEnabled,
                initialEntropySampleRate: this.entropySampleRate,
                seed: this._getResetSeed(initialBaseSeed, i),
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
            this.worlds[worldIndex].setSpeed(this.simulationController.getSpeed());
        }
    }

    _handleProxyUpdate = (worldIndex, _updateType) => {
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

    _setupEventListeners() {
        this.#setupSimulationControlHandlers();
        this.#setupRulesetCommandHandlers();
        this.#setupEditorCommandHandlers();
        this.#setupWorldStateCommandHandlers();
        this.#setupInputAndInteractionHandlers();
        this.#setupAutoExploreHandlers();
    }

    #setupAutoExploreHandlers() {
        EventBus.subscribe(EVENTS.COMMAND_START_AUTO_EXPLORE, (options) => this.autoExploreService.start(options || {}));
        EventBus.subscribe(EVENTS.COMMAND_STOP_AUTO_EXPLORE, (data) => this.autoExploreService.stop(data || {}));
        EventBus.subscribe(EVENTS.COMMAND_CLEAR_AUTO_EXPLORE_GALLERY, () => this.autoExploreService.clearGallery());
    }

    #setupSimulationControlHandlers() {
        EventBus.subscribe(EVENTS.SIMULATION_PAUSED, this.setGlobalPause);
        EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, (speed) => this.setGlobalSpeed(speed));
        EventBus.subscribe(EVENTS.COMMAND_SELECT_WORLD, (newIndex) => {
            this.selectedWorldIndex = newIndex;
            this.dispatchSelectedWorldUpdates();
            EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, newIndex);
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, (data) => {
            this.isEntropySamplingEnabled = data.enabled;
            this.entropySampleRate = data.rate;
            PersistenceService.saveUISetting('entropySamplingEnabled', data.enabled);
            PersistenceService.saveUISetting('entropySampleRate', data.rate);
            this.worlds.forEach(proxy => proxy.sendCommand('SET_ENTROPY_SAMPLING_PARAMS', {
                enabled: this.isEntropySamplingEnabled,
                rate: this.entropySampleRate
            }));
            EventBus.dispatch(EVENTS.ENTROPY_SAMPLING_CHANGED, { enabled: this.isEntropySamplingEnabled, rate: this.entropySampleRate });
        });
        
        // --- ADD THIS ---
        EventBus.subscribe(EVENTS.COMMAND_SET_DETERMINISTIC_RESET, (isDeterministic) => {
            this.deterministic = isDeterministic;
            PersistenceService.saveUISetting('deterministic', isDeterministic);
        });
    }

    #setupRulesetCommandHandlers() {
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
            this._cloneAndMutateOthers(data.mutationRate, data.mode, data.ensureMutation);
        });
        EventBus.subscribe(EVENTS.COMMAND_CLONE_RULESET, () => {
            this._cloneRuleset();
        });
        EventBus.subscribe(EVENTS.COMMAND_BREED_WORLDS, (data) => {
            // A null/undefined parentAIndex means "the selected world" (the UI's implicit parent A).
            const parentA = (data.parentAIndex == null) ? this.selectedWorldIndex : data.parentAIndex;
            this._breedWorlds(parentA, data.parentBIndex, data.mode, data.postMutationRate);
        });
        EventBus.subscribe(EVENTS.COMMAND_INVERT_RULESET, this._invertSelectedRuleset);
        EventBus.subscribe(EVENTS.COMMAND_UNDO_RULESET, (data) => this.undoRulesetChange(data.worldIndex));
        EventBus.subscribe(EVENTS.COMMAND_REDO_RULESET, (data) => this.redoRulesetChange(data.worldIndex));
        EventBus.subscribe(EVENTS.COMMAND_REVERT_TO_HISTORY_STATE, (data) => this.revertToHistoryState(data.worldIndex, data.historyIndex));
    }

    #setupEditorCommandHandlers() {
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
    }
    
    #setupWorldStateCommandHandlers() {
        EventBus.subscribe(EVENTS.COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL, this._applySelectedInitialStateToAll);
        EventBus.subscribe(EVENTS.COMMAND_RESET_INITIAL_STATES_TO_DEFAULT, this._resetStatesToDefault);
        EventBus.subscribe(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, () => {
            const baseSeed = Date.now();
            this.worlds.forEach((proxy, idx) => {
                if (this.worldSettings[idx]) {
                    proxy.resetWorld(this.worldSettings[idx].initialState, this._getResetSeed(baseSeed, idx));
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
            const baseSeed = Date.now();
            indicesToReset.forEach(idx => {
                if (data.copyPrimaryRuleset && idx !== this.selectedWorldIndex) {
                    // Copy-on-reset doesn't push history (it isn't a user ruleset edit).
                    this._commitRuleset(idx, primaryRulesetHex, { addToHistory: false });
                }
                if (this.worldSettings[idx]) {
                    this.worlds[idx].resetWorld(this.worldSettings[idx].initialState, this._getResetSeed(baseSeed, idx));
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
                if (!proxy) return;

                const initialState = this.worldSettings[idx]?.initialState;
                if (!initialState) {
                    console.warn(`World ${idx} has no initial state, skipping clear.`);
                    return;
                }
                const clearStateConfig = { ...initialState, params: { ...initialState.params, density: 0 } };
                proxy.sendCommand('RESET_WORLD', { isClearOperation: true, initialState: clearStateConfig });
            });

            if (data.scope === 'all') EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        });
        EventBus.subscribe(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE, this.saveSelectedWorldState);
        EventBus.subscribe(EVENTS.COMMAND_LOAD_WORLD_STATE, (data) => this.loadWorldState(data.worldIndex, data.loadedData));
        EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_INITIAL_STATE, (data) => {
            if (this.worldSettings[data.worldIndex]) {
                this.worldSettings[data.worldIndex].initialState = data.initialState;
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
                    this.worlds[data.worldIndex].setSpeed(this.simulationController.getSpeed());
                } else if (!data.isEnabled) {
                    this.worlds[data.worldIndex].stopSimulation();
                }
                PersistenceService.saveWorldSettings(this.worldSettings);
                EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
            }
        });
    }
    
    #setupInputAndInteractionHandlers() {
        EventBus.subscribe(EVENTS.COMMAND_APPLY_BRUSH, (data) => {
            this.worlds[data.worldIndex]?.applyBrush(data.col, data.row, this.brushController.getBrushSize());
        });
        EventBus.subscribe(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, (data) => {
            this.worlds[data.worldIndex]?.applySelectiveBrush(data.cellIndices, data.brushMode);
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_HOVER_STATE, (data) => {
            findHexagonsInNeighborhood(data.col, data.row, this.brushController.getBrushSize(), this._hoverAffectedIndicesSet);
            this.worlds[data.worldIndex]?.setHoverState(this._hoverAffectedIndicesSet);
        });
        EventBus.subscribe(EVENTS.COMMAND_CLEAR_HOVER_STATE, (data) => {
            this.worlds[data.worldIndex]?.clearHoverState();
        });
        EventBus.subscribe(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, (data) => {
            this.worlds[this.selectedWorldIndex]?.setGhostState(data.indices);
        });
        EventBus.subscribe(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW, () => {
            this.worlds[this.selectedWorldIndex]?.clearGhostState();
        });
    }

    _applySelectedInitialStateToAll = () => {
        const selectedState = this.worldSettings[this.selectedWorldIndex]?.initialState;
        if (!selectedState) return;
        const stateCopy = structuredClone(selectedState);
        this.worldSettings.forEach(setting => {
            setting.initialState = structuredClone(stateCopy);
        });
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    _resetStatesToDefault = () => {
        this.worldSettings.forEach((setting, idx) => {
            setting.initialState = {
                mode: 'density',
                params: { density: Config.DEFAULT_INITIAL_DENSITIES[idx] ?? 0.5 }
            };
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

    /**
     * Computes the RNG seed for a single world reset. In deterministic mode every
     * world shares `baseSeed`, so worlds with matching initial-state configs reset
     * to identical grids; otherwise each world is offset by its index. Callers must
     * capture `baseSeed` once (e.g. `Date.now()`) before the reset loop so a single
     * operation seeds all worlds consistently.
     * @param {number} baseSeed - A single seed captured once per reset operation.
     * @param {number} worldIndex
     * @returns {number}
     */
    _getResetSeed(baseSeed, worldIndex) {
        return this.deterministic ? baseSeed : baseSeed + worldIndex;
    }

    /**
     * Apply a ruleset to a single world, centralizing the push-history → hexToRuleset →
     * buffer.slice(0) → setRuleset → update-worldSettings dance repeated across every
     * ruleset-mutation path. Callers still own scope resolution, persistence, and event
     * dispatch (so a batch can persist/dispatch once after the loop).
     * @param {number} worldIndex
     * @param {string} hex - 32-char ruleset hex (a falsy world/settings entry is a no-op).
     * @param {object} [opts]
     * @param {boolean} [opts.addToHistory=true] - Push hex onto the world's ruleset history.
     *   Set false for undo/redo/revert, which reshape history themselves.
     * @param {boolean} [opts.uploadToWorker=true] - Send the parsed rule buffer to the worker.
     *   Set false when the worker already has this ruleset (clone source) or receives it via
     *   another command (LOAD_STATE). Skipped when hex is "Error".
     * @param {boolean} [opts.reset=false] - Reset the world's grid after applying.
     * @param {number} [opts.seed] - Reset seed (used when reset is true).
     */
    _commitRuleset = (worldIndex, hex, opts = {}) => {
        const { addToHistory = true, uploadToWorker = true, reset = false, seed } = opts;
        const proxy = this.worlds[worldIndex];
        const settings = this.worldSettings[worldIndex];
        if (!proxy || !settings) return;

        if (addToHistory) this._addRulesetToHistory(worldIndex, hex);
        if (uploadToWorker && hex !== "Error") {
            proxy.setRuleset(hexToRuleset(hex).buffer.slice(0));
        }
        settings.rulesetHex = hex;
        if (reset) proxy.resetWorld(settings.initialState, seed);
    }

    #applyRulesetToWorlds = (rulesetHex, scope, shouldReset) => {
        const newRulesetArray = hexToRuleset(rulesetHex);
        if (rulesetHex === "Error" || newRulesetArray.length !== 128) {
            console.error("Cannot apply invalid ruleset hex:", rulesetHex);
            return;
        }

        const indicesToAffect = this._getAffectedWorldIndices(scope);
        const baseSeed = Date.now();

        indicesToAffect.forEach(idx => {
            this._commitRuleset(idx, rulesetHex, {
                reset: shouldReset,
                seed: this._getResetSeed(baseSeed, idx),
            });
        });

        if (indicesToAffect.includes(this.selectedWorldIndex)) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, rulesetHex);
            PersistenceService.saveRuleset(rulesetHex);
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    // Delegates to RulesetService. n_count mode seeds its flips from the *selected* world's
    // effective per-neighbor-count output (preserving the prior behaviour), hence the parsed
    // current ruleset is passed as the reference.
    _generateMutatedHex = (sourceHex, mutationRate, mutationMode) =>
        this.rulesetService.generateMutatedHex(sourceHex, mutationRate, mutationMode, this._getParsedCurrentRuleset());

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
                this._commitRuleset(idx, newHex);
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

    _cloneAndMutateOthers = (mutationRate, mutationMode = 'single', ensureMutation = false) => {
        const selectedProxy = this.worlds[this.selectedWorldIndex];
        if (!selectedProxy) {
            console.error("Cannot clone/mutate: selected world proxy is not available.");
            return;
        }

        const sourceRulesetHex = this.getCurrentRulesetHex();

        if (sourceRulesetHex === "Error" || sourceRulesetHex === "N/A") {
             console.error("Cannot clone/mutate: selected world's ruleset is invalid.");
             EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Selected world has an invalid ruleset and cannot be cloned.", type: 'error' });
             return;
        }

        const generatedHexes = new Set([sourceRulesetHex]);
        const baseSeed = Date.now();

        this.worlds.forEach((proxy, idx) => {
            let newHex = sourceRulesetHex;
            const isSelected = idx === this.selectedWorldIndex;
            if (!isSelected) {
                let attempts = 0;
                const maxAttempts = 10; // prevent infinite loop
                do {
                    newHex = this._generateMutatedHex(sourceRulesetHex, mutationRate, mutationMode);
                    attempts++;
                } while (ensureMutation && generatedHexes.has(newHex) && attempts < maxAttempts);

                if (ensureMutation && generatedHexes.has(newHex) && attempts >= maxAttempts) {
                    console.warn(`Could not generate a unique mutation for ${sourceRulesetHex} after ${maxAttempts} attempts. Forcing one.`);
                    // Force a single bit flip if still no mutation
                    const rules = hexToRuleset(newHex);
                    let forcedHex;
                    let forceAttempts = 0;
                    do {
                        const randomIndex = Math.floor(Math.random() * 128);
                        rules[randomIndex] = 1 - rules[randomIndex];
                        forcedHex = rulesetToHex(rules);
                        forceAttempts++;
                    } while (generatedHexes.has(forcedHex) && forceAttempts < 128);
                    newHex = forcedHex;
                }

                if (newHex !== "Error") generatedHexes.add(newHex);
            }

            // The selected world already runs the source ruleset, so skip its worker upload.
            this._commitRuleset(idx, newHex, {
                uploadToWorker: !isSelected,
                reset: true,
                seed: this._getResetSeed(baseSeed, idx),
            });

            if (!this.isGloballyPaused) {
                proxy.startSimulation();
            }
        });


        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    }

    /** The current ruleset hex of a world by index (live worker stats first, then saved settings). */
    _getRulesetHexForWorld = (idx) => {
        const stats = this.worlds[idx]?.getLatestStats();
        if (stats?.rulesetHex && stats.rulesetHex !== "Error") return stats.rulesetHex;
        return this.worldSettings[idx]?.rulesetHex || null;
    };

    /**
     * Breed two parent worlds: parents A and B keep their rulesets; every other world receives a
     * fresh `crossoverHexes(A, B)` child (Phase 5 manual surface — mirrors clone-and-mutate but with
     * two parents). The child worlds are reset+restarted so the recombination is visible immediately.
     * @param {number} parentAIdx
     * @param {number} parentBIdx
     * @param {'uniform'|'r_sym'} [mode='r_sym']
     * @param {number} [postMutationRate=0]
     */
    _breedWorlds = (parentAIdx, parentBIdx, mode = 'r_sym', postMutationRate = 0) => {
        const hexA = this._getRulesetHexForWorld(parentAIdx);
        const hexB = this._getRulesetHexForWorld(parentBIdx);
        if (!hexA || !hexB || hexA === "N/A" || hexB === "N/A") {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Cannot breed: a parent world has an invalid ruleset.", type: 'error' });
            return;
        }
        if (parentAIdx === parentBIdx) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Pick two different worlds to breed.", type: 'error' });
            return;
        }

        const baseSeed = Date.now();
        this.worlds.forEach((proxy, idx) => {
            if (idx === parentAIdx || idx === parentBIdx) return; // parents keep their rulesets
            const childHex = this.rulesetService.crossoverHexes(hexA, hexB, mode, Math.random, postMutationRate);
            if (!childHex || childHex === "Error") return;
            this._commitRuleset(idx, childHex, {
                uploadToWorker: true,
                reset: true,
                seed: this._getResetSeed(baseSeed, idx),
            });
            if (!this.isGloballyPaused) proxy.startSimulation();
        });

        if (this.selectedWorldIndex !== parentAIdx && this.selectedWorldIndex !== parentBIdx) {
            this.dispatchSelectedWorldUpdates();
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    };

    _cloneRuleset = () => {
        const selectedProxy = this.worlds[this.selectedWorldIndex];
        if (!selectedProxy) {
            console.error("Cannot clone: selected world proxy is not available.");
            return;
        }

        const sourceRulesetHex = this.getCurrentRulesetHex();
        if (sourceRulesetHex === "Error" || sourceRulesetHex === "N/A") {
             console.error("Cannot clone: selected world's ruleset is invalid.");
             EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Selected world has an invalid ruleset and cannot be cloned.", type: 'error' });
             return;
        }

        const baseSeed = Date.now();
        this.worlds.forEach((proxy, idx) => {
            // The selected world already runs the source ruleset, so skip its worker upload.
            this._commitRuleset(idx, sourceRulesetHex, {
                uploadToWorker: idx !== this.selectedWorldIndex,
                reset: true,
                seed: this._getResetSeed(baseSeed, idx),
            });

            if (!this.isGloballyPaused) {
                proxy.startSimulation();
            }
        });

        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET); 
    }

    _modifyRulesetForScope = (scope, modifierFunc, conditionalResetScope) => {
        const indices = this._getAffectedWorldIndices(scope);
        const baseSeed = Date.now();
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
                const shouldReset = conditionalResetScope !== 'none' &&
                    this._getAffectedWorldIndices(conditionalResetScope).includes(idx);
                this._commitRuleset(idx, newHex, {
                    reset: shouldReset,
                    seed: this._getResetSeed(baseSeed, idx),
                });
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
                proxy.setSpeed(this.simulationController.getSpeed());
            }
        });
        this.simulationController._syncPauseState(this.isGloballyPaused);
        // Respect global pause during exploration: the pause button pauses/resumes the search loop.
        // (Guarded so the restore path — which runs after the service is already idle — can't recurse.)
        if (this.autoExploreService?.isRunning()) {
            if (this.isGloballyPaused) this.autoExploreService.pause();
            else this.autoExploreService.resume();
        }
    }

    // --- Auto-explore support (Phase 4) -------------------------------------
    // The AutoExploreService owns the search loop but mutates worlds through these helpers so the
    // proxy/persistence dance stays in WorldManager. They deliberately avoid spamming localStorage
    // and ruleset history during the search; the snapshot/restore pair brackets a whole session.

    /** Snapshot the pre-explore worlds (rulesets, initial states, enabled flags) + pause state. */
    _captureAutoExploreSnapshot = () => ({
        isGloballyPaused: this.isGloballyPaused,
        worlds: this.worldSettings.map(ws => ({
            rulesetHex: ws.rulesetHex,
            initialState: structuredClone(ws.initialState),
            enabled: ws.enabled,
        })),
    });

    /** Enable (or disable) every world for a full-grid search, without starting normal ticking. */
    _setAllWorldsEnabledForExplore = (enabled) => {
        this.worlds.forEach((proxy, idx) => {
            if (this.worldSettings[idx]) this.worldSettings[idx].enabled = enabled;
            proxy.setEnabled(enabled);
        });
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    };

    /**
     * Apply a candidate ruleset to a world during exploration. Lightweight: uploads to the worker and
     * keeps `worldSettings.rulesetHex` in sync (so the worker's STATS echo doesn't re-trigger a
     * persist), but pushes no history and writes no localStorage — the session is bracketed by
     * snapshot/restore. Dispatches RULESET_CHANGED for the selected world so the UI tracks the champion.
     */
    _applyExploreRuleset = (worldIndex, hex) => {
        const proxy = this.worlds[worldIndex];
        const settings = this.worldSettings[worldIndex];
        if (!proxy || !settings || hex === "Error") return;
        proxy.setRuleset(hexToRuleset(hex).buffer.slice(0));
        settings.rulesetHex = hex;
        if (worldIndex === this.selectedWorldIndex) EventBus.dispatch(EVENTS.RULESET_CHANGED, hex);
    };

    /**
     * Restore the worlds captured by {@link _captureAutoExploreSnapshot}. Re-applies each world's
     * ruleset (without history), initial state and enabled flag, resets the grids, and restores the
     * pre-explore pause state.
     * @param {object} snapshot
     * @param {{adoptChampionHex?: string|null}} [opts] - When `adoptChampionHex` is set, the selected
     *   world keeps that ruleset (user adopted the find) instead of its pre-explore one.
     */
    _restoreAutoExploreSnapshot = (snapshot, opts = {}) => {
        if (!snapshot) return;
        const adoptHex = opts.adoptChampionHex || null;
        const baseSeed = Date.now();
        snapshot.worlds.forEach((snap, idx) => {
            const settings = this.worldSettings[idx];
            const proxy = this.worlds[idx];
            if (!settings || !proxy) return;
            const restoreHex = (adoptHex && idx === this.selectedWorldIndex) ? adoptHex : snap.rulesetHex;
            settings.initialState = structuredClone(snap.initialState);
            settings.enabled = snap.enabled;
            proxy.setEnabled(snap.enabled);
            this._commitRuleset(idx, restoreHex, {
                addToHistory: false,
                reset: true,
                seed: this._getResetSeed(baseSeed, idx),
            });
        });
        // Restore the pre-explore pause state (starts/stops enabled worlds as appropriate).
        this.setGlobalPause(snapshot.isGloballyPaused);
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        // NB: do NOT call dispatchSelectedWorldUpdates here — it reconciles worldSettings from the
        // proxy's *cached* stats, which still hold the champion hex (the worker hasn't echoed the
        // just-pushed restored ruleset yet) and would clobber the restore. Dispatch the restored
        // truth directly instead; the worker's RESET_WORLD stats echo then re-syncs the proxy cache.
        const selIdx = this.selectedWorldIndex;
        const selHex = this.worldSettings[selIdx]?.rulesetHex;
        if (selHex) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, selHex);
            PersistenceService.saveRuleset(selHex);
            const selStats = this.worlds[selIdx]?.getLatestStats();
            if (selStats) {
                EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, { ...selStats, rulesetHex: selHex, worldIndex: selIdx });
            }
        }
    };

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

    // Called by the renderer once a world's FBO has been redrawn, so the next
    // frame can skip the redraw until something visual changes again.
    clearWorldRenderDirty = (worldIndex) => {
        this.worlds[worldIndex]?.clearRenderDirty();
    }

    // Force every world's FBO to be redrawn on the next frame (e.g. after a color
    // LUT change that alters appearance without producing a STATE_UPDATE).
    markAllWorldsRenderDirty = () => {
        this.worlds.forEach(proxy => proxy?.markRenderDirty());
    }


    getSelectedWorldIndex = () => this.selectedWorldIndex;

    // Returns the selected world's live per-cell binary state buffer (Uint8Array of
    // NUM_CELLS, 0/1), or null if not yet available. Used by pattern capture to read
    // which cells are active within a selected region — same view the renderer reads.
    getSelectedWorldStateArray = () => this.worlds[this.selectedWorldIndex]?.latestStateArray || null;

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
        initialState: ws.initialState,
        enabled: ws.enabled,
        rulesetHex: ws.rulesetHex
    }));

    getSymmetryData = () => this.symmetryData;

    // Parse the current ruleset hex into its 128-entry array, memoizing on the hex string. This is
    // called in tight loops (editor grids iterate every center-state × neighbor-count combination),
    // and re-parsing the same hex each call was pure waste.
    _getParsedCurrentRuleset = () => {
        const currentHex = this.getCurrentRulesetHex();
        if (currentHex === "N/A" || currentHex === "Error") return null;
        if (this._parsedRulesetCache && this._parsedRulesetCache.hex === currentHex) {
            return this._parsedRulesetCache.ruleset;
        }
        const ruleset = hexToRuleset(currentHex);
        if (!ruleset || ruleset.length !== 128) return null;
        this._parsedRulesetCache = { hex: currentHex, ruleset };
        return ruleset;
    }

    getEffectiveRuleForNeighborCount = (centerState, numActiveNeighbors) =>
        RulesetService.getEffectiveRuleForNeighborCount(this._getParsedCurrentRuleset(), centerState, numActiveNeighbors);

    getCanonicalRuleDetails = () =>
        this.rulesetService.getCanonicalRuleDetails(this._getParsedCurrentRuleset());

    _generateRandomRulesetHex = (bias, generationMode) =>
        this.rulesetService.generateRandomRulesetHex(bias, generationMode);

    saveSelectedWorldState = () => {
        const proxy = this.worlds[this.selectedWorldIndex];
        if (!proxy) return;

        const stateArray = proxy.latestStateArray || new Uint8Array(0);
        const rulesetHex = this.getCurrentRulesetHex();
        const stats = proxy.getLatestStats();

        const data = {
            rows: Config.GRID_ROWS,
            cols: Config.GRID_COLS,
            rulesetHex: rulesetHex,
            // v2 format: per-cell bytes base64-encoded (~4× smaller than a JSON number
            // array). loadWorldState still reads the legacy `state: number[]` field.
            format: 'b64',
            stateB64: cellsToBase64(stateArray),
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
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Grid dimensions in file do not match current configuration.", type: 'error' });
            return;
        }
        const proxy = this.worlds[worldIndex];
        const newRulesetArray = hexToRuleset(loadedData.rulesetHex);
        // Accept both the v2 base64 byte format and the legacy JSON number-array format.
        let newStateArray;
        if (typeof loadedData.stateB64 === 'string') {
            newStateArray = base64ToCells(loadedData.stateB64, Config.NUM_CELLS);
        } else if (Array.isArray(loadedData.state)) {
            newStateArray = Uint8Array.from(loadedData.state);
        } else {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Save file is missing world state data.", type: 'error' });
            return;
        }
        if (newStateArray.length !== Config.NUM_CELLS) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "State data length in file does not match current configuration.", type: 'error' });
            return;
        }

        if (this.worldSettings[worldIndex]) {
            // The ruleset reaches the worker via the LOAD_STATE command below, not setRuleset.
            this._commitRuleset(worldIndex, loadedData.rulesetHex, { uploadToWorker: false });
            const newDensity = newStateArray.reduce((sum, val) => sum + val, 0) / (newStateArray.length || 1);
            this.worldSettings[worldIndex].initialState = {
                mode: 'density',
                params: { density: newDensity }
            };
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
                proxy.setSpeed(this.simulationController.getSpeed());
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
        this._commitRuleset(worldIndex, targetRuleset, { addToHistory: false });

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
        this._commitRuleset(worldIndex, previousRuleset, { addToHistory: false });

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
        // History already advanced above; just upload + sync the cached hex.
        this._commitRuleset(worldIndex, nextRuleset, { addToHistory: false });

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

    generateShareUrl() {
        return ShareCodec.encode({
            worldSettings: this.getWorldSettingsForUI(),
            selectedWorldIndex: this.getSelectedWorldIndex(),
            camera: this.getCurrentCameraState(),
            gridRows: Config.GRID_ROWS,
            origin: window.location.origin,
            pathname: window.location.pathname,
        });
    }

    _invertSelectedRuleset = () => {
        const selectedIndex = this.selectedWorldIndex;
        const currentHex = this.worldSettings[selectedIndex]?.rulesetHex;

        if (!currentHex || currentHex === "Error" || currentHex === "N/A") {
            console.error("Cannot invert ruleset: No valid ruleset on selected world.");
            return;
        }

        const invertedHex = RulesetService.invertHex(currentHex);
        this.#applyRulesetToWorlds(invertedHex, 'selected', false);
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