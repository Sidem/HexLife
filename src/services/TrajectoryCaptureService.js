// @ts-check

import * as Config from '../core/config.js';
import { encodeTrajectory, TRAJECTORY_EXTENSION, TRAJECTORY_MIME } from '../core/analysis/TrajectoryFormat.js';
import { downloadFile, rulesetName } from '../utils/utils.js';
import { createStoredZip } from '../utils/ZipStore.js';
import { APP_VERSION } from '../version.js';
import { classifyRulesetConstraint } from '../core/rulesetDescriptor.js';
import {
    CORPUS_FAMILY_PATTERN,
    CORPUS_PROTOCOL,
    CORPUS_SCENARIOS,
    initialConditionId,
} from '../core/analysis/corpusProtocol.js';

// Re-exported for existing importers; the protocol vocabulary now lives in `corpusProtocol.js`.
export { CORPUS_PROTOCOL, CORPUS_SCENARIOS };

const LABELS = new Set(['unlabeled', 'interesting', 'boring']);
const SCENARIOS = new Set(CORPUS_SCENARIOS);
export const MAX_TRAJECTORY_SLICES = 16;
export const MAX_TRAJECTORY_SERIES_TICKS = 4096;

function newId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `hxlt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** @param {string} value */
function safeSlug(value) {
    return String(value || 'trajectory')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'trajectory';
}

/**
 * The `gridPreset` header value for the live grid size, or a `custom-RxC` marker when a share link
 * brought in a size no preset matches. Exported because the Corpus Lab scheduler has to know which
 * grid *block* the session is in, and reading it from anywhere but here could disagree with what the
 * clip headers actually say.
 */
export function currentGridPreset() {
    return Object.entries(Config.GRID_SIZE_PRESETS)
        .find(([, rows]) => rows === Config.GRID_ROWS)?.[0] || `custom-${Config.GRID_ROWS}x${Config.GRID_COLS}`;
}

export class TrajectoryCaptureService {
    /** @param {import('../core/WorldManager.js').WorldManager} worldManager */
    constructor(worldManager) {
        this.wm = worldManager;
    }

    /**
     * Corpus provenance for one world, resolved at capture time.
     *
     * Only the Corpus Lab path uses this. The shipped ad-hoc export (`captureSelected`) deliberately
     * keeps its own inline header assembly so a corpus-protocol change cannot alter release-line
     * clip bytes.
     *
     * @param {number} index @param {Record<string, any>} options
     */
    _captureContext(index, options) {
        const proxy = this.wm.worlds[index];
        const settings = this.wm.worldSettings[index];
        if (!proxy?.isInitialized) throw new Error(`World ${index + 1} is not ready.`);
        const ruleset = settings?.rulesetHex || proxy.getLatestStats().rulesetHex;
        const initialState = settings?.initialState ? structuredClone(settings.initialState) : undefined;
        const seed = Number.isFinite(proxy.lastResetSeed) ? Number(proxy.lastResetSeed) : null;
        const scenario = SCENARIOS.has(String(options.scenario)) ? String(options.scenario) : 'unknown';
        return {
            proxy,
            settings,
            ruleset,
            provenance: {
                initialState,
                corpusProtocol: CORPUS_PROTOCOL,
                family: String(options.family || '').trim().slice(0, 100),
                scenario,
                symmetryClass: classifyRulesetConstraint(ruleset),
                gridPreset: currentGridPreset(),
                initialConditionId: initialConditionId(initialState),
                seed,
                seedId: seed == null ? 'unknown' : `seed-${Math.trunc(seed) >>> 0}`,
            },
        };
    }

    /**
     * Capture one non-destructive exact trajectory from the selected world.
     * @param {{frameCount?: number, tickStride?: number, label?: string, notes?: string}} [options]
     */
    async captureSelected(options = {}) {
        if (this.wm.autoExploreService?.isRunning()) {
            throw new Error('Stop Auto-Explore before capturing training data.');
        }
        const index = this.wm.selectedWorldIndex;
        const proxy = this.wm.worlds[index];
        const settings = this.wm.worldSettings[index];
        if (!proxy?.isInitialized) throw new Error('Selected world is not ready.');

        const frameCount = Math.max(1, Math.min(32, Math.trunc(Number(options.frameCount) || 32)));
        const tickStride = Math.max(1, Math.min(8, Math.trunc(Number(options.tickStride) || 8)));
        if ((frameCount - 1) * tickStride > 256) {
            throw new Error('Training slice span may not exceed 256 simulated ticks.');
        }
        const label = LABELS.has(String(options.label)) ? String(options.label) : 'unlabeled';
        const capture = await proxy.captureTrajectory({ frameCount, tickStride });
        const { frames, sourceTick } = capture;
        const tickOffsets = frames.map(
            (/** @type {Uint8Array} */ _, /** @type {number} */ frame) => frame * tickStride,
        );
        const ruleset = settings?.rulesetHex || proxy.getLatestStats().rulesetHex;
        const id = newId();
        const encoded = encodeTrajectory({
            header: {
                id,
                rows: Config.GRID_ROWS,
                cols: Config.GRID_COLS,
                tickOffsets,
                ruleset,
                sourceTick,
                initialState: settings?.initialState ? structuredClone(settings.initialState) : undefined,
                label,
                notes: String(options.notes || '').slice(0, 500),
                appVersion: APP_VERSION,
                createdAt: new Date().toISOString(),
            },
            frames,
        });
        return { ...encoded, frames };
    }

    /** @param {{frameCount?: number, tickStride?: number, label?: string, notes?: string}} [options] */
    async captureAndDownload(options = {}) {
        const result = await this.captureSelected(options);
        const name = rulesetName(result.header.ruleset);
        const filename = `hexlife-${safeSlug(name)}-t${result.header.sourceTick}-${result.header.id.slice(0, 8)}.${TRAJECTORY_EXTENSION}`;
        downloadFile(filename, Uint8Array.from(result.bytes).buffer, TRAJECTORY_MIME);
        return { filename, header: result.header };
    }

    /**
     * Capture one just-judged world's clips for the session buffer, without downloading.
     *
     * This is the capture-at-judgment path the Corpus Lab uses: the clips are encoded while the
     * world is still live, then the caller is free to recycle that world immediately — which is what
     * lets one session outlive a single grid of judgments.
     *
     * Family and scenario arrive from the lineage generator and the scenario classifier rather than
     * from typed input, so a long session cannot drift into mislabeled provenance.
     *
     * @param {number} worldIndex
     * @param {{
     *   label: 'interesting'|'boring',
     *   family: string,
     *   scenario: string,
     *   frameCount?: number,
     *   tickStride?: number,
     *   sliceCount?: number,
     *   notes?: string,
     *   sessionId?: string,
     * }} options
     * @returns {Promise<{clips: Array<{filename: string, bytes: Uint8Array, header: Record<string, any>}>, ruleset: string}>}
     */
    async captureJudgedWorld(worldIndex, options) {
        if (this.wm.autoExploreService?.isRunning()) throw new Error('Stop Auto-Explore before capturing training data.');
        const label = String(options?.label);
        if (label !== 'interesting' && label !== 'boring') {
            throw new Error('A corpus clip needs an interesting or boring label.');
        }
        const family = String(options?.family || '').trim();
        if (!CORPUS_FAMILY_PATTERN.test(family)) {
            throw new Error(`Derived family id "${family}" is not protocol-valid.`);
        }
        const scenario = String(options?.scenario || 'unknown');
        if (!SCENARIOS.has(scenario)) throw new Error(`Unknown scenario "${scenario}".`);

        const index = Math.trunc(Number(worldIndex));
        const proxy = this.wm.worlds[index];
        if (!Number.isFinite(proxy?.lastResetSeed)) {
            throw new Error(`World ${index + 1} has no known reset seed; reset it before capture.`);
        }
        const { ruleset, provenance } = this._captureContext(index, { ...options, family, scenario });

        const frameCount = Math.max(1, Math.min(32, Math.trunc(Number(options?.frameCount) || 32)));
        const tickStride = Math.max(1, Math.min(32, Math.trunc(Number(options?.tickStride) || 1)));
        const sliceCount = Math.max(1, Math.min(MAX_TRAJECTORY_SLICES, Math.trunc(Number(options?.sliceCount) || 4)));
        if ((frameCount - 1) * tickStride > 256) throw new Error('Training slice span may not exceed 256 simulated ticks.');
        const totalSpan = (sliceCount - 1) * frameCount * tickStride + (frameCount - 1) * tickStride;
        if (totalSpan > MAX_TRAJECTORY_SERIES_TICKS) {
            throw new Error(`Training-slice set span may not exceed ${MAX_TRAJECTORY_SERIES_TICKS} simulated ticks.`);
        }

        const captures = sliceCount === 1
            ? [await proxy.captureTrajectory({ frameCount, tickStride })]
            : await proxy.captureTrajectorySeries({ frameCount, tickStride, sliceCount });
        if (!Array.isArray(captures) || captures.length !== sliceCount) {
            throw new Error(`World ${index + 1} returned an incomplete trajectory series.`);
        }

        const collectionId = newId();
        const createdAt = new Date().toISOString();
        const clips = captures.map((capture, collectionIndex) => {
            const tickOffsets = capture.frames.map(
                (/** @type {Uint8Array} */ _, /** @type {number} */ frame) => frame * tickStride,
            );
            const record = encodeTrajectory({
                header: {
                    id: newId(),
                    rows: Config.GRID_ROWS,
                    cols: Config.GRID_COLS,
                    tickOffsets,
                    ruleset,
                    sourceTick: capture.sourceTick,
                    ...provenance,
                    label,
                    notes: String(options?.notes || '').slice(0, 500),
                    batchId: String(options?.sessionId || collectionId),
                    worldIndex: index,
                    collectionId,
                    collectionIndex,
                    collectionCount: sliceCount,
                    appVersion: APP_VERSION,
                    createdAt,
                },
                frames: capture.frames,
            });
            return {
                filename: `${safeSlug(family)}-${safeSlug(rulesetName(ruleset))}-t${record.header.sourceTick}-${record.header.id}.${TRAJECTORY_EXTENSION}`,
                bytes: record.bytes,
                header: record.header,
            };
        });
        return { clips, ruleset };
    }

    /**
     * Write a collection buffer out as one ZIP: every buffered clip plus the session index and the
     * proposed family registry fragment.
     *
     * @param {import('../core/analysis/CorpusCollectionBuffer.js').CorpusCollectionBuffer} buffer
     * @param {{partIndex?: number, final?: boolean}} [options]
     */
    downloadCorpusBuffer(buffer, options = {}) {
        if (!buffer?.clipCount) throw new Error('Nothing collected yet.');
        const index = buffer.index(options);
        const part = index.partIndex ? `-part${index.partIndex + 1}` : '';
        const zip = createStoredZip([
            ...buffer.clips.map(({ filename, bytes }) => ({ name: filename, bytes })),
            {
                name: `_hexlife-corpus-session-${buffer.sessionId}${part}.json`,
                bytes: new TextEncoder().encode(`${JSON.stringify(index, null, 2)}\n`),
            },
            {
                name: `_families-v1-proposed-${buffer.sessionId}${part}.json`,
                bytes: new TextEncoder().encode(`${JSON.stringify(buffer.familyRegistry(), null, 2)}\n`),
            },
        ]);
        const filename = `hexlife-corpus-session-${buffer.sessionId.slice(0, 8)}${part}-${index.clipCount}-clips.zip`;
        downloadFile(filename, Uint8Array.from(zip).buffer, 'application/zip');
        return { filename, index };
    }

    /**
     * Capture and evaluate without downloading.
     * @param {import('./NativeTrajectoryModelService.js').NativeTrajectoryModelService} modelService
     * @param {{frameCount?: number, tickStride?: number}} [options]
     */
    async evaluateSelected(modelService, options = {}) {
        const trajectory = await this.captureSelected({ ...options, label: 'unlabeled' });
        const result = await modelService.evaluate({
            frames: trajectory.frames,
            rows: trajectory.header.rows,
            cols: trajectory.header.cols,
            tickOffsets: trajectory.header.tickOffsets,
        });
        return { ...result, trajectory: trajectory.header };
    }
}
