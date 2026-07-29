// @ts-check

import * as Config from '../core/config.js';
import { encodeTrajectory, TRAJECTORY_EXTENSION, TRAJECTORY_MIME } from '../core/analysis/TrajectoryFormat.js';
import { downloadFile, rulesetName } from '../utils/utils.js';
import { createStoredZip } from '../utils/ZipStore.js';
import { APP_VERSION } from '../version.js';

const LABELS = new Set(['unlabeled', 'interesting', 'boring']);
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

export class TrajectoryCaptureService {
    /** @param {import('../core/WorldManager.js').WorldManager} worldManager */
    constructor(worldManager) {
        this.wm = worldManager;
    }

    /**
     * Capture a non-destructive slice from the selected world's exact current state.
     * @param {{frameCount?: number, tickStride?: number, label?: string, family?: string, notes?: string}} [options]
     */
    async captureSelected(options = {}) {
        if (this.wm.autoExploreService?.isRunning()) throw new Error('Stop Auto-Explore before capturing training data.');
        const index = this.wm.selectedWorldIndex;
        const proxy = this.wm.worlds[index];
        const settings = this.wm.worldSettings[index];
        if (!proxy?.isInitialized) throw new Error('Selected world is not ready.');

        const frameCount = Math.max(1, Math.min(32, Math.trunc(Number(options.frameCount) || 32)));
        const tickStride = Math.max(1, Math.min(32, Math.trunc(Number(options.tickStride) || 1)));
        if ((frameCount - 1) * tickStride > 256) throw new Error('Training slice span may not exceed 256 simulated ticks.');
        const label = LABELS.has(String(options.label)) ? String(options.label) : 'unlabeled';
        const capture = await proxy.captureTrajectory({ frameCount, tickStride });
        const { frames, sourceTick } = capture;
        const tickOffsets = frames.map((/** @type {Uint8Array} */ _, /** @type {number} */ frame) => frame * tickStride);
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
                family: String(options.family || '').trim().slice(0, 100),
                notes: String(options.notes || '').slice(0, 500),
                appVersion: APP_VERSION,
                createdAt: new Date().toISOString(),
            },
            frames,
        });
        return { ...encoded, frames };
    }

    /** @param {{frameCount?: number, tickStride?: number, label?: string, family?: string, notes?: string}} [options] */
    async captureAndDownload(options = {}) {
        const result = await this.captureSelected(options);
        const name = rulesetName(result.header.ruleset);
        const filename = `hexlife-${safeSlug(name)}-t${result.header.sourceTick}-${result.header.id.slice(0, 8)}.${TRAJECTORY_EXTENSION}`;
        const body = Uint8Array.from(result.bytes).buffer;
        downloadFile(filename, body, TRAJECTORY_MIME);
        return { filename, header: result.header };
    }

    /**
     * Capture consecutive, non-overlapping future slices from one exact world state and package
     * them for direct extraction into HexLifeInterestModel/data/trajectories.
     * @param {{frameCount?: number, tickStride?: number, sliceCount?: number, label?: string, family?: string, notes?: string}} [options]
     */
    async captureSeriesSelected(options = {}) {
        if (this.wm.autoExploreService?.isRunning()) throw new Error('Stop Auto-Explore before capturing training data.');
        const index = this.wm.selectedWorldIndex;
        const proxy = this.wm.worlds[index];
        const settings = this.wm.worldSettings[index];
        if (!proxy?.isInitialized) throw new Error('Selected world is not ready.');

        const frameCount = Math.max(1, Math.min(32, Math.trunc(Number(options.frameCount) || 32)));
        const tickStride = Math.max(1, Math.min(32, Math.trunc(Number(options.tickStride) || 1)));
        const sliceCount = Math.max(2, Math.min(MAX_TRAJECTORY_SLICES, Math.trunc(Number(options.sliceCount) || 8)));
        if ((frameCount - 1) * tickStride > 256) throw new Error('Training slice span may not exceed 256 simulated ticks.');
        const totalSpan = (sliceCount - 1) * frameCount * tickStride + (frameCount - 1) * tickStride;
        if (totalSpan > MAX_TRAJECTORY_SERIES_TICKS) {
            throw new Error(`Training-slice set span may not exceed ${MAX_TRAJECTORY_SERIES_TICKS} simulated ticks.`);
        }

        const label = LABELS.has(String(options.label)) ? String(options.label) : 'unlabeled';
        const family = String(options.family || '').trim().slice(0, 100);
        const notes = String(options.notes || '').slice(0, 500);
        const ruleset = settings?.rulesetHex || proxy.getLatestStats().rulesetHex;
        const collectionId = newId();
        const createdAt = new Date().toISOString();
        const captures = await proxy.captureTrajectorySeries({ frameCount, tickStride, sliceCount });
        if (!Array.isArray(captures) || captures.length !== sliceCount) {
            throw new Error('Worker returned an incomplete trajectory series.');
        }

        return captures.map((capture, collectionIndex) => {
            const tickOffsets = capture.frames.map(
                (/** @type {Uint8Array} */ _, /** @type {number} */ frame) => frame * tickStride,
            );
            return {
                ...encodeTrajectory({
                    header: {
                        id: newId(),
                        rows: Config.GRID_ROWS,
                        cols: Config.GRID_COLS,
                        tickOffsets,
                        ruleset,
                        sourceTick: capture.sourceTick,
                        initialState: settings?.initialState ? structuredClone(settings.initialState) : undefined,
                        label,
                        family,
                        notes,
                        collectionId,
                        collectionIndex,
                        collectionCount: sliceCount,
                        appVersion: APP_VERSION,
                        createdAt,
                    },
                    frames: capture.frames,
                }),
                frames: capture.frames,
            };
        });
    }

    /** @param {{frameCount?: number, tickStride?: number, sliceCount?: number, label?: string, family?: string, notes?: string}} [options] */
    async captureSeriesAndDownload(options = {}) {
        const records = await this.captureSeriesSelected(options);
        const first = records[0].header;
        const name = rulesetName(first.ruleset);
        const files = records.map((record) => {
            const filename = `${safeSlug(name)}-t${record.header.sourceTick}-${record.header.id}.${TRAJECTORY_EXTENSION}`;
            return { name: filename, bytes: record.bytes, header: record.header };
        });
        const index = {
            schema: 'HXLT-COLLECTION-1',
            collectionId: first.collectionId,
            createdAt: first.createdAt,
            label: first.label,
            family: first.family,
            count: files.length,
            files: files.map((file) => ({
                filename: file.name,
                id: file.header.id,
                sourceTick: file.header.sourceTick,
                frameCount: file.header.frameCount,
                tickOffsets: file.header.tickOffsets,
                payloadCrc32: file.header.payloadCrc32,
            })),
        };
        const zip = createStoredZip([
            ...files.map(({ name: filename, bytes }) => ({ name: filename, bytes })),
            {
                name: `_hexlife-hxlt-index-${first.collectionId}.json`,
                bytes: new TextEncoder().encode(`${JSON.stringify(index, null, 2)}\n`),
            },
        ]);
        const filename = `hexlife-${safeSlug(name)}-t${first.sourceTick}-${files.length}-slices-${first.collectionId.slice(0, 8)}.zip`;
        downloadFile(filename, Uint8Array.from(zip).buffer, 'application/zip');
        return { filename, headers: records.map((record) => record.header), index };
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
