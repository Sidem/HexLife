import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { hexToRuleset, rulesetName } from '../utils/utils.js';
import { scoreCandidate } from './analysis/InterestingnessScore.js';
import { BehaviorArchive } from './analysis/BehaviorArchive.js';

/**
 * Phase 4 of the auto-explore roadmap: the generation loop that ties Phases 1–3 together into the
 * flagship "auto-explore" feature.
 *
 * Each generation:
 *   1. The current champion ruleset is placed in the selected world; the other worlds get mutants
 *      of it (via {@link RulesetService.generateMutatedHex}).
 *   2. Every world evaluates its candidate over the IC suite ({@link IC_SUITE}): for each IC we
 *      seeded-reset the world and run a `RUN_EVALUATION` burst (Phase 2), collecting the raw
 *      metrics. All 9 worlds run their suites concurrently (the burst loop is async per worker).
 *   3. Each candidate is scored ({@link scoreCandidate}, Phase 3); interesting finds are inserted
 *      into the {@link BehaviorArchive} (which is the session gallery). The next champion is the
 *      candidate with the best *novelty-weighted* score, so the search both exploits good families
 *      and is pushed toward unexplored behavior.
 *
 * The service owns the idle/running/paused state machine. It talks to the worlds through the
 * proxies it is handed at construction and never imports any UI — WorldManager subscribes it to
 * the COMMAND_* events and re-broadcasts its progress (EXPLORE_PROGRESS / EXPLORE_FIND_ADDED).
 * On stop it restores the user's pre-explore rulesets, initial states and enabled flags.
 */

/**
 * The IC suite every candidate is evaluated over (roadmap design principle 1: the unit of behavior
 * is `ruleset × initial condition`). Three deterministically-seeded conditions spanning the regimes
 * where different rule families show structure: dense chaos, sparse noise, and a single seed cluster.
 */
export const IC_SUITE = [
    { label: 'chaos', initialState: { mode: 'density', params: { density: 0.5 } } },
    { label: 'sparse', initialState: { mode: 'density', params: { density: 0.05 } } },
    {
        label: 'seed',
        initialState: {
            mode: 'cluster',
            params: {
                count: 1, density: 1.0, densityVariation: 0,
                diameter: 14, diameterVariation: 0,
                eccentricity: 0, orientation: 0, orientationVariation: 0,
                gaussianStdDev: 1.5,
            },
        },
    },
];

/** Tunable knobs for the explore loop (the score weights live in InterestingnessScore.SCORE_CONFIG). */
export const EXPLORE_CONFIG = {
    /** Ticks per evaluation burst. */
    evalTicks: 160,
    /** Block-entropy sample cadence within a burst. */
    sampleEvery: 10,
    /** Damage-probe window length (ticks) for the σ estimate. */
    probeTicks: 64,
    /** Default mutation rate when the caller doesn't override it. */
    mutationRate: 0.06,
    /** Default mutation mode. */
    mutationMode: 'r_sym',
    /** Crossover children (champion × runner-up) bred per generation once a runner-up exists. */
    crossoverChildren: 3,
    /** Crossover recombination mode (RulesetService.crossoverHexes). */
    crossoverMode: 'r_sym',
    /** Minimum candidate score to bank a find into the gallery archive. */
    findThreshold: 0.45,
    /** Max gallery entries to persist (best-first; archive itself is unbounded in memory). */
    maxGalleryEntries: 200,
};

const EXPLORE_STATE = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused' });

export class AutoExploreService {
    /**
     * @param {object} worldManager - The owning WorldManager (proxies + ruleset service + helpers).
     */
    constructor(worldManager) {
        this.wm = worldManager;
        this.state = EXPLORE_STATE.IDLE;
        this.generation = 0;
        this.championHex = null;
        /** Runner-up of the latest generation — the second parent for crossover breeding. */
        this.runnerUpHex = null;
        this.options = { ...EXPLORE_CONFIG };
        this.archive = new BehaviorArchive();
        /** Snapshot of pre-explore per-world settings + pause state, for restore on stop. */
        this._snapshot = null;
        /** Resolver used to suspend the loop while paused. */
        this._resumeResolver = null;
        /** Monotonic run token so a stop/restart invalidates an in-flight generation. */
        this._runToken = 0;

        this._loadGallery();
    }

    isRunning() {
        return this.state !== EXPLORE_STATE.IDLE;
    }

    getGalleryEntries() {
        return this.archive.getEntries();
    }

