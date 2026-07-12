import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { hexToRuleset, rulesetName } from '../utils/utils.js';
import { scoreCandidate, scoreSingleIC, applyConfirmation, SCORE_CONFIG } from './analysis/InterestingnessScore.js';
import { sanitizeScoring, buildScoreConfig, isDefaultScoring } from './analysis/ScoringPresets.js';
import { BehaviorArchive } from './analysis/BehaviorArchive.js';
import { EmbeddingArchive } from './analysis/EmbeddingArchive.js';
import { trajectoryNovelty, meanVector, cosineSimilarity } from './analysis/EmbeddingNovelty.js';

/**
 * Tiny deterministic PRNG (same routine as WorldWorker's) for the population builder: mutants and
 * crossover children must derive from the run's base seed, or a shared search link couldn't replay
 * the identical generation sequence.
 * @param {number} a
 * @returns {() => number}
 */
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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
 * is `ruleset × initial condition`). Deterministically-seeded conditions spanning the regimes where
 * different rule families show structure: dense chaos, sparse noise, a single compact seed cluster,
 * and several interacting clusters.
 *
 * NB the cluster strategy is registered under the worker key `'clusters'` (plural) — `mode: 'cluster'`
 * silently fell back to density-1.0 (a saturated grid, instantly killed), so the cluster ICs MUST use
 * `'clusters'`. See WorldWorker `strategies` / ClusterStrategy.
 */
export const IC_SUITE = [
    { label: 'chaos', initialState: { mode: 'density', params: { density: 0.5 } } },
    { label: 'sparse', initialState: { mode: 'density', params: { density: 0.05 } } },
    {
        // A single compact seed cluster dropped into an empty grid ("does a small blob organize?").
        label: 'seed',
        initialState: {
            mode: 'clusters',
            params: {
                count: 1, density: 1.0, densityVariation: 0,
                diameter: 6, diameterVariation: 0,
                eccentricity: 0, orientation: 0, orientationVariation: 0,
                gaussianStdDev: 2.0,
            },
        },
    },
    {
        // Several interacting clusters ("do separate blobs collide, merge, or seed travelling structure?").
        label: 'clusters',
        initialState: {
            mode: 'clusters',
            params: {
                count: 5, density: 1.0, densityVariation: 0.1,
                diameter: 8, diameterVariation: 3,
                eccentricity: 0.2, orientation: 0, orientationVariation: 1,
                gaussianStdDev: 2.0,
            },
        },
    },
    {
        // The mirror of the single seed: a saturated grid with one empty cell — "what erodes a full field?".
        // DensityStrategy special-cases density 1.0 as an all-ON grid with a single OFF centre cell.
        label: 'inverted',
        initialState: { mode: 'density', params: { density: 1.0 } },
    },
    {
        // Many small clusters — a busy, broken-up field for rules that need lots of seeds to ignite.
        label: 'scatter',
        initialState: {
            mode: 'clusters',
            params: {
                count: 30, density: 0.75, densityVariation: 0.2,
                diameter: 5, diameterVariation: 2,
                eccentricity: 0.2, orientation: 0, orientationVariation: 1.0,
                gaussianStdDev: 2.5,
            },
        },
    },
    {
        // Few elongated, eccentric clusters — probes anisotropic / directional rule behaviour.
        label: 'streaks',
        initialState: {
            mode: 'clusters',
            params: {
                count: 6, density: 0.8, densityVariation: 0.15,
                diameter: 22, diameterVariation: 6,
                eccentricity: 0.82, orientation: 30, orientationVariation: 0.6,
                gaussianStdDev: 2.6,
            },
        },
    },
];

/** Clamp bounds for the search population size (Stage 2). Nine keeps replays byte-identical to the
 *  pre-Stage-2 "population == the 9 rendered worlds" behaviour; larger fans more candidates through the
 *  same 9 workers via per-worker queues. */
export const POPULATION_MIN = 9;
export const POPULATION_MAX = 144;

/** Tunable knobs for the explore loop (the score weights live in InterestingnessScore.SCORE_CONFIG). */
export const EXPLORE_CONFIG = {
    /** Candidates evaluated per generation (Stage 2). 9 == byte-identical to the pre-decoupling
     *  behaviour (one candidate per rendered world). Larger populations time-share the same 9 workers
     *  through per-worker queues (candidate `c` runs on world `c % 9`). Clamp: integer, 9–144. */
    populationSize: 9,
    /** Ticks per (cheap) screening evaluation burst. */
    evalTicks: 160,
    /** Ticks discarded at the start of a burst before metrics accumulate (kills transient pollution, F2). */
    warmupTicks: 20,
    /** Ticks for the (expensive) confirmation burst run only on would-be finds (long-horizon, F2). */
    confirmTicks: 600,
    /** A cycle of period ≤ this at confirmation is tagged + penalized (must catch the period-84 trap;
     *  must stay ≤ the worker's CYCLE_DETECTION_MAX_PERIOD = 400). */
    confirmCycleMaxPeriod: 120,
    /** Score multiplier applied to a confirmed cycler (honest labeling, not silent rejection). */
    confirmCyclePenalty: 0.25,
    /** Block-entropy sample cadence within a burst. */
    sampleEvery: 10,
    /** Damage-probe window length (ticks) for the σ estimate. */
    probeTicks: 64,
    /** Default mutation rate when the caller doesn't override it. */
    mutationRate: 0.06,
    /** Default mutation mode. */
    mutationMode: 'r_sym',
    /** Labels of the IC-suite conditions to evaluate over (null/empty = the full suite). */
    icLabels: null,
    /** Crossover children (champion × runner-up) bred per generation once a runner-up exists. */
    crossoverChildren: 3,
    /** Crossover recombination mode (RulesetService.crossoverHexes); null ⇒ follow mutationMode
     *  (`'single'` maps to `'uniform'`), so breeding respects the selected constraint mode. */
    crossoverMode: null,
    /** Minimum candidate score to bank a find into the gallery archive. */
    findThreshold: 0.45,
    /** Max gallery entries to persist (best-first; archive itself is unbounded in memory). */
    maxGalleryEntries: 200,
    /** Generation budget: stop the loop after this many generations (0 = unlimited). */
    maxGenerations: 0,
    // --- Perceptual objective (v3.0, ASAL; only active when the embedding model is enabled + loaded) ---
    /** Frames captured per confirmed find to form the embedding trajectory (the open-endedness signal). */
    embeddingFrames: 6,
    /** Ticks advanced between captured trajectory frames (spacing of the perceptual time series). */
    embeddingFrameTicks: 50,
    // --- Supervised target search (v3.2, ASAL; only active when embeddings are on AND a prompt is set) --
    /** Natural-language target ("find life that looks like…"). Empty ⇒ the statistical / open-ended
     *  pipeline, UNCHANGED — an empty prompt is byte-identical to Stage 2 (an acceptance criterion). */
    targetPrompt: '',
    /** Reserved weight for future target/statistical blending (parked; selection is pure targetSim today). */
    targetWeight: 0.7,
    /** Minimum trajectory→prompt cosine similarity to bank a target-mode find into the gallery. CLIP
     *  image-text similarities sit in ~[0.1, 0.35]; 0.22 keeps only the genuine matches. */
    targetBankThreshold: 0.22,
};

