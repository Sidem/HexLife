import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import * as Config from './config.js';
import { hexToRuleset, rulesetName } from '../utils/utils.js';
import { scoreCandidate, scoreSingleIC, applyConfirmation, SCORE_CONFIG } from './analysis/InterestingnessScore.js';
import { sanitizeScoring, buildScoreConfig, isDefaultScoring } from './analysis/ScoringPresets.js';
import { BehaviorArchive } from './analysis/BehaviorArchive.js';
import { DescriptorArchive } from './analysis/DescriptorArchive.js';
import { encodePack } from '../services/LibraryPackCodec.js';
// Population builder (mutants + crossover children) must derive from the run's base seed, or a
// shared search link couldn't replay the identical generation sequence.
import { mulberry32 } from './rng.js';

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
    /** Learned objective. `statistical` preserves the pre-model path byte-for-byte. */
    objective: 'native-beta',
    /** Exact non-destructive HXLT trajectory evaluated after statistical confirmation. */
    nativeFrames: 32,
    nativeTickStride: 8,
    /** Per-candidate model deadline. Failure always falls back to confirmed statistics. */
    nativeInferenceTimeoutMs: 15000,
};

const EXPLORE_STATE = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused' });

export class AutoExploreService {
    /**
     * @param {object} worldManager - The owning WorldManager (proxies + ruleset service + helpers).
     * @param {object} [opts]
     * @param {((worldIndex: number) => Promise<string|null>)|null} [opts.thumbnailProvider]
     *   Async capture of a world's current render as a small data-URL thumbnail (DI so the service
     *   stays renderer-free, principle 5). null in unit tests / when no renderer is available.
     * @param {import('../services/NativeTrajectoryModelService.js').NativeTrajectoryModelService|null} [opts.nativeModelProvider]
     */
    constructor(worldManager, { thumbnailProvider = null, nativeModelProvider = null } = {}) {
        this.wm = worldManager;
        this.thumbnailProvider = thumbnailProvider;
        this.nativeModelProvider = nativeModelProvider;
        /** Per-find thumbnail/frame capture deadline (ms) so the search never stalls on a slow capture. */
        this.thumbnailTimeoutMs = 300;
        this.nativeEnabled = false;
        this.state = EXPLORE_STATE.IDLE;
        this.generation = 0;
        this.championHex = null;
        /** Runner-up of the latest generation — the second parent for crossover breeding. */
        this.runnerUpHex = null;
        this.options = { ...EXPLORE_CONFIG };
        /** Score config for the current run (v3.1 user-customizable scoring); defaults otherwise. */
        this._scoreConfig = SCORE_CONFIG;
        this.archive = new BehaviorArchive();
        this.descriptorArchive = new DescriptorArchive();
        /** Snapshot of pre-explore per-world settings + pause state, for restore on stop. */
        this._snapshot = null;
        /** Resolver used to suspend the loop while paused. */
        this._resumeResolver = null;
        /** Monotonic run token so a stop/restart invalidates an in-flight generation. */
        this._runToken = 0;
        this._nativeAbortController = null;

        this._loadGallery();
        this._loadDescriptorGallery();
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
            objective: this.options.objective,
            nativeEnabled: this.nativeEnabled,
            nativeStatus: this.nativeModelProvider?.getStatus?.() || null,
            descriptorCells: this.descriptorArchive.size,
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
            const modeLabel = { r_sym: 'R-Sym', d_sym: 'D-Sym', n_count: 'N-Count', totalistic: 'Totalistic' }[this.options.mutationMode] || this.options.mutationMode;
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: `Seed ruleset projected onto the ${modeLabel} constraint (majority vote per group).`,
                type: 'info',
            });
        }
        this.championHex = seedHex;
        this._activeICSuite = this._resolveICSuite(this.options.icLabels);

        this.nativeEnabled = this.options.objective !== 'statistical' && !!this.nativeModelProvider;
        this._nativeAbortController?.abort();
        this._nativeAbortController = new AbortController();
        if (this.nativeEnabled) {
            this.nativeModelProvider.setEnabled(true);
            // Loading overlaps statistical screening. Every inference call also awaits readiness and
            // degrades independently, so one failed load can never hang or abort the generation.
            this.nativeModelProvider.ensureReady().catch(() => false);
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
                objective: this.options.objective,
            },
        };
        // Population size shapes the trajectory (more candidates ⇒ different champions), so a replay
        // needs it — but omit it when 9 to keep old links short/valid and byte-identical (a link with
        // no populationSize replays under the default 9). Mirrors how `scoring` is omitted at default.
        const popSize = this._resolvePopulationSize();
        if (popSize !== EXPLORE_CONFIG.populationSize) this._searchDescriptor.config.populationSize = popSize;
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
        this._nativeAbortController?.abort();
        this._nativeAbortController = null;
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
        let descriptorChanged = false;
        // Per-DISPLAYED-SLOT score/kill snapshot for the minimap badges: length == numWorlds, and
        // slot `c % numWorlds` is overwritten as its queued candidates finish, so at generation end it
        // holds each world's LAST candidate. (MinimapOverlays consumes this under the same field name.)
        const perWorldScores = new Array(numWorlds).fill(null);

        results.forEach((r, idx) => {
            if (!r || r.scored.perIC.length === 0) return;
            const { scored, screenScore, winMetrics, confirmed, native } = r;
            // Confirmed native reward ranks learned runs; a missing/failed native result falls back
            // to the exact statistical score.
            const statisticalScore = confirmed ? confirmed.finalScore : screenScore;
            const baseScore = confirmed && native && Number.isFinite(native.reward)
                ? native.reward
                : statisticalScore;
            const nativeDescriptor = native?.descriptor || null;
            const nativeCellOverride = nativeDescriptor
                ? `n:${this.descriptorArchive.cellKeyFor(nativeDescriptor)}`
                : null;
            const selBase = baseScore;
            // Pass the candidate hex so the incumbent champion isn't penalized against itself (F3), and
            // keep learned-cell novelty pressure aligned with the gallery cell.
            let selectionScore = selBase * this.archive.noveltyMultiplier(
                winMetrics, baseScore, r.hex, nativeCellOverride,
            );
            if (nativeDescriptor) {
                selectionScore *= this.descriptorArchive.noveltyMultiplier(nativeDescriptor, baseScore, r.hex);
            }
            const reportScore = baseScore;
            ranked.push({ r, scored, winMetrics, selectionScore, baseScore, reportScore });

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
            if (confirmed && !confirmed.rejected) {
                const entry = this._makeEntry(
                    r, scored, winMetrics, confirmed, screenScore, r.thumb, native, nativeCellOverride,
                );
                const res = this.archive.tryInsert(entry, { cellKeyOverride: nativeCellOverride });
                if (res.added || res.improved) finds.push(entry);
                if (nativeDescriptor) {
                    this.descriptorArchive.tryInsert({
                        hex: entry.hex,
                        mnemonic: entry.mnemonic,
                        score: entry.score,
                        modelId: native.modelId,
                        generation: this.generation,
                        vector: nativeDescriptor,
                    });
                    descriptorChanged = true;
                }
            }
        });

        if (finds.length > 0) {
            this._persistGallery();
            for (const f of finds) EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: f, gallerySize: this.archive.size });
        }
        if (descriptorChanged) this._persistDescriptorGallery();

        // Best = next champion; second-best = runner-up parent for next generation's crossover.
        ranked.sort((a, b) => b.selectionScore - a.selectionScore);
        const bestScored = ranked.length > 0 ? ranked[0] : null;
        const bestHex = bestScored ? bestScored.r.hex : this.championHex;
        this.runnerUpHex = ranked.length > 1 ? ranked[1].r.hex : null;

        if (bestHex) this.championHex = bestHex;
        if (bestScored && bestScored.reportScore > this._bestScoreSeen) this._bestScoreSeen = bestScored.reportScore;

        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('generation', {
            bestScore: bestScored ? bestScored.reportScore : 0,
            bestHex,
            bestComponents: bestScored ? bestScored.scored.perComponent : null,
            perWorldScores,
            selectedWorldIndex: selectedIdx,
            objective: this.nativeEnabled ? 'native-beta' : 'statistical',
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
        let native = null;
        // Only candidates that clear the cheap statistical screen pay for long confirmation and
        // optional native inference. Hard kills therefore stay model-free and deterministic.
        const passesGate = screenScore >= this.options.findThreshold;
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

            const confirmIC = scoreSingleIC({ ...confirmMetrics, icLabel: winMetrics.icLabel }, this._scoreConfig);
            confirmed = applyConfirmation(screenScore, confirmIC, confirmMetrics, {
                ...this._scoreConfig,
                confirmCycleMaxPeriod: this.options.confirmCycleMaxPeriod,
                confirmCyclePenalty: this.options.confirmCyclePenalty,
            });
            // Model load, capture, timeout, and inference failures return null and preserve the
            // confirmed statistical score.
            if (!confirmed.rejected && this.nativeEnabled) {
                native = await this._evaluateNativeTrajectory(worldIndex, token);
                if (token !== this._runToken || this.state === EXPLORE_STATE.IDLE) return null;
            }
        }

        // Capture a thumbnail of the just-confirmed world NOW — it still holds the confirmation
        // burst's final frame (or the native trajectory's last frame), and the next generation
        // hasn't reset it yet (v2.6, F6). Time-boxed so a slow capture never stalls the search.
        let thumb = null;
        if (confirmed && !confirmed.rejected && this.thumbnailProvider) {
            thumb = await this._captureThumbnail(worldIndex);
            if (token !== this._runToken) return null;
        }
        return { hex, perIC: ev.perIC, scored, screenScore, winMetrics, confirmed, thumb, native };
    }

    /**
     * Capture the exact post-confirmation cell trajectory and evaluate it with the native model.
     * The run token, AbortSignal, and inference deadline ensure stop/restart cannot bank stale work.
     * @param {number} worldIndex
     * @param {number} token
     * @returns {Promise<{reward: number, rawReward: number, descriptor: Float32Array, modelId: string}|null>}
     */
    async _evaluateNativeTrajectory(worldIndex, token) {
        if (!this.nativeEnabled || !this.nativeModelProvider) return null;
        const proxy = this.wm.worlds[worldIndex];
        if (!proxy) return null;
        try {
            const frameCount = Math.max(1, Math.min(32, Math.trunc(this.options.nativeFrames)));
            const tickStride = Math.max(1, Math.min(8, Math.trunc(this.options.nativeTickStride)));
            const capture = await proxy.captureTrajectory({ frameCount, tickStride });
            if (token !== this._runToken || !capture?.frames?.length) return null;
            return await this.nativeModelProvider.evaluate({
                frames: capture.frames,
                rows: Config.GRID_ROWS,
                cols: Config.GRID_COLS,
                tickOffsets: capture.frames.map((_, index) => index * tickStride),
            }, {
                signal: this._nativeAbortController?.signal,
                timeoutMs: this.options.nativeInferenceTimeoutMs,
            });
        } catch (error) {
            if (error?.name !== 'AbortError') {
                console.warn('Native trajectory ranking fell back to statistics:', error);
            }
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
     * Build a gallery entry from a scored + confirmed candidate (winning IC reproduces the behavior).
     * The banked `score` is the *confirmed* final score; `screenScore` and `cyclic` are kept for the
     * gallery (honest labeling — a `↻N` chip, design principle 3).
     * @param {{hex: string}} ev
     * @param {object} scored
     * @param {object} winMetrics
     * @param {{finalScore: number, cyclic: number|null, rejected: boolean}} confirmed
     * @param {number} screenScore
     * @param {string|null} [thumb] Optional data-URL thumbnail of the find (v2.6).
     * @param {{reward: number, rawReward: number, descriptor: Float32Array, modelId: string}|null} [native]
     * @param {string|null} [cellKeyOverride] Native descriptor SimHash cell.
     * @returns {import('./analysis/BehaviorArchive.js').ArchiveEntry}
     */
    _makeEntry(ev, scored, winMetrics, confirmed, screenScore, thumb = null, native = null, cellKeyOverride = null) {
        const perComponent = scored.perComponent;
        // Raw statistical inputs remain available for explanation even when native reward ranks the find.
        const rawMetrics = (scored.perIC && scored.perIC[scored.winningIC]) ? scored.perIC[scored.winningIC].raw : null;
        return {
            rawMetrics,
            hex: ev.hex,
            mnemonic: rulesetName(ev.hex),
            score: native && Number.isFinite(native.reward) ? native.reward : confirmed.finalScore,
            statisticalScore: confirmed.finalScore,
            nativeRawReward: native && Number.isFinite(native.rawReward) ? native.rawReward : undefined,
            nativeModelId: native?.modelId || undefined,
            screenScore,
            cyclic: confirmed.cyclic,
            thumb: thumb || null,
            // Native keys are opaque because raw descriptors are intentionally not persisted.
            descriptorKind: cellKeyOverride ? 'native' : 'stats',
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

    // --- Native descriptor archive persistence (compact, no raw vectors) --------------------------

    /** Descriptor-space id: model and preprocessing must match for cells to compare. */
    _descriptorModelId() {
        return this.nativeModelProvider?.getStatus?.().modelId || null;
    }

    _loadDescriptorGallery() {
        try {
            this.descriptorArchive.loadEntries(
                PersistenceService.loadNativeDescriptorGallery(this._descriptorModelId()),
            );
        } catch (e) {
            console.warn('AutoExploreService: failed to load native descriptor gallery', e);
        }
    }

    _persistDescriptorGallery() {
        const entries = this.descriptorArchive.getEntries().slice(0, this.options.maxGalleryEntries);
        PersistenceService.saveNativeDescriptorGallery(entries, this._descriptorModelId());
    }

    /**
     * The native model changed: SimHash cell keys — and even the projection's
     * dimensionality — are model-specific, so the in-memory archive must be REPLACED (a fresh
     * instance re-derives its projection lazily from the next vector's dim; clear() would keep a
     * stale-dim projection and silently mis-hash). The persisted gallery self-invalidates on the
     * modelId mismatch at load. Only valid while idle (WorldManager guards this).
     */
    onNativeModelChanged() {
        this.descriptorArchive = new DescriptorArchive();
        this._loadDescriptorGallery();
        this._persistDescriptorGallery();
    }

    clearGallery() {
        this.archive.clear();
        this.descriptorArchive.clear();
        PersistenceService.saveExploreGallery([]);
        PersistenceService.saveNativeDescriptorGallery([], this._descriptorModelId());
        EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: null, gallerySize: 0, cleared: true });
    }

    /**
     * Serialize the current gallery (statistical archive, best-first) into a portable pack JSON
     * string. The native descriptor archive is intentionally not exported — its SimHash cells are
     * model-specific and would be stripped on import anyway.
     * @returns {string}
     */
    exportGalleryPackJSON() {
        return encodePack({ finds: this.archive.getEntries() });
    }

    /**
     * Merge decoded pack finds into the session gallery via the normal {@link BehaviorArchive.tryInsert}
     * semantics (best-per-cell + family dedupe). The codec strips opaque learned `cellKey` values and
     * resets `descriptorKind: 'stats'`, so old and new packs import safely across model versions.
     * Persists once and dispatches one gallery refresh. **Refused while a run is active.**
     * @param {object[]} decodedFinds Already sanitized by {@link decodePack}.
     * @returns {{added: number, improved: number, rejected: number}}
     */
    importGalleryFinds(decodedFinds) {
        if (this.isRunning()) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Stop the run before importing finds.', type: 'error' });
            return { added: 0, improved: 0, rejected: 0 };
        }
        let added = 0;
        let improved = 0;
        let rejected = 0;
        for (const find of decodedFinds || []) {
            // No override: the statistical descriptor is re-derived from portable metrics.
            const res = this.archive.tryInsert(find);
            if (res.added) added++;
            else if (res.improved) improved++;
            else rejected++;
        }
        if (added || improved) this._persistGallery();
        EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: null, gallerySize: this.archive.size, imported: true });
        return { added, improved, rejected };
    }
}
