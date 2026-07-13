import * as Config from './config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { EXPLORE_CONFIG } from './AutoExploreService.js';
import * as Renderer from '../rendering/renderer.js';
import { generateThumbnailLUT } from '../utils/ruleVizUtils.js';
import { hexToRuleset } from '../utils/utils.js';

/**
 * Bakes evolved-world thumbnails for the Ruleset Library previews WITHOUT disturbing the user's
 * selected view: it borrows a non-selected, enabled scratch world (evolve → capture → restore).
 * Extracted from WorldManager (the god-object split, roadmap #3); it reaches back into the host
 * WorldManager for the shared world/proxy state and leaves the persistence/UI reconciliation there.
 *
 * The service OWNS the "currently baking world" index — WorldManager._handleProxyUpdate reads
 * `this.bakingWorldIndex` to suppress the scratch world's transient burst echoes from clobbering
 * persisted worldSettings or firing UI ruleset events during a bake.
 */
export class ThumbnailBakeService {
    /** @param {import('./WorldManager.js').WorldManager} worldManager */
    constructor(worldManager) {
        this.wm = worldManager;
        // While a thumbnail-bake batch borrows a scratch world, its evaluation-burst STATE_UPDATE
        // echoes must NOT reconcile persisted worldSettings / fire UI ruleset events for that world
        // (they carry the transient baked ruleset, not the world's real one). -1 = no bake in flight.
        this.bakingWorldIndex = -1;
        // Tail of the serialized bake-batch chain (see _withScratchBakeWorld).
        this._bakeChain = null;
    }

