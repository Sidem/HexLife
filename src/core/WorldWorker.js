import * as Config from './config.js';
import init, { World } from './wasm-engine/hexlife_wasm.js';
import { rulesetToHex, findHexagonsInNeighborhood, packCells, unpackCellsInto } from '../utils/utils.js';
import { Throttler } from '../utils/throttler.js';
import { DensityStrategy } from './initialStateStrategies/DensityStrategy.js';
import { ClusterStrategy } from './initialStateStrategies/ClusterStrategy.js';

let _wasm_module;
let wasm_world;
let worldIndex = -1;
let workerConfig = {};
let jsStateArray = null;
let jsNextStateArray = null;
let jsRuleIndexArray = null;
let jsNextRuleIndexArray = null;
let ruleset = null;
let commandQueue = [];
let isRunning = false;
let isEnabled = true;
let tickIntervalId = null;
let currentSpeedTarget = Config.DEFAULT_SPEED;
let targetTickDurationMs = 1000 / Config.DEFAULT_SPEED;
// Tick-batching accumulator (see runTickBatch): carries fractional owed ticks
// between timer fires so real TPS tracks currentSpeedTarget despite the browser's
// ~4ms setInterval clamp.
let tickAccumulator = 0;
let lastBatchTime = 0;
let worldTickCounter = 0;
let ruleUsageCounters = null;
let ratioHistory = [];
let entropyHistory = [];
let hexBlockEntropyHistory = [];
const MAX_HISTORY_SIZE = Config.STATS_HISTORY_SIZE || 100;
let workerIsEntropySamplingEnabled = false;
let workerEntropySampleRate = 10;
let lastSentChecksum = null;
// Sliding window of recent state checksums for cycle detection. checksumWindowCounts is a
// Map<checksum, count> (not a Set) so evicting the oldest entry is O(1) — see recordChecksum.
let checksumWindowCounts = new Map();
let stateChecksumQueue = [];

let statsThrottler;
let gridThrottler;
let lastKnownStats = {};

let isCyclePlaybackMode = false;
let isDetectingCycle = false;
let detectedCycle = [];
let cyclePlaybackIndex = 0;
let cycleStartChecksum = null;

// --- Auto-explore evaluation burst (Phase 2) ---------------------------------
// A RUN_EVALUATION command runs the current (ruleset × state) for a fixed number of ticks in a
// tight chunked loop, collecting the cheap interestingness proxies the engine now exposes
// (changed-cell turnover, damage-spreading σ, block entropy, rule-usage delta, kill flags, cycle
// outcome) and replies once with EVALUATION_RESULT. The burst runs OUTSIDE the normal setInterval
// tick loop: it pauses normal ticking, self-schedules via setTimeout(0) between chunks so STOP /
// other commands stay responsive, and sends throttled grid updates so the search stays watchable.
let isEvaluating = false;
let evalState = null;
let evalTimerId = null;
// Per-chunk wall-clock budget — same responsiveness discipline as TICK_BATCH_TIME_BUDGET_MS.
const EVAL_CHUNK_BUDGET_MS = 8;
// Throttle grid sends during a burst to ~10 fps (watching the grid churn is the show; we don't go
// dark, but we don't flood the main thread with one send per tick either).
const EVAL_GRID_SEND_INTERVAL_MS = 100;
// A burst's final ratio at or above this counts as "saturated" (a kill signal in Phase 3).
const EVAL_SATURATION_RATIO = 0.99;
// Commands that change the cell state or ruleset being evaluated; receiving one mid-burst aborts the
// evaluation. Lifecycle-only commands (START/STOP/SPEED, entropy params) are deliberately excluded.
const EVAL_DISRUPTIVE_COMMANDS = new Set([
    'RESET_WORLD', 'LOAD_STATE', 'SET_RULESET', 'APPLY_BRUSH', 'APPLY_SELECTIVE_BRUSH', 'SET_ENABLED',
]);

const strategies = {
    density: new DensityStrategy(),
    clusters: new ClusterStrategy()
};

