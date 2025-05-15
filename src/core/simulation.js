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
let currentRuleset = new Uint8Array(128);
let currentRulesetHex = "N/A";
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

export function initSimulation() {
    console.log("Initializing Simulation...");
    symmetryData = Symmetry.precomputeSymmetryGroups();
    currentSpeed = PersistenceService.loadSimSpeed();
    setSimulationSpeed(currentSpeed);

    const loadedRulesetHex = PersistenceService.loadRuleset();
    if (loadedRulesetHex) {
        _setGlobalRulesetInternal(loadedRulesetHex);
    } else {
        _generateRandomRulesetInternal(0.5, 'r_sym');
    }

    currentBrushSize = PersistenceService.loadBrushSize();
    isEntropySamplingEnabled = PersistenceService.loadUISetting('entropySamplingEnabled', false);
    entropySampleRate = PersistenceService.loadUISetting('entropySampleRate', 10);
    globalTickCounter = 0;
    let worldSettings = PersistenceService.loadWorldSettings();
    worldsData = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        const settings = worldSettings[i];
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
            initialDensity: settings.initialDensity
        });
    }
    _resetWorldsInternal({ scope: 'all', useInitialDensities: true });

    isPaused = true;
    tickTimer = 0;
    selectedWorldIndex = Config.DEFAULT_SELECTED_WORLD_INDEX;
    setupSimulationEventListeners();
    console.log(`Simulation initialized with ${Config.NUM_WORLDS} worlds.`);
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, getWorldSettings());
}

