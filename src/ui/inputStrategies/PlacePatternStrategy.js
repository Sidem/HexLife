import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import { translatePatternCells, rotatePatternCells, mirrorPatternCells } from '../../utils/utils.js';

/**
 * @class PlacePatternStrategy
 * @description Handles placing a pre-defined pattern on the grid.
 */
export class PlacePatternStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.patternToPlace = null;
        this.originParity = 0;
        // Last valid cursor cell over the selected view, so a rotation can refresh the
        // ghost preview in place without waiting for the next mouse move.
        this.lastCol = null;
        this.lastRow = null;
        // Cursor-following "Esc to exit" hint, shown while placing (desktop only — it is
        // revealed on mouse move, so it stays hidden during touch placement).
        this.hintEl = null;
    }

    enter(options) {
        if (!options || !options.cells) {
            console.error("PlacePatternStrategy: No cell data provided.");
            this.manager.setStrategy('pan');
            return;
        }
        this.patternToPlace = options.cells;
        this.originParity = options.originParity ?? 0;
        this.lastCol = null;
        this.lastRow = null;
        this.manager.canvas.classList.add('placing-pattern-cursor');
        this._createHint();
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, {
            message: 'Click to place · R rotate · F flip (Shift+F vertical) · Esc to exit',
            type: 'info'
        });
    }

    exit() {
        this.patternToPlace = null;
        this.originParity = 0;
        this.lastCol = null;
        this.lastRow = null;
        this.manager.canvas.classList.remove('placing-pattern-cursor');
        this._removeHint();
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
    }

    handleMouseDown(event) {
        if (event.button !== 0) return;
        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(event);
        if (viewType !== 'selected' || col === null) {
             this.manager.setStrategy('pan');
            return;
        }
        const indicesToSet = this.getTranslatedPatternIndices(col, row);
        // Stamp the pattern: its cells are meant to be set alive, so use 'draw' rather than the
        // default 'invert'. Inverting XORs the pattern against whatever is already there, which on a
        // busy/running world erases overlapping live cells and leaves a garbled remnant that dies the
        // next tick (the "pattern disappears while running" bug). 'draw' matches the ghost preview and
        // works identically whether the sim is paused or running, sparse or dense.
        EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { worldIndex: worldIndexAtCursor, cellIndices: indicesToSet, brushMode: 'draw' });
        // Stay in placing mode so the same pattern can be stamped repeatedly; keep the ghost
        // preview visible at the cursor. Esc (or switching tools) exits.
        this.lastCol = col;
        this.lastRow = row;
        EventBus.dispatch(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, { indices: indicesToSet });
    }

    handleMouseMove(event) {
        this._positionHint(event);
        const { col, row, viewType } = this.manager.getCoordsFromPointerEvent(event);
        if (viewType !== 'selected' || col === null) {
            this.lastCol = null;
            this.lastRow = null;
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
            return;
        }

        this.lastCol = col;
        this.lastRow = row;
        const indicesToSet = this.getTranslatedPatternIndices(col, row);
        EventBus.dispatch(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, { indices: indicesToSet });
    }

    handleMouseOut() {
        if (this.hintEl) this.hintEl.classList.remove('visible');
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            this.manager.setStrategy(this.manager.previousStrategyName || 'pan');
            return;
        }
        if (event.key === 'r' || event.key === 'R') {
            // Consume the key so the global 'r' (reset all worlds) shortcut never fires while
            // placing. InputManager listens in the capture phase, so stopping propagation here
            // pre-empts the KeyboardShortcutManager's bubble-phase handler.
            event.preventDefault();
            event.stopPropagation();
            this.rotate(event.shiftKey ? -1 : 1);
            return;
        }
        if (event.key === 'f' || event.key === 'F') {
            // Same capture-phase consumption as rotate, so no global 'f' shortcut can fire.
            event.preventDefault();
            event.stopPropagation();
            this.mirror(event.shiftKey);
        }
    }

    /**
     * Rotates the live pattern by `steps` × 60° (kept across placements) and refreshes the
     * ghost preview at the last known cursor cell.
     * @param {number} steps Positive = clockwise, negative = counter-clockwise.
     */
    rotate(steps) {
        if (!this.patternToPlace) return;
        this.patternToPlace = rotatePatternCells(this.patternToPlace, this.originParity, steps);
        this._refreshGhost();
    }

    /**
     * Mirrors the live pattern (kept across placements) and refreshes the ghost preview at the
     * last known cursor cell.
     * @param {boolean} vertical `false` = horizontal flip (left↔right); `true` = vertical (up↔down).
     */
    mirror(vertical) {
        if (!this.patternToPlace) return;
        this.patternToPlace = mirrorPatternCells(this.patternToPlace, this.originParity, vertical);
        this._refreshGhost();
    }

    /** Re-renders the ghost preview at the last known cursor cell, if any. */
    _refreshGhost() {
        if (this.lastCol !== null && this.lastRow !== null) {
            const indicesToSet = this.getTranslatedPatternIndices(this.lastCol, this.lastRow);
            EventBus.dispatch(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, { indices: indicesToSet });
        }
    }

    /** Creates the cursor-following exit hint (hidden until the first mouse move). */
    _createHint() {
        if (this.hintEl) return;
        const container = this.manager.canvas.parentElement;
        if (!container) return;
        const el = document.createElement('div');
        el.className = 'placing-exit-hint';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = '<kbd>Esc</kbd> to exit';
        container.appendChild(el);
        this.hintEl = el;
    }

    _removeHint() {
        if (this.hintEl) {
            this.hintEl.remove();
            this.hintEl = null;
        }
    }

    /** Moves the exit hint just below-right of the cursor and reveals it. */
    _positionHint(event) {
        if (!this.hintEl) return;
        const container = this.manager.canvas.parentElement;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        this.hintEl.style.left = `${event.clientX - rect.left + 16}px`;
        this.hintEl.style.top = `${event.clientY - rect.top + 16}px`;
        this.hintEl.classList.add('visible');
    }

    getTranslatedPatternIndices(anchorCol, anchorRow) {
        if (!this.patternToPlace) return new Set();

        const indices = new Set();
        const placed = translatePatternCells(this.patternToPlace, anchorCol, anchorRow, this.originParity);
        for (const [newCol, newRow] of placed) {
            if (newCol >= 0 && newCol < Config.GRID_COLS && newRow >= 0 && newRow < Config.GRID_ROWS) {
                indices.add(newRow * Config.GRID_COLS + newCol);
            }
        }
        return indices;
    }
}