function mulberry32(a) {
    return function() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// Checksum of the current state buffer. The buffer lives in Wasm linear memory now, so this is
// computed entirely inside Wasm (no array is copied across the boundary).
function stateChecksum() {
    if (!wasm_world) return 0;
    return wasm_world.checksum_state();
}

// (Re)build the typed-array views over the World's buffers in Wasm linear memory. Called once after
// the World is constructed. The views are never copied per-tick; `run_tick` swaps the current/next
// buffers internally and the worker mirrors that by swapping its view references (see runTick).
function refreshSimViews() {
    const mem = _wasm_module.memory.buffer;
    const n = workerConfig.NUM_CELLS;
    jsStateArray = new Uint8Array(mem, wasm_world.state_ptr(), n);
    jsNextStateArray = new Uint8Array(mem, wasm_world.next_state_ptr(), n);
    jsRuleIndexArray = new Uint8Array(mem, wasm_world.rule_indices_ptr(), n);
    jsNextRuleIndexArray = new Uint8Array(mem, wasm_world.next_rule_indices_ptr(), n);
    ruleset = new Uint8Array(mem, wasm_world.ruleset_ptr(), 128);
    ruleUsageCounters = new Uint32Array(mem, wasm_world.rule_usage_counters_ptr(), 128);
}

// Copies a view's bytes into a fresh, transferable ArrayBuffer. Required because the views are
// backed by Wasm linear memory: transferring `view.buffer` directly would detach all of Wasm
// memory, and slicing `view.buffer` would copy the entire heap rather than just the cells.
function copyOutBuffer(view) {
    return view.slice().buffer;
}

// Transfer-back pool for the two STATE_UPDATE cell buffers. After the main thread consumes a grid
// send it posts the now-replaced ArrayBuffers back (RECLAIM_BUFFERS, transferred); copyCellsOut
// refills one instead of allocating a fresh NUM_CELLS buffer per send (~display rate × 9 worlds).
// In steady state two pairs of buffers ping-pong between worker and main thread with zero
// per-frame allocation. Bounded so a lagging/stalled main thread can't grow it without limit.
let cellBufferPool = [];
const MAX_POOLED_BUFFERS = 4; // 2 in flight + slack

// Pop a pooled cell buffer of the current NUM_CELLS size, discarding any stale-sized leftovers
// (e.g. survivors of a grid-dimension change); allocate fresh only when the pool can't supply one.
function acquireCellBuffer() {
    const n = workerConfig.NUM_CELLS;
    while (cellBufferPool.length > 0) {
        const buf = cellBufferPool.pop();
        if (buf.byteLength === n) return buf;
    }
    return new ArrayBuffer(n);
}

// Cell-buffer equivalent of copyOutBuffer that draws from the transfer-back pool. Used only for the
// state / rule-index payloads (both NUM_CELLS bytes), which dominate the per-send allocation churn.
function copyCellsOut(view) {
    const buf = acquireCellBuffer();
    new Uint8Array(buf).set(view);
    return buf;
}

function resetCycleState() {
    isCyclePlaybackMode = false;
    isDetectingCycle = false;
    detectedCycle = [];
    cyclePlaybackIndex = 0;
    cycleStartChecksum = null;
    checksumWindowCounts.clear();
    stateChecksumQueue = [];
    lastSentChecksum = null;
}

// Abort an in-progress cycle-detection attempt without discarding the checksum history. Used when a
// candidate "cycle" turns out to be a spurious 32-bit checksum collision (states differ) or grows
// past CYCLE_DETECTION_MAX_PERIOD. The simulation keeps running normally and may legitimately
// detect a real cycle later.
function abortCycleDetection() {
    isDetectingCycle = false;
    detectedCycle = [];
    cycleStartChecksum = null;
}

// Capture one cycle frame. The binary state is bit-packed (8 cells/byte) to keep collected-frame
// memory bounded — up to CYCLE_DETECTION_MAX_PERIOD frames are held while detecting, so on the
// "huge" preset the unpacked form would cost hundreds of MB/world. The rule-index array (0-127
// per cell) isn't binary, so it's kept as a byte copy for faithful playback colouring.
// activeCount is stored alongside (the caller already has it for this state) so playback reads it
// directly instead of recomputing an O(NUM_CELLS) reduce every replayed tick.
function captureCycleFrame(activeCount) {
    return {
        state: packCells(jsStateArray),
        rules: jsRuleIndexArray.slice(),
        activeCount
    };
}

// Record a state checksum into the sliding detection window. Eviction of the oldest entry is
// O(1): decrement its count in checksumWindowCounts and forget the checksum only when no copies
// remain in the window — replacing an earlier per-tick O(window) `queue.includes(oldest)` rescan.
function recordChecksum(checksum) {
    stateChecksumQueue.push(checksum);
    checksumWindowCounts.set(checksum, (checksumWindowCounts.get(checksum) || 0) + 1);
    if (stateChecksumQueue.length > Config.CYCLE_DETECTION_HISTORY_SIZE) {
        const oldest = stateChecksumQueue.shift();
        const remaining = (checksumWindowCounts.get(oldest) || 0) - 1;
        if (remaining > 0) checksumWindowCounts.set(oldest, remaining);
        else checksumWindowCounts.delete(oldest);
    }
}

// Byte-for-byte equality of two Uint8Array views over the same logical length. Used to confirm a
// recurring checksum reflects a genuinely identical state before committing to cycle playback.
function statesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function calculateBinaryEntropy(p1) { if (p1 <= 0 || p1 >= 1) return 0; const p0 = 1 - p1; return -(p1 * Math.log2(p1) + p0 * Math.log2(p0)); }

// Assemble the lastKnownStats snapshot from current world state. activeCount is passed in (every
// caller already has it); ratio derives from it. binaryEntropy/blockEntropy are passed explicitly
// because callers differ on whether/how they sample entropy (live tick carries forward the last
// sample; force/enable/reset paths compute or leave them undefined).
function buildStats(activeCount, binaryEntropy, blockEntropy) {
    return {
        tick: worldTickCounter,
        activeCount,
        ratio: workerConfig.NUM_CELLS > 0 ? activeCount / workerConfig.NUM_CELLS : 0,
        binaryEntropy,
        blockEntropy,
        rulesetHex: rulesetToHex(ruleset),
        isEnabled,
        isInCycle: isCyclePlaybackMode,
        cycleLength: isCyclePlaybackMode ? detectedCycle.length : 0,
    };
}

// Hex block entropy is computed in Wasm over the state buffer it already owns (see World::block_entropy).
function calculateHexBlockEntropy() {
    return wasm_world ? wasm_world.block_entropy() : 0;
}

function applySelectiveBrushLogic(cellIndices, brushMode = 'invert') {
    if (!jsStateArray || !cellIndices || cellIndices.size === 0) return false;
    let changed = false;
    for (const idx of cellIndices) {
        if (idx >= 0 && idx < workerConfig.NUM_CELLS) {
            const previousState = jsStateArray[idx];
            let newState = previousState;

            if (brushMode === 'invert') {
                newState = 1 - previousState;
            } else if (brushMode === 'draw') {
                newState = 1;
            } else if (brushMode === 'erase') {
                newState = 0;
            }

            if (newState !== previousState) {
                jsStateArray[idx] = newState;
                if(jsRuleIndexArray) jsRuleIndexArray[idx] = 255; // Use 255 to signal a manual change
                changed = true;
            }
        }
    }
    return changed;
}

function processCommandQueue() {
    let needsGridUpdate = false;
    let rulesetChangedInQueue = false;

    for (const command of commandQueue) {
        switch (command.type) {
            case 'SET_RULESET': {
                ruleset.set(new Uint8Array(command.data.rulesetBuffer));
                rulesetChangedInQueue = true;
                needsGridUpdate = true;
                resetCycleState();
                break;
            }
            case 'RESET_WORLD': {
                worldTickCounter = 0;
                ratioHistory = [];
                entropyHistory = [];
                hexBlockEntropyHistory = [];
                const config = command.data.initialState;
                const isClearOp = command.data.isClearOperation || false;
                const seed = command.data.seed;
                const rng = seed ? mulberry32(seed) : Math.random;

                if (ruleUsageCounters) ruleUsageCounters.fill(0);
                if (jsStateArray) {
                    if (isClearOp) {
                        jsStateArray.fill(config.params.density);
                    } else {
                        const strategy = strategies[config.mode];
                        if (strategy) {
                            strategy.generate(jsStateArray, config.params, rng, workerConfig);
                        } else {
                            // Fallback to density
                            strategies.density.generate(jsStateArray, config.params, rng, workerConfig);
                        }
                    }
                }
                if(jsRuleIndexArray) jsRuleIndexArray.fill(255); // Use 255 as a flag for "initial state"
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                resetCycleState();
                needsGridUpdate = true;
                break;
            }
            case 'APPLY_BRUSH':
            case 'APPLY_SELECTIVE_BRUSH': {
                let brushChanged = false;
                if (command.type === 'APPLY_BRUSH') {
                    const affectedIndicesInBrush = new Set();
                    findHexagonsInNeighborhood(command.data.col, command.data.row, command.data.brushSize, affectedIndicesInBrush);
                    brushChanged = applySelectiveBrushLogic(affectedIndicesInBrush);
                } else {
                    brushChanged = applySelectiveBrushLogic(command.data.cellIndices, command.data.brushMode);
                }
                if (brushChanged) {
                    resetCycleState();
                    needsGridUpdate = true;
                }
                break;
            }
            case 'SET_ENABLED': {
                isEnabled = command.data.enabled;
                 if (!isEnabled && jsStateArray) {
                    jsStateArray.fill(0);
                    if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                    resetCycleState();
                    needsGridUpdate = true;
                } else if (isEnabled && jsStateArray) {
                    lastSentChecksum = null;
                    needsGridUpdate = true;
                }
                break;
            }
            case 'LOAD_STATE': {
                jsStateArray.set(new Uint8Array(command.data.newStateBuffer));
                ruleset.set(new Uint8Array(command.data.newRulesetBuffer));
                worldTickCounter = command.data.worldTick || 0;
                ratioHistory = [];
                entropyHistory = [];
                hexBlockEntropyHistory = [];
                if (ruleUsageCounters) ruleUsageCounters.fill(0);
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                if(jsNextStateArray) jsNextStateArray.fill(0);
                if(jsNextRuleIndexArray) jsNextRuleIndexArray.fill(0);
                isEnabled = true;
                resetCycleState();
                needsGridUpdate = true;
                rulesetChangedInQueue = true;
                break;
            }
        }
    }
    commandQueue = [];

    return { needsGridUpdate, rulesetChangedInQueue };
}

function runTick() {
    const { needsGridUpdate, rulesetChangedInQueue } = processCommandQueue();
    let simulationPerformedUpdate = false;
    if (!isEnabled || !isRunning) {
        if (needsGridUpdate || rulesetChangedInQueue) {
            forceSyncUpdate();
        }
        return;
    }
    
    let activeCount;
    if (isCyclePlaybackMode) {
        worldTickCounter++;
        const nextFrame = detectedCycle[cyclePlaybackIndex];
        // Playback writes directly into the current state buffer (no run_tick, no buffer swap),
        // so the Wasm-owned `state` and the worker's views stay in sync. The frame's state is
        // bit-packed (8 cells/byte); unpack it back into the live view.
        unpackCellsInto(nextFrame.state, jsStateArray, workerConfig.NUM_CELLS);
        jsRuleIndexArray.set(nextFrame.rules);
        cyclePlaybackIndex = (cyclePlaybackIndex + 1) % detectedCycle.length;
        // Stored at capture (see captureCycleFrame) — avoids an O(NUM_CELLS) reduce per tick.
        activeCount = nextFrame.activeCount;
    } else {
        worldTickCounter++;
        // run_tick advances the simulation inside Wasm and swaps the current/next buffers
        // internally, returning the active-cell count of the new generation. Mirror that swap on
        // the worker's views so they keep tracking the now-current buffers in linear memory.
        activeCount = wasm_world.run_tick();
        [jsStateArray, jsNextStateArray] = [jsNextStateArray, jsStateArray];
        [jsRuleIndexArray, jsNextRuleIndexArray] = [jsNextRuleIndexArray, jsRuleIndexArray];
    }

    const newStateChecksum = stateChecksum();


    if (isDetectingCycle) {
        if (newStateChecksum === cycleStartChecksum && statesEqual(packCells(jsStateArray), detectedCycle[0].state)) {
            // Verified: the recurring checksum reflects a genuinely identical state, so the frames
            // collected so far form one true period of the cycle. Commit to playback.
            isCyclePlaybackMode = true;
            isDetectingCycle = false;
            cyclePlaybackIndex = 0;
        } else if (detectedCycle.length >= Config.CYCLE_DETECTION_MAX_PERIOD) {
            // The candidate cycle grew past the cap without closing — almost certainly a spurious
            // checksum collision. Abort so we stop copying a full state every tick.
            abortCycleDetection();
        } else {
            detectedCycle.push(captureCycleFrame(activeCount));
        }
    } else if (!isCyclePlaybackMode && checksumWindowCounts.has(newStateChecksum)) {
        isDetectingCycle = true;
        cycleStartChecksum = newStateChecksum;
        detectedCycle = [captureCycleFrame(activeCount)];
    }

    if (!isCyclePlaybackMode) {
        recordChecksum(newStateChecksum);
    }

    if (newStateChecksum !== lastSentChecksum) {
        simulationPerformedUpdate = true;
    }

    

    const ratio = workerConfig.NUM_CELLS > 0 ? activeCount / workerConfig.NUM_CELLS : 0;
    let currentBinaryEntropy, currentBlockEntropy;
    const shouldSampleEntropy = workerIsEntropySamplingEnabled && (worldTickCounter % workerEntropySampleRate === 0);

    if (shouldSampleEntropy) {
        currentBinaryEntropy = calculateBinaryEntropy(ratio);
        currentBlockEntropy = calculateHexBlockEntropy();
        entropyHistory.push(currentBinaryEntropy);
        hexBlockEntropyHistory.push(currentBlockEntropy);
        if (entropyHistory.length > MAX_HISTORY_SIZE) entropyHistory.shift();
        if (hexBlockEntropyHistory.length > MAX_HISTORY_SIZE) hexBlockEntropyHistory.shift();
    }

    ratioHistory.push(ratio);
    if (ratioHistory.length > MAX_HISTORY_SIZE) ratioHistory.shift();
    
    
    lastKnownStats = buildStats(
        activeCount,
        currentBinaryEntropy ?? lastKnownStats.binaryEntropy,
        currentBlockEntropy ?? lastKnownStats.blockEntropy
    );

    
    statsThrottler.schedule();

    
    if (simulationPerformedUpdate) {
        lastSentChecksum = newStateChecksum;
        // Throttled to ~display rate. sendGridUpdate reads the current buffers at fire time, so a
        // deferred send always carries the latest frame, never a stale one.
        gridThrottler.schedule();
    }
}


function sendGridUpdate() {
    // Any actual send (throttled or forced) clears a pending throttled send so forced syncs don't
    // get followed by a redundant duplicate frame.
    if (gridThrottler) gridThrottler.cancel();
    if (!jsStateArray || !jsRuleIndexArray) {
        console.warn(`Worker ${worldIndex}: Attempted to send grid update with invalid/missing buffers.`);
        return;
    }

    // State and rule-index views are backed by Wasm linear memory, so copy out just their cells
    // into fresh transferable buffers (never transfer/slice the whole Wasm heap). Hover is
    // main-thread-only now, so it is no longer part of this payload.
    const statePayload = {
        type: 'STATE_UPDATE',
        worldIndex: worldIndex,
        stateBuffer: copyCellsOut(jsStateArray),
        ruleIndexBuffer: copyCellsOut(jsRuleIndexArray),
    };
    const transferListState = [statePayload.stateBuffer, statePayload.ruleIndexBuffer];
    self.postMessage(statePayload, transferListState);
}

function sendStatsUpdate(forceUpdate = false) {
    
    if (!isRunning && !forceUpdate) return;

    // ruleUsageCounters is a view into Wasm memory; copy only its 128 entries out.
    const ruleUsageCountersBuffer = ruleUsageCounters ? copyOutBuffer(ruleUsageCounters) : null;
    const transferListStats = ruleUsageCountersBuffer ? [ruleUsageCountersBuffer] : [];

    self.postMessage({
        type: 'STATS_UPDATE',
        worldIndex: worldIndex,
        ...lastKnownStats,
        ruleUsageCounters: ruleUsageCountersBuffer,
    }, transferListStats);
}

function forceSyncUpdate() {
    
    
    if (!jsStateArray) return;
    lastSentChecksum = stateChecksum();
    sendGridUpdate();

    const active = jsStateArray.reduce((s, c) => s + c, 0);
    const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
    let binaryEntropy, blockEntropy;

    if (workerIsEntropySamplingEnabled) {
        binaryEntropy = calculateBinaryEntropy(ratio);
        blockEntropy = calculateHexBlockEntropy();
    }

    
    lastKnownStats = buildStats(active, binaryEntropy, blockEntropy);

    sendStatsUpdate(true);
}

// Per-fire wall-clock budget. Browsers clamp setInterval to ~4ms, so a single
// runTick per fire caps real TPS well below high targets and drifts. runTickBatch
// instead runs as many ticks as elapsed real time owes, bounded by this budget so
// the worker stays responsive to incoming commands; debt it can't service is
// dropped (capped accumulator) rather than spiralling.
const TICK_BATCH_TIME_BUDGET_MS = 8;

function runTickBatch() {
    const now = performance.now();
    let elapsed = now - lastBatchTime;
    lastBatchTime = now;
    if (elapsed < 0) elapsed = 0; // guard against a non-monotonic clock reading

    // While paused/disabled, a single runTick still drains the command queue
    // (and force-syncs if a ruleset/grid edit arrived) without advancing the sim.
    if (!isRunning || !isEnabled) {
        runTick();
        return;
    }

    tickAccumulator += (elapsed * currentSpeedTarget) / 1000;
    // Cap owed ticks to ~one second of catch-up so a long stall (GC, backgrounded
    // tab) doesn't unleash a huge burst on the next fire.
    const maxDebt = Math.max(currentSpeedTarget, 1);
    if (tickAccumulator > maxDebt) tickAccumulator = maxDebt;

    while (tickAccumulator >= 1) {
        runTick();
        tickAccumulator -= 1;
        // Cycle playback / a stop command mid-batch flips these; bail so we don't
        // keep ticking a sim that just halted.
        if (!isRunning || !isEnabled) {
            tickAccumulator = 0;
            break;
        }
        if (performance.now() - now >= TICK_BATCH_TIME_BUDGET_MS) {
            tickAccumulator = 0; // drop unservable debt; resync next fire
            break;
        }
    }
}

function updateSimulationInterval() {
    if (tickIntervalId) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
    }
    if (isRunning && isEnabled) {
        targetTickDurationMs = Math.max(1, 1000 / currentSpeedTarget);
        // Reset the accumulator clock so a speed change or (re)start doesn't book
        // ticks for the idle gap before this interval existed.
        lastBatchTime = performance.now();
        tickAccumulator = 0;
        tickIntervalId = setInterval(runTickBatch, targetTickDurationMs);
    }
}