const EXPLORE_STATE = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused' });

export class AutoExploreService {
    /**
     * @param {object} worldManager - The owning WorldManager (proxies + ruleset service + helpers).
     * @param {object} [opts]
     * @param {((worldIndex: number) => Promise<string|null>)|null} [opts.thumbnailProvider]
     *   Async capture of a world's current render as a small data-URL thumbnail (DI so the service
     *   stays renderer-free, principle 5). null in unit tests / when no renderer is available.
     * @param {{isEnabled: () => boolean, ensureReady: () => Promise<boolean>, embed: (frame: any) => Promise<Float32Array|null>, getStatus?: () => string}|null} [opts.embeddingProvider]
     *   Optional foundation-model embedding provider for the perceptual objective (v3.0). null/absent ⇒
     *   the statistical objective is used unchanged (the default).
     * @param {((worldIndex: number) => Promise<any|null>)|null} [opts.frameProvider]
     *   Async capture of a world's current render as raw ImageData (fed to the embedder). null ⇒ no
     *   perceptual trajectory is captured (the term is simply absent and the score renormalizes).
     */
    constructor(worldManager, { thumbnailProvider = null, embeddingProvider = null, frameProvider = null } = {}) {
        this.wm = worldManager;
        this.thumbnailProvider = thumbnailProvider;
        this.embeddingProvider = embeddingProvider;
        this.frameProvider = frameProvider;
        /** Per-find thumbnail/frame capture deadline (ms) so the search never stalls on a slow capture. */
        this.thumbnailTimeoutMs = 300;
        /** Whether the perceptual objective is active for the current run (set in start()). */
        this.embeddingEnabled = false;
        this.state = EXPLORE_STATE.IDLE;
        this.generation = 0;
        this.championHex = null;
        /** Runner-up of the latest generation — the second parent for crossover breeding. */
        this.runnerUpHex = null;
        this.options = { ...EXPLORE_CONFIG };
        /** Score config for the current run (v3.1 user-customizable scoring); defaults otherwise. */
        this._scoreConfig = SCORE_CONFIG;
        this.archive = new BehaviorArchive();
        /** Perceptual illumination archive (v3.0): a second MAP-Elites-lite archive keyed by the
         *  foundation-model embedding, running alongside `archive`. Populated only when embeddings are
         *  on; supplies an additional perceptual-novelty pressure on champion selection. */
        this.embeddingArchive = new EmbeddingArchive();
        /** Snapshot of pre-explore per-world settings + pause state, for restore on stop. */
        this._snapshot = null;
        /** Resolver used to suspend the loop while paused. */
        this._resumeResolver = null;
        /** Monotonic run token so a stop/restart invalidates an in-flight generation. */
        this._runToken = 0;

        this._loadGallery();
        this._loadEmbeddingGallery();
    }

    isRunning() {
        return this.state !== EXPLORE_STATE.IDLE;
    }

    getGalleryEntries() {
        return this.archive.getEntries();
    }

    /** Snapshot of the current loop status, for a UI mounting mid-run (no event needed). */
    getStatus() {
        return {
            state: this.state,
            generation: this.generation,
            championHex: this.championHex,
            gallerySize: this.archive.size,
            embeddingEnabled: !!(this.embeddingProvider && this.embeddingProvider.isEnabled()),
            embeddingStatus: this.embeddingProvider && this.embeddingProvider.getStatus ? this.embeddingProvider.getStatus() : 'disabled',
            embeddingCells: this.embeddingArchive.size,
            targetMode: !!this._targetMode,
            targetPrompt: this._targetPrompt || '',
            options: { ...this.options },
        };
    }

    /**
     * Descriptor for reproducing the current (or most recent — persisted across sessions) search:
     * base seed + starting ruleset + the config subset that shapes the trajectory. Null when no
     * search has ever run. Consumed by the Explore panel's "copy search link".
     * @returns {{baseSeed: number, seedHex: string, config: object}|null}
     */
    getSearchDescriptor() {
        if (this._searchDescriptor) return this._searchDescriptor;
        const persisted = PersistenceService.loadUISetting('exploreLastSearch', null);
        return (persisted && Number.isFinite(persisted.baseSeed) && persisted.seedHex) ? persisted : null;
    }

    /**
     * Resolve which IC-suite conditions to evaluate over. Unknown/empty selections fall back to the
     * full suite so a misconfigured toggle never produces a zero-IC (un-scoreable) run.
     * @param {string[]|null|undefined} labels
     * @returns {typeof IC_SUITE}
     */
    _resolveICSuite(labels) {
        if (!labels || labels.length === 0) return IC_SUITE;
        const filtered = IC_SUITE.filter((ic) => labels.includes(ic.label));
        return filtered.length > 0 ? filtered : IC_SUITE;
    }

