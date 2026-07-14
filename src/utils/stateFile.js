import { base64ToCells } from './utils.js';

/**
 * Shape-validate a world-state save file (`{ rows, cols, rulesetHex, stateB64 | state[] , worldTick }`,
 * the format {@link WorldManager.saveSelectedWorldState} writes) and decode its cells.
 *
 * Single source of truth for the three readers of that format: the toolbar's Load State input, the
 * COMMAND_LOAD_WORLD_STATE handler, and the Saved Starts importer. Dimension-matching against the
 * *live* grid is deliberately NOT done here — the importer accepts other grid sizes (it resamples),
 * while loading into a world does not.
 *
 * @param {any} data Parsed JSON from the file.
 * @returns {{cells: Uint8Array, rows: number, cols: number, rulesetHex: string, worldTick: number}
 *   | {error: string}}
 */
export function parseStateFile(data) {
    if (!data || typeof data !== 'object') return { error: 'Not a world-state file.' };

    const rows = Number(data.rows);
    const cols = Number(data.cols);
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
        return { error: 'File is missing its grid dimensions.' };
    }
    if (typeof data.rulesetHex !== 'string' || !/^[0-9a-fA-F]{32}$/.test(data.rulesetHex)) {
        return { error: 'File is missing a valid 32-character ruleset hex.' };
    }

    let cells;
    try {
        if (typeof data.stateB64 === 'string') {
            cells = base64ToCells(data.stateB64, rows * cols);
        } else if (Array.isArray(data.state)) {
            // Legacy format: one JSON number per cell.
            cells = Uint8Array.from(data.state, v => (v ? 1 : 0));
        } else {
            return { error: 'File is missing world state data.' };
        }
    } catch {
        return { error: 'World state data in the file is corrupt.' };
    }

    if (cells.length !== rows * cols) {
        return { error: "State data length doesn't match the grid dimensions in the file." };
    }

    return { cells, rows, cols, rulesetHex: data.rulesetHex, worldTick: Number(data.worldTick) || 0 };
}