// Advance one evaluation tick: step the sim, mirror the buffer swap, and run the same cycle
// detection the live loop uses (so a burst that falls into a cycle can be classified as terminal).
// Deliberately does NOT touch the normal stats histories — eval metrics are accumulated separately
// in evalState, leaving ratioHistory/entropyHistory untouched for the live UI.
function evalTick() {
    worldTickCounter++;
    const activeCount = wasm_world.run_tick();
    [jsStateArray, jsNextStateArray] = [jsNextStateArray, jsStateArray];
    [jsRuleIndexArray, jsNextRuleIndexArray] = [jsNextRuleIndexArray, jsRuleIndexArray];

    const newChecksum = stateChecksum();

    // Mirror of runTick's cycle detection (kept in lockstep on purpose).
    if (isDetectingCycle) {
        if (newChecksum === cycleStartChecksum && statesEqual(packCells(jsStateArray), detectedCycle[0].state)) {
            isCyclePlaybackMode = true;
            isDetectingCycle = false;
            cyclePlaybackIndex = 0;
        } else if (detectedCycle.length >= Config.CYCLE_DETECTION_MAX_PERIOD) {
            abortCycleDetection();
        } else {
            detectedCycle.push(captureCycleFrame(activeCount));
        }
    } else if (!isCyclePlaybackMode && checksumWindowCounts.has(newChecksum)) {
        isDetectingCycle = true;
        cycleStartChecksum = newChecksum;
        detectedCycle = [captureCycleFrame(activeCount)];
    }
    if (!isCyclePlaybackMode) {
        recordChecksum(newChecksum);
    }

    return activeCount;
}

