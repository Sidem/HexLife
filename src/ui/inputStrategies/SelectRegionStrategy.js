import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';

/**
 * @class SelectRegionStrategy
 * @description Lets the user drag a rectangular marquee over the selected world to
 * capture the active cells inside it as a reusable pattern. On commit it normalizes
 * the captured cells to relative coordinates and opens the save-pattern modal.
 */
export class SelectRegionStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.isSelecting = false;
        this.startCoords = null; // { col, row }
    }

    enter() {
        this.isSelecting = false;
        this.startCoords = null;
        this.manager.canvas.classList.add('selecting-region-cursor');
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: 'Drag a box over the active cells to capture them as a pattern. Esc to cancel.',
            type: 'info'
        });
    }

    exit() {
        this.isSelecting = false;
        this.startCoords = null;
        this.manager.canvas.classList.remove('selecting-region-cursor');
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
    }

    handleMouseDown(event) {
        if (event.button !== 0) return;
        this._beginAt(event);
    }

    handleMouseMove(event) {
        if (!this.isSelecting) return;
        this._updateTo(event);
    }

    handleMouseUp(event) {
        this._commitFrom(event);
    }

    handleMouseOut() {
        // Abandon an in-progress drag if the pointer leaves the canvas; keep the
        // strategy active so the user can try again without re-entering the mode.
        if (this.isSelecting) {
            this.isSelecting = false;
            this.startCoords = null;
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
        }
    }

    handleTouchStart(event) {
        this._beginAt(event.touches[0]);
    }

    handleTouchMove(event) {
        if (!this.isSelecting) return;
        this._updateTo(event.touches[0]);
    }

    handleTouchEnd(event) {
        this._commitFrom(event.changedTouches[0]);
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            this.manager.setStrategy(this.manager.previousStrategyName || 'pan');
        }
    }

    _beginAt(pointer) {
        if (!pointer) return;
        const { col, row, viewType } = this.manager.getCoordsFromPointerEvent(pointer);
        if (viewType !== 'selected' || col === null) return;
        this.isSelecting = true;
        this.startCoords = { col, row };
        EventBus.dispatch(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, { indices: this._rectIndices(col, row) });
    }

    _updateTo(pointer) {
        if (!pointer) return;
        const { col, row, viewType } = this.manager.getCoordsFromPointerEvent(pointer);
        if (viewType !== 'selected' || col === null) return;
        EventBus.dispatch(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, { indices: this._rectIndices(col, row) });
    }

    _commitFrom(pointer) {
        if (!this.isSelecting) return;
        this.isSelecting = false;
        const start = this.startCoords;
        this.startCoords = null;
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);

        let endCol = start.col;
        let endRow = start.row;
        if (pointer) {
            const { col, row, viewType } = this.manager.getCoordsFromPointerEvent(pointer);
            if (viewType === 'selected' && col !== null) {
                endCol = col;
                endRow = row;
            }
        }

        const cells = this._captureActiveCells(start.col, start.row, endCol, endRow);
        if (cells.length === 0) {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
                message: 'No active cells in selection — nothing to capture.',
                type: 'error'
            });
            this.manager.setStrategy(this.manager.previousStrategyName || 'pan');
            return;
        }

        EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_PATTERN_MODAL, { cells });
        this.manager.setStrategy(this.manager.previousStrategyName || 'pan');
    }

    /**
     * Set of cell indices covering the rectangle bounded by the start anchor and
     * the given corner (clamped to the grid). Used for the live marquee preview.
     */
    _rectIndices(toCol, toRow) {
        const indices = new Set();
        if (!this.startCoords) return indices;
        const { minCol, maxCol, minRow, maxRow } = this._bounds(this.startCoords.col, this.startCoords.row, toCol, toRow);
        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                indices.add(row * Config.GRID_COLS + col);
            }
        }
        return indices;
    }

    /**
     * Reads the selected world's state buffer and returns the active cells within
     * the rectangle, normalized to relative coordinates anchored at (0, 0).
     * @returns {Array<[number, number]>}
     */
    _captureActiveCells(c1, r1, c2, r2) {
        const stateArray = this.manager.worldManager.getSelectedWorldStateArray();
        if (!stateArray) return [];
        const { minCol, maxCol, minRow, maxRow } = this._bounds(c1, r1, c2, r2);

        const active = [];
        let originCol = Infinity;
        let originRow = Infinity;
        for (let row = minRow; row <= maxRow; row++) {
            for (let col = minCol; col <= maxCol; col++) {
                if (stateArray[row * Config.GRID_COLS + col]) {
                    active.push([col, row]);
                    if (col < originCol) originCol = col;
                    if (row < originRow) originRow = row;
                }
            }
        }
        return active.map(([col, row]) => [col - originCol, row - originRow]);
    }

    _bounds(c1, r1, c2, r2) {
        return {
            minCol: Math.max(0, Math.min(c1, c2)),
            maxCol: Math.min(Config.GRID_COLS - 1, Math.max(c1, c2)),
            minRow: Math.max(0, Math.min(r1, r2)),
            maxRow: Math.min(Config.GRID_ROWS - 1, Math.max(r1, r2)),
        };
    }
}
