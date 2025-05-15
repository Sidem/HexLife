// src/core/simulation.js
import * as Config from './config.js';
import { coordsToIndex } from '../utils/utils.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Symmetry from './Symmetry.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

const NEIGHBOR_DIRS_ODD_R = [
    [+1, 0], [+1, +1], [0, +1],
    [-1, +1], [-1, 0], [0, -1]
];
const NEIGHBOR_DIRS_EVEN_R = [
    [+1, -1], [+1, 0], [0, +1],
    [-1, 0], [-1, -1], [0, -1]
];

let worldsData = [];

let isPaused = true;
let tickTimer = 0;
let currentSpeed = Config.DEFAULT_SPEED;
let tickDuration = 1.0 / currentSpeed;
let selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;
let isEntropySamplingEnabled = false;
let entropySampleRate = 10;
let globalTickCounter = 0;
let currentBrushSize = Config.DEFAULT_NEIGHBORHOOD_SIZE;
let symmetryData = null;

// Helper to get the ruleset of the currently selected world (or a default if none selected/exists)
function getPrimaryRuleset() {
    if (worldsData[selectedWorldIndex]) {
        return worldsData[selectedWorldIndex].ruleset;
    }
    // Fallback to a default empty ruleset if selected world is not yet fully initialized
    const tempRuleset = new Uint8Array(128);
    tempRuleset.fill(0);
    return tempRuleset;
}
function getPrimaryRulesetHex() {
    if (worldsData[selectedWorldIndex]) {
        return worldsData[selectedWorldIndex].rulesetHex;
    }
    return rulesetToHex(getPrimaryRuleset());
}


export function initSimulation() {
    console.log("Initializing Simulation...");
    symmetryData = Symmetry.precomputeSymmetryGroups();
    currentSpeed = PersistenceService.loadSimSpeed();
    setSimulationSpeed(currentSpeed);

    currentBrushSize = PersistenceService.loadBrushSize();
    isEntropySamplingEnabled = PersistenceService.loadUISetting('entropySamplingEnabled', false);
    entropySampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);
    globalTickCounter = 0;

    let worldSettings = PersistenceService.loadWorldSettings();
    const loadedPrimaryRulesetHex = PersistenceService.loadRuleset(); // This is now the "default" or last global ruleset

    worldsData = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const settings = worldSettings[i];
        const worldRuleset = new Uint8Array(128);
        let worldRulesetHex = "0".repeat(32); // Default to all zeros

        if (settings.rulesetHex) { // If per-world ruleset was saved in settings (future enhancement)
            worldRuleset.set(hexToRuleset(settings.rulesetHex));
            worldRulesetHex = settings.rulesetHex;
        } else if (loadedPrimaryRulesetHex) {
            worldRuleset.set(hexToRuleset(loadedPrimaryRulesetHex));
            worldRulesetHex = loadedPrimaryRulesetHex;
        } else {
            // Generate a default random one if nothing else is available
            // This initial random ruleset will be the same for all if no primary is loaded
            const tempRandomRuleset = new Uint8Array(128);
            for (let j = 0; j < 128; j++) tempRandomRuleset[j] = Math.random() < 0.5 ? 1 : 0;
            worldRuleset.set(tempRandomRuleset);
            worldRulesetHex = rulesetToHex(tempRandomRuleset);
        }
        
        worldsData.push({
            jsStateArray: new Uint8Array(Config.NUM_CELLS),
            jsNextStateArray: new Uint8Array(Config.NUM_CELLS).fill(0),
            jsHoverStateArray: new Uint8Array(Config.NUM_CELLS).fill(0),
            jsRuleIndexArray: new Uint8Array(Config.NUM_CELLS).fill(0),
            jsNextRuleIndexArray: new Uint8Array(Config.NUM_CELLS).fill(0),
            stats: {
                ratio: 0, avgRatio: 0,
                history: new Array(Config.STATS_HISTORY_SIZE).fill(0),
                entropyHistory: new Array(Config.STATS_HISTORY_SIZE).fill(0)
            },
            enabled: settings.enabled,
            initialDensity: settings.initialDensity,
            ruleset: worldRuleset, // Per-world ruleset
            rulesetHex: worldRulesetHex // Per-world ruleset hex
        });
    }
    // If no primary ruleset was loaded, generate one for the initially selected world
    if (!loadedPrimaryRulesetHex && worldsData[selectedWorldIndex]) {
        _generateRulesetForWorldsInternal(0.5, 'r_sym', [selectedWorldIndex]);
    }


    _resetWorldsInternal({ scope: 'all', useInitialDensities: true });

    isPaused = true;
    tickTimer = 0;
    // selectedWorldIndex is already set
    setupSimulationEventListeners();
    console.log(`Simulation initialized with ${Config.NUM_WORLDS} worlds.`);
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, getWorldSettings());
    EventBus.dispatch(EVENTS.RULESET_CHANGED, getPrimaryRulesetHex()); // Dispatch initial ruleset of selected world
}