// Estimate the branching parameter σ from a damage-spreading Hamming series. σ is the mean
// per-generation growth factor of a single-cell perturbation: σ<1 sub-critical (damage heals),
// σ≈1 critical (edge of chaos — what auto-explore hunts for), σ>1 super-critical (chaos). We fit a
// line to ln(hamming) vs generation over the early, UNSATURATED regime (damage still small relative
// to the grid) and take σ=exp(slope). The implicit starting point (gen 0, hamming 1 → ln 0) anchors
// the fit. Returns 0 when the perturbation dies on the first generation, or null when no probe ran.
function estimateSigma(hammingSeries, numCells) {
    if (!hammingSeries || hammingSeries.length === 0) return null;
    const saturationCap = 0.25 * numCells;
    const xs = [0];
    const ys = [0]; // (generation 0, ln(initial hamming = 1) = 0)
    for (let i = 0; i < hammingSeries.length; i++) {
        const h = hammingSeries[i];
        if (h <= 0) break;            // damage healed — stop (the rest are zeros)
        if (h > saturationCap) break; // damage saturated — later points no longer reflect growth
        xs.push(i + 1);
        ys.push(Math.log(h));
    }
    if (xs.length < 2) {
        // Only the anchor survived: the perturbation died on (or before) the first sampled
        // generation, or instantly saturated. Healed ⇒ sub-critical (0); saturated ⇒ super-critical.
        return hammingSeries[0] > saturationCap ? Infinity : 0;
    }
    const n = xs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
        sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
    }
    const denom = n * sxx - sx * sx;
    if (denom === 0) return null;
    const slope = (n * sxy - sx * sy) / denom;
    return Math.exp(slope);
}

