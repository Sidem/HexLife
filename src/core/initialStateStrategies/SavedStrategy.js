import { BaseStateStrategy } from './BaseStateStrategy.js';
import { DensityStrategy } from './DensityStrategy.js';
import { base64ToCells } from '../../utils/utils.js';

const densityFallback = new DensityStrategy();

/**
 * "Saved start": a captured cell grid replayed verbatim as a world's initial state.
 *
 * Unlike the generative strategies this one ignores `rng` entirely (except on the malformed-payload
 * fallback), so every reset reproduces the captured cells byte-for-byte and all nine worlds seeded
 * from the same entry start identical — the whole point of the feature.
 *
 * `params.rows`/`params.cols` are the dims the state was captured at. When they differ from the
 * live grid (the user changed the grid size after capturing), the state is resampled with a
 * deterministic nearest-neighbour map instead of being refused: the start stays recognisable, the
 * cross-world identity holds, and the UI badges the entry as scaled.
 */
export class SavedStrategy extends BaseStateStrategy {
    generate(stateArray, params, rng, config) {
        const srcRows = Number(params?.rows);
        const srcCols = Number(params?.cols);
        const cells = this._decode(params, srcRows, srcCols);

        if (!cells) {
            // Never throw inside the worker — degrade to the statistical start we recorded at capture.
            densityFallback.generate(stateArray, { density: params?.density ?? 0.5 }, rng, config);
            return;
        }

        const dstCols = config?.GRID_COLS | 0;
        const dstRows = config?.GRID_ROWS | 0;

        if (srcRows === dstRows && srcCols === dstCols) {
            stateArray.set(cells.subarray(0, stateArray.length));
            return;
        }

        for (let r = 0; r < dstRows; r++) {
            const srcR = Math.min(srcRows - 1, Math.floor((r * srcRows) / dstRows));
            for (let c = 0; c < dstCols; c++) {
                const srcC = Math.min(srcCols - 1, Math.floor((c * srcCols) / dstCols));
                stateArray[r * dstCols + c] = cells[srcR * srcCols + srcC];
            }
        }
    }

    /** @returns {Uint8Array|null} The decoded source grid, or null when the payload is unusable. */
    _decode(params, srcRows, srcCols) {
        if (typeof params?.stateB64 !== 'string' || !params.stateB64) return null;
        if (!Number.isFinite(srcRows) || !Number.isFinite(srcCols) || srcRows <= 0 || srcCols <= 0) return null;
        try {
            const cells = base64ToCells(params.stateB64, srcRows * srcCols);
            return cells.length === srcRows * srcCols ? cells : null;
        } catch {
            return null;
        }
    }
}