function _getAffectedWorldIndices(scope) {
    let indices = [];
    if (scope === 'all') {
        for (let i = 0; i < worldsData.length; i++) indices.push(i);
    } else if (scope === 'selected') {
        indices.push(selectedWorldIndex);
    } else if (typeof scope === 'number' && scope >= 0 && scope < worldsData.length) {
        indices.push(scope);
    }
    return indices;
}


function handleScopedReset(resetScope) {
    if (resetScope && resetScope !== 'none') {
        const targetResetScope = resetScope === 'selected' ? selectedWorldIndex : resetScope;
        _resetWorldsInternal({ scope: targetResetScope, useInitialDensities: true });

        // Dispatch ALL_WORLDS_RESET only if literally all worlds were targeted for reset
        if (targetResetScope === 'all') {
            EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        }
        // Update stats for the selected world if it was part of this reset
        // or if it was the only one reset ('selected' scope)
        const affectedIndices = _getAffectedWorldIndices(targetResetScope);
        if (affectedIndices.includes(selectedWorldIndex)) {
             if (worldsData[selectedWorldIndex]) {
                EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
            }
        }
    }
}

function setupSimulationEventListeners() {
    EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PAUSE, () => setSimulationPaused(!isPaused));
    EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, setSimulationSpeed);
    EventBus.subscribe(EVENTS.COMMAND_SET_BRUSH_SIZE, setBrushSize);

    EventBus.subscribe(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, (data) => {
        // data = { bias, generationMode, resetScopeForThisChange }
        const affectedIndices = _getAffectedWorldIndices(data.resetScopeForThisChange === 'none' ? 'selected' : data.resetScopeForThisChange);
        if (affectedIndices.length > 0) {
            _generateRulesetForWorldsInternal(data.bias, data.generationMode, affectedIndices);
            if (affectedIndices.includes(selectedWorldIndex)) {
                 EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
        }
        handleScopedReset(data.resetScopeForThisChange);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_RULESET, (data) => {
        // data = { hexString, resetScopeForThisChange }
        const affectedIndices = _getAffectedWorldIndices(data.resetScopeForThisChange === 'none' ? 'selected' : data.resetScopeForThisChange);
        let success = false;
        if (affectedIndices.length > 0) {
            success = _setRulesetForWorldsInternal(data.hexString, affectedIndices);
            if (success && affectedIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
        }
        if (success) {
            handleScopedReset(data.resetScopeForThisChange);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_TOGGLE_RULE_OUTPUT, (data) => {
        // data = { ruleIndex, resetScopeForThisChange }
        const affectedIndices = _getAffectedWorldIndices(data.resetScopeForThisChange);
        let changed = false;
        if (affectedIndices.length > 0) {
            changed = _toggleRuleOutputStateForWorldsInternal(data.ruleIndex, affectedIndices);
            if (changed && affectedIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
        }
        if (changed) handleScopedReset(data.resetScopeForThisChange);
    });

    EventBus.subscribe(EVENTS.COMMAND_EDITOR_TOGGLE_RULE_OUTPUT, (data) => {
        // data = { ruleIndex, modificationScope, conditionalResetScope }
        const affectedModIndices = _getAffectedWorldIndices(data.modificationScope);
        const changed = _toggleRuleOutputStateForWorldsInternal(data.ruleIndex, affectedModIndices);
        if (changed) {
            if (affectedModIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
            handleScopedReset(data.conditionalResetScope);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_ALL_RULES_STATE, (data) => {
        // data = { targetState, modificationScope, conditionalResetScope }
        const affectedModIndices = _getAffectedWorldIndices(data.modificationScope);
        const changed = _setAllRulesStateForWorldsInternal(data.targetState, affectedModIndices);
        if (changed) {
            if (affectedModIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
            handleScopedReset(data.conditionalResetScope);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_NEIGHBOR_COUNT, (data) => {
        // data = { centerState, numActive, outputState, modificationScope, conditionalResetScope }
        const affectedModIndices = _getAffectedWorldIndices(data.modificationScope);
        const changed = _setRulesForNeighborCountConditionForWorldsInternal(data.centerState, data.numActive, data.outputState, affectedModIndices);
        if (changed) {
            if (affectedModIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
            handleScopedReset(data.conditionalResetScope);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, (data) => { // Ensure event name matches
        // data = { canonicalBitmask, centerState, outputState, modificationScope, conditionalResetScope }
        const affectedModIndices = _getAffectedWorldIndices(data.modificationScope);
        const changed = _setRulesForCanonicalRepresentativeForWorldsInternal(data.canonicalBitmask, data.centerState, data.outputState, affectedModIndices);
        if (changed) {
            if (affectedModIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
            handleScopedReset(data.conditionalResetScope);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_EDITOR_SET_RULESET_HEX, (data) => {
        // data = { hexString, modificationScope, conditionalResetScope }
        const affectedModIndices = _getAffectedWorldIndices(data.modificationScope);
        const success = _setRulesetForWorldsInternal(data.hexString, affectedModIndices);
        if (success) {
            if (affectedModIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
            handleScopedReset(data.conditionalResetScope);
        }
    });

    EventBus.subscribe(EVENTS.COMMAND_SET_ALL_RULES_STATE, (data) => {
        const affectedIndices = _getAffectedWorldIndices(data.resetScopeForThisChange);
        let changed = false;
        if (affectedIndices.length > 0) {
            changed = _setAllRulesStateForWorldsInternal(data.targetState, affectedIndices);
            if (changed && affectedIndices.includes(selectedWorldIndex)) {
                 EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
        }
        if (changed) handleScopedReset(data.resetScopeForThisChange);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, (data) => {
        const affectedIndices = _getAffectedWorldIndices(data.resetScopeForThisChange);
        let changed = false;
        if (affectedIndices.length > 0) {
            changed = _setRulesForCanonicalRepresentativeForWorldsInternal(data.canonicalBitmask, data.centerState, data.outputState, affectedIndices);
            if (changed && affectedIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
        }
        if (changed) handleScopedReset(data.resetScopeForThisChange);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_RULES_FOR_NEIGHBOR_COUNT, (data) => {
        const affectedIndices = _getAffectedWorldIndices(data.resetScopeForThisChange);
        let changed = false;
        if (affectedIndices.length > 0) {
            changed = _setRulesForNeighborCountConditionForWorldsInternal(data.centerState, data.numActive, data.outputState, affectedIndices);
            if (changed && affectedIndices.includes(selectedWorldIndex)) {
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[selectedWorldIndex].rulesetHex);
            }
        }
        if (changed) handleScopedReset(data.resetScopeForThisChange);
    });

    EventBus.subscribe(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, () => {
        _resetWorldsInternal({ scope: 'all', useInitialDensities: true });
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        if (worldsData[selectedWorldIndex]) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    });
    EventBus.subscribe(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, (data) => {
        const targetScope = data.scope === 'selected' ? selectedWorldIndex : data.scope;
        if (data.copyPrimaryRuleset && typeof targetScope === 'number') {
            const primaryRuleset = getPrimaryRuleset(); // Ruleset of currently selected world in main view
            worldsData[targetScope].ruleset.set(primaryRuleset);
            worldsData[targetScope].rulesetHex = rulesetToHex(primaryRuleset);
             if (targetScope === selectedWorldIndex) { // If we just changed the ruleset of the selected world
                EventBus.dispatch(EVENTS.RULESET_CHANGED, worldsData[targetScope].rulesetHex);
            }
        }
        _resetWorldsInternal({ scope: targetScope, useInitialDensities: true });
        if (data.scope === 'all') EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        const affectedIndices = _getAffectedWorldIndices(targetScope);
        if (affectedIndices.includes(selectedWorldIndex)) {
            if (worldsData[selectedWorldIndex]) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_CLEAR_WORLDS, (data) => {
        const targetScope = data.scope === 'selected' ? selectedWorldIndex : data.scope;
        _clearWorldsInternal(targetScope);
        const affectedIndices = _getAffectedWorldIndices(targetScope);
        if (affectedIndices.includes(selectedWorldIndex)) {
            if (worldsData[selectedWorldIndex]) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
        }
        if (data.scope === 'all') EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    });

    EventBus.subscribe(EVENTS.COMMAND_LOAD_WORLD_STATE, (data) => {
        if (loadWorldState(data.worldIndex, data.loadedData)) {
            handleScopedReset(data.worldIndex); // Reset only the loaded world
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_APPLY_BRUSH, (data) => applyBrush(data.worldIndex, data.col, data.row, data.brushSize));
    EventBus.subscribe(EVENTS.COMMAND_SET_HOVER_STATE, (data) => setHoverState(data.worldIndex, data.col, data.row, data.brushSize));
    EventBus.subscribe(EVENTS.COMMAND_CLEAR_HOVER_STATE, (data) => clearHoverState(data.worldIndex));
    EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, (data) => setWorldInitialDensity(data.worldIndex, data.density));
    EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_ENABLED, (data) => setWorldEnabled(data.worldIndex, data.isEnabled));
    EventBus.subscribe(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, (data) => setEntropySampling(data.enabled, data.rate));
    EventBus.subscribe(EVENTS.COMMAND_SELECT_WORLD, (newIndex) => {
        setSelectedWorldIndex(newIndex);
        EventBus.dispatch(EVENTS.RULESET_CHANGED, getPrimaryRulesetHex()); // Update UI with selected world's ruleset
    });
}

function countSetBits(n) { let c=0; while(n>0){n&=(n-1);c++;} return c; }
function calculateBinaryEntropy(p1) { if (p1<=0||p1>=1)return 0; const p0=1-p1; return -(p1*Math.log2(p1)+p0*Math.log2(p0));}

function runSingleStepForAllWorlds() {
    const numCols = Config.GRID_COLS;
    globalTickCounter++;
    for (let worldIdx = 0; worldIdx < worldsData.length; worldIdx++) {
        const world = worldsData[worldIdx];
        if (!world.enabled) continue;
        const { jsStateArray, jsNextStateArray, jsNextRuleIndexArray, ruleset } = world; // Use world.ruleset
        let activeCount = 0;
        for (let i = 0; i < Config.NUM_CELLS; i++) {
            const cCol = i % numCols, cRow = Math.floor(i/numCols), cState = jsStateArray[i];
            let neighborMask = 0;
            const dirs = (cCol % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;
            for (let nOrder = 0; nOrder < 6; nOrder++) {
                const nCol = (cCol + dirs[nOrder][0] + numCols) % numCols;
                const nRow = (cRow + dirs[nOrder][1] + Config.GRID_ROWS) % Config.GRID_ROWS;
                if (jsStateArray[nRow * numCols + nCol] === 1) neighborMask |= (1 << nOrder);
            }
            const ruleIdx = (cState << 6) | neighborMask;
            const nextState = ruleset[ruleIdx]; // Use world-specific ruleset
            jsNextStateArray[i] = nextState;
            jsNextRuleIndexArray[i] = ruleIdx;
            if (nextState === 1) activeCount++;
        }
        updateWorldStats(world, activeCount);
        if (isEntropySamplingEnabled && (globalTickCounter % entropySampleRate === 0)) {
            world.stats.entropyHistory.push(calculateBinaryEntropy(world.stats.ratio));
            if (world.stats.entropyHistory.length > Config.STATS_HISTORY_SIZE) world.stats.entropyHistory.shift();
        }
        world.jsStateArray.set(jsNextStateArray);
        world.jsRuleIndexArray.set(jsNextRuleIndexArray);
    }
    if (worldsData[selectedWorldIndex]) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
}

function updateWorldStats(world, activeCount) {
    world.stats.ratio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
    world.stats.history.push(world.stats.ratio);
    if (world.stats.history.length > Config.STATS_HISTORY_SIZE) world.stats.history.shift();
    world.stats.avgRatio = world.stats.history.length > 0 ? world.stats.history.reduce((a,b)=>a+b,0) / world.stats.history.length : 0;
}

export function stepSimulation(timeDelta) {
    if (isPaused) return 0;
    timeDelta = Math.min(timeDelta, 1.0);
    let steps = 0;
    tickTimer += timeDelta;
    while (tickTimer >= tickDuration && steps < 10) {
        runSingleStepForAllWorlds();
        tickTimer -= tickDuration;
        steps++;
        if (isPaused) break;
    }
    if (tickTimer >= tickDuration && steps >= 10) tickTimer = tickDuration + (tickTimer % tickDuration);
    return steps;
}

// --- Per-world ruleset modification functions ---
function _setRulesetForWorldsInternal(hexString, worldIndices) {
    const newRulesetArray = hexToRuleset(hexString);
    const newHex = rulesetToHex(newRulesetArray); // Normalize
    if (newHex === "Error") { console.error("Invalid hex string for setting ruleset:", hexString); return false; }

    let actualChangeOccurred = false;
    for (const idx of worldIndices) {
        if (worldsData[idx] && worldsData[idx].rulesetHex.toUpperCase() !== newHex.toUpperCase()) {
            worldsData[idx].ruleset.set(newRulesetArray);
            worldsData[idx].rulesetHex = newHex;
            actualChangeOccurred = true;
            if (idx === selectedWorldIndex) PersistenceService.saveRuleset(newHex); // Save the "primary" ruleset
        }
    }
    return actualChangeOccurred;
}

function _generateRulesetForWorldsInternal(bias, generationMode, worldIndices) {
    const tempRuleset = new Uint8Array(128);
    if (generationMode === 'n_count') {
        for (let cs=0; cs<=1; cs++) for (let nan=0; nan<=6; nan++) {
            const out = Math.random()<bias?1:0;
            for(let m=0;m<64;m++) if(countSetBits(m)===nan) tempRuleset[(cs<<6)|m]=out;
        }
    } else if (generationMode === 'random') {
        for (let i=0; i<128; i++) tempRuleset[i] = Math.random()<bias?1:0;
        if(tempRuleset[0]===1&&tempRuleset[127]===0)tempRuleset[Math.random()<0.5?127:0]=Math.random()<0.5?1:0;
        else if(tempRuleset[0]===0&&tempRuleset[127]===1)tempRuleset[Math.random()<0.5?127:0]=Math.random()<0.5?0:1;
    } else if (generationMode === 'r_sym') {
        if (!symmetryData) { for (let i=0; i<128; i++) tempRuleset[i] = Math.random()<bias?1:0;}
        else {
            tempRuleset.fill(0);
            for (const group of symmetryData.canonicalRepresentatives) for (let cs=0; cs<=1; cs++) {
                const out = Math.random()<bias?1:0;
                for (const member of group.members) tempRuleset[(cs<<6)|member]=out;
            }
        }
    }
    const newHex = rulesetToHex(tempRuleset);
    for (const idx of worldIndices) {
        if (worldsData[idx]) {
            worldsData[idx].ruleset.set(tempRuleset);
            worldsData[idx].rulesetHex = newHex;
            if (idx === selectedWorldIndex) PersistenceService.saveRuleset(newHex);
        }
    }
}

function _modifyRulesetForWorldsInternal(worldIndices, ruleModifierFunc) {
    let overallChangeOccurred = false;
    for (const idx of worldIndices) {
        if (worldsData[idx]) {
            const rulesetCopy = new Uint8Array(worldsData[idx].ruleset); // Modify a copy
            const changedInThisWorld = ruleModifierFunc(rulesetCopy);
            if (changedInThisWorld) {
                worldsData[idx].ruleset.set(rulesetCopy);
                worldsData[idx].rulesetHex = rulesetToHex(rulesetCopy);
                overallChangeOccurred = true;
                if (idx === selectedWorldIndex) PersistenceService.saveRuleset(worldsData[idx].rulesetHex);
            }
        }
    }
    return overallChangeOccurred;
}

function _toggleRuleOutputStateForWorldsInternal(ruleIndex, worldIndices) {
    return _modifyRulesetForWorldsInternal(worldIndices, (ruleset) => {
        if (ruleIndex >=0 && ruleIndex < 128) { ruleset[ruleIndex] = 1 - ruleset[ruleIndex]; return true;} return false;
    });
}
function _setAllRulesStateForWorldsInternal(targetState, worldIndices) {
    if (targetState!==0 && targetState!==1) return false;
    return _modifyRulesetForWorldsInternal(worldIndices, (ruleset) => {
        let changed = false; for(let i=0;i<128;i++) if(ruleset[i]!==targetState){ruleset[i]=targetState;changed=true;} return changed;
    });
}
function _setRulesForCanonicalRepresentativeForWorldsInternal(canonicalBitmask, centerState, outputState, worldIndices) {
    if (!symmetryData) return false;
    const group = symmetryData.canonicalRepresentatives.find(g => g.representative === canonicalBitmask);
    if (!group) return false;
    return _modifyRulesetForWorldsInternal(worldIndices, (ruleset) => {
        let changed = false;
        for (const member of group.members) {
            const idx = (centerState << 6) | member;
            if (ruleset[idx] !== outputState) { ruleset[idx] = outputState; changed = true; }
        } return changed;
    });
}
function _setRulesForNeighborCountConditionForWorldsInternal(centerState, numActive, outputState, worldIndices) {
     return _modifyRulesetForWorldsInternal(worldIndices, (ruleset) => {
        let changed = false;
        for(let m=0; m<64; m++) if(countSetBits(m)===numActive){
            const idx = (centerState<<6)|m; if(ruleset[idx]!==outputState){ruleset[idx]=outputState;changed=true;}
        } return changed;
    });
}
// --- End Per-world ruleset modification functions ---


export function getEffectiveRuleForCanonicalRepresentative(canonicalBitmask, centerState) {
    const world = worldsData[selectedWorldIndex];
    if (!world || !symmetryData?.bitmaskToCanonical.has(canonicalBitmask)) return 2;
    const group = symmetryData.canonicalRepresentatives.find(g => g.representative === canonicalBitmask);
    if (!group) return 2;
    let firstOutput = -1;
    for (const member of group.members) {
        const output = world.ruleset[(centerState << 6) | member];
        if (firstOutput === -1) firstOutput = output;
        else if (firstOutput !== output) return 2;
    }
    return firstOutput === -1 ? 2 : firstOutput;
}

export function getCanonicalRuleDetails() { // Uses selected world's ruleset for effective output
    if (!symmetryData) return [];
    return symmetryData.canonicalRepresentatives.flatMap(group => [
        { canonicalBitmask: group.representative, centerState: 0, orbitSize: group.orbitSize, effectiveOutput: getEffectiveRuleForCanonicalRepresentative(group.representative, 0), members: group.members },
        { canonicalBitmask: group.representative, centerState: 1, orbitSize: group.orbitSize, effectiveOutput: getEffectiveRuleForCanonicalRepresentative(group.representative, 1), members: group.members }
    ]);
}

export function getEffectiveRuleForNeighborCount(centerState, numActiveNeighbors) {
    const world = worldsData[selectedWorldIndex];
    if (!world || centerState < 0 || centerState > 1 || numActiveNeighbors < 0 || numActiveNeighbors > 6) return 2;
    let firstOutput = -1;
    for (let mask = 0; mask < 64; mask++) {
        if (countSetBits(mask) === numActiveNeighbors) {
            const output = world.ruleset[(centerState << 6) | mask];
            if (firstOutput === -1) firstOutput = output;
            else if (firstOutput !== output) return 2;
        }
    }
    return firstOutput === -1 ? 2 : firstOutput;
}

export function rulesetToHex(rulesetArray) {
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    let bin = ""; for (let i = 0; i < 128; i++) bin += rulesetArray[i];
    try { return BigInt('0b' + bin).toString(16).toUpperCase().padStart(32, '0'); }
    catch (e) { return "Error"; }
}
export function hexToRuleset(hexString) {
    const ruleset = new Uint8Array(128).fill(0);
    if (!hexString || !/^[0-9a-fA-F]{32}$/.test(hexString)) return ruleset;
    try {
        let bin = BigInt('0x' + hexString).toString(2).padStart(128, '0');
        for (let i = 0; i < 128; i++) ruleset[i] = bin[i] === '1' ? 1 : 0;
    } catch (e) { console.error("Error converting hex to ruleset:", e); }
    return ruleset;
}

function getNeighbors(col, row) {
    const dirs = (col % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;
    return dirs.map(d => [col + d[0], row + d[1]]);
}

function findHexagonsInNeighborhood(startCol, startRow, maxDistance) {
    const startIndex = coordsToIndex(startCol, startRow);
    if (startIndex === undefined) return [];
    const affected = new Set([startIndex]);
    const q = [[startCol, startRow, 0]];
    const visited = new Map([[`${startCol},${startRow}`, 0]]);
    while (q.length > 0) {
        const [cc, cr, cd] = q.shift();
        if (cd >= maxDistance) continue;
        for (const [nc, nr] of getNeighbors(cc, cr)) {
            const wc = (nc % Config.GRID_COLS + Config.GRID_COLS) % Config.GRID_COLS;
            const wr = (nr % Config.GRID_ROWS + Config.GRID_ROWS) % Config.GRID_ROWS;
            if (!visited.has(`${wc},${wr}`)) {
                const ni = coordsToIndex(wc, wr);
                if (ni !== undefined) {
                    visited.set(`${wc},${wr}`, cd + 1);
                    affected.add(ni);
                    q.push([wc, wr, cd + 1]);
                }
            }
        }
    }
    return Array.from(affected);
}

export function setHoverState(worldIndex, col, row, brushSize) {
    if (worldIndex<0||worldIndex>=worldsData.length||!worldsData[worldIndex].enabled) return false;
    const hState=worldsData[worldIndex].jsHoverStateArray;
    const newHover= (col!==null&&row!==null)?new Set(findHexagonsInNeighborhood(col,row,brushSize)):new Set();
    let changed=false;
    for(let i=0;i<hState.length;i++){
        const shouldHover=newHover.has(i);
        if(hState[i]!==(shouldHover?1:0)){hState[i]=shouldHover?1:0;changed=true;}
    } return changed;
}
export function clearHoverState(worldIndex) {
    if (worldIndex<0||worldIndex>=worldsData.length) return false;
    const hState=worldsData[worldIndex].jsHoverStateArray; let ch=false;
    for(let i=0;i<hState.length;i++)if(hState[i]===1){hState[i]=0;ch=true;} return ch;
}
export function applyBrush(worldIndex, col, row, brushSize) {
    if (worldIndex<0||worldIndex>=worldsData.length||!worldsData[worldIndex].enabled) return false;
    const w=worldsData[worldIndex]; let ch=false;
    for(const idx of findHexagonsInNeighborhood(col,row,brushSize)) if(idx>=0&&idx<Config.NUM_CELLS){
        w.jsStateArray[idx]=1-w.jsStateArray[idx]; w.jsRuleIndexArray[idx]=0; ch=true;
    }
    if(ch){updateWorldStats(w,w.jsStateArray.reduce((s,st)=>s+st,0)); if(worldIndex===selectedWorldIndex)EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED,getSelectedWorldStats());}
    return ch;
}

export function setSimulationPaused(p) { if(isPaused===p)return; isPaused=p; if(!isPaused)tickTimer=0; EventBus.dispatch(EVENTS.SIMULATION_PAUSED,isPaused); }
export function setSimulationSpeed(s) { s=Math.max(0,Math.min(Config.MAX_SIM_SPEED,s)); if(currentSpeed===s)return; currentSpeed=s; tickDuration=s>0?1.0/s:Infinity; PersistenceService.saveSimSpeed(s); EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED,s); }
export function setBrushSize(s) { s=Math.max(0,Math.min(Config.MAX_NEIGHBORHOOD_SIZE,s)); if(currentBrushSize===s)return; currentBrushSize=s; PersistenceService.saveBrushSize(s); EventBus.dispatch(EVENTS.BRUSH_SIZE_CHANGED,s); }
export function setSelectedWorldIndex(idx) {
    if (idx<0||idx>=worldsData.length||selectedWorldIndex===idx)return;
    selectedWorldIndex=idx;
    EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED,idx);
    EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED,getSelectedWorldStats());
}
export function setWorldInitialDensity(worldIdx, density) {
    if (worldIdx<0||worldIdx>=worldsData.length) return false;
    worldsData[worldIdx].initialDensity=Math.max(0,Math.min(1,density));
    PersistenceService.saveWorldSettings(getWorldSettings());
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED,getWorldSettings()); return true;
}
export function setWorldEnabled(worldIdx,isEnabled){
    if (worldIdx<0||worldIdx>=worldsData.length) return false;
    const w=worldsData[worldIdx]; w.enabled=!!isEnabled;
    if(!w.enabled){w.jsStateArray.fill(0);w.jsRuleIndexArray.fill(0);updateWorldStats(w,0); if(worldIdx===selectedWorldIndex)EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED,getSelectedWorldStats());}
    PersistenceService.saveWorldSettings(getWorldSettings());
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED,getWorldSettings()); return true;
}
export function getWorldSettings() { return worldsData.map(w => ({initialDensity:w.initialDensity, enabled:w.enabled, rulesetHex: w.rulesetHex /* Optionally save per-world ruleset hex */})); }

function _resetWorldsInternal({ scope='all', useInitialDensities=true }) {
    const affected = _getAffectedWorldIndices(scope);
    if(scope==='all' && useInitialDensities) globalTickCounter=0;
    for(const idx of affected){
        const w=worldsData[idx]; let ac=0;
        if(w.enabled && useInitialDensities){
            const d=w.initialDensity; if(d===0)w.jsStateArray.fill(0); else if(d===1){w.jsStateArray.fill(1);ac=Config.NUM_CELLS;}
            else for(let i=0;i<Config.NUM_CELLS;i++)if((w.jsStateArray[i]=Math.random()<d?1:0)===1)ac++;
        } else w.jsStateArray.fill(0);
        w.jsRuleIndexArray.fill(0); w.jsNextStateArray.fill(0); w.jsNextRuleIndexArray.fill(0); w.jsHoverStateArray.fill(0);
        updateWorldStats(w,ac);
    }
}
function _clearWorldsInternal(scope='selected'){
    const affected = _getAffectedWorldIndices(scope);
    for(const idx of affected) if(worldsData[idx].enabled){
        const w=worldsData[idx], t=w.jsStateArray.some(s=>s===1)?0:1;
        w.jsStateArray.fill(t); w.jsRuleIndexArray.fill(0); updateWorldStats(w,t===1?Config.NUM_CELLS:0);
    }
}

export function loadWorldState(worldIndex, stateData) {
    if (worldIndex<0||worldIndex>=worldsData.length||stateData.rows!==Config.GRID_ROWS||stateData.cols!==Config.GRID_COLS||stateData.state.length!==Config.NUM_CELLS) return false;
    const w=worldsData[worldIndex];
    w.jsStateArray.set(Uint8Array.from(stateData.state));
    w.jsRuleIndexArray.fill(0);w.jsNextStateArray.fill(0);w.jsNextRuleIndexArray.fill(0);w.jsHoverStateArray.fill(0);
    const ac=w.jsStateArray.reduce((s,c)=>s+c,0);
    setWorldInitialDensity(worldIndex,Config.NUM_CELLS>0?ac/Config.NUM_CELLS:0);
    if(stateData.rulesetHex) { // Expect rulesetHex for per-world loading
        w.ruleset.set(hexToRuleset(stateData.rulesetHex));
        w.rulesetHex = stateData.rulesetHex;
        if(worldIndex === selectedWorldIndex) EventBus.dispatch(EVENTS.RULESET_CHANGED, w.rulesetHex);
    } else if (stateData.ruleset) { // Legacy support for "ruleset" key
         w.ruleset.set(hexToRuleset(stateData.ruleset));
         w.rulesetHex = stateData.ruleset;
         if(worldIndex === selectedWorldIndex) EventBus.dispatch(EVENTS.RULESET_CHANGED, w.rulesetHex);
    }
    updateWorldStats(w,ac); setWorldEnabled(worldIndex,true);
    if(worldIndex===selectedWorldIndex)EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED,getSelectedWorldStats());
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED,getWorldSettings()); return true;
}
export function getWorldStateForSave(worldIndex) {
    if (worldIndex<0||worldIndex>=worldsData.length) return null;
    const w=worldsData[worldIndex];
    return {rows:Config.GRID_ROWS,cols:Config.GRID_COLS,rulesetHex:w.rulesetHex,state:Array.from(w.jsStateArray)};
}

export function getWorldsData() { return worldsData; }
// getCurrentRulesetHex and getCurrentRulesetArray now refer to the selected world's ruleset
export function getCurrentRulesetHex() { return getPrimaryRulesetHex(); }
export function getCurrentRulesetArray() { return new Uint8Array(getPrimaryRuleset()); } // Return a copy
export function isSimulationPaused() { return isPaused; }
export function getSelectedWorldIndex() { return selectedWorldIndex; }
export function getCurrentSimulationSpeed() { return currentSpeed; }
export function getCurrentBrushSize() { return currentBrushSize; }
export function getEntropySamplingState() { return {enabled:isEntropySamplingEnabled,rate:entropySampleRate};}
export function setEntropySampling(e,r){isEntropySamplingEnabled=!!e;entropySampleRate=Math.max(1,Math.floor(r));PersistenceService.saveUISetting('entropySamplingEnabled',e);PersistenceService.saveUISetting('entropySampleRate',r);EventBus.dispatch(EVENTS.ENTROPY_SAMPLING_CHANGED,{enabled:e,rate:r});}
export function getSelectedWorldStats() {
    if (selectedWorldIndex>=0&&selectedWorldIndex<worldsData.length){const w=worldsData[selectedWorldIndex];if(w?.enabled&&w?.stats){const{ratio,avgRatio,history,entropyHistory}=w.stats;return{ratio,avgRatio,history,entropy:entropyHistory.length>0?entropyHistory[entropyHistory.length-1]:calculateBinaryEntropy(ratio)};}}
    return {ratio:0,avgRatio:0,history:[],entropy:0};
}
export function getSelectedWorldEntropyHistory() {return worldsData[selectedWorldIndex]?.stats?.entropyHistory||[];}
export function getSelectedWorldRatioHistory() {return worldsData[selectedWorldIndex]?.stats?.history||[];}
export function getSymmetryData() { return symmetryData; }