// Tear down an in-flight evaluation (used when a state-mutating command arrives mid-burst, or
// before starting a fresh burst). Still posts an EVALUATION_RESULT — flagged `cancelled` — so the
// caller's pending promise resolves rather than hanging forever. Restores normal ticking if the sim
// was running.
function cancelEvaluation(reason) {
    if (!isEvaluating) return;
    if (evalTimerId !== null) { clearTimeout(evalTimerId); evalTimerId = null; }
    if (wasm_world) wasm_world.stop_probe();
    isEvaluating = false;
    evalState = null;
    self.postMessage({ type: 'EVALUATION_RESULT', worldIndex, cancelled: true, cancelledBy: reason || null });
    updateSimulationInterval();
}

// Begin a burst. Snapshots the rule-usage counters (so we can report the per-burst delta), arms the
// damage probe if requested, pauses the normal tick interval, and kicks off the chunk loop.
function startEvaluation(opts) {
    if (!wasm_world) return;
    if (isEvaluating) cancelEvaluation();

    const ticks = Math.max(1, opts.ticks || 300);
    const sampleEvery = Math.max(1, opts.sampleEvery || 10);
    const probeOpts = opts.probe || {};
    const probeEnabled = !!probeOpts.enabled;
    const probeTicks = Math.max(0, probeOpts.probeTicks || 0);
    // Default the flip to the grid centre when the caller doesn't pin one.
    const flipIndex = Number.isInteger(probeOpts.flipIndex)
        ? probeOpts.flipIndex
        : Math.floor(workerConfig.NUM_CELLS / 2);

    // Pause normal ticking for the duration of the burst.
    if (tickIntervalId) { clearInterval(tickIntervalId); tickIntervalId = null; }

    // Fresh cycle-detection window for this burst (a cycle reached during eval is terminal).
    resetCycleState();
    recordChecksum(stateChecksum());

    if (probeEnabled && probeTicks > 0) {
        wasm_world.start_probe(flipIndex);
        // start_probe lazily allocates the two probe buffers, which can GROW Wasm linear memory and
        // thereby detach every typed-array view over it (state/ruleset/usage counters). Rebuild the
        // views so the burst reads live memory rather than a detached buffer.
        refreshSimViews();
    }

    evalState = {
        ticks,
        sampleEvery,
        probe: { enabled: probeEnabled && probeTicks > 0, flipIndex, probeTicks },
        ticksDone: 0,
        // changed-cell turnover: online accumulators (mean / variance / Fano / CV at the end).
        changedSum: 0,
        changedSumSq: 0,
        changedN: 0,
        // block-entropy samples (level + variance computed at the end).
        blockEntropySamples: [],
        // damage-spreading Hamming series over the probe window.
        probeHamming: [],
        // rule-usage counters at burst start; the delta over the burst is end - start.
        startRuleUsage: ruleUsageCounters ? ruleUsageCounters.slice() : new Uint32Array(128),
        lastActiveCount: wasm_world.active_count(),
        cycleDetected: false,
        cyclePeriod: 0,
        lastGridSendTime: 0,
    };
    isEvaluating = true;
    evalTimerId = setTimeout(runEvaluationChunk, 0);
}

