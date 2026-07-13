import * as Config from './config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Renderer from '../rendering/renderer.js';
import { EXPLORE_CONFIG } from './AutoExploreService.js';
import { scoreSingleIC } from './analysis/InterestingnessScore.js';
import { sanitizeScoring, buildScoreConfig } from './analysis/ScoringPresets.js';
import { hexToRuleset } from '../utils/utils.js';

/**
 * The "borrow worlds" session helper: snapshots the pre-session worlds, applies candidate rulesets
 * during a search, restores everything afterward, and captures render frames for the explore
 * gallery / perceptual objective. Also runs the Analysis panel's on-demand `measureSelectedWorld`
 * (a non-destructive single-world evaluation burst).
 *
 * Extracted from WorldManager (the god-object split, roadmap #3). It reaches back into the host
 * WorldManager for the shared world/proxy state and the primitives that stay there (`_commitRuleset`,
 * `_getResetSeed`, `setGlobalPause`, persistence, current-ruleset accessors). AutoExploreService
 * still calls these through WorldManager delegators, so the search loop is untouched. This is the
 * same borrow-and-restore shape the upcoming DailyChallengeService will reuse.
 */
export class ExploreSessionCoordinator {
    /** @param {import('./WorldManager.js').WorldManager} worldManager */
    constructor(worldManager) {
        this.wm = worldManager;
    }

    /** Snapshot the pre-explore worlds (rulesets, initial states, enabled flags) + pause state. */
    _captureAutoExploreSnapshot = () => ({
        isGloballyPaused: this.wm.isGloballyPaused,
        worlds: this.wm.worldSettings.map(ws => ({
            rulesetHex: ws.rulesetHex,
            initialState: structuredClone(ws.initialState),
            enabled: ws.enabled,
        })),
    });

    /** Enable (or disable) every world for a full-grid search, without starting normal ticking. */
    _setAllWorldsEnabledForExplore = (enabled) => {
        this.wm.worlds.forEach((proxy, idx) => {
            if (this.wm.worldSettings[idx]) this.wm.worldSettings[idx].enabled = enabled;
            proxy.setEnabled(enabled);
        });
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.wm.getWorldSettingsForUI());
    };

    /**
     * Apply a candidate ruleset to a world during exploration. Lightweight: uploads to the worker and
     * keeps `worldSettings.rulesetHex` in sync (so the worker's STATS echo doesn't re-trigger a
     * persist), but pushes no history and writes no localStorage — the session is bracketed by
     * snapshot/restore. Dispatches RULESET_CHANGED for the selected world so the UI tracks the champion.
     */
    _applyExploreRuleset = (worldIndex, hex) => {
        const proxy = this.wm.worlds[worldIndex];
        const settings = this.wm.worldSettings[worldIndex];
        if (!proxy || !settings || hex === "Error") return;
        proxy.setRuleset(hexToRuleset(hex).buffer.slice(0));
        settings.rulesetHex = hex;
        if (worldIndex === this.wm.selectedWorldIndex) EventBus.dispatch(EVENTS.RULESET_CHANGED, hex);
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
            const settings = this.wm.worldSettings[idx];
            const proxy = this.wm.worlds[idx];
            if (!settings || !proxy) return;
            const restoreHex = (adoptHex && idx === this.wm.selectedWorldIndex) ? adoptHex : snap.rulesetHex;
            settings.initialState = structuredClone(snap.initialState);
            settings.enabled = snap.enabled;
            proxy.setEnabled(snap.enabled);
            this.wm._commitRuleset(idx, restoreHex, {
                addToHistory: false,
                reset: true,
                seed: this.wm._getResetSeed(baseSeed, idx),
            });
        });
        // Restore the pre-explore pause state (starts/stops enabled worlds as appropriate).
        this.wm.setGlobalPause(snapshot.isGloballyPaused);
        PersistenceService.saveWorldSettings(this.wm.worldSettings);
        EventBus.dispatch(EVENTS.WORLD_SETTINGS_CHANGED, this.wm.getWorldSettingsForUI());
        EventBus.dispatch(EVENTS.ALL_WORLDS_RESET);
        // NB: do NOT call dispatchSelectedWorldUpdates here — it reconciles worldSettings from the
        // proxy's *cached* stats, which still hold the champion hex (the worker hasn't echoed the
        // just-pushed restored ruleset yet) and would clobber the restore. Dispatch the restored
        // truth directly instead; the worker's RESET_WORLD stats echo then re-syncs the proxy cache.
        const selIdx = this.wm.selectedWorldIndex;
        const selHex = this.wm.worldSettings[selIdx]?.rulesetHex;
        if (selHex) {
            EventBus.dispatch(EVENTS.RULESET_CHANGED, selHex);
            PersistenceService.saveRuleset(selHex);
            const selStats = this.wm.worlds[selIdx]?.getLatestStats();
            if (selStats) {
                EventBus.dispatch(EVENTS.WORLD_STATS_UPDATED, { ...selStats, rulesetHex: selHex, worldIndex: selIdx });
            }
        }
    };

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
        if (this.wm.autoExploreService?.isRunning()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Stop Auto-Explore before measuring a world.', type: 'error' });
            return null;
        }
        const idx = this.wm.selectedWorldIndex;
        const proxy = this.wm.worlds[idx];
        if (!proxy) return null;

        const hex = this.wm.getCurrentRulesetHex();
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
        const rulesetArray = this.wm.getCurrentRulesetArray();

        try {
            const metrics = await proxy.runEvaluation({
                ticks,
                sampleEvery: EXPLORE_CONFIG.sampleEvery,
                warmupTicks: EXPLORE_CONFIG.warmupTicks,
                probe: { enabled: !!probe, probeTicks: EXPLORE_CONFIG.probeTicks },
            });
            // Score under the user's CURRENT scoring settings (v3.1) so the Analysis panel matches
            // what a run started right now would compute (defaults when the setting is absent).
            const scoreCfg = buildScoreConfig(sanitizeScoring(PersistenceService.loadUISetting('exploreScoring', null)));
            const scored = scoreSingleIC({ ...metrics, icLabel: 'measure' }, scoreCfg);
            return {
                score: scored.score,
                components: scored.components,
                killed: scored.killed,
                killReason: scored.killReason,
                raw: scored.raw,
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
    };
}
