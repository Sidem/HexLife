import { EventBus, EVENTS } from '../services/EventBus.js';
import * as PersistenceService from '../services/PersistenceService.js';
import { hexToRuleset, rulesetName } from '../utils/utils.js';
import { scoreCandidate, scoreSingleIC, applyConfirmation, SCORE_CONFIG } from './analysis/InterestingnessScore.js';
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
];

/** Tunable knobs for the explore loop (the score weights live in InterestingnessScore.SCORE_CONFIG). */
export const EXPLORE_CONFIG = {
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
    /** Crossover recombination mode (RulesetService.crossoverHexes). */
    crossoverMode: 'r_sym',
    /** Minimum candidate score to bank a find into the gallery archive. */
    findThreshold: 0.45,
    /** Max gallery entries to persist (best-first; archive itself is unbounded in memory). */
    maxGalleryEntries: 200,
    /** Generation budget: stop the loop after this many generations (0 = unlimited). */
    maxGenerations: 0,
};

const EXPLORE_STATE = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused' });

export class AutoExploreService {
    /**
     * @param {object} worldManager - The owning WorldManager (proxies + ruleset service + helpers).
     * @param {object} [opts]
     * @param {((worldIndex: number) => Promise<string|null>)|null} [opts.thumbnailProvider]
     *   Async capture of a world's current render as a small data-URL thumbnail (DI so the service
     *   stays renderer-free, principle 5). null in unit tests / when no renderer is available.
     */
    constructor(worldManager, { thumbnailProvider = null } = {}) {
        this.wm = worldManager;
        this.thumbnailProvider = thumbnailProvider;
        /** Per-find thumbnail capture deadline (ms) so the search never stalls on a slow capture. */
        this.thumbnailTimeoutMs = 300;
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

    /** Snapshot of the current loop status, for a UI mounting mid-run (no event needed). */
    getStatus() {
        return {
            state: this.state,
            generation: this.generation,
            championHex: this.championHex,
            gallerySize: this.archive.size,
            options: { ...this.options },
        };
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
        this.generation = 0;
        this.runnerUpHex = null;
        /** Best base score observed this run (for the generation-budget completion toast, v2.7). */
        this._bestScoreSeen = 0;
        this._runToken++;

        const seedHex = this.wm.getCurrentRulesetHex();
        if (!seedHex || seedHex === 'Error' || seedHex === 'N/A') {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cannot auto-explore: selected world has no valid ruleset.', type: 'error' });
            return;
        }
        this.championHex = seedHex;
        this._activeICSuite = this._resolveICSuite(this.options.icLabels);

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

        const confirmIC = scoreSingleIC({ ...metrics, icLabel: find.icLabel });
        const confirmed = applyConfirmation(find.screenScore ?? oldScore, confirmIC, metrics, {
            ...SCORE_CONFIG,
            confirmCycleMaxPeriod: this.options.confirmCycleMaxPeriod ?? EXPLORE_CONFIG.confirmCycleMaxPeriod,
            confirmCyclePenalty: this.options.confirmCyclePenalty ?? EXPLORE_CONFIG.confirmCyclePenalty,
        });

        this.archive.updateEntry(find.hex, {
            score: confirmed.finalScore,
            cyclic: confirmed.cyclic,
            perComponent: confirmIC.components,
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
        const worlds = this.wm.worlds;
        const selectedIdx = this.wm.selectedWorldIndex;
        const population = this._buildPopulation(this.championHex, worlds.length, selectedIdx);

        // Apply each candidate's ruleset to its world up front (so the user sees the population).
        population.forEach((hex, idx) => this.wm._applyExploreRuleset(idx, hex));

        // Each world screens its candidate over the IC suite and, if promising, runs ONE long
        // confirmation burst on the SAME world — all concurrent, NO cross-world barrier (each world
        // owns its worker, so world A's confirmation never waits on world B's screen).
        const results = await Promise.all(
            population.map((hex, idx) => this._screenAndConfirm(idx, hex, token))
        );
        if (token !== this._runToken) return;

        // Bank confirmed finds, then rank by novelty-weighted *confirmed* score.
        const ranked = [];
        const finds = [];
        // Per-world score/kill snapshot for the minimap badges (results[idx] ↔ world idx).
        const perWorldScores = new Array(population.length).fill(null);

        results.forEach((r, idx) => {
            if (!r || r.scored.perIC.length === 0) return;
            const { scored, screenScore, winMetrics, confirmed } = r;
            // The score that drives selection + the gallery: the confirmed final score when a
            // confirmation ran (so the period-84 screen-trap can't become champion), else the screen.
            const baseScore = confirmed ? confirmed.finalScore : screenScore;
            // Pass the candidate hex so the incumbent champion isn't penalized against itself (F3).
            const selectionScore = baseScore * this.archive.noveltyMultiplier(winMetrics, baseScore, r.hex);
            ranked.push({ r, scored, winMetrics, selectionScore, baseScore });

            const winIC = scored.perIC[scored.winningIC];
            perWorldScores[idx] = {
                score: baseScore,
                killed: winIC ? winIC.killed : false,
                killReason: winIC ? winIC.killReason : null,
                cyclic: confirmed ? confirmed.cyclic : null,
            };

            // Bank only candidates that survived a confirmation burst (rejected-at-confirm are dropped).
            // A cycle-penalized find is still banked — it's a legitimate, honestly-tagged category.
            if (confirmed && !confirmed.rejected) {
                const entry = this._makeEntry(r, scored, winMetrics, confirmed, screenScore, r.thumb);
                const res = this.archive.tryInsert(entry);
                if (res.added || res.improved) finds.push(entry);
            }
        });

        if (finds.length > 0) {
            this._persistGallery();
            for (const f of finds) EventBus.dispatch(EVENTS.EXPLORE_FIND_ADDED, { find: f, gallerySize: this.archive.size });
        }

        // Best = next champion; second-best = runner-up parent for next generation's crossover.
        ranked.sort((a, b) => b.selectionScore - a.selectionScore);
        const bestScored = ranked.length > 0 ? ranked[0] : null;
        const bestHex = bestScored ? bestScored.r.hex : this.championHex;
        this.runnerUpHex = ranked.length > 1 ? ranked[1].r.hex : null;

        if (bestHex) this.championHex = bestHex;
        if (bestScored && bestScored.baseScore > this._bestScoreSeen) this._bestScoreSeen = bestScored.baseScore;

        EventBus.dispatch(EVENTS.EXPLORE_PROGRESS, this._progressPayload('generation', {
            bestScore: bestScored ? bestScored.baseScore : 0,
            bestHex,
            bestComponents: bestScored ? bestScored.scored.perComponent : null,
            perWorldScores,
            selectedWorldIndex: selectedIdx,
        }));
    }

    /**
     * Per-world two-stage evaluation (v2.4): cheap screen over the IC suite, then — only if the
     * candidate clears `findThreshold` — ONE expensive confirmation burst on the SAME world, winning
     * IC, the SAME stored seed. The confirmation sees long-horizon outcomes (a quiet death, a late
     * cycle) the 160-tick screen can't (F2). Pure scoring/confirmation logic lives in
     * InterestingnessScore; this method just sequences the worker bursts. Returns null if aborted.
     * @param {number} worldIndex
     * @param {string} hex
     * @param {number} token
     * @returns {Promise<{hex: string, perIC: object[], scored: object, screenScore: number,
     *   winMetrics: object, confirmed: {finalScore: number, cyclic: number|null, rejected: boolean}|null}|null>}
     */
    async _screenAndConfirm(worldIndex, hex, token) {
        const ev = await this._evaluateCandidate(worldIndex, hex, token);
        if (!ev || ev.perIC.length === 0 || token !== this._runToken) return null;

        const scored = scoreCandidate(ev.perIC);
        const screenScore = scored.score;
        const winMetrics = ev.perIC[scored.winningIC] || {};

        let confirmed = null;
        if (screenScore >= this.options.findThreshold && winMetrics.initialState) {
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
            const confirmIC = scoreSingleIC({ ...confirmMetrics, icLabel: winMetrics.icLabel });
            confirmed = applyConfirmation(screenScore, confirmIC, confirmMetrics, {
                ...SCORE_CONFIG,
                confirmCycleMaxPeriod: this.options.confirmCycleMaxPeriod,
                confirmCyclePenalty: this.options.confirmCyclePenalty,
            });
        }

        // Capture a thumbnail of the just-confirmed world NOW — it still holds the confirmation
        // burst's final frame, and the next generation hasn't reset it yet (v2.6, F6). Time-boxed so
        // a slow capture never stalls the search.
        let thumb = null;
        if (confirmed && !confirmed.rejected && this.thumbnailProvider) {
            thumb = await this._captureThumbnail(worldIndex);
            if (token !== this._runToken) return null;
        }
        return { hex, perIC: ev.perIC, scored, screenScore, winMetrics, confirmed, thumb };
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
        const suite = this._activeICSuite || IC_SUITE;
        const perIC = [];
        for (let i = 0; i < suite.length; i++) {
            if (token !== this._runToken || this.state === EXPLORE_STATE.IDLE) return null;
            const ic = suite[i];
            const seed = this._seedFor(worldIndex, i);
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

    /** Deterministic per-(generation, world, IC) reset seed; stored on the winning find for replay. */
    _seedFor(worldIndex, icIndex) {
        return this._exploreBaseSeed + this.generation * 9973 + worldIndex * 97 + icIndex;
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
     * @returns {import('./analysis/BehaviorArchive.js').ArchiveEntry}
     */
    _makeEntry(ev, scored, winMetrics, confirmed, screenScore, thumb = null) {
        return {
            hex: ev.hex,
            mnemonic: rulesetName(ev.hex),
            score: confirmed.finalScore,
            screenScore,
            cyclic: confirmed.cyclic,
            thumb: thumb || null,
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