// Run one time-budgeted chunk of the burst, then either finish or self-reschedule.
function runEvaluationChunk() {
    evalTimerId = null;
    if (!isEvaluating || !evalState) return;
    const chunkStart = performance.now();

    while (evalState.ticksDone < evalState.ticks) {
        const t = evalState.ticksDone; // 0-based index of the tick about to run
        const activeCount = evalTick();
        evalState.ticksDone++;
        evalState.lastActiveCount = activeCount;

        const changed = wasm_world.last_changed_count();
        evalState.changedSum += changed;
        evalState.changedSumSq += changed * changed;
        evalState.changedN++;

        // Damage probe: sample Hamming within the window, then free the probe lane once it closes.
        if (evalState.probe.enabled && t < evalState.probe.probeTicks) {
            evalState.probeHamming.push(wasm_world.probe_hamming());
            if (t + 1 >= evalState.probe.probeTicks) {
                wasm_world.stop_probe();
            }
        }

        // Block-entropy sampling.
        if (t % evalState.sampleEvery === 0) {
            evalState.blockEntropySamples.push(calculateHexBlockEntropy());
        }

        // Falling into a cycle is a definitive classification — stop burning ticks.
        if (isCyclePlaybackMode) {
            evalState.cycleDetected = true;
            evalState.cyclePeriod = detectedCycle.length;
            break;
        }

        if (performance.now() - chunkStart >= EVAL_CHUNK_BUDGET_MS) break;
    }

    // Throttled grid send so the search stays watchable.
    const now = performance.now();
    if (now - evalState.lastGridSendTime >= EVAL_GRID_SEND_INTERVAL_MS) {
        evalState.lastGridSendTime = now;
        sendGridUpdate();
    }

    if (evalState.ticksDone >= evalState.ticks || evalState.cycleDetected) {
        finishEvaluation();
    } else {
        evalTimerId = setTimeout(runEvaluationChunk, 0);
    }
}

