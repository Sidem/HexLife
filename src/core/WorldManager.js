import * as Config from './config.js';
import { WorldProxy } from './WorldProxy.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Symmetry from './Symmetry.js';
import { RulesetService } from './RulesetService.js';
import { AutoExploreService, EXPLORE_CONFIG } from './AutoExploreService.js';
import { EmbeddingService } from '../services/EmbeddingService.js';
import { scoreSingleIC } from './analysis/InterestingnessScore.js';
import { ShareCodec } from '../services/ShareCodec.js';
import * as Renderer from '../rendering/renderer.js';
import { rulesetToHex, hexToRuleset, findHexagonsInNeighborhood, cellsToBase64, base64ToCells, rulesetName } from '../utils/utils.js';

export class WorldManager {
    constructor(sharedSettings = {}) {
        this.worlds = [];
        this.cameraStates = [];
        this.sharedSettings = sharedSettings;
        this.simulationController = null;
        this.brushController = null;
        this.selectedWorldIndex = sharedSettings.selectedWorldIndex ?? Config.DEFAULT_SELECTED_WORLD_INDEX;
        this.isGloballyPaused = true;
        // State-history scrub-back: the user's current view position on the selected world's recorded
        // history (offset ticks back from the live tip; 0 = present) and whether they're parked there.
        this.scrubOffset = 0;
        this.isScrubbing = false;
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
        // Optional foundation-model embedding provider for the perceptual auto-explore objective (v3.0,
        // ASAL). Default off (persisted setting); lazily loads a CLIP image encoder in its own worker
        // only when enabled, and degrades to the statistical objective on any failure.
        this.embeddingService = new EmbeddingService({
            enabled: PersistenceService.loadUISetting('embeddingEnabled', false),
        });
        // If the user previously opted in, warm the (browser-cached) model now so the panel shows a
        // truthful ready/error status instead of a stuck "will load on demand"; fire-and-forget and
        // self-degrading. Default-off users never spawn the worker.
        if (this.embeddingService.isEnabled()) this.embeddingService.ensureReady();
        // Auto-explore (Phase 4): generation loop + session gallery. Constructed after worlds exist;
        // it only references the proxies/ruleset service lazily once started. The thumbnail provider
        // (v2.6, F6) waits a couple of rAFs for the renderer to draw the world's final eval frame,
        // then grabs a small JPEG data URL — DI so the service stays renderer-free. The frame provider
        // (v3.0) likewise grabs raw ImageData for the embedder; both are renderer-free DI.
        this.autoExploreService = new AutoExploreService(this, {
            thumbnailProvider: (worldIndex) => this._captureExploreThumbnail(worldIndex),
            embeddingProvider: this.embeddingService,
            frameProvider: (worldIndex) => this._captureExploreFrame(worldIndex),
        });
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
                    locked: false,
                    isParent: false,
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
                setting.locked = !!setting.locked;
                setting.isParent = !!setting.isParent;
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
                locked: false,
                isParent: false,
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
            // Record scrub-back history on the selected world only (bounded memory).
            this.worlds[worldIndex]?.setHistoryCapture(true);
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
        EventBus.subscribe(EVENTS.COMMAND_PAUSE_AUTO_EXPLORE, () => this.autoExploreService.pause());
        EventBus.subscribe(EVENTS.COMMAND_RESUME_AUTO_EXPLORE, () => this.autoExploreService.resume());
        EventBus.subscribe(EVENTS.COMMAND_CLEAR_AUTO_EXPLORE_GALLERY, () => this.autoExploreService.clearGallery());
        EventBus.subscribe(EVENTS.COMMAND_APPLY_EXPLORE_FIND, (data) => this.applyExploreFind(data?.find));
        EventBus.subscribe(EVENTS.COMMAND_RETEST_EXPLORE_FIND, (data) => this.autoExploreService.retestFind(data?.find));
        // Perceptual objective toggle (v3.0): persist the choice and load/unload the embedding model.
        EventBus.subscribe(EVENTS.COMMAND_SET_EMBEDDING_ENABLED, (data) => {
            const enabled = !!(data && data.enabled);
            PersistenceService.saveUISetting('embeddingEnabled', enabled);
            this.embeddingService.setEnabled(enabled);
        });
    }

