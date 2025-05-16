// src/core/WorldManager.js
import * as Config from './config.js';
import { WorldProxy } from './WorldProxy.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Symmetry from './Symmetry.js'; // For ruleset generation

export class WorldManager {
    constructor() {
        this.worlds = []; // Array of WorldProxy instances
        this.selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;
        this.isGloballyPaused = true; // Master pause state
        this.currentGlobalSpeed = PersistenceService.loadSimSpeed() || Config.DEFAULT_SPEED;
        this.currentBrushSize = PersistenceService.loadBrushSize() || Config.DEFAULT_NEIGHBORHOOD_SIZE;
        
        // Initialize properties that might be accessed by methods converted to arrow functions
        this.symmetryData = Symmetry.precomputeSymmetryGroups();
        this.worldSettings = PersistenceService.loadWorldSettings(); // Array of {initialDensity, enabled, rulesetHex}
        this.initialDefaultRulesetHex = PersistenceService.loadRuleset() || this._generateRandomRulesetHex(0.5, 'r_sym');

        this._initWorlds();
        this._setupEventListeners();
    }

    _initWorlds = () => { // Converted to arrow function for consistency, though not strictly necessary if only called internally
        const worldManagerCallbacks = {
            onUpdate: (worldIndex, updateType) => this._handleProxyUpdate(worldIndex, updateType),
            onInitialized: (worldIndex) => this._handleProxyInitialized(worldIndex)
        };

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = this.worldSettings[i] || {
                initialDensity: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0.5,
                enabled: Config.DEFAULT_WORLD_ENABLED_STATES[i] ?? true,
                rulesetHex: this.initialDefaultRulesetHex
            };

            const rulesetArray = this.hexToRuleset(settings.rulesetHex);

            const proxy = new WorldProxy(i, {
                config: { GRID_ROWS: Config.GRID_ROWS, GRID_COLS: Config.GRID_COLS, NUM_CELLS: Config.NUM_CELLS },
                density: settings.initialDensity,
                enabled: settings.enabled,
                rulesetArray: rulesetArray,
                rulesetHex: settings.rulesetHex,
                speed: this.currentGlobalSpeed
            }, worldManagerCallbacks);
            this.worlds.push(proxy);
        }
    }

    _handleProxyInitialized = (worldIndex) => {
        console.log(`World ${worldIndex} worker initialized and sent initial state.`);
        if (worldIndex === this.selectedWorldIndex) {
            this.dispatchSelectedWorldUpdates();
        }
        if (!this.isGloballyPaused && this.worlds[worldIndex]?.getLatestStats().isEnabled) {
            this.worlds[worldIndex].startSimulation();
            this.worlds[worldIndex].setSpeed(this.currentGlobalSpeed);
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

    _setupEventListeners = () => { // Converted for consistency
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PAUSE, () => this.setGlobalPause(!this.isGloballyPaused));
        EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, (speed) => this.setGlobalSpeed(speed));
        EventBus.subscribe(EVENTS.COMMAND_SET_BRUSH_SIZE, (size) => this.currentBrushSize = size);

        EventBus.subscribe(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, (data) => {
            const newRulesetHex = this._generateRandomRulesetHex(data.bias, data.generationMode);
            this._applyRulesetToWorlds(newRulesetHex, data.resetScopeForThisChange, true, data.resetScopeForThisChange);
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_RULESET, (data) => {
            this._applyRulesetToWorlds(data.hexString, data.resetScopeForThisChange, true, data.resetScopeForThisChange);
        });

        EventBus.subscribe(EVENTS.COMMAND_EDITOR_TOGGLE_RULE_OUTPUT, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = this.hexToRuleset(currentRulesetHex);
                if (data.ruleIndex >= 0 && data.ruleIndex < 128) {
                    rules[data.ruleIndex] = 1 - rules[data.ruleIndex];
                }
                return this.rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
         EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_ALL_RULES_STATE, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = this.hexToRuleset(currentRulesetHex);
                rules.fill(data.targetState);
                return this.rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
        EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_NEIGHBOR_COUNT, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = this.hexToRuleset(currentRulesetHex);
                for (let mask = 0; mask < 64; mask++) {
                    if (Symmetry.countSetBits(mask) === data.numActive) {
                        const idx = (data.centerState << 6) | mask;
                        rules[idx] = data.outputState;
                    }
                }
                return this.rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
        EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, (data) => {
            this._modifyRulesetForScope(data.modificationScope, (currentRulesetHex) => {
                const rules = this.hexToRuleset(currentRulesetHex);
                const group = this.symmetryData.canonicalRepresentatives.find(g => g.representative === data.canonicalBitmask);
                if (group) {
                    for (const member of group.members) {
                        const idx = (data.centerState << 6) | member;
                        rules[idx] = data.outputState;
                    }
                }
                return this.rulesetToHex(rules);
            }, data.conditionalResetScope);
        });
        EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULESET_HEX, (data) => {
             this._applyRulesetToWorlds(data.hexString, data.modificationScope, false, data.conditionalResetScope);
        });

        EventBus.subscribe(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, () => {
            this.worlds.forEach((proxy, idx) => {
                if (this.worldSettings[idx]) { // Check if settings exist
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
                     const newRulesetBuffer = this.hexToRuleset(primaryRulesetHex).buffer.slice(0);
                     this.worlds[idx].setRuleset(newRulesetBuffer);
                     this.worldSettings[idx].rulesetHex = primaryRulesetHex;
                }
                if (this.worldSettings[idx]) { // Check settings
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
                this.worlds[idx].resetWorld(0);
                if (this.worldSettings[idx] && !this.isGloballyPaused && this.worldSettings[idx].enabled) {
                     this.worlds[idx].startSimulation();
                }
            });
            if (data.scope === 'all') EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
            this.dispatchSelectedWorldUpdates();
        });

        EventBus.subscribe(EVENTS.COMMAND_APPLY_BRUSH, (data) => {
            this.worlds[data.worldIndex]?.applyBrush(data.col, data.row, this.currentBrushSize);
        });
        EventBus.subscribe(EVENTS.COMMAND_SET_HOVER_STATE, (data) => {
            const affectedIndices = this._findHexagonsInNeighborhood(data.col, data.row, this.currentBrushSize);
            this.worlds[data.worldIndex]?.setHoverState(affectedIndices);
        });
        EventBus.subscribe(EVENTS.COMMAND_CLEAR_HOVER_STATE, (data) => {
            this.worlds[data.worldIndex]?.clearHoverState();
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
                    this.worlds[data.worldIndex].setSpeed(this.currentGlobalSpeed);
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

        EventBus.subscribe(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE, this.saveSelectedWorldState); // Already arrow fn
        EventBus.subscribe(EVENTS.COMMAND_LOAD_WORLD_STATE, (data) => this.loadWorldState(data.worldIndex, data.loadedData)); // Already arrow fn

        EventBus.subscribe(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, (data) => {
            this.isEntropySamplingEnabled = data.enabled;
            this.entropySampleRate = data.rate;
            PersistenceService.saveUISetting('entropySamplingEnabled', data.enabled);
            PersistenceService.saveUISetting('entropySampleRate', data.rate);
        });
    }

    _getAffectedWorldIndices = (scope) => { // Converted
        if (scope === 'all') return this.worlds.map((_, i) => i);
        if (scope === 'selected') return [this.selectedWorldIndex];
        if (typeof scope === 'number' && scope >= 0 && scope < this.worlds.length) return [scope];
        console.warn("Invalid scope for _getAffectedWorldIndices:", scope);
        return [];
    }

    _applyRulesetToWorlds = (rulesetHex, targetScope, fromMainBarResetLogic, conditionalResetScopeIfEditor = 'none') => { // Converted
        const newRulesetArray = this.hexToRuleset(rulesetHex);
        if (rulesetHex === "Error" || newRulesetArray.length !== 128) {
            console.error("Cannot apply invalid ruleset hex:", rulesetHex);
            return;
        }
        const indices = this._getAffectedWorldIndices(targetScope);

        indices.forEach(idx => {
            const newRulesetBuffer = newRulesetArray.buffer.slice(0);
            this.worlds[idx].setRuleset(newRulesetBuffer);
            this.worldSettings[idx].rulesetHex = rulesetHex;

            const resetScopeForThisChange = fromMainBarResetLogic
                ? (PersistenceService.loadUISetting('resetOnNewRule', true) ? targetScope : 'none')
                : conditionalResetScopeIfEditor;

            if (resetScopeForThisChange !== 'none') {
                 const resetTargetIndices = this._getAffectedWorldIndices(resetScopeForThisChange);
                 if (resetTargetIndices.includes(idx) && this.worldSettings[idx]) { // Check settings
                    this.worlds[idx].resetWorld(this.worldSettings[idx].initialDensity);
                 }
            }
        });

        if (indices.includes(this.selectedWorldIndex)) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, rulesetHex);
            PersistenceService.saveRuleset(rulesetHex);
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    _modifyRulesetForScope = (scope, modifierFunc, conditionalResetScope) => { // Converted
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
                const newRulesetArray = this.hexToRuleset(newHex);
                const newRulesetBuffer = newRulesetArray.buffer.slice(0);
                this.worlds[idx].setRuleset(newRulesetBuffer);
                this.worldSettings[idx].rulesetHex = newHex;

                if (conditionalResetScope !== 'none') {
                    const resetTargetIndices = this._getAffectedWorldIndices(conditionalResetScope);
                    if (resetTargetIndices.includes(idx) && this.worldSettings[idx]) { // Check settings
                        this.worlds[idx].resetWorld(this.worldSettings[idx].initialDensity);
                    }
                }
            }
        });

        if (indices.includes(this.selectedWorldIndex)) {
            this.dispatchSelectedWorldUpdates();
            if (this.worldSettings[this.selectedWorldIndex]) { // Check settings
                 PersistenceService.saveRuleset(this.worldSettings[this.selectedWorldIndex].rulesetHex);
            }
        }
        PersistenceService.saveWorldSettings(this.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
    }

    setGlobalPause = (paused) => { // Converted
        this.isGloballyPaused = paused;
        this.worlds.forEach(proxy => {
            if (this.isGloballyPaused || !proxy.getLatestStats().isEnabled) {
                proxy.stopSimulation();
            } else {
                proxy.startSimulation();
                proxy.setSpeed(this.currentGlobalSpeed);
            }
        });
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.isGloballyPaused);
    }

    setGlobalSpeed = (speed) => { // Converted
        this.currentGlobalSpeed = Math.max(1, Math.min(Config.MAX_SIM_SPEED, speed));
        this.worlds.forEach(proxy => proxy.setSpeed(this.currentGlobalSpeed));
        PersistenceService.saveSimSpeed(this.currentGlobalSpeed);
        EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED, this.currentGlobalSpeed);
    }

    getWorldsRenderData = () => { // Converted
        return this.worlds.map(proxy => proxy.getLatestRenderData());
    }

    // --- Interface methods for UI (mostly getters, arrow functions ensure `this` context) ---
    isSimulationPaused = () => this.isGloballyPaused;
    getCurrentSimulationSpeed = () => this.currentGlobalSpeed;
    getCurrentBrushSize = () => this.currentBrushSize;
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
    getCurrentRulesetArray = () => this.hexToRuleset(this.getCurrentRulesetHex());

    getSelectedWorldStats = () => {
        const proxy = this.worlds[this.selectedWorldIndex];
        return proxy ? proxy.getLatestStats() : { tick: 0, ratio: 0, entropy: 0, isEnabled: false, rulesetHex: "0".repeat(32), tps: 0 };
    }
    getWorldSettingsForUI = () => this.worldSettings.map(ws => ({
        initialDensity: ws.initialDensity,
        enabled: ws.enabled,
        rulesetHex: ws.rulesetHex
    }));

    getSymmetryData = () => this.symmetryData;

    getEffectiveRuleForNeighborCount = (centerState, numActiveNeighbors) => { // Converted
        const currentHex = this.getCurrentRulesetHex();
        if (currentHex === "N/A" || currentHex === "Error") return 2; // Not enough info
        const ruleset = this.hexToRuleset(currentHex);

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

    getCanonicalRuleDetails = () => { // Converted
        if (!this.symmetryData) {
            console.error("getCanonicalRuleDetails: this.symmetryData is undefined.");
            return [];
        }
        const currentHex = this.getCurrentRulesetHex();
        if (currentHex === "N/A" || currentHex === "Error") return [];
        const ruleset = this.hexToRuleset(currentHex);

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

    _generateRandomRulesetHex = (bias, generationMode) => { // Converted
        const tempRuleset = new Uint8Array(128);
        if (generationMode === 'n_count') {
            for (let cs = 0; cs <= 1; cs++) {
                for (let nan = 0; nan <= 6; nan++) {
                    const out = Math.random() < bias ? 1 : 0;
                    for (let m = 0; m < 64; m++) if (Symmetry.countSetBits(m) === nan) tempRuleset[(cs << 6) | m] = out;
                }
            }
        } else if (generationMode === 'r_sym') {
            if (!this.symmetryData || !this.symmetryData.canonicalRepresentatives) { // Guard against undefined symmetryData
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
        } else { // random
            for (let i = 0; i < 128; i++) tempRuleset[i] = Math.random() < bias ? 1 : 0;
        }
        return this.rulesetToHex(tempRuleset); // rulesetToHex does not use `this`
    }

    // rulesetToHex and hexToRuleset are utility functions and don't use `this`, so they can remain as is or be static.
    // For consistency, if they were to use `this` in the future, making them arrow functions would be safer.
    // Since they are pure, their current form is fine.
    rulesetToHex(rulesetArray) {
        if (!rulesetArray || rulesetArray.length !== 128) return "Error";
        let bin = ""; for (let i = 0; i < 128; i++) bin += rulesetArray[i];
        try { return BigInt('0b' + bin).toString(16).toUpperCase().padStart(32, '0'); }
        catch (e) { return "Error"; }
    }

    hexToRuleset(hexString) {
        const ruleset = new Uint8Array(128).fill(0);
        if (!hexString || !/^[0-9a-fA-F]{32}$/.test(hexString)) {
            // console.warn("hexToRuleset: Invalid hex string provided:", hexString); // Optional warning
            return ruleset; // Return default (all zeros) for invalid hex
        }
        try {
            let bin = BigInt('0x' + hexString).toString(2).padStart(128, '0');
            for (let i = 0; i < 128; i++) ruleset[i] = bin[i] === '1' ? 1 : 0;
        } catch (e) { console.error("Error converting hex to ruleset:", hexString, e); }
        return ruleset;
    }

    _findHexagonsInNeighborhood(startCol, startRow, maxDistance) { // Does not use `this`
        const affected = new Set();
        if (startCol === null || startRow === null) return Array.from(affected);

        const q = [[startCol, startRow, 0]];
        const visited = new Map([[`${startCol},${startRow}`, 0]]);
        const startIndex = startRow * Config.GRID_COLS + startCol;
        if(startIndex !== undefined && startIndex >= 0 && startIndex < Config.NUM_CELLS) affected.add(startIndex);

        while (q.length > 0) {
            const [cc, cr, cd] = q.shift();
            if (cd >= maxDistance) continue;

            const dirs = (cc % 2 !== 0) ? Config.NEIGHBOR_DIRS_ODD_R : Config.NEIGHBOR_DIRS_EVEN_R;
            for (const [dx, dy] of dirs) {
                const nc = cc + dx;
                const nr = cr + dy;
                const wc = (nc % Config.GRID_COLS + Config.GRID_COLS) % Config.GRID_COLS;
                const wr = (nr % Config.GRID_ROWS + Config.GRID_ROWS) % Config.GRID_ROWS;

                if (!visited.has(`${wc},${wr}`)) {
                    const ni = wr * Config.GRID_COLS + wc;
                    if (ni !== undefined && ni >=0 && ni < Config.NUM_CELLS) {
                        visited.set(`${wc},${wr}`, cd + 1);
                        affected.add(ni);
                        q.push([wc, wr, cd + 1]);
                    }
                }
            }
        }
        return Array.from(affected);
    }

    saveSelectedWorldState = () => { // Converted
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
            filename: `hex_state_world${this.selectedWorldIndex}_${rulesetHex}_${new Date().toISOString().slice(0,-4).replace(/[:.-]/g,'')}.json`,
            content: JSON.stringify(data, null, 2),
            mimeType: 'application/json'
        });
    }

    loadWorldState = (worldIndex, loadedData) => { // Converted
        if (worldIndex < 0 || worldIndex >= this.worlds.length) return;
        if (loadedData.rows !== Config.GRID_ROWS || loadedData.cols !== Config.GRID_COLS) {
            alert("Grid dimensions in file do not match current configuration.");
            return;
        }
        const proxy = this.worlds[worldIndex];
        const newRulesetArray = this.hexToRuleset(loadedData.rulesetHex);
        const newStateArray = Uint8Array.from(loadedData.state);

        if (this.worldSettings[worldIndex]) { // Check settings exist
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
            proxy.setSpeed(this.currentGlobalSpeed);
        }

        PersistenceService.saveWorldSettings(this.worldSettings);
        if (worldIndex === this.selectedWorldIndex) {
            this.dispatchSelectedWorldUpdates();
        }
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    }

    getEntropySamplingState = () => ({ enabled: this.isEntropySamplingEnabled, rate: this.entropySampleRate });

    terminateAllWorkers = () => { // Converted
        this.worlds.forEach(proxy => proxy.terminate());
    }
}