// Reduce the burst's accumulators to a summary and post EVALUATION_RESULT, then restore normal
// ticking. All scoring/weighting lives downstream (Phase 3) — this reply carries only raw metrics.
function finishEvaluation() {
    const s = evalState;
    if (!s) return;
    if (wasm_world) wasm_world.stop_probe();

    const numCells = workerConfig.NUM_CELLS || 1;
    const finalActiveCount = s.lastActiveCount;
    const finalRatio = finalActiveCount / numCells;

    // Changed-cell turnover stats.
    const changedMean = s.changedN > 0 ? s.changedSum / s.changedN : 0;
    const changedVar = s.changedN > 0
        ? Math.max(0, s.changedSumSq / s.changedN - changedMean * changedMean)
        : 0;
    const changedStd = Math.sqrt(changedVar);
    const changedFano = changedMean > 0 ? changedVar / changedMean : 0; // variance/mean (susceptibility proxy)
    const changedCV = changedMean > 0 ? changedStd / changedMean : 0;   // coefficient of variation

    // Block-entropy level + variance.
    let beMean = 0, beVar = 0;
    const beSamples = s.blockEntropySamples;
    if (beSamples.length > 0) {
        for (const v of beSamples) beMean += v;
        beMean /= beSamples.length;
        for (const v of beSamples) beVar += (v - beMean) * (v - beMean);
        beVar /= beSamples.length;
    }

    const sigma = s.probe.enabled ? estimateSigma(s.probeHamming, numCells) : null;

    // Per-rule usage delta over the burst (end - start); a Shannon-diversity input for Phase 3.
    const ruleUsageDelta = new Uint32Array(128);
    if (ruleUsageCounters) {
        for (let i = 0; i < 128; i++) {
            ruleUsageDelta[i] = (ruleUsageCounters[i] - s.startRuleUsage[i]) >>> 0;
        }
    }
    const ruleUsageDeltaBuffer = ruleUsageDelta.buffer;

    const result = {
        type: 'EVALUATION_RESULT',
        worldIndex,
        ticksRun: s.ticksDone,
        finalRatio,
        finalActiveCount,
        changed: {
            mean: changedMean,
            variance: changedVar,
            fano: changedFano,
            cv: changedCV,
        },
        blockEntropy: {
            mean: beMean,
            variance: beVar,
            samples: beSamples,
        },
        sigma,
        probeHamming: s.probeHamming,
        ruleUsageDelta: ruleUsageDeltaBuffer,
        extinct: finalActiveCount === 0,
        saturated: finalRatio >= EVAL_SATURATION_RATIO,
        cycle: { detected: s.cycleDetected, period: s.cyclePeriod },
    };

    isEvaluating = false;
    evalState = null;
    self.postMessage(result, [ruleUsageDeltaBuffer]);

    // Resume normal ticking if the sim was running before the burst.
    updateSimulationInterval();
}