function handleScopedReset(resetScope) {
    if (resetScope && resetScope !== 'none') {
        const targetResetScope = resetScope === 'selected' ? selectedWorldIndex : resetScope;
        _resetWorldsInternal({ scope: targetResetScope, useInitialDensities: true });

        if (targetResetScope === 'all') {
            EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        }
        if (targetResetScope === 'all' || targetResetScope === selectedWorldIndex) {
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
        _generateRandomRulesetInternal(data.bias, data.generationMode);
        handleScopedReset(data.resetScopeForThisChange);
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_RULESET, (data) => {
        if (_setGlobalRulesetInternal(data.hexString)) {
            handleScopedReset(data.resetScopeForThisChange);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_TOGGLE_RULE_OUTPUT, (data) => {
        if (_toggleRuleOutputStateInternal(data.ruleIndex)) {
            handleScopedReset(data.resetScopeForThisChange);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_ALL_RULES_STATE, (data) => {
        if (_setAllRulesStateInternal(data.targetState)) {
            handleScopedReset(data.resetScopeForThisChange);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, (data) => {
        if (_setRulesForCanonicalRepresentativeInternal(data.canonicalBitmask, data.centerState, data.outputState)) {
            handleScopedReset(data.resetScopeForThisChange);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_SET_RULES_FOR_NEIGHBOR_COUNT, (data) => {
        if (_setRulesForNeighborCountConditionInternal(data.centerState, data.numActive, data.outputState, true)) { // true to update hex/event
            handleScopedReset(data.resetScopeForThisChange);
        }
    });

    EventBus.subscribe(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, () => {
        _resetWorldsInternal({ scope: 'all', useInitialDensities: true });
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        if (worldsData[selectedWorldIndex]) {
            EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, (data) => {
        const targetScope = data.scope === 'selected' ? selectedWorldIndex : data.scope;
        _resetWorldsInternal({ scope: targetScope, useInitialDensities: true });
        if (data.scope === 'all') EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        if (data.scope === 'all' || targetScope === selectedWorldIndex) {
            if (worldsData[selectedWorldIndex]) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_CLEAR_WORLDS, (data) => {
        const targetScope = data.scope === 'selected' ? selectedWorldIndex : data.scope;
        _clearWorldsInternal(targetScope);
        if (data.scope === 'all' || targetScope === selectedWorldIndex) {
            if (worldsData[selectedWorldIndex]) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
        }
        if (data.scope === 'all') EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
    });

    EventBus.subscribe(EVENTS.COMMAND_LOAD_WORLD_STATE, (data) => {
        if (loadWorldState(data.worldIndex, data.loadedData)) {
            handleScopedReset(data.worldIndex);
        }
    });
    EventBus.subscribe(EVENTS.COMMAND_APPLY_BRUSH, (data) => applyBrush(data.worldIndex, data.col, data.row, data.brushSize));
    EventBus.subscribe(EVENTS.COMMAND_SET_HOVER_STATE, (data) => setHoverState(data.worldIndex, data.col, data.row, data.brushSize));
    EventBus.subscribe(EVENTS.COMMAND_CLEAR_HOVER_STATE, (data) => clearHoverState(data.worldIndex));
    EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, (data) => setWorldInitialDensity(data.worldIndex, data.density));
    EventBus.subscribe(EVENTS.COMMAND_SET_WORLD_ENABLED, (data) => setWorldEnabled(data.worldIndex, data.isEnabled));
    EventBus.subscribe(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, (data) => setEntropySampling(data.enabled, data.rate));
    EventBus.subscribe(EVENTS.COMMAND_SELECT_WORLD, setSelectedWorldIndex);
}

function countSetBits(n) {
    let count = 0;
    while (n > 0) { n &= (n - 1); count++; }
    return count;
}

function calculateBinaryEntropy(p1) {
    if (p1 <= 0 || p1 >= 1) return 0;
    const p0 = 1 - p1;
    return -(p1 * Math.log2(p1) + p0 * Math.log2(p0));
}

function runSingleStepForAllWorlds() {
    const numCols = Config.GRID_COLS;
    const numRows = Config.GRID_ROWS;
    globalTickCounter++;

    for (let worldIdx = 0; worldIdx < worldsData.length; worldIdx++) {
        const world = worldsData[worldIdx];
        if (!world.enabled) continue;

        const { jsStateArray, jsNextStateArray, jsNextRuleIndexArray } = world;
        let activeCount = 0;

        for (let i = 0; i < Config.NUM_CELLS; i++) {
            const centerCol = i % numCols;
            const centerRow = Math.floor(i / numCols);
            const centerState = jsStateArray[i];
            let neighborStatesBitmask = 0;
            const base_dirs = (centerCol % 2 !== 0) ? NEIGHBOR_DIRS_ODD_R : NEIGHBOR_DIRS_EVEN_R;

            for (let neighborOrder = 0; neighborOrder < 6; neighborOrder++) {
                const dCol = base_dirs[neighborOrder][0];
                const dRow = base_dirs[neighborOrder][1];
                const nCol = (centerCol + dCol + numCols) % numCols;
                const nRow = (centerRow + dRow + numRows) % numRows;
                if (jsStateArray[nRow * numCols + nCol] === 1) {
                    neighborStatesBitmask |= (1 << neighborOrder);
                }
            }
            const ruleIndex = (centerState << 6) | neighborStatesBitmask;
            const nextState = currentRuleset[ruleIndex];
            jsNextStateArray[i] = nextState;
            jsNextRuleIndexArray[i] = ruleIndex;
            if (nextState === 1) activeCount++;
        }
        updateWorldStats(world, activeCount);

        if (isEntropySamplingEnabled && (globalTickCounter % entropySampleRate === 0)) {
            const currentEntropy = calculateBinaryEntropy(world.stats.ratio);
            world.stats.entropyHistory.push(currentEntropy);
            if (world.stats.entropyHistory.length > Config.STATS_HISTORY_SIZE) {
                world.stats.entropyHistory.shift();
            }
        }
        world.jsStateArray.set(jsNextStateArray);
        world.jsRuleIndexArray.set(jsNextRuleIndexArray);
    }
    if (worldsData[selectedWorldIndex]) {
        EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    }
}

function updateWorldStats(world, activeCount) {
    const stats = world.stats;
    stats.ratio = Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0;
    stats.history.push(stats.ratio);
    if (stats.history.length > Config.STATS_HISTORY_SIZE) stats.history.shift();
    stats.avgRatio = stats.history.length > 0 ? stats.history.reduce((a, b) => a + b, 0) / stats.history.length : 0;
}

export function stepSimulation(timeDelta) {
    if (isPaused) return 0;
    timeDelta = Math.min(timeDelta, 1.0);
    let stepsTakenThisFrame = 0;
    tickTimer += timeDelta;
    while (tickTimer >= tickDuration && stepsTakenThisFrame < 10) {
        runSingleStepForAllWorlds();
        tickTimer -= tickDuration;
        stepsTakenThisFrame++;
        if (isPaused) break;
    }
    if (tickTimer >= tickDuration && stepsTakenThisFrame >= 10) {
        tickTimer = tickDuration + (tickTimer % tickDuration);
    }
    return stepsTakenThisFrame;
}

function _setGlobalRulesetInternal(hexString) {
    const newRuleset = hexToRuleset(hexString);
    const newHex = rulesetToHex(newRuleset);
    if (newHex !== "Error" && newHex.toUpperCase() === hexString.toUpperCase()) {
        if (currentRulesetHex.toUpperCase() !== newHex.toUpperCase()) {
            currentRuleset.set(newRuleset);
            currentRulesetHex = newHex;
            PersistenceService.saveRuleset(currentRulesetHex);
            EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
        }
        return true;
    }
    console.error("Failed to apply ruleset from hex:", hexString);
    return false;
}

function _generateRandomRulesetInternal(bias = 0.5, generationMode = 'random') {
    const oldRulesetHex = currentRulesetHex;
    if (generationMode === 'n_count') {
        for (let cs = 0; cs <= 1; cs++) {
            for (let nan = 0; nan <= 6; nan++) {
                _setRulesForNeighborCountConditionInternal(cs, nan, Math.random() < bias ? 1 : 0, false);
            }
        }
    } else if (generationMode === 'random') {
        for (let i = 0; i < 128; i++) currentRuleset[i] = Math.random() < bias ? 1 : 0;
        if (currentRuleset[0]===1 && currentRuleset[127]===0) currentRuleset[Math.random()<0.5?127:0] = Math.random()<0.5?1:0;
        else if (currentRuleset[0]===0 && currentRuleset[127]===1) currentRuleset[Math.random()<0.5?127:0] = Math.random()<0.5?0:1;

    } else if (generationMode === 'r_sym') {
        if (!symmetryData) {
            for (let i = 0; i < 128; i++) currentRuleset[i] = Math.random() < bias ? 1 : 0;
        } else {
            currentRuleset.fill(0);
            for (const group of symmetryData.canonicalRepresentatives) {
                for (let cs = 0; cs <= 1; cs++) {
                    const ro = Math.random() < bias ? 1 : 0;
                    for (const member of group.members) currentRuleset[(cs << 6) | member] = ro;
                }
            }
        }
    }
    const newHex = rulesetToHex(currentRuleset);
    if (oldRulesetHex.toUpperCase() !== newHex.toUpperCase()) {
        currentRulesetHex = newHex;
        PersistenceService.saveRuleset(currentRulesetHex);
        EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
    }
}

function _setRulesForNeighborCountConditionInternal(centerState, numActiveNeighbors, outputState, updateHexAndDispatch = true) {
    let changed = false;
    for (let mask = 0; mask < 64; mask++) {
        if (countSetBits(mask) === numActiveNeighbors) {
            const ruleIndex = (centerState << 6) | mask;
            if (currentRuleset[ruleIndex] !== outputState) {
                currentRuleset[ruleIndex] = outputState;
                changed = true;
            }
        }
    }
    if (changed && updateHexAndDispatch) {
        const oldHex = currentRulesetHex;
        currentRulesetHex = rulesetToHex(currentRuleset);
        if (oldHex.toUpperCase() !== currentRulesetHex.toUpperCase()) {
            PersistenceService.saveRuleset(currentRulesetHex);
            EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
        }
    }
    return changed;
}

function _setRulesForCanonicalRepresentativeInternal(canonicalBitmask, centerState, outputState) {
    if (!symmetryData) return false;
    const group = symmetryData.canonicalRepresentatives.find(g => g.representative === canonicalBitmask);
    if (!group) return false;
    let changed = false;
    for (const member of group.members) {
        const ruleIndex = (centerState << 6) | member;
        if (currentRuleset[ruleIndex] !== outputState) {
            currentRuleset[ruleIndex] = outputState;
            changed = true;
        }
    }
    if (changed) {
        const oldHex = currentRulesetHex;
        currentRulesetHex = rulesetToHex(currentRuleset);
        if (oldHex.toUpperCase() !== currentRulesetHex.toUpperCase()) {
            PersistenceService.saveRuleset(currentRulesetHex);
            EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
        }
    }
    return changed;
}

function _toggleRuleOutputStateInternal(ruleIndex) {
    if (ruleIndex >= 0 && ruleIndex < 128) {
        currentRuleset[ruleIndex] = 1 - currentRuleset[ruleIndex];
        const oldHex = currentRulesetHex;
        currentRulesetHex = rulesetToHex(currentRuleset);
        if (oldHex.toUpperCase() !== currentRulesetHex.toUpperCase()) {
            PersistenceService.saveRuleset(currentRulesetHex);
            EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
        }
        return true;
    }
    return false;
}

function _setAllRulesStateInternal(targetState) {
    if (targetState !== 0 && targetState !== 1) return false;
    let changed = false;
    for (let i = 0; i < 128; i++) {
        if (currentRuleset[i] !== targetState) {
            currentRuleset[i] = targetState;
            changed = true;
        }
    }
    if (changed) {
        const oldHex = currentRulesetHex;
        currentRulesetHex = rulesetToHex(currentRuleset);
        if (oldHex.toUpperCase() !== currentRulesetHex.toUpperCase()) {
            PersistenceService.saveRuleset(currentRulesetHex);
            EventBus.dispatch(EVENTS.RULESET_CHANGED, currentRulesetHex);
        }
    }
    return changed;
}

export function getEffectiveRuleForCanonicalRepresentative(canonicalBitmask, centerState) {
    if (!symmetryData?.bitmaskToCanonical.has(canonicalBitmask)) return 2;
    const group = symmetryData.canonicalRepresentatives.find(g => g.representative === canonicalBitmask);
    if (!group) return 2;
    let firstOutput = -1;
    for (const member of group.members) {
        const output = currentRuleset[(centerState << 6) | member];
        if (firstOutput === -1) firstOutput = output;
        else if (firstOutput !== output) return 2;
    }
    return firstOutput === -1 ? 2 : firstOutput;
}

export function getCanonicalRuleDetails() {
    if (!symmetryData) return [];
    return symmetryData.canonicalRepresentatives.flatMap(group => [
        { canonicalBitmask: group.representative, centerState: 0, orbitSize: group.orbitSize, effectiveOutput: getEffectiveRuleForCanonicalRepresentative(group.representative, 0), members: group.members },
        { canonicalBitmask: group.representative, centerState: 1, orbitSize: group.orbitSize, effectiveOutput: getEffectiveRuleForCanonicalRepresentative(group.representative, 1), members: group.members }
    ]);
}

export function getEffectiveRuleForNeighborCount(centerState, numActiveNeighbors) {
    if (centerState < 0 || centerState > 1 || numActiveNeighbors < 0 || numActiveNeighbors > 6) return 2;
    let firstOutput = -1;
    for (let mask = 0; mask < 64; mask++) {
        if (countSetBits(mask) === numActiveNeighbors) {
            const output = currentRuleset[(centerState << 6) | mask];
            if (firstOutput === -1) firstOutput = output;
            else if (firstOutput !== output) return 2;
        }
    }
    return firstOutput === -1 ? 2 : firstOutput;
}

export function rulesetToHex(rulesetArray) {
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    let bin = "";
    for (let i = 0; i < 128; i++) bin += rulesetArray[i];
    try {
        let hex = BigInt('0b' + bin).toString(16).toUpperCase();
        return hex.padStart(32, '0');
    } catch (e) { return "Error"; }
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
    if (worldIndex < 0 || worldIndex >= worldsData.length || !worldsData[worldIndex].enabled) return false;
    const world = worldsData[worldIndex];
    const hoverState = world.jsHoverStateArray;
    let newHoverIndices = (col !== null && row !== null) ? new Set(findHexagonsInNeighborhood(col, row, brushSize)) : new Set();
    let changed = false;
    for (let i = 0; i < hoverState.length; i++) {
        const shouldBeHovered = newHoverIndices.has(i);
        if (hoverState[i] !== (shouldBeHovered ? 1 : 0)) {
            hoverState[i] = shouldBeHovered ? 1 : 0;
            changed = true;
        }
    }
    return changed;
}

export function clearHoverState(worldIndex) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    const hoverState = worldsData[worldIndex].jsHoverStateArray;
    let changed = false;
    for (let i = 0; i < hoverState.length; i++) if (hoverState[i] === 1) { hoverState[i] = 0; changed = true; }
    return changed;
}

export function applyBrush(worldIndex, col, row, brushSize) {
    if (worldIndex < 0 || worldIndex >= worldsData.length || !worldsData[worldIndex].enabled) return false;
    const world = worldsData[worldIndex];
    let changed = false;
    for (const index of findHexagonsInNeighborhood(col, row, brushSize)) {
        if (index >= 0 && index < Config.NUM_CELLS) {
            world.jsStateArray[index] = 1 - world.jsStateArray[index];
            world.jsRuleIndexArray[index] = 0;
            changed = true;
        }
    }
    if (changed) {
        updateWorldStats(world, world.jsStateArray.reduce((sum, s) => sum + s, 0));
        if (worldIndex === selectedWorldIndex) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    }
    return changed;
}

export function setSimulationPaused(paused) {
    if (isPaused === paused) return;
    isPaused = paused;
    if (!isPaused) tickTimer = 0;
    EventBus.dispatch(EVENTS.SIMULATION_PAUSED, isPaused);
}

export function setSimulationSpeed(speed) {
    speed = Math.max(0, Math.min(Config.MAX_SIM_SPEED, speed));
    if (currentSpeed === speed) return;
    currentSpeed = speed;
    tickDuration = currentSpeed > 0 ? 1.0 / currentSpeed : Infinity;
    PersistenceService.saveSimSpeed(currentSpeed);
    EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED, currentSpeed);
}

export function setBrushSize(size) {
    size = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, size));
    if (currentBrushSize === size) return;
    currentBrushSize = size;
    PersistenceService.saveBrushSize(currentBrushSize);
    EventBus.dispatch(EVENTS.BRUSH_SIZE_CHANGED, currentBrushSize);
}

export function setSelectedWorldIndex(index) {
    if (index < 0 || index >= worldsData.length || selectedWorldIndex === index) return;
    selectedWorldIndex = index;
    EventBus.dispatch(EVENTS.SELECTED_WORLD_CHANGED, selectedWorldIndex);
    EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
}

export function setWorldInitialDensity(worldIndex, density) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    worldsData[worldIndex].initialDensity = Math.max(0, Math.min(1, density));
    PersistenceService.saveWorldSettings(getWorldSettings());
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, getWorldSettings());
    return true;
}

export function setWorldEnabled(worldIndex, isEnabled) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    const world = worldsData[worldIndex];
    world.enabled = !!isEnabled;
    if (!world.enabled) {
        world.jsStateArray.fill(0);
        world.jsRuleIndexArray.fill(0);
        updateWorldStats(world, 0);
        if (worldIndex === selectedWorldIndex) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    }
    PersistenceService.saveWorldSettings(getWorldSettings());
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, getWorldSettings());
    return true;
}

export function getWorldSettings() {
    return worldsData.map(w => ({ initialDensity: w.initialDensity, enabled: w.enabled }));
}

function _resetWorldsInternal({ scope = 'all', useInitialDensities = true }) {
    let affectedIndices = [];
    if (scope === 'all') {
        for (let i = 0; i < worldsData.length; i++) affectedIndices.push(i);
        if (useInitialDensities) globalTickCounter = 0;
    } else if (typeof scope === 'number' && scope >= 0 && scope < worldsData.length) {
        affectedIndices.push(scope);
    } else return;

    for (const idx of affectedIndices) {
        const world = worldsData[idx];
        let activeCount = 0;
        if (world.enabled && useInitialDensities) {
            const density = world.initialDensity;
            if (density === 0) world.jsStateArray.fill(0);
            else if (density === 1) { world.jsStateArray.fill(1); activeCount = Config.NUM_CELLS; }
            else {
                for (let i = 0; i < Config.NUM_CELLS; i++) {
                    if ((world.jsStateArray[i] = Math.random() < density ? 1 : 0) === 1) activeCount++;
                }
            }
        } else { // Not enabled or not using initial densities (implies clear to 0)
            world.jsStateArray.fill(0);
        }
        world.jsRuleIndexArray.fill(0);
        world.jsNextStateArray.fill(0);
        world.jsNextRuleIndexArray.fill(0);
        world.jsHoverStateArray.fill(0);
        updateWorldStats(world, activeCount); // Also updates history and entropy
    }
}

function _clearWorldsInternal(scope = 'selected') {
    let affectedIndices = [];
    if (scope === 'all') {
        worldsData.forEach((w, i) => { if (w.enabled) affectedIndices.push(i); });
    } else if (typeof scope === 'number' && scope >= 0 && scope < worldsData.length && worldsData[scope].enabled) {
        affectedIndices.push(scope);
    } else return;

    for (const idx of affectedIndices) {
        const world = worldsData[idx];
        const targetState = world.jsStateArray.some(s => s === 1) ? 0 : 1;
        world.jsStateArray.fill(targetState);
        world.jsRuleIndexArray.fill(0);
        updateWorldStats(world, targetState === 1 ? Config.NUM_CELLS : 0);
    }
}

export function loadWorldState(worldIndex, stateData) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return false;
    if (stateData.rows !== Config.GRID_ROWS || stateData.cols !== Config.GRID_COLS || stateData.state.length !== Config.NUM_CELLS) return false;

    const world = worldsData[worldIndex];
    world.jsStateArray.set(Uint8Array.from(stateData.state));
    world.jsRuleIndexArray.fill(0);
    world.jsNextStateArray.fill(0);
    world.jsNextRuleIndexArray.fill(0);
    world.jsHoverStateArray.fill(0);

    const activeCount = world.jsStateArray.reduce((s,c)=>s+c,0);
    setWorldInitialDensity(worldIndex, Config.NUM_CELLS > 0 ? activeCount / Config.NUM_CELLS : 0);
    if (stateData.ruleset) _setGlobalRulesetInternal(stateData.ruleset); // This will fire RULESET_CHANGED

    updateWorldStats(world, activeCount); // Update stats immediately
    setWorldEnabled(worldIndex, true); // Enable the world

    if (worldIndex === selectedWorldIndex) EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, getSelectedWorldStats());
    EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, getWorldSettings());
    return true;
}

export function getWorldStateForSave(worldIndex) {
    if (worldIndex < 0 || worldIndex >= worldsData.length) return null;
    return {
        rows: Config.GRID_ROWS, cols: Config.GRID_COLS,
        ruleset: currentRulesetHex, state: Array.from(worldsData[worldIndex].jsStateArray)
    };
}

export function getWorldsData() { return worldsData; }
export function getCurrentRulesetHex() { return currentRulesetHex; }
export function isSimulationPaused() { return isPaused; }
export function getSelectedWorldIndex() { return selectedWorldIndex; }
export function getCurrentSimulationSpeed() { return currentSpeed; }
export function getCurrentBrushSize() { return currentBrushSize; }
export function getEntropySamplingState() { return { enabled: isEntropySamplingEnabled, rate: entropySampleRate }; }

export function setEntropySampling(enabled, rate) {
    isEntropySamplingEnabled = !!enabled;
    entropySampleRate = Math.max(1, Math.floor(rate));
    PersistenceService.saveUISetting('entropySamplingEnabled', isEntropySamplingEnabled);
    PersistenceService.saveUISetting('entropySampleRate', entropySampleRate);
    EventBus.dispatch(EVENTS.ENTROPY_SAMPLING_CHANGED, { enabled: isEntropySamplingEnabled, rate: entropySampleRate });
}

export function getSelectedWorldStats() {
    if (selectedWorldIndex >= 0 && selectedWorldIndex < worldsData.length) {
        const world = worldsData[selectedWorldIndex];
        if (world?.enabled && world?.stats) {
            const { ratio, avgRatio, history, entropyHistory } = world.stats;
            return { ratio, avgRatio, history, entropy: entropyHistory.length > 0 ? entropyHistory[entropyHistory.length -1] : calculateBinaryEntropy(ratio) };
        }
    }
    return { ratio: 0, avgRatio: 0, history: [], entropy: 0 };
}
export function getCurrentRulesetArray() { return new Uint8Array(currentRuleset); }
export function getSelectedWorldEntropyHistory() {
    return worldsData[selectedWorldIndex]?.stats?.entropyHistory || [];
}
export function getSelectedWorldRatioHistory() {
    return worldsData[selectedWorldIndex]?.stats?.history || [];
}
export function getSymmetryData() { return symmetryData; }