    /**
     * Capture a BAKED thumbnail with the fixed monochrome luminance LUT instead of the live palette
     * (see {@link generateThumbnailLUT}) so library previews are comparable across entries and
     * CVD-proof regardless of the user's Chroma Lab choice. Two-rAF wait (let the renderer draw the
     * world's latest eval frame before reading its FBO) + never-throws contract.
     * @param {number} worldIndex
     * @returns {Promise<string|null>}
     */
    _captureBakedThumbnail = (worldIndex) => new Promise((resolve) => {
        try {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try {
                        resolve(Renderer.captureWorldThumbnailWithLUT(worldIndex, generateThumbnailLUT()));
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
     * Pick a scratch world for thumbnail baking: a non-selected, enabled, initialized world. Baking
     * borrows it (evolve → capture → restore) so the user's large SELECTED view is never disturbed —
     * only that world's small minimap cell briefly flickers. Enabled is required because a disabled
     * world's FBO renders the "disabled" overlay, not the evolved cells, so its capture would be blank.
     * Starts scanning just after the selected world for a stable, deterministic choice. Returns -1 when
     * no other enabled world is available (falls back to no-op baking → glyph placeholders).
     * @returns {number}
     */
    _pickScratchWorldIndex = () => {
        const sel = this.wm.selectedWorldIndex;
        const n = this.wm.worlds.length;
        for (let step = 1; step < n; step++) {
            const idx = (sel + step) % n;
            const proxy = this.wm.worlds[idx];
            if (proxy?.isInitialized && this.wm.worldSettings[idx]?.enabled) return idx;
        }
        return -1;
    };

    /**
     * Bracket a sequence of thumbnail bakes on a scratch (non-selected) world — the "borrow-and-restore"
     * engine behind the Ruleset Library previews. Snapshots the scratch world's exact cells/tick/ruleset
     * ONCE, suppresses its burst echoes from reconciling worldSettings (via `bakingWorldIndex`), runs
     * `body(bake)` — where each `bake(job)` applies a ruleset, seed-resets to an IC, evolves a burst and
     * captures the rendered frame — then restores the snapshot in a SINGLE `LOAD_STATE` and releases the
     * guard. Capturing the restore ruleset once (not per-bake off stale proxy stats) is what keeps the
     * world from being left on a leftover baked ruleset. Jobs with no `initialState` fall back to the
     * selected world's current IC, so unpaired library entries still get a preview. Never throws.
     * @param {(bake: (job: {hex: string, initialState?: object, seed?: number|null, ticks?: number}) => Promise<string|null>) => Promise<any>} body
     * @returns {Promise<any>}
     */
    _withScratchBakeWorld = (body) => {
        // Serialize bake batches so overlapping snapshot/restore of the scratch world can't corrupt it: a
        // save-triggered backfill may cancel + restart a sweep while a prior batch is still mid-burst, so
        // each batch waits for the previous one's restore before it snapshots. `_bakeChain` is the tail.
        const run = async () => {
        // No scratch world (Auto-Explore running, or no other enabled world): run body with a no-op bake
        // so callers still resolve (all thumbs null) without snapshot/guard/restore side effects.
        const noopBake = async () => null;
        if (this.wm.autoExploreService?.isRunning()) return body(noopBake);

        const idx = this._pickScratchWorldIndex();
        const proxy = idx >= 0 ? this.wm.worlds[idx] : null;
        if (!proxy) return body(noopBake);

        // Snapshot the exact pre-bake state ONCE for a single non-destructive restore. The ruleset comes
        // from worldSettings (the stable main-thread source of truth), NOT live proxy stats — which lag
        // the worker's echoes and would otherwise capture a previous bake's transient ruleset.
        const savedCells = proxy.latestStateArray ? new Uint8Array(proxy.latestStateArray) : null;
        if (!savedCells || savedCells.length !== Config.NUM_CELLS) return body(noopBake);
        const savedTick = proxy.getLatestStats().tick || 0;
        const savedHex = this.wm.worldSettings[idx]?.rulesetHex;
        let savedRulesetArray;
        try {
            savedRulesetArray = hexToRuleset(savedHex);
        } catch {
            return body(noopBake);
        }

        this.bakingWorldIndex = idx;
        EventBus.dispatch(EVENTS.WORLD_BAKING_STATE_CHANGED, { worldIndex: idx });

        const bake = async ({ hex, initialState, seed = null, ticks = EXPLORE_CONFIG.evalTicks } = {}) => {
            if (!hex || hex === 'Error' || hex === 'N/A') return null;
            // Unpaired entries (no IC of their own) bake against the selected world's current IC.
            const ic = initialState || this.wm.worldSettings[this.wm.selectedWorldIndex]?.initialState;
            if (!ic) return null;
            let rulesetArray;
            try {
                rulesetArray = hexToRuleset(hex);
            } catch {
                return null;
            }
            try {
                // Apply the target ruleset, seed-reset to the target IC, then evolve a burst — mirroring
                // AutoExploreService._evaluateCandidate (setRuleset → resetWorld → runEvaluation). A finite
                // seed reproduces the exact paired layout; a falsy seed lets the worker pick a fresh one.
                proxy.setRuleset(rulesetArray.buffer.slice(0));
                proxy.resetWorld(ic, Number.isFinite(seed) ? seed : 0);
                await proxy.runEvaluation({
                    ticks,
                    sampleEvery: EXPLORE_CONFIG.sampleEvery,
                    warmupTicks: EXPLORE_CONFIG.warmupTicks,
                    probe: { enabled: false, probeTicks: EXPLORE_CONFIG.probeTicks },
                });
                return await this._captureBakedThumbnail(idx);
            } catch {
                return null;
            }
        };

        try {
            return await body(bake);
        } finally {
            // Restore the exact pre-bake cells/tick/ruleset ONCE (LOAD_STATE rewrites the worker buffers),
            // then release the guard so the world's real STATE_UPDATE echoes flow to the UI again.
            proxy.sendCommand('LOAD_STATE', {
                newStateBuffer: savedCells.buffer.slice(0),
                newRulesetBuffer: savedRulesetArray.buffer.slice(0),
                worldTick: savedTick,
            }, [savedCells.buffer.slice(0), savedRulesetArray.buffer.slice(0)]);
            this.bakingWorldIndex = -1;
            EventBus.dispatch(EVENTS.WORLD_BAKING_STATE_CHANGED, { worldIndex: -1 });
        }
        };

        const result = (this._bakeChain || Promise.resolve()).then(run, run);
        // Chain tail swallows outcome so one batch's failure never blocks the next.
        this._bakeChain = result.then(() => {}, () => {});
        return result;
    };

    /**
     * Bake a single evolved-world thumbnail for a (ruleset × initial-condition × seed) combo WITHOUT
     * disturbing the user's selected view (baked on a scratch non-selected world; see
     * {@link _withScratchBakeWorld}). Returns a JPEG data-URL, or `null` on any failure (capture
     * unavailable, Auto-Explore running, bad ruleset, no IC) so callers can fall back to the rule glyph.
     * @param {{hex: string, initialState?: object, seed?: number|null, ticks?: number}} job
     * @returns {Promise<string|null>}
     */
    bakeThumbnail = async (job) => this._withScratchBakeWorld((bake) => bake(job));

    /**
     * Bake thumbnails for a list of (hex, initialState, seed) jobs one at a time (sequential so the
     * single borrowed scratch world is never contended). Each job's `onResult(dataUrl)` callback fires
     * as its bake resolves. Returns the array of data-URLs (null entries for failures). Used by the
     * Library's save-time multi-IC chooser and its lazy backfill of entries that lack a thumbnail.
     * @param {Array<{hex: string, initialState?: object, seed?: number|null, ticks?: number,
     *   onResult?: (thumb: string|null) => void}>} jobs
     * @returns {Promise<Array<string|null>>}
     */
    bakeThumbnails = async (jobs = []) => this._withScratchBakeWorld(async (bake) => {
        const out = [];
        for (const job of jobs) {
            const thumb = await bake(job);
            out.push(thumb);
            try { job.onResult?.(thumb); } catch { /* callback errors must not abort the queue */ }
        }
        return out;
    });

    /**
     * Lazily fill in missing thumbnails for library entries, invoking `onResult(entry, thumb)` so the
     * caller persists each its own way (personal entries write to the user library; public entries write
     * to the public-thumb cache). Entries with a paired initial condition bake from it; unpaired entries
     * bake from the selected world's current IC (via {@link _withScratchBakeWorld}). One bake at a time,
     * capped per call so opening the library never stalls; abortable via the returned handle. The whole
     * sweep is bracketed by a single snapshot/restore of the scratch world.
     * `onResult(entry, thumb)` fires after each bake resolves (thumb is `null` on failure) so the caller
     * can persist successes AND remember attempts — that lets it skip already-tried entries on the next
     * sweep instead of re-baking the whole library on every save.
     * `onDone({ cancelled, remaining })` fires once the batch settles: `remaining` is how many missing
     * entries were left unbaked by the per-call `max` cap, so the caller can schedule the next batch and
     * cover the whole library over time instead of stalling after the first `max` entries.
     * @param {Array<{hex: string, initialState?: object, seed?: number|null, thumb?: string|null}>} entries
     * @param {{onResult: (entry: object, thumb: string|null) => void, onDone?: (info: {cancelled: boolean, remaining: number}) => void, max?: number}} ctx
     * @returns {{cancel: () => void}}
     */
    backfillMissingThumbnails = (entries, { onResult, onDone, max = 8 } = {}) => {
        let cancelled = false;
        const missing = (entries || []).filter(e => e && e.hex && !e.thumb);
        const pending = missing.slice(0, max);
        const remaining = Math.max(0, missing.length - pending.length);

        this._withScratchBakeWorld(async (bake) => {
            for (const entry of pending) {
                if (cancelled) return;
                const thumb = await bake({ hex: entry.hex, initialState: entry.initialState, seed: entry.seed });
                if (cancelled) return;
                onResult?.(entry, thumb);
            }
        }).then(() => onDone?.({ cancelled, remaining }), () => onDone?.({ cancelled, remaining }));

        return { cancel: () => { cancelled = true; } };
    };
}
