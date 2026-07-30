// @ts-check

import * as Config from '../core/config.js';
import { encodeTrajectory, TRAJECTORY_EXTENSION, TRAJECTORY_MIME } from '../core/analysis/TrajectoryFormat.js';
import { downloadFile, rulesetName } from '../utils/utils.js';
import { APP_VERSION } from '../version.js';

const LABELS = new Set(['unlabeled', 'interesting', 'boring']);

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
