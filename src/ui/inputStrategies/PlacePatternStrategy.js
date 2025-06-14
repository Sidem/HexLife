import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';

/**
 * @class PlacePatternStrategy
 * @description Handles placing a pre-defined pattern on the grid.
 */
export class PlacePatternStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.patternToPlace = null;
    }

    enter(options) {
        if (!options || !options.cells) {
            console.error("PlacePatternStrategy: No cell data provided.");
            this.manager.setStrategy('pan'); // Revert to a safe strategy
            return;
        }
        this.patternToPlace = options.cells;
        this.manager.canvas.classList.add('placing-pattern-cursor');
    }

    exit() {
        this.patternToPlace = null;
        this.manager.canvas.classList.remove('placing-pattern-cursor');
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
    }

    handleMouseDown(event) {
        if (event.button !== 0) return; // Only left click to place

        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(event);
        if (viewType !== 'selected' || col === null) {
             this.manager.setStrategy('pan'); // Exit placing mode if clicked outside
            return;
        }

        const indicesToSet = this.getTranslatedPatternIndices(col, row);
        EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { worldIndex: worldIndexAtCursor, cellIndices: indicesToSet });
        
        // Revert to the previous interaction mode (pan or draw)
        this.manager.setStrategy(this.manager.previousStrategyName || 'pan');
    }

    handleMouseMove(event) {
        const { col, row, viewType } = this.manager.getCoordsFromPointerEvent(event);
        if (viewType !== 'selected' || col === null) {
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
            return;
        }

        const indicesToSet = this.getTranslatedPatternIndices(col, row);
        EventBus.dispatch(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, { indices: indicesToSet });
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            this.manager.setStrategy(this.manager.previousStrategyName || 'pan');
        }
    }
    
    getTranslatedPatternIndices(anchorCol, anchorRow) {
        if (!this.patternToPlace) return new Set();

        const indices = new Set();
        for (const [dx, dy] of this.patternToPlace) {
            const newCol = anchorCol + dx;
            const newRow = anchorRow + dy;
            if (newCol >= 0 && newCol < Config.GRID_COLS && newRow >= 0 && newRow < Config.GRID_ROWS) {
                const index = newRow * Config.GRID_COLS + newCol;
                indices.add(index);
            }
        }
        return indices;
    }
}