    /**
     * Apply a gallery find to the selected world so the user can study the discovered behavior:
     * set the world's ruleset (pushed to history — this is a deliberate adopt, unlike the search's
     * throwaway candidates) and reset with the find's winning initial condition + deterministic seed,
     * exactly reproducing the IC the score was won on. Stops any in-flight explore loop first.
     * @param {import('./analysis/BehaviorArchive.js').ArchiveEntry} find
     */
    applyExploreFind = (find) => {
        if (!find || !find.hex || find.hex === 'Error') return;
        if (this.autoExploreService?.isRunning()) this.autoExploreService.stop();

        const idx = this.selectedWorldIndex;
        const settings = this.worldSettings[idx];
        const proxy = this.worlds[idx];
        if (!settings || !proxy) return;

        if (find.initialState) settings.initialState = structuredClone(find.initialState);
        this._commitRuleset(idx, find.hex, {
            addToHistory: true,
            reset: true,
            seed: find.seed,
        });
        PersistenceService.saveRuleset(find.hex);
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.RULESET_CHANGED, find.hex);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Applied "${find.mnemonic || rulesetName(find.hex)}" (${find.icLabel || 'IC'}).`, type: 'success' });
    };

    #setupSimulationControlHandlers() {
        EventBus.subscribe(EVENTS.SIMULATION_PAUSED, this.setGlobalPause);
        EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, (speed) => this.setGlobalSpeed(speed));
        EventBus.subscribe(EVENTS.COMMAND_SELECT_WORLD, (newIndex) => {
            const prevIndex = this.selectedWorldIndex;
            if (newIndex !== prevIndex) {
                // Hand scrub-back capture from the old selected world to the new one (one world records
                // at a time → bounded memory). Leaving the old world's scrub state intact would strand
                // it parked on a past frame, so resume it before clearing its capture.
                if (this.isScrubbing) this.worlds[prevIndex]?.resumeHistory();
                this.worlds[prevIndex]?.setHistoryCapture(false);
                this.worlds[newIndex]?.setHistoryCapture(true);
                this.isScrubbing = false;
                this.scrubOffset = 0;
            }
            this.selectedWorldIndex = newIndex;
            this.dispatchSelectedWorldUpdates();
            EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, newIndex);
            this._dispatchScrubState();
        });
        EventBus.subscribe(EVENTS.COMMAND_SCRUB_HISTORY, (data) => this.scrubSelectedHistory(data?.offset ?? 0));
        EventBus.subscribe(EVENTS.COMMAND_STATE_STEP, (data) => this.stepSelectedHistory(data?.delta ?? 0));
        EventBus.subscribe(EVENTS.COMMAND_EXIT_SCRUB, () => this.exitScrub());
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
            this.#applyRulesetToWorlds(newRulesetHex, data.applyScope, data.shouldReset, true);
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
            this._breedFromGenepool(data?.mode, data?.postMutationRate);
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
            this._guardDestructive({
                title: 'Reset all 9 worlds?',
                message: 'Re-seed every world with fresh random cells at its starting density. This affects all nine worlds and cannot be undone.',
                confirmLabel: 'Reset all',
                run: () => this._resetAllWorldsToInitialDensities(),
            });
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
            // Only the all-worlds clear is unrecoverable; a single world keeps scrub-back,
            // so it bypasses the confirmation gate.
            if (data?.scope === 'all') {
                this._guardDestructive({
                    title: 'Clear all 9 worlds?',
                    message: 'Empty every cell to the inactive state across all nine worlds. This cannot be undone.',
                    confirmLabel: 'Clear all',
                    run: () => this._clearWorlds(data),
                });
            } else {
                this._clearWorlds(data);
            }
        });
        EventBus.subscribe(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE, this.saveSelectedWorldState);
        EventBus.subscribe(EVENTS.COMMAND_LOAD_WORLD_STATE, (data) => this.loadWorldState(data.worldIndex, data.loadedData));
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_WORLD_LOCK, () => this.toggleSelectedWorldLock());
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_WORLD_PARENT, (data) => this.toggleWorldParent(data?.worldIndex));
        EventBus.subscribe(EVENTS.COMMAND_COPY_WORLD_STATE, (data) => this.copyWorldState(this.selectedWorldIndex, data.targetWorldIndex));
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
        EventBus.subscribe(EVENTS.COMMAND_SHIFT_WORLD, (data) => {
            const idx = (data && typeof data.worldIndex === 'number') ? data.worldIndex : this.selectedWorldIndex;
            this.worlds[idx]?.shiftState(data.dCol | 0, data.dRow | 0);
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

    /** True when a world's ruleset is locked against evolutionary/automatic rewrites (Generate,
     *  Mutate, Clone, Clone & Mutate, Breed). Deliberate sets/edits ignore this. */
    _isLocked = (idx) => !!this.worldSettings[idx]?.locked;

    /** True when a world is flagged as a breeding parent (a member of the genepool). */
    _isParent = (idx) => !!this.worldSettings[idx]?.isParent;

    /** Enabled worlds currently flagged as breeding parents (the genepool). */
    _getParentIndices = () =>
        this.worldSettings.reduce((acc, ws, idx) => {
            if (ws?.isParent && ws?.enabled) acc.push(idx);
            return acc;
        }, []);

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
     * Run a destructive all-worlds action, optionally behind a confirmation dialog. The
     * "confirm destructive actions" preference (default on) is read live; when off, the
     * action runs immediately. Routing through the EventBus keeps WorldManager UI-agnostic
     * and gates every dispatch source (toolbar popout, FABs, keyboard, command palette) at
     * once. The confirmation is requested via COMMAND_SHOW_CONFIRMATION; `run` performs the
     * work directly on confirm (no command re-dispatch, so no loop).
     * @param {{title:string, message:string, confirmLabel:string, run:()=>void}} opts
     */
    _guardDestructive({ title, message, confirmLabel, run }) {
        if (PersistenceService.loadUISetting('confirmDestructiveActions', true)) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, { title, message, confirmLabel, onConfirm: run });
        } else {
            run();
        }
    }

    /** Re-seed all worlds with fresh random cells at their configured densities. */
    _resetAllWorldsToInitialDensities() {
        const baseSeed = Date.now();
        this.worlds.forEach((proxy, idx) => {
            if (this.worldSettings[idx]) {
                proxy.resetWorld(this.worldSettings[idx].initialState, this._getResetSeed(baseSeed, idx));
                if (!this.isGloballyPaused && this.worldSettings[idx].enabled) proxy.startSimulation();
            }
        });
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    }

    /** Empty cells to the inactive state across the scope's worlds (clear, not reset). */
    _clearWorlds(data) {
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

    #applyRulesetToWorlds = (rulesetHex, scope, shouldReset, respectLocks = false) => {
        const newRulesetArray = hexToRuleset(rulesetHex);
        if (rulesetHex === "Error" || newRulesetArray.length !== 128) {
            console.error("Cannot apply invalid ruleset hex:", rulesetHex);
            return;
        }

        let indicesToAffect = this._getAffectedWorldIndices(scope);
        if (respectLocks) indicesToAffect = indicesToAffect.filter(idx => !this._isLocked(idx));
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
            if (this._isLocked(idx)) return;
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
            // A locked world keeps its ruleset (and grid) untouched by clone & mutate.
            if (!isSelected && this._isLocked(idx)) return;
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
     * Breed from the genepool: every enabled world flagged as a parent (`isParent`) is a source; each
     * remaining enabled, non-parent, non-locked world receives a fresh `crossoverPoolHexes(...)` child
     * recombined from the pool. Parents keep their rulesets. Offspring are reset+restarted so the
     * recombination is visible immediately.
     * - 0 parents → no-op (with guidance toast).
     * - 1 parent  → each offspring is that parent's ruleset + post-mutation (i.e. clone-and-mutate).
     * - ≥2        → multi-parent recombination (2 parents is identical to the old A×B breed).
     * @param {'uniform'|'r_sym'|'n_count'} [mode='r_sym']
     * @param {number} [postMutationRate=0]
     */
    _breedFromGenepool = (mode = 'r_sym', postMutationRate = 0) => {
        const parentIndices = this._getParentIndices();
        if (parentIndices.length === 0) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Flag at least one world as a parent first (press B).", type: 'error' });
            return;
        }

        const parentHexes = parentIndices
            .map(idx => this._getRulesetHexForWorld(idx))
            .filter(hex => hex && hex !== "N/A" && hex !== "Error");
        if (parentHexes.length === 0) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "Cannot breed: parent worlds have invalid rulesets.", type: 'error' });
            return;
        }

        // Offspring slots: enabled, not a parent, not locked.
        const offspringIndices = [];
        this.worldSettings.forEach((ws, idx) => {
            if (ws?.enabled && !this._isParent(idx) && !this._isLocked(idx)) offspringIndices.push(idx);
        });
        if (offspringIndices.length === 0) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: "No offspring worlds — leave an enabled, unlocked, non-parent world to breed into.", type: 'error' });
            return;
        }

        const baseSeed = Date.now();
        offspringIndices.forEach(idx => {
            const childHex = this.rulesetService.crossoverPoolHexes(parentHexes, mode, Math.random, postMutationRate);
            if (!childHex || childHex === "Error") return;
            this._commitRuleset(idx, childHex, {
                uploadToWorker: true,
                reset: true,
                seed: this._getResetSeed(baseSeed, idx),
            });
            if (!this.isGloballyPaused) this.worlds[idx]?.startSimulation();
        });

        // The selected world may be an offspring whose ruleset just changed; reconcile its UI unless
        // it is a parent (untouched).
        if (!this._isParent(this.selectedWorldIndex)) {
            this.dispatchSelectedWorldUpdates();
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: `Bred ${offspringIndices.length} offspring from ${parentHexes.length} parent${parentHexes.length === 1 ? '' : 's'}`
        });
    };

    /**
     * Toggle a world's breeding-parent flag (defaults to the selected world). A parent is a source
     * for the genepool breed and is never overwritten by it. Returns the new flag (for a toast).
     * @param {number} [worldIndex] - Defaults to the selected world.
     * @returns {boolean}
     */
    toggleWorldParent = (worldIndex = this.selectedWorldIndex) => {
        const settings = this.worldSettings[worldIndex];
        if (!settings) return false;
        settings.isParent = !settings.isParent;
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        return settings.isParent;
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
            // A locked world keeps its ruleset (and grid) untouched by clone.
            if (idx !== this.selectedWorldIndex && this._isLocked(idx)) return;
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

    // --- State-history scrub-back -------------------------------------------
    // Emit the selected world's current scrub availability/position so the transport bar can render.
    _dispatchScrubState = () => {
        const proxy = this.worlds[this.selectedWorldIndex];
        const length = proxy?.getLatestStats().historyLength ?? 0;
        EventBus.dispatch(EVENTS.STATE_HISTORY_CHANGED, {
            worldIndex: this.selectedWorldIndex,
            length,
            offset: this.scrubOffset,
            isScrubbing: this.isScrubbing,
        });
    }

    // Park the selected world on `offset` ticks back from its live tip. Pauses globally first (you
    // can't sensibly scrub a running grid), then drives the worker's destructive playback.
    scrubSelectedHistory = (offset) => {
        const idx = this.selectedWorldIndex;
        const proxy = this.worlds[idx];
        if (!proxy) return;
        const length = proxy.getLatestStats().historyLength ?? 0;
        if (length === 0) return;
        if (!this.isGloballyPaused) this.setGlobalPause(true);
        this.scrubOffset = Math.max(0, Math.min(length - 1, Math.round(offset) || 0));
        this.isScrubbing = true;
        proxy.scrubHistory(this.scrubOffset);
        this._dispatchScrubState();
    }

    // Step the scrub position by `delta` ticks (positive = back, negative = forward). Forward past the
    // live tip advances the simulation one tick instead (a genuine single-step-forward while paused).
    stepSelectedHistory = (delta) => {
        const idx = this.selectedWorldIndex;
        const proxy = this.worlds[idx];
        if (!proxy) return;
        if (!this.isGloballyPaused) this.setGlobalPause(true);
        const length = proxy.getLatestStats().historyLength ?? 0;
        const target = this.scrubOffset + (Math.round(delta) || 0);
        if (target < 0) {
            // Forward past the tip: advance the live sim. Drops scrub mode (the worker truncates).
            this.isScrubbing = false;
            this.scrubOffset = 0;
            proxy.stepHistoryLive();
        } else {
            if (length === 0) return;
            this.scrubOffset = Math.min(target, length - 1);
            this.isScrubbing = true;
            proxy.scrubHistory(this.scrubOffset);
        }
        this._dispatchScrubState();
    }

    // Leave scrub mode and return the selected world to its live tip (without resuming play).
    exitScrub = () => {
        if (!this.isScrubbing) return;
        this.worlds[this.selectedWorldIndex]?.resumeHistory();
        this.isScrubbing = false;
        this.scrubOffset = 0;
        this._dispatchScrubState();
    }

    setGlobalPause = (isPaused) => {
        // Resuming play from a scrubbed-back frame: leave scrub mode so ticking continues forward from
        // the viewed frame (the worker also self-heals on START_SIMULATION, but clear our state here).
        if (!isPaused && this.isScrubbing) {
            this.worlds[this.selectedWorldIndex]?.resumeHistory();
            this.isScrubbing = false;
            this.scrubOffset = 0;
            this._dispatchScrubState();
        }
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
     * Capture a small JPEG thumbnail of a world's current render for the explore gallery (v2.6, F6).
     * Waits up to two animation frames so the renderer has a chance to draw the world's final eval
     * frame (the worker posts a grid update before EVALUATION_RESULT) before reading its FBO. Resolves
     * to null on any failure so the search loop never throws on capture (it also time-boxes the call).
     * @param {number} worldIndex
     * @returns {Promise<string|null>}
     */
    _captureExploreThumbnail = (worldIndex) => new Promise((resolve) => {
        try {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        resolve(Renderer.captureWorldThumbnail(worldIndex));
                    } catch {
                        resolve(null);
                    }
                });
            });
        } catch {
            resolve(null);
        }
    });

    /**
     * Capture a world's current render as raw ImageData for the perceptual objective's embedding worker
     * (v3.0). Same two-rAF wait as the thumbnail capture (let the renderer draw the world's latest eval
     * frame before reading its FBO); resolves null on any failure so the search never throws on capture.
     * @param {number} worldIndex
     * @returns {Promise<ImageData|null>}
     */
    _captureExploreFrame = (worldIndex) => new Promise((resolve) => {
        try {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        resolve(Renderer.captureWorldImageData(worldIndex));
                    } catch {
                        resolve(null);
                    }
                });
            });
        } catch {
            resolve(null);
        }
    });

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
        locked: !!ws.locked,
        isParent: !!ws.isParent,
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

    /**
     * Run a one-off "interestingness" measurement on the selected world WITHOUT disturbing it, for the
     * Analysis panel's on-demand metrics. Snapshots the exact current cells + tick, runs one evaluation
     * burst (the SAME machinery Auto-Explore uses — `RUN_EVALUATION`), scores it with `scoreSingleIC`,
     * then restores the snapshot so the burst doesn't fast-forward the user's world. Compute-intensive
     * (especially the σ damage probe), hence on-demand rather than live.
     * @param {{ticks?: number, probe?: boolean}} [opts] - `ticks` burst length; `probe` enables the σ probe.
     * @returns {Promise<{score:number, components:object, killed:boolean, killReason:(string|null), tick:number}|null>}
     */
    measureSelectedWorld = async ({ ticks = EXPLORE_CONFIG.evalTicks, probe = true } = {}) => {
        if (this.autoExploreService?.isRunning()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Stop Auto-Explore before measuring a world.', type: 'error' });
            return null;
        }
        const idx = this.selectedWorldIndex;
        const proxy = this.worlds[idx];
        if (!proxy) return null;

        const hex = this.getCurrentRulesetHex();
        if (!hex || hex === 'Error' || hex === 'N/A') {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Selected world has no valid ruleset to measure.', type: 'error' });
            return null;
        }

        // Snapshot the exact pre-measure state (cells + tick) for a non-destructive restore.
        const savedCells = proxy.latestStateArray ? new Uint8Array(proxy.latestStateArray) : null;
        if (!savedCells || savedCells.length !== Config.NUM_CELLS) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'World state is not ready to measure yet.', type: 'error' });
            return null;
        }
        const savedTick = proxy.getLatestStats().tick || 0;
        const rulesetArray = this.getCurrentRulesetArray();

        try {
            const metrics = await proxy.runEvaluation({
                ticks,
                sampleEvery: EXPLORE_CONFIG.sampleEvery,
                warmupTicks: EXPLORE_CONFIG.warmupTicks,
                probe: { enabled: !!probe, probeTicks: EXPLORE_CONFIG.probeTicks },
            });
            const scored = scoreSingleIC({ ...metrics, icLabel: 'measure' });
            return {
                score: scored.score,
                components: scored.components,
                killed: scored.killed,
                killReason: scored.killReason,
                tick: savedTick,
            };
        } finally {
            // Restore the exact pre-measure cells/tick (LOAD_STATE rewrites the worker buffers).
            proxy.sendCommand('LOAD_STATE', {
                newStateBuffer: savedCells.buffer.slice(0),
                newRulesetBuffer: rulesetArray.buffer.slice(0),
                worldTick: savedTick,
            }, [savedCells.buffer.slice(0), rulesetArray.buffer.slice(0)]);
        }
    }

    /**
     * Bake an evolved-world thumbnail for a (ruleset × initial-condition × seed) combo WITHOUT
     * disturbing the user's view — the "borrow-and-restore" engine behind the Ruleset Library
     * previews. Borrows the selected world exactly like {@link measureSelectedWorld}: snapshot its
     * cells/tick/ruleset, apply the target ruleset, seed-reset to the target IC, run a burst, capture
     * the rendered frame (the SAME two-rAF FBO grab the auto-explore gallery uses), then restore the
     * snapshot via `LOAD_STATE`. Returns a JPEG data-URL, or `null` on any failure (capture
     * unavailable, Auto-Explore running, bad ruleset) so callers can fall back to the rule glyph.
     * @param {{hex: string, initialState: object, seed?: number|null, ticks?: number}} opts
     * @returns {Promise<string|null>}
     */
    bakeThumbnail = async ({ hex, initialState, seed = null, ticks = EXPLORE_CONFIG.evalTicks } = {}) => {
        if (this.autoExploreService?.isRunning()) return null;
        if (!hex || hex === 'Error' || hex === 'N/A' || !initialState) return null;

        const idx = this.selectedWorldIndex;
        const proxy = this.worlds[idx];
        if (!proxy) return null;

        // Snapshot the exact pre-bake state (cells + tick + ruleset) for a non-destructive restore.
        const savedCells = proxy.latestStateArray ? new Uint8Array(proxy.latestStateArray) : null;
        if (!savedCells || savedCells.length !== Config.NUM_CELLS) return null;
        const savedTick = proxy.getLatestStats().tick || 0;
        const savedRulesetArray = this.getCurrentRulesetArray();

        let rulesetArray;
        try {
            rulesetArray = hexToRuleset(hex);
        } catch {
            return null;
        }

        try {
            // Apply the target ruleset, seed-reset to the target IC, then evolve a burst — mirroring
            // AutoExploreService._evaluateCandidate (setRuleset → resetWorld → runEvaluation).
            proxy.setRuleset(rulesetArray.buffer.slice(0));
            // A finite seed reproduces the exact paired layout; a falsy seed lets the worker pick a
            // fresh random one (RESET_WORLD treats a falsy seed as Math.random).
            proxy.resetWorld(initialState, Number.isFinite(seed) ? seed : 0);
            await proxy.runEvaluation({
                ticks,
                sampleEvery: EXPLORE_CONFIG.sampleEvery,
                warmupTicks: EXPLORE_CONFIG.warmupTicks,
                probe: { enabled: false, probeTicks: EXPLORE_CONFIG.probeTicks },
            });
            return await this._captureExploreThumbnail(idx);
        } catch {
            return null;
        } finally {
            // Restore the exact pre-bake cells/tick/ruleset (LOAD_STATE rewrites the worker buffers).
            proxy.sendCommand('LOAD_STATE', {
                newStateBuffer: savedCells.buffer.slice(0),
                newRulesetBuffer: savedRulesetArray.buffer.slice(0),
                worldTick: savedTick,
            }, [savedCells.buffer.slice(0), savedRulesetArray.buffer.slice(0)]);
        }
    };

    /**
     * Bake thumbnails for a list of (hex, initialState, seed) jobs one at a time (sequential so the
     * single borrowed world is never contended). Each job's `onResult(dataUrl)` callback fires as its
     * bake resolves. Returns the array of data-URLs (null entries for failures). Used by the Library's
     * save-time multi-IC chooser and its lazy backfill of entries that lack a thumbnail.
     * @param {Array<{hex: string, initialState: object, seed?: number|null, ticks?: number,
     *   onResult?: (thumb: string|null) => void}>} jobs
     * @returns {Promise<Array<string|null>>}
     */
    bakeThumbnails = async (jobs = []) => {
        const out = [];
        for (const job of jobs) {
            if (this.autoExploreService?.isRunning()) { out.push(null); continue; }
            const thumb = await this.bakeThumbnail(job);
            out.push(thumb);
            try { job.onResult?.(thumb); } catch { /* callback errors must not abort the queue */ }
        }
        return out;
    };

    /**
     * Lazily fill in missing thumbnails for library entries that carry an initial condition but have no
     * `thumb` yet, invoking `onBaked(entry, thumb)` so the caller persists each its own way (personal
     * entries write to the user library; public entries write to the public-thumb cache). One bake at a
     * time, capped per call so opening the library never stalls; abortable via the returned handle.
     * Skips entirely while Auto-Explore is running.
     * @param {Array<{hex: string, initialState: object, seed?: number|null, thumb?: string|null}>} entries
     * @param {{onBaked: (entry: object, thumb: string) => void, max?: number}} ctx
     * @returns {{cancel: () => void}}
     */
    backfillMissingThumbnails = (entries, { onBaked, max = 8 } = {}) => {
        let cancelled = false;
        const pending = (entries || [])
            .filter(e => e && e.hex && e.initialState && !e.thumb)
            .slice(0, max);

        (async () => {
            for (const entry of pending) {
                if (cancelled || this.autoExploreService?.isRunning()) return;
                const thumb = await this.bakeThumbnail({ hex: entry.hex, initialState: entry.initialState, seed: entry.seed });
                if (cancelled) return;
                if (thumb) onBaked?.(entry, thumb);
            }
        })();

        return { cancel: () => { cancelled = true; } };
    };

    /**
     * Toggle the selected world's ruleset lock. A locked world keeps its ruleset through the
     * evolutionary/automatic paths (Generate, Mutate, Clone, Clone & Mutate, Breed); deliberate
     * sets/edits still apply. Returns the new locked state (for the caller's toast).
     * @returns {boolean}
     */
    toggleSelectedWorldLock = () => {
        const idx = this.selectedWorldIndex;
        const settings = this.worldSettings[idx];
        if (!settings) return false;
        settings.locked = !settings.locked;
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        return settings.locked;
    };

    /**
     * Copy a world's current cell state (NOT its ruleset) onto another world; the target keeps
     * its own ruleset. The copied state is stamped at tick 0 (a fresh paste, not a continuation).
     * @param {number} sourceIndex
     * @param {number} targetIndex
     */
    copyWorldState = (sourceIndex, targetIndex) => {
        if (sourceIndex === targetIndex) return;
        const source = this.worlds[sourceIndex];
        const target = this.worlds[targetIndex];
        if (!source || !target) return;

        const stateArray = source.latestStateArray;
        if (!stateArray || stateArray.length !== Config.NUM_CELLS) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Source world state is not ready yet.', type: 'error' });
            return;
        }

        const targetRulesetHex = this._getRulesetHexForWorld(targetIndex);
        const targetRulesetArray = hexToRuleset(targetRulesetHex);
        const stateCopy = new Uint8Array(stateArray);

        target.sendCommand('LOAD_STATE', {
            newStateBuffer: stateCopy.buffer.slice(0),
            newRulesetBuffer: targetRulesetArray.buffer.slice(0),
            worldTick: 0,
        }, [stateCopy.buffer.slice(0), targetRulesetArray.buffer.slice(0)]);

        target.setEnabled(true);
        if (this.worldSettings[targetIndex]) this.worldSettings[targetIndex].enabled = true;
        if (!this.isGloballyPaused) {
            target.startSimulation();
            target.setSpeed(this.simulationController.getSpeed());
        }

        PersistenceService.saveWorldSettings(this.worldSettings);
        if (targetIndex === this.selectedWorldIndex) this.dispatchSelectedWorldUpdates();
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Copied world ${sourceIndex + 1} state → world ${targetIndex + 1}` });
    };

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

    generateShareUrl({ includeWorldState = false } = {}) {
        return ShareCodec.encode({
            worldSettings: this.getWorldSettingsForUI(),
            selectedWorldIndex: this.getSelectedWorldIndex(),
            camera: this.getCurrentCameraState(),
            gridRows: Config.GRID_ROWS,
            origin: window.location.origin,
            pathname: window.location.pathname,
            includeWorldState,
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