self.onmessage = async function(event) {
    const command = event.data;

    // A command that mutates the world's cell state or ruleset mid-burst invalidates the evaluation,
    // so abort it (the proxy promise still resolves via the cancelled result). Benign lifecycle
    // commands (START/STOP/SPEED/entropy params) don't touch the evaluated state and are allowed to
    // run alongside the burst — their effect is reapplied when the burst restores normal ticking.
    // RUN_EVALUATION restarts cleanly via startEvaluation; RECLAIM_BUFFERS is harmless.
    if (isEvaluating && EVAL_DISRUPTIVE_COMMANDS.has(command.type)) {
        cancelEvaluation(command.type);
    }

    switch (command.type) {
        case 'INIT': {
            _wasm_module = await init();
            wasm_world = new World(command.data.config.GRID_COLS, command.data.config.GRID_ROWS);
            worldIndex = command.data.worldIndex;
            workerConfig = command.data.config;
            currentSpeedTarget = command.data.initialSpeed || Config.DEFAULT_SPEED;
            targetTickDurationMs = 1000 / currentSpeedTarget;
            ratioHistory = [];
            entropyHistory = [];
            hexBlockEntropyHistory = [];
            // State, next-state, rule-index, ruleset and usage-counter buffers all live in Wasm
            // linear memory; build typed-array views over them rather than allocating in JS.
            refreshSimViews();
            ruleset.set(new Uint8Array(command.data.initialRulesetBuffer));
            isEnabled = command.data.initialIsEnabled;
            workerIsEntropySamplingEnabled = command.data.initialEntropySamplingEnabled;
            workerEntropySampleRate = command.data.initialEntropySampleRate || 10;

            statsThrottler = new Throttler(sendStatsUpdate, Config.STATS_UPDATE_INTERVAL_MS);
            gridThrottler = new Throttler(sendGridUpdate, Config.GRID_UPDATE_INTERVAL_MS);

            resetCycleState();

            if (isEnabled) {
                const initialState = command.data.initialState;
                const seed = command.data.seed || Date.now();
                const rng = seed ? mulberry32(seed) : Math.random;
                const strategy = strategies[initialState.mode];
                if (strategy) {
                    strategy.generate(jsStateArray, initialState.params, rng, workerConfig);
                } else {
                    strategies.density.generate(jsStateArray, initialState.params, rng, workerConfig);
                }
                jsRuleIndexArray.fill(255); // Use 255 as a flag for "initial state"
            } else {
                jsStateArray.fill(0);
                jsRuleIndexArray.fill(255); // Use 255 as a flag for "initial state"
            }

            const initialChecksum = stateChecksum();
            recordChecksum(initialChecksum);
            lastSentChecksum = initialChecksum;

            const initialActiveCount = isEnabled && jsStateArray ? jsStateArray.reduce((s, c) => s + c, 0) : 0;
            const initialRatio = isEnabled && workerConfig.NUM_CELLS > 0 ? initialActiveCount / workerConfig.NUM_CELLS : 0; 
            let initialBinaryEntropy, initialBlockEntropy;
            if (isEnabled && workerIsEntropySamplingEnabled) {
                initialBinaryEntropy = calculateBinaryEntropy(initialRatio);
                initialBlockEntropy = calculateHexBlockEntropy();
                ratioHistory.push(initialRatio);
                entropyHistory.push(initialBinaryEntropy);
                hexBlockEntropyHistory.push(initialBlockEntropy);
            } else if (isEnabled) {
                ratioHistory.push(initialRatio);
            }

            
            lastKnownStats = buildStats(initialActiveCount, initialBinaryEntropy, initialBlockEntropy);

            self.postMessage({ type: 'INIT_ACK', worldIndex: worldIndex });
            sendGridUpdate();
            sendStatsUpdate(true); 
            break;
        }

        case 'START_SIMULATION': {
            isRunning = true;
            updateSimulationInterval();
            break;
        }
        case 'STOP_SIMULATION': {
            isRunning = false;
            updateSimulationInterval();
            break;
        }
        case 'SET_SPEED_TARGET': {
            currentSpeedTarget = command.data.speed;
            updateSimulationInterval();
            break;
        }
        case 'SET_ENABLED': {
            const prevEnabled = isEnabled;
            isEnabled = command.data.enabled;
            let sendUpdateForSetEnabled = false;
            if (!isEnabled && jsStateArray) {
                jsStateArray.fill(0);
                if(jsRuleIndexArray) jsRuleIndexArray.fill(0);
                resetCycleState();
                
                sendUpdateForSetEnabled = true;
            } else if (isEnabled && !prevEnabled && jsStateArray) {
                 lastSentChecksum = null; 
                 sendUpdateForSetEnabled = true;
            }
            updateSimulationInterval(); 
            if (sendUpdateForSetEnabled) {
                lastSentChecksum = stateChecksum();
                const activeAfterEnable = jsStateArray.reduce((s, c) => s + c, 0);
                const ratioAfterEnable = workerConfig.NUM_CELLS > 0 ? activeAfterEnable / workerConfig.NUM_CELLS : 0; 
                
                
                lastKnownStats = buildStats(
                    activeAfterEnable,
                    workerIsEntropySamplingEnabled ? calculateBinaryEntropy(ratioAfterEnable) : undefined,
                    workerIsEntropySamplingEnabled ? calculateHexBlockEntropy() : undefined
                );

                sendGridUpdate();
                sendStatsUpdate(true); 
            }
            break;
        }

        case 'SET_ENTROPY_SAMPLING_PARAMS': {
            workerIsEntropySamplingEnabled = command.data.enabled;
            workerEntropySampleRate = command.data.rate || 10;
            if (!workerIsEntropySamplingEnabled) {
                entropyHistory = [];
                hexBlockEntropyHistory = [];
            }
            break;
        }

        case 'RESET_WORLD':
        case 'APPLY_BRUSH':
        case 'APPLY_SELECTIVE_BRUSH':
        case 'LOAD_STATE': {
            commandQueue.push(command);
            const { needsGridUpdate: inducedUpdateOnGrid } = processCommandQueue();
            if (inducedUpdateOnGrid) {
                lastSentChecksum = stateChecksum();
                const active = jsStateArray.reduce((s, c) => s + c, 0);
                const ratio = workerConfig.NUM_CELLS > 0 ? active / workerConfig.NUM_CELLS : 0;
                
                
                lastKnownStats = buildStats(
                    active,
                    workerIsEntropySamplingEnabled ? calculateBinaryEntropy(ratio) : undefined,
                    workerIsEntropySamplingEnabled ? calculateHexBlockEntropy() : undefined
                );

                sendGridUpdate();
                sendStatsUpdate(true); 
            }
            break;
        }

        case 'SET_RULESET': {
            commandQueue.push(command);
            if (!isRunning || !isEnabled) {
                runTick();
            }
            break;
        }
        case 'RUN_EVALUATION': {
            // { ticks, sampleEvery, probe: { enabled, flipIndex, probeTicks } } → one EVALUATION_RESULT.
            startEvaluation(command.data || {});
            break;
        }
        case 'RECLAIM_BUFFERS': {
            // Main thread returning consumed STATE_UPDATE buffers for reuse. Pool only
            // current-size buffers and only up to the cap (defends against a stale size after a
            // grid change, and against unbounded growth if sends ever outpace reclaims).
            const buffers = command.data && command.data.buffers;
            if (buffers) {
                for (const buf of buffers) {
                    if (buf && buf.byteLength === workerConfig.NUM_CELLS &&
                        cellBufferPool.length < MAX_POOLED_BUFFERS) {
                        cellBufferPool.push(buf);
                    }
                }
            }
            break;
        }
        default: {
            commandQueue.push(command);
            break;
        }
    }
};