    /**
     * Begin exploration. Snapshots the current worlds, seeds the champion from the selected world's
     * ruleset, enables all worlds for a full 3×3 search, and kicks off the async generation loop.
     * @param {Partial<typeof EXPLORE_CONFIG>} [options]
     */
    start(options = {}) {
        if (this.isRunning()) return;
        this.options = { ...EXPLORE_CONFIG, ...options };
        this.generation = 0;
        this.runnerUpHex = null;
        this._runToken++;

        const seedHex = this.wm.getCurrentRulesetHex();
        if (!seedHex || seedHex === 'Error' || seedHex === 'N/A') {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cannot auto-explore: selected world has no valid ruleset.', type: 'error' });
            return;
        }
        this.championHex = seedHex;

        this._snapshot = this.wm._captureAutoExploreSnapshot();
        // A full-grid search needs every world running, regardless of prior enabled flags.
        this.wm._setAllWorldsEnabledForExplore(true);

        this.state = EXPLORE_STATE.RUNNING;
        this._exploreBaseSeed = Date.now();
        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('started'));
        // Fire-and-forget; the loop self-checks the run token / state on every await boundary.
        this._runLoop(this._runToken).catch((err) => {
            console.error('AutoExploreService loop error:', err);
            this.stop();
        });
    }

    /** Pause the loop at the next generation boundary (no restore). */
    pause() {
        if (this.state !== EXPLORE_STATE.RUNNING) return;
        this.state = EXPLORE_STATE.PAUSED;
        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('paused'));
    }

    /** Resume a paused loop. */
    resume() {
        if (this.state !== EXPLORE_STATE.PAUSED) return;
        this.state = EXPLORE_STATE.RUNNING;
        if (this._resumeResolver) {
            const r = this._resumeResolver;
            this._resumeResolver = null;
            r();
        }
        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('resumed'));
    }

    /**
     * Stop exploration and restore the pre-explore worlds. Safe to call when idle.
     * @param {object} [opts]
     * @param {boolean} [opts.adopt] - When true, keep the champion in the selected world instead of
     *   restoring its pre-explore ruleset (the user "adopts" the current find).
     */
    stop(opts = {}) {
        if (this.state === EXPLORE_STATE.IDLE) return;
        const wasPaused = this.state === EXPLORE_STATE.PAUSED;
        this.state = EXPLORE_STATE.IDLE;
        this._runToken++; // invalidate any in-flight generation
        if (wasPaused && this._resumeResolver) {
            const r = this._resumeResolver;
            this._resumeResolver = null;
            r();
        }
        if (this._snapshot) {
            this.wm._restoreAutoExploreSnapshot(this._snapshot, {
                adoptChampionHex: opts.adopt ? this.championHex : null,
            });
            this._snapshot = null;
        }
        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('stopped'));
    }

    // --- Generation loop ----------------------------------------------------

    /**
     * @param {number} token - The run token this loop belongs to; a newer token aborts it.
     */
    async _runLoop(token) {
        while (token === this._runToken && this.state !== EXPLORE_STATE.IDLE) {
            if (this.state === EXPLORE_STATE.PAUSED) {
                await new Promise((resolve) => { this._resumeResolver = resolve; });
                continue; // re-check state/token after resume
            }

            await this._runGeneration(token);
            if (token !== this._runToken) return; // stopped/restarted mid-generation
            this.generation++;
        }
    }

    /**
     * Build the population, evaluate every world over the IC suite concurrently, score, archive
     * finds, and pick the next champion.
     * @param {number} token
     */
    async _runGeneration(token) {
        const worlds = this.wm.worlds;
        const selectedIdx = this.wm.selectedWorldIndex;
        const population = this._buildPopulation(this.championHex, worlds.length, selectedIdx);

        // Apply each candidate's ruleset to its world up front (so the user sees the population).
        population.forEach((hex, idx) => this.wm._applyExploreRuleset(idx, hex));

        const evaluations = await Promise.all(
            population.map((hex, idx) => this._evaluateCandidate(idx, hex, token))
        );
        if (token !== this._runToken) return;

        // Score every candidate, archive the interesting finds, then rank by novelty-weighted score.
        const ranked = [];
        const finds = [];

        for (const ev of evaluations) {
            if (!ev || ev.perIC.length === 0) continue;
            const scored = scoreCandidate(ev.perIC);
            const winMetrics = ev.perIC[scored.winningIC] || {};
            const selectionScore = scored.score * this.archive.noveltyMultiplier(winMetrics, scored.score);
            ranked.push({ ev, scored, winMetrics, selectionScore });

            if (scored.score >= this.options.findThreshold) {
                const entry = this._makeEntry(ev, scored, winMetrics);
                const res = this.archive.tryInsert(entry);
                if (res.added || res.improved) finds.push(entry);
            }
        }

        if (finds.length > 0) {
            this._persistGallery();
            for (const f of finds) EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: f, gallerySize: this.archive.size });
        }

        // Best = next champion; second-best = runner-up parent for next generation's crossover.
        ranked.sort((a, b) => b.selectionScore - a.selectionScore);
        const bestScored = ranked.length > 0 ? ranked[0] : null;
        const bestHex = bestScored ? bestScored.ev.hex : this.championHex;
        this.runnerUpHex = ranked.length > 1 ? ranked[1].ev.hex : null;

        if (bestHex) this.championHex = bestHex;

        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('generation', {
            bestScore: bestScored ? bestScored.scored.score : 0,
            bestHex,
            bestComponents: bestScored ? bestScored.scored.perComponent : null,
        }));
    }

    /**
     * Build the per-world candidate ruleset list: the champion sits in the selected world; the other
     * worlds get a mix of champion×runner-up crossover children (when a runner-up exists — i.e. from
     * generation 1 on) and independent mutants of the champion. Crossover recombines two good
     * families, mutation explores around the champion — together they balance exploit and explore.
     * @param {string} championHex
     * @param {number} numWorlds
     * @param {number} selectedIdx
     * @returns {string[]}
     */
    _buildPopulation(championHex, numWorlds, selectedIdx) {
        const rs = this.wm.rulesetService;
        const { mutationRate, mutationMode, crossoverMode, crossoverChildren } = this.options;
        const referenceRuleset = hexToRuleset(championHex);
        const population = new Array(numWorlds);

        const otherIndices = [];
        for (let i = 0; i < numWorlds; i++) if (i !== selectedIdx) otherIndices.push(i);
        // Breed crossover children only when we have a distinct runner-up to cross with.
        const canBreed = this.runnerUpHex && this.runnerUpHex !== championHex;
        const numChildren = canBreed ? Math.min(crossoverChildren, otherIndices.length) : 0;

        population[selectedIdx] = championHex;
        otherIndices.forEach((idx, k) => {
            let hex;
            if (k < numChildren) {
                // A low post-crossover mutation rate injects fresh variation into each child.
                hex = rs.crossoverHexes(championHex, this.runnerUpHex, crossoverMode, Math.random, mutationRate);
            } else {
                hex = rs.generateMutatedHex(championHex, mutationRate, mutationMode, referenceRuleset);
            }
            if (!hex || hex === 'Error') hex = championHex;
            population[idx] = hex;
        });
        return population;
    }

    /**
     * Evaluate one candidate over the full IC suite on its world. Returns null if aborted.
     * @param {number} worldIndex
     * @param {string} hex
     * @param {number} token
     * @returns {Promise<{hex: string, perIC: object[]}|null>}
     */
    async _evaluateCandidate(worldIndex, hex, token) {
        const proxy = this.wm.worlds[worldIndex];
        if (!proxy) return null;
        const perIC = [];
        for (let i = 0; i < IC_SUITE.length; i++) {
            if (token !== this._runToken || this.state === EXPLORE_STATE.IDLE) return null;
            const ic = IC_SUITE[i];
            const seed = this._seedFor(worldIndex, i);
            proxy.resetWorld(ic.initialState, seed);
            const result = await proxy.runEvaluation({
                ticks: this.options.evalTicks,
                sampleEvery: this.options.sampleEvery,
                probe: { enabled: true, probeTicks: this.options.probeTicks },
            });
            if (!result || result.cancelled) return null;
            perIC.push({ ...result, icLabel: ic.label, seed, initialState: ic.initialState });
        }
        return { hex, perIC };
    }

    /** Deterministic per-(generation, world, IC) reset seed; stored on the winning find for replay. */
    _seedFor(worldIndex, icIndex) {
        return this._exploreBaseSeed + this.generation * 9973 + worldIndex * 97 + icIndex;
    }

    /**
     * Build a gallery entry from a scored candidate (winning IC reproduces the interesting behavior).
     * @param {{hex: string, perIC: object[]}} ev
     * @param {object} scored
     * @param {object} winMetrics
     * @returns {import('./analysis/BehaviorArchive.js').ArchiveEntry}
     */
    _makeEntry(ev, scored, winMetrics) {
        return {
            hex: ev.hex,
            mnemonic: rulesetName(ev.hex),
            score: scored.score,
            perComponent: scored.perComponent,
            winningIC: scored.winningIC,
            icLabel: winMetrics.icLabel,
            initialState: winMetrics.initialState,
            seed: winMetrics.seed,
            generation: this.generation,
            metrics: {
                finalRatio: winMetrics.finalRatio,
                blockEntropy: { mean: winMetrics.blockEntropy ? winMetrics.blockEntropy.mean : 0 },
                sigma: winMetrics.sigma,
            },
        };
    }

    _progressPayload(phase, extra = {}) {
        return {
            phase,
            state: this.state,
            generation: this.generation,
            championHex: this.championHex,
            gallerySize: this.archive.size,
            ...extra,
        };
    }

    // --- Gallery persistence (mirrors USER_PATTERNS) ------------------------

    _loadGallery() {
        try {
            const entries = PersistenceService.loadExploreGallery();
            this.archive.loadEntries(entries);
        } catch (e) {
            console.warn('AutoExploreService: failed to load gallery', e);
        }
    }

    _persistGallery() {
        const entries = this.archive.getEntries().slice(0, this.options.maxGalleryEntries);
        PersistenceService.saveExploreGallery(entries);
    }

    clearGallery() {
        this.archive.clear();
        PersistenceService.saveExploreGallery([]);
        EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: null, gallerySize: 0, cleared: true });
    }
}