    /**
     * Begin exploration. Snapshots the current worlds, seeds the champion from the selected world's
     * ruleset, enables all worlds for a full 3×3 search, and kicks off the async generation loop.
     * @param {Partial<typeof EXPLORE_CONFIG>} [options]
     */
    start(options = {}) {
        if (this.isRunning()) return;
        this.options = { ...EXPLORE_CONFIG, ...options };
        // The confirmation burst must run at least as long as the (now up-to-5000-tick) screening burst,
        // otherwise a long screen would be "confirmed" by a shorter look — defeating screen-cheap/confirm-
        // expensive. Scale it up to match without ever shortening the configured confirm length.
        this.options.confirmTicks = Math.max(this.options.confirmTicks, this.options.evalTicks);
        // v3.1 user-customizable scoring: `options.scoring` (weights/uniform-penalty in slider units,
        // from the Scoring panel or a share link) overrides the default objective for this run.
        // `options.findThreshold` rides the EXPLORE_CONFIG spread above. Absent ⇒ tuned defaults.
        this._scoreConfig = options.scoring
            ? buildScoreConfig(sanitizeScoring(options.scoring))
            : SCORE_CONFIG;
        this.generation = 0;
        this.runnerUpHex = null;
        /** Best base score observed this run (for the generation-budget completion toast, v2.7). */
        this._bestScoreSeen = 0;
        this._runToken++;

        const rawSeedHex = this.wm.getCurrentRulesetHex();
        if (!rawSeedHex || rawSeedHex === 'Error' || rawSeedHex === 'N/A') {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cannot auto-explore: selected world has no valid ruleset.', type: 'error' });
            return;
        }
        // A constrained mode's mutation/crossover flips whole inheritance units but never repairs
        // asymmetry already in the seed — project the seed onto the mode's subspace up front so
        // every candidate the search produces actually satisfies the selected constraint.
        const seedHex = this.wm.rulesetService.projectToMode(rawSeedHex, this.options.mutationMode);
        if (seedHex.toUpperCase() !== rawSeedHex.toUpperCase()) {
            const modeLabel = { r_sym: 'R-Sym', n_count: 'N-Count', totalistic: 'Totalistic' }[this.options.mutationMode] || this.options.mutationMode;
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: `Seed ruleset projected onto the ${modeLabel} constraint (majority vote per group).`,
                type: 'info',
            });
        }
        this.championHex = seedHex;
        this._activeICSuite = this._resolveICSuite(this.options.icLabels);

        // Perceptual objective (v3.0): active only when a provider is wired AND the user enabled it.
        // Warm the model up front (non-blocking); if it can't load, degrade to the statistical objective
        // for this run. The frameProvider is required to capture the trajectory the embedder consumes.
        this.embeddingEnabled = !!(this.embeddingProvider && this.embeddingProvider.isEnabled() && this.frameProvider);
        if (this.embeddingEnabled) {
            this.embeddingProvider.ensureReady().then((ok) => {
                if (!ok) this.embeddingEnabled = false; // model unavailable ⇒ silent statistical fallback
            }).catch(() => { this.embeddingEnabled = false; });
        }

        // Supervised target search (v3.2, ASAL https://arxiv.org/abs/2412.17799): active iff embeddings
        // are on AND the caller supplied a non-empty prompt AND the provider can embed text. The target
        // vector resolves lazily (fire-and-forget, like ensureReady) — a generation that runs before it
        // lands scores statistically (degrade, don't block). A null result (model failed to embed the
        // prompt) toasts once and falls back to the statistical objective for the whole run.
        this._targetPrompt = '';
        this._targetVector = null;
        this._targetMode = false;
        const rawPrompt = typeof this.options.targetPrompt === 'string' ? this.options.targetPrompt.trim() : '';
        if (this.embeddingEnabled && rawPrompt && typeof this.embeddingProvider.embedText === 'function') {
            this._targetPrompt = rawPrompt;
            this._targetMode = true;
            const token = this._runToken;
            Promise.resolve(this.embeddingProvider.embedText(rawPrompt)).then((vec) => {
                if (token !== this._runToken) return;
                if (vec && vec.length) {
                    this._targetVector = vec;
                } else {
                    this._targetMode = false;
                    EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                        message: 'Could not embed the target prompt — searching with the statistical objective.',
                        type: 'info',
                    });
                }
            }).catch(() => { if (token === this._runToken) this._targetMode = false; });
        }

        this._snapshot = this.wm._captureAutoExploreSnapshot();
        // A full-grid search needs every world running, regardless of prior enabled flags.
        this.wm._setAllWorldsEnabledForExplore(true);

        this.state = EXPLORE_STATE.RUNNING;
        // Reproducible searches (share-the-seed): an explicit baseSeed replays the identical
        // generation sequence — same per-(gen, world, IC) reset seeds AND same mutants/children
        // (the population rng derives from it, see _buildPopulation). No seed ⇒ fresh random base.
        this._exploreBaseSeed = Number.isFinite(options.baseSeed) ? Math.floor(options.baseSeed) : Date.now();
        // Persist a descriptor of this run so it can be shared / reproduced after the fact.
        this._searchDescriptor = {
            baseSeed: this._exploreBaseSeed,
            seedHex,
            config: {
                mutationRate: this.options.mutationRate,
                mutationMode: this.options.mutationMode,
                evalTicks: this.options.evalTicks,
                maxGenerations: this.options.maxGenerations,
                icLabels: this.options.icLabels || null,
                findThreshold: this.options.findThreshold,
            },
        };
        // Population size shapes the trajectory (more candidates ⇒ different champions), so a replay
        // needs it — but omit it when 9 to keep old links short/valid and byte-identical (a link with
        // no populationSize replays under the default 9). Mirrors how `scoring` is omitted at default.
        const popSize = this._resolvePopulationSize();
        if (popSize !== EXPLORE_CONFIG.populationSize) this._searchDescriptor.config.populationSize = popSize;
        // Supervised target search (v3.2): a prompt shapes the trajectory (it drives selection), so a
        // faithful replay needs it — carried only when non-empty to keep statistical-search links short
        // and byte-identical. Cross-device replay is best-effort (webgpu/wasm numerics differ marginally).
        if (this._targetPrompt) {
            this._searchDescriptor.config.targetPrompt = this._targetPrompt;
            this._searchDescriptor.config.targetWeight = this.options.targetWeight;
        }
        // Custom scoring changes champion selection, so a replay needs it; omitted when default
        // (short URLs, and old links keep replaying under whatever the current defaults are).
        if (options.scoring) {
            const scoring = sanitizeScoring(options.scoring);
            if (!isDefaultScoring(scoring)) this._searchDescriptor.config.scoring = scoring;
        }
        PersistenceService.saveUISetting('exploreLastSearch', this._searchDescriptor);
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

    /**
     * Re-evaluate a gallery find on the selected world over a confirmation-length burst and update
     * its stored score / components / cyclic tag in place (loop UX, v2.7). Only valid when no run is
     * active — it borrows the selected world's worker, which the search owns while running.
     * `startEvaluation` pauses normal ticking for the burst and restores it afterwards. Toasts the
     * score delta and re-emits EXPLORE_FIND_ADDED so the gallery re-renders + re-sorts.
     * @param {import('./analysis/BehaviorArchive.js').ArchiveEntry} find
     * @returns {Promise<void>}
     */
    async retestFind(find) {
        if (this.isRunning()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Stop the run before re-testing a find.', type: 'error' });
            return;
        }
        if (!find || !find.hex || find.hex === 'Error' || !find.initialState) return;

        const idx = this.wm.selectedWorldIndex;
        const proxy = this.wm.worlds[idx];
        if (!proxy) return;

        const oldScore = typeof find.score === 'number' ? find.score : 0;

        this.wm._applyExploreRuleset(idx, find.hex);
        proxy.resetWorld(find.initialState, find.seed);
        const metrics = await proxy.runEvaluation({
            ticks: this.options.confirmTicks ?? EXPLORE_CONFIG.confirmTicks,
            sampleEvery: this.options.sampleEvery ?? EXPLORE_CONFIG.sampleEvery,
            warmupTicks: this.options.warmupTicks ?? EXPLORE_CONFIG.warmupTicks,
            probe: { enabled: true, probeTicks: this.options.probeTicks ?? EXPLORE_CONFIG.probeTicks },
        });
        if (!metrics || metrics.cancelled) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Re-test was interrupted.', type: 'error' });
            return;
        }

        // Score the re-test under the user's CURRENT scoring settings (v3.1) — the same config the
        // next run would use — so a retested entry ranks consistently with fresh finds.
        const scoreCfg = buildScoreConfig(sanitizeScoring(PersistenceService.loadUISetting('exploreScoring', null)));
        const confirmIC = scoreSingleIC({ ...metrics, icLabel: find.icLabel }, scoreCfg);
        const confirmed = applyConfirmation(find.screenScore ?? oldScore, confirmIC, metrics, {
            ...scoreCfg,
            confirmCycleMaxPeriod: this.options.confirmCycleMaxPeriod ?? EXPLORE_CONFIG.confirmCycleMaxPeriod,
            confirmCyclePenalty: this.options.confirmCyclePenalty ?? EXPLORE_CONFIG.confirmCyclePenalty,
        });

        this.archive.updateEntry(find.hex, {
            score: confirmed.finalScore,
            cyclic: confirmed.cyclic,
            perComponent: confirmIC.components,
            rawMetrics: confirmIC.raw || null,
        });
        this._persistGallery();
        EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find, gallerySize: this.archive.size, retested: true });
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: `${oldScore.toFixed(2)} → ${confirmed.finalScore.toFixed(2)} (${find.mnemonic || rulesetName(find.hex)})`,
            type: 'success',
        });
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

            // Generation budget (v2.7): stop once the configured number of generations have run.
            if (this.options.maxGenerations > 0 && this.generation >= this.options.maxGenerations) {
                const name = this.championHex ? rulesetName(this.championHex) : '';
                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                    message: `Explored ${this.generation} generations — best ${this._bestScoreSeen.toFixed(2)} ${name}`.trim(),
                    type: 'success',
                });
                this.stop();
                return;
            }
        }
    }

    /**
     * Build the population, evaluate every world over the IC suite concurrently, score, archive
     * finds, and pick the next champion.
     * @param {number} token
     */
    async _runGeneration(token) {
        const numWorlds = this.wm.worlds.length;
        const selectedIdx = this.wm.selectedWorldIndex;
        const populationSize = this._resolvePopulationSize();
        const population = this._buildPopulation(this.championHex, populationSize, selectedIdx);

        // Stage 2: the population is decoupled from the 9 rendered worlds. Each world drains a queue of
        // candidates (candidate `c` runs on world `c % numWorlds`) — sequential within a world, all 9
        // worlds concurrent, and NO cross-batch barrier: a fast world starts its next candidate while a
        // slow one is still mid-confirm. The world's ruleset is (re)applied immediately before each
        // candidate's evaluation, so the minimap shows a rolling subset of the population. At
        // populationSize 9 each queue is exactly one candidate (c === w), i.e. the pre-Stage-2 behaviour.
        const results = new Array(population.length).fill(null);
        const workerLoops = [];
        for (let w = 0; w < numWorlds; w++) {
            workerLoops.push((async () => {
                for (let c = w; c < population.length; c += numWorlds) {
                    if (token !== this._runToken || this.state === EXPLORE_STATE.IDLE) return;
                    this.wm._applyExploreRuleset(w, population[c]); // rolling minimap display
                    results[c] = await this._screenAndConfirm(w, population[c], token, c);
                }
            })());
        }
        await Promise.all(workerLoops);
        if (token !== this._runToken) return;

        // Bank confirmed finds, then rank by novelty-weighted *confirmed* score.
        const ranked = [];
        const finds = [];
        let embeddingChanged = false;
        // Per-DISPLAYED-SLOT score/kill snapshot for the minimap badges: length == numWorlds, and
        // slot `c % numWorlds` is overwritten as its queued candidates finish, so at generation end it
        // holds each world's LAST candidate. (MinimapOverlays consumes this under the same field name.)
        const perWorldScores = new Array(numWorlds).fill(null);

        const targetBankThreshold = this._resolveTargetBankThreshold();
        results.forEach((r, idx) => {
            if (!r || r.scored.perIC.length === 0) return;
            const { scored, screenScore, winMetrics, confirmed, embedding } = r;
            // The statistical score, always banked HONESTLY as the gallery `score` (chips/bars keep
            // meaning): the confirmed final score when a confirmation ran (so the period-84 screen-trap
            // can't win), else the screen. In target mode selection is driven by `targetSim` instead.
            const baseScore = confirmed ? confirmed.finalScore : screenScore;
            const embVector = embedding ? embedding.vector : null;
            // Embedding-first gallery descriptor (v3.0/v3.2, roadmap #3): when an embedding is available,
            // the find is keyed by its perceptual SimHash cell (prefixed `e:` so it never collides with a
            // statistical `r|e|σ` key) — for both novelty pressure and the gallery cell it occupies.
            const statsCellOverride = (this.embeddingEnabled && embVector)
                ? `e:${this.embeddingArchive.cellKeyFor(embVector)}`
                : null;
            // Target similarity (v3.2): mean trajectory→prompt cosine, present only in target mode with a
            // resolved prompt vector + captured trajectory. Null ⇒ this candidate scores statistically
            // (the target vector hasn't resolved yet, or no embedding was captured) — degrade, don't block.
            const targetSim = (this._targetMode && embedding && Number.isFinite(embedding.targetSimilarity))
                ? embedding.targetSimilarity
                : null;
            const targetActive = this._targetMode && targetSim != null;
            const selBase = targetActive ? targetSim : baseScore;
            // Pass the candidate hex so the incumbent champion isn't penalized against itself (F3), and
            // the perceptual cell override so novelty pressure matches the embedding-first descriptor.
            let selectionScore = selBase * this.archive.noveltyMultiplier(winMetrics, baseScore, r.hex, statsCellOverride);
            // Perceptual illumination (v3.0): when an embedding is available, also push the search away
            // from perceptually-explored cells — the second (embedding-keyed) novelty pressure.
            if (this.embeddingEnabled && embVector) {
                selectionScore *= this.embeddingArchive.noveltyMultiplier(embVector, baseScore, r.hex);
            }
            // The score surfaced to the UI/progress: targetSim in target mode (labelled "match"), else base.
            const reportScore = targetActive ? targetSim : baseScore;
            ranked.push({ r, scored, winMetrics, selectionScore, baseScore, reportScore, targetSim });

            const winIC = scored.perIC[scored.winningIC];
            // Candidate `idx` was displayed on world `idx % numWorlds`; later candidates on the same
            // world overwrite the slot (rolling display).
            perWorldScores[idx % numWorlds] = {
                score: baseScore,
                killed: winIC ? winIC.killed : false,
                killReason: winIC ? winIC.killReason : null,
                cyclic: confirmed ? confirmed.cyclic : null,
            };

            // Bank only candidates that survived a confirmation burst (rejected-at-confirm are dropped).
            // A cycle-penalized find is still banked — it's a legitimate, honestly-tagged category.
            // Banking gate: statistical mode banks every survivor (findThreshold already gated screening).
            // Target mode (v3.2) instead gates on the target match — the user asked for things that look
            // like X, so bank the top matches (targetSim ≥ targetBankThreshold), not the statistical score.
            if (confirmed && !confirmed.rejected) {
                const bankOk = this._targetMode
                    ? (targetSim != null && targetSim >= targetBankThreshold)
                    : true;
                if (bankOk) {
                    const entry = this._makeEntry(r, scored, winMetrics, confirmed, screenScore, r.thumb, embedding, statsCellOverride);
                    const res = this.archive.tryInsert(entry, { cellKeyOverride: statsCellOverride });
                    if (res.added || res.improved) finds.push(entry);
                    // Mirror into the perceptual illumination archive (keyed by the find's embedding).
                    if (embVector) {
                        this.embeddingArchive.tryInsert({
                            hex: entry.hex,
                            mnemonic: entry.mnemonic,
                            score: entry.score,
                            openEndedness: embedding.openEndedness,
                            generation: this.generation,
                            vector: embVector,
                        });
                        embeddingChanged = true;
                    }
                }
            }
        });

        if (finds.length > 0) {
            this._persistGallery();
            for (const f of finds) EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: f, gallerySize: this.archive.size });
        }
        if (embeddingChanged) this._persistEmbeddingGallery();

        // Best = next champion; second-best = runner-up parent for next generation's crossover.
        ranked.sort((a, b) => b.selectionScore - a.selectionScore);
        const bestScored = ranked.length > 0 ? ranked[0] : null;
        const bestHex = bestScored ? bestScored.r.hex : this.championHex;
        this.runnerUpHex = ranked.length > 1 ? ranked[1].r.hex : null;

        if (bestHex) this.championHex = bestHex;
        // In target mode `reportScore` is the target-match cosine (labelled "match" in the UI); otherwise
        // it's the statistical base score. Both `_bestScoreSeen` and the progress bestScore follow it.
        if (bestScored && bestScored.reportScore > this._bestScoreSeen) this._bestScoreSeen = bestScored.reportScore;

        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('generation', {
            bestScore: bestScored ? bestScored.reportScore : 0,
            bestHex,
            bestComponents: bestScored ? bestScored.scored.perComponent : null,
            perWorldScores,
            selectedWorldIndex: selectedIdx,
            targetMode: this._targetMode,
        }));
    }

    /**
     * Per-world two-stage evaluation (v2.4): cheap screen over the IC suite, then — only if the
     * candidate clears `findThreshold` — ONE expensive confirmation burst on the SAME world, winning
     * IC, the SAME stored seed. The confirmation sees long-horizon outcomes (a quiet death, a late
     * cycle) the 160-tick screen can't (F2). Pure scoring/confirmation logic lives in
     * InterestingnessScore; this method just sequences the worker bursts. Returns null if aborted.
     * @param {number} worldIndex - Which of the 9 workers runs this candidate (selects the proxy).
     * @param {string} hex
     * @param {number} token
     * @param {number} [candidateIndex=worldIndex] - Position in the population; keys the reset seeds so
     *   the trajectory is world-placement-independent (Stage 2). Defaults to worldIndex for callers that
     *   don't decouple (populationSize 9 ⇒ candidateIndex === worldIndex).
     * @returns {Promise<{hex: string, perIC: object[], scored: object, screenScore: number,
     *   winMetrics: object, confirmed: {finalScore: number, cyclic: number|null, rejected: boolean}|null}|null>}
     */
    async _screenAndConfirm(worldIndex, hex, token, candidateIndex = worldIndex) {
        const ev = await this._evaluateCandidate(worldIndex, hex, token, candidateIndex);
        if (!ev || ev.perIC.length === 0 || token !== this._runToken) return null;

        const scored = scoreCandidate(ev.perIC, this._scoreConfig);
        const screenScore = scored.score;
        const winMetrics = ev.perIC[scored.winningIC] || {};

        let confirmed = null;
        let embedding = null;
        // Screening gate. Statistical mode: only candidates whose cheap screen clears `findThreshold` pay
        // for confirmation. Target mode (v3.2): confirm EVERY candidate that survives the hard kills
        // (extinct/saturated/frozen/short-cycle still die) regardless of the statistical score — the
        // vision model, not the statistical proxy, must drive selection, or a prompt-matching-but-
        // statistically-dull candidate would never be seen by the model. This is what makes it ASAL-faithful.
        const winICScore = scored.perIC[scored.winningIC];
        const passesGate = this._targetMode
            ? !!(winICScore && !winICScore.killed)
            : screenScore >= this.options.findThreshold;
        if (passesGate && winMetrics.initialState) {
            if (token !== this._runToken || this.state === EXPLORE_STATE.IDLE) return null;
            const proxy = this.wm.worlds[worldIndex];
            proxy.resetWorld(winMetrics.initialState, winMetrics.seed);
            const confirmMetrics = await proxy.runEvaluation({
                ticks: this.options.confirmTicks,
                sampleEvery: this.options.sampleEvery,
                warmupTicks: this.options.warmupTicks,
                probe: { enabled: true, probeTicks: this.options.probeTicks },
            });
            if (!confirmMetrics || confirmMetrics.cancelled || token !== this._runToken) return null;

            // Perceptual objective (v3.0): capture a short embedding trajectory of the just-confirmed
            // behavior and fold its open-endedness (trajectory novelty) into the confirmation metrics
            // so the CONFIRMED score carries the perceptual term. Cheap statistical screening stays
            // model-free; only confirmed finds pay the embedding cost. ANY failure (no model, capture
            // miss, < 2 usable frames) leaves confirmMetrics untouched ⇒ the score renormalizes over
            // the statistical terms (graceful degradation). Runs only after the confirmation burst, so
            // deterministic per-(gen,world,IC) seeding upstream is unaffected.
            if (this.embeddingEnabled) {
                embedding = await this._captureEmbedding(worldIndex, token);
                if (token !== this._runToken) return null;
                if (embedding && Number.isFinite(embedding.openEndedness)) {
                    confirmMetrics.embedding = { openEndedness: embedding.openEndedness };
                }
            }

            const confirmIC = scoreSingleIC({ ...confirmMetrics, icLabel: winMetrics.icLabel }, this._scoreConfig);
            confirmed = applyConfirmation(screenScore, confirmIC, confirmMetrics, {
                ...this._scoreConfig,
                confirmCycleMaxPeriod: this.options.confirmCycleMaxPeriod,
                confirmCyclePenalty: this.options.confirmCyclePenalty,
            });
        }

        // Capture a thumbnail of the just-confirmed world NOW — it still holds the confirmation
        // burst's final frame (or the embedding trajectory's last frame), and the next generation
        // hasn't reset it yet (v2.6, F6). Time-boxed so a slow capture never stalls the search.
        let thumb = null;
        if (confirmed && !confirmed.rejected && this.thumbnailProvider) {
            thumb = await this._captureThumbnail(worldIndex);
            if (token !== this._runToken) return null;
        }
        return { hex, perIC: ev.perIC, scored, screenScore, winMetrics, confirmed, thumb, embedding };
    }

    /**
     * Capture a short trajectory of rendered frames of the just-confirmed world and reduce it to a
     * perceptual open-endedness signal (v3.0, ASAL). Starts from the confirmation burst's final state,
     * then advances the world in small sub-bursts, capturing one frame between each, and embeds every
     * frame with the (off-thread) foundation model. Returns `{ openEndedness, vector }` — the trajectory
     * novelty and the mean embedding (the perceptual archive key) — or null on any failure / abort /
     * fewer than two usable embeddings (the caller then degrades gracefully). In supervised target mode
     * (v3.2) it also returns `targetSimilarity`: the mean cosine similarity of the trajectory's frame
     * embeddings to the run's target-prompt vector (mean is robust to one noisy frame). Raw cosine is
     * stored — CLIP's image-text similarity range (~[0.1, 0.35]) is NOT renormalized, only relative
     * order matters for selection.
     * @param {number} worldIndex
     * @param {number} token
     * @returns {Promise<{openEndedness: number, vector: Float32Array, targetSimilarity?: number}|null>}
     */
    async _captureEmbedding(worldIndex, token) {
        if (!this.embeddingEnabled || !this.frameProvider || !this.embeddingProvider) return null;
        const proxy = this.wm.worlds[worldIndex];
        if (!proxy) return null;

        const n = Math.max(2, this.options.embeddingFrames || EXPLORE_CONFIG.embeddingFrames);
        const frameTicks = Math.max(1, this.options.embeddingFrameTicks || EXPLORE_CONFIG.embeddingFrameTicks);

        const frames = [];
        const first = await this._captureFrame(worldIndex);
        if (token !== this._runToken) return null;
        if (first) frames.push(first);
        for (let i = 1; i < n; i++) {
            if (token !== this._runToken || this.state === EXPLORE_STATE.IDLE) return null;
            const r = await proxy.runEvaluation({
                ticks: frameTicks,
                sampleEvery: this.options.sampleEvery,
                warmupTicks: 0,
                probe: { enabled: false },
            });
            if (!r || r.cancelled || token !== this._runToken) break;
            const f = await this._captureFrame(worldIndex);
            if (token !== this._runToken) return null;
            if (f) frames.push(f);
        }
        if (frames.length < 2) return null;

        const embeds = [];
        for (const f of frames) {
            if (token !== this._runToken) return null;
            const e = await this.embeddingProvider.embed(f);
            if (e && e.length) embeds.push(e);
        }
        if (embeds.length < 2) return null;

        const vector = meanVector(embeds);
        if (!vector) return null;
        const result = { openEndedness: trajectoryNovelty(embeds), vector };
        // Supervised target search (v3.2): score each frame against the prompt vector and average.
        if (this._targetVector && this._targetVector.length) {
            let sum = 0;
            for (const e of embeds) sum += cosineSimilarity(e, this._targetVector);
            result.targetSimilarity = sum / embeds.length;
        }
        return result;
    }

    /**
     * Race the injected frame provider (raw ImageData capture) against the capture deadline so the loop
     * never blocks on a slow render read.
     * @param {number} worldIndex
     * @returns {Promise<any|null>}
     */
    async _captureFrame(worldIndex) {
        if (!this.frameProvider) return null;
        try {
            return await Promise.race([
                Promise.resolve(this.frameProvider(worldIndex)),
                new Promise((resolve) => setTimeout(() => resolve(null), this.thumbnailTimeoutMs)),
            ]);
        } catch {
            return null;
        }
    }

    /**
     * Race the injected thumbnail provider against a short timeout so the loop never blocks on capture.
     * @param {number} worldIndex
     * @returns {Promise<string|null>}
     */
    async _captureThumbnail(worldIndex) {
        try {
            return await Promise.race([
                Promise.resolve(this.thumbnailProvider(worldIndex)),
                new Promise((resolve) => setTimeout(() => resolve(null), this.thumbnailTimeoutMs)),
            ]);
        } catch {
            return null;
        }
    }

    /**
     * Build the per-world candidate ruleset list: the champion sits in the selected world; the other
     * worlds get a mix of champion×runner-up crossover children (when a runner-up exists — i.e. from
     * generation 1 on) and independent mutants of the champion. Crossover recombines two good
     * families, mutation explores around the champion — together they balance exploit and explore.
     * At populationSize 9 the candidate list is the 3×3 grid; a larger population adds more crossover
     * children + mutants in the same ascending-index / children-first order (the rng consumption order
     * is unchanged, so a 9-candidate replay is byte-identical — pinned by the golden test).
     * @param {string} championHex
     * @param {number} populationSize
     * @param {number} selectedIdx - Guaranteed < 9 ≤ populationSize (the selected world holds the champion).
     * @returns {string[]}
     */
    _buildPopulation(championHex, populationSize, selectedIdx) {
        const rs = this.wm.rulesetService;
        const { mutationRate, mutationMode, crossoverMode, crossoverChildren } = this.options;
        // Breeding respects the search's constraint mode: each inheritance unit (orbit group /
        // count bucket / sum bucket) is an atomic gene, inherited wholesale from one parent, and
        // the post-crossover mutation flips those same units — so children stay inside the mode's
        // subspace. An explicit crossoverMode option still overrides.
        const breedMode = crossoverMode || (mutationMode === 'single' ? 'uniform' : mutationMode);
        const referenceRuleset = hexToRuleset(championHex);
        const population = new Array(populationSize);

        const otherIndices = [];
        for (let i = 0; i < populationSize; i++) if (i !== selectedIdx) otherIndices.push(i);
        // Breed crossover children only when we have a distinct runner-up to cross with.
        const canBreed = this.runnerUpHex && this.runnerUpHex !== championHex;
        const numChildren = canBreed ? Math.min(crossoverChildren, otherIndices.length) : 0;

        // Deterministic per-generation rng seeded from the run's base seed, so a replayed base seed
        // reproduces the exact mutants/children (the other half of search reproducibility beside the
        // per-(gen, world, IC) reset seeds in _seedFor).
        const rng = mulberry32((this._exploreBaseSeed + this.generation * 7919) >>> 0);

        population[selectedIdx] = championHex;
        otherIndices.forEach((idx, k) => {
            let hex;
            if (k < numChildren) {
                // A low post-crossover mutation rate injects fresh variation into each child.
                hex = rs.crossoverHexes(championHex, this.runnerUpHex, breedMode, rng, mutationRate);
            } else {
                hex = rs.generateMutatedHex(championHex, mutationRate, mutationMode, referenceRuleset, rng);
            }
            if (!hex || hex === 'Error') hex = championHex;
            population[idx] = hex;
        });
        return population;
    }

    /**
     * Evaluate one candidate over the full IC suite on its world. Returns null if aborted.
     * @param {number} worldIndex - The worker that runs the bursts.
     * @param {string} hex
     * @param {number} token
     * @param {number} [candidateIndex=worldIndex] - Population position; keys the reset seeds.
     * @returns {Promise<{hex: string, perIC: object[]}|null>}
     */
    async _evaluateCandidate(worldIndex, hex, token, candidateIndex = worldIndex) {
        const proxy = this.wm.worlds[worldIndex];
        if (!proxy) return null;
        const suite = this._activeICSuite || IC_SUITE;
        const perIC = [];
        for (let i = 0; i < suite.length; i++) {
            if (token !== this._runToken || this.state === EXPLORE_STATE.IDLE) return null;
            const ic = suite[i];
            const seed = this._seedFor(candidateIndex, i);
            proxy.resetWorld(ic.initialState, seed);
            const result = await proxy.runEvaluation({
                ticks: this.options.evalTicks,
                sampleEvery: this.options.sampleEvery,
                warmupTicks: this.options.warmupTicks,
                probe: { enabled: true, probeTicks: this.options.probeTicks },
            });
            if (!result || result.cancelled) return null;
            perIC.push({ ...result, icLabel: ic.label, seed, initialState: ic.initialState });
        }
        return { hex, perIC };
    }

    /**
     * Deterministic per-(generation, candidate, IC) reset seed; stored on the winning find for replay.
     * Keyed by CANDIDATE index (not world index) so the trajectory is independent of which of the 9
     * workers happens to evaluate a candidate — at populationSize 9 the candidate index equals the world
     * index, so seeds are byte-identical to the pre-Stage-2 code (the golden test pins this). Collision
     * analysis: `gen*9973 + candidate*97 + ic` is distinct for every (gen ≤ 50, candidate < 144, ic < 7)
     * — the first collision needs Δcandidate ≈ 2776 (see tests/autoExploreDeterminism.test.js).
     */
    _seedFor(candidateIndex, icIndex) {
        return this._exploreBaseSeed + this.generation * 9973 + candidateIndex * 97 + icIndex;
    }

    /**
     * Resolve the effective population size for this run: the configured `populationSize`, sanitized to
     * an integer clamped to [POPULATION_MIN, POPULATION_MAX], defaulting to 9 (byte-identical replay).
     * @returns {number}
     */
    _resolvePopulationSize() {
        const raw = this.options.populationSize;
        if (!Number.isFinite(raw)) return EXPLORE_CONFIG.populationSize;
        return Math.min(POPULATION_MAX, Math.max(POPULATION_MIN, Math.floor(raw)));
    }

    /**
     * Resolve the target-mode banking threshold (v3.2): the configured `targetBankThreshold`, clamped to
     * a sane cosine range, defaulting to EXPLORE_CONFIG's 0.22. Entries whose trajectory→prompt cosine
     * clears this are banked into the gallery.
     * @returns {number}
     */
    _resolveTargetBankThreshold() {
        const raw = Number(this.options.targetBankThreshold);
        if (!Number.isFinite(raw)) return EXPLORE_CONFIG.targetBankThreshold;
        return Math.min(1, Math.max(0, raw));
    }

    /**
     * Build a gallery entry from a scored + confirmed candidate (winning IC reproduces the behavior).
     * The banked `score` is the *confirmed* final score; `screenScore` and `cyclic` are kept for the
     * gallery (honest labeling — a `↻N` chip, design principle 3).
     * @param {{hex: string}} ev
     * @param {object} scored
     * @param {object} winMetrics
     * @param {{finalScore: number, cyclic: number|null, rejected: boolean}} confirmed
     * @param {number} screenScore
     * @param {string|null} [thumb] Optional data-URL thumbnail of the find (v2.6).
     * @param {{openEndedness: number, vector: Float32Array, targetSimilarity?: number}|null} [embedding]
     *   Perceptual trajectory result (v3.0); when present, its open-endedness term is overlaid onto the
     *   (screen-derived) component breakdown so the gallery bar reflects the perceptual signal the
     *   confirmation measured, and its `targetSimilarity` (v3.2) is stored for the target-match chip.
     * @param {string|null} [cellKeyOverride] Perceptual SimHash cell the entry is banked under (v3.2);
     *   sets `descriptorKind: 'embedding'` so persistence preserves the (unrecomputable) key on reload.
     * @returns {import('./analysis/BehaviorArchive.js').ArchiveEntry}
     */
    _makeEntry(ev, scored, winMetrics, confirmed, screenScore, thumb = null, embedding = null, cellKeyOverride = null) {
        // Screening is model-free, so its perComponent has no perceptual term. The open-endedness is
        // measured during confirmation; overlay it (the half-saturation reward + flag) so the gallery's
        // "Novelty" bar shows it. The other eight terms keep their screen values (screening measures them).
        let perComponent = scored.perComponent;
        if (embedding && Number.isFinite(embedding.openEndedness)) {
            const oe = embedding.openEndedness;
            perComponent = {
                ...scored.perComponent,
                openEndedness: oe / (oe + this._scoreConfig.openEndednessHalfSat),
                openEndednessUsed: true,
            };
        }
        // Raw metric inputs of the winning IC (v3.1) — feed the UI's per-term explainer curve
        // markers. The confirmation-measured open-endedness overlays the screen value, matching
        // the perComponent overlay above. Legacy entries simply lack the field.
        let rawMetrics = (scored.perIC && scored.perIC[scored.winningIC]) ? scored.perIC[scored.winningIC].raw : null;
        if (embedding && Number.isFinite(embedding.openEndedness)) {
            rawMetrics = { ...(rawMetrics || {}), openEndedness: embedding.openEndedness };
        }
        return {
            rawMetrics,
            hex: ev.hex,
            mnemonic: rulesetName(ev.hex),
            score: confirmed.finalScore,
            screenScore,
            cyclic: confirmed.cyclic,
            thumb: thumb || null,
            openEndedness: embedding && Number.isFinite(embedding.openEndedness) ? embedding.openEndedness : undefined,
            // Supervised target search (v3.2): the trajectory→prompt match, for the gallery "target" chip.
            targetSimilarity: embedding && Number.isFinite(embedding.targetSimilarity) ? embedding.targetSimilarity : undefined,
            // Which descriptor keyed this entry (roadmap #3): 'embedding' when banked under a perceptual
            // SimHash cell, else 'stats'. loadEntries preserves the opaque embedding key on reload.
            descriptorKind: cellKeyOverride ? 'embedding' : 'stats',
            perComponent,
            winningIC: scored.winningIC,
            icLabel: winMetrics.icLabel,
            initialState: winMetrics.initialState,
            seed: winMetrics.seed,
            generation: this.generation,
            metrics: {
                finalRatio: winMetrics.finalRatio,
                // Persist both mean (descriptor / entropy bin) and the temporal variance (v2.8 Wuensche
                // term) so a re-scored or reloaded entry keeps its temporal-variance term instead of
                // falling back to drop-and-renormalize. Legacy entries lack variance → renormalize.
                blockEntropy: {
                    mean: winMetrics.blockEntropy ? winMetrics.blockEntropy.mean : 0,
                    variance: winMetrics.blockEntropy ? winMetrics.blockEntropy.variance : 0,
                },
                // Persist the centroid-drift speed (v2.9 transport term) so a re-scored/reloaded entry
                // keeps its transport term instead of dropping-and-renormalizing. Legacy entries omit it.
                transport: { meanSpeed: winMetrics.transport ? winMetrics.transport.meanSpeed : 0 },
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

    // --- Perceptual illumination archive persistence (v3.0; compact, no raw vectors) --------------

    /** Model id namespacing the perceptual archive: cells from different CLIP models are not comparable. */
    _embeddingModelId() {
        return (this.embeddingProvider && this.embeddingProvider.getModelId)
            ? this.embeddingProvider.getModelId()
            : null;
    }

    _loadEmbeddingGallery() {
        try {
            this.embeddingArchive.loadEntries(PersistenceService.loadEmbeddingGallery(this._embeddingModelId()));
        } catch (e) {
            console.warn('AutoExploreService: failed to load embedding gallery', e);
        }
    }

    _persistEmbeddingGallery() {
        const entries = this.embeddingArchive.getEntries().slice(0, this.options.maxGalleryEntries);
        PersistenceService.saveEmbeddingGallery(entries, this._embeddingModelId());
    }

    /**
     * The perceptual (CLIP) model changed: SimHash cell keys — and even the projection's
     * dimensionality — are model-specific, so the in-memory archive must be REPLACED (a fresh
     * instance re-derives its projection lazily from the next vector's dim; clear() would keep a
     * stale-dim projection and silently mis-hash). The persisted gallery self-invalidates on the
     * modelId mismatch at load. Only valid while idle (WorldManager guards this).
     */
    onEmbeddingModelChanged() {
        this.embeddingArchive = new EmbeddingArchive();
        this._loadEmbeddingGallery();
        this._persistEmbeddingGallery();
    }

    clearGallery() {
        this.archive.clear();
        this.embeddingArchive.clear();
        PersistenceService.saveExploreGallery([]);
        PersistenceService.saveEmbeddingGallery([], this._embeddingModelId());
        EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: null, gallerySize: 0, cleared: true });
    }
}
