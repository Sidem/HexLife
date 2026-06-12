import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';
import { translatePatternCells } from '../../utils/utils.js';

/**
 * @class PlacePatternStrategy
 * @description Handles placing a pre-defined pattern on the grid.
 */
export class PlacePatternStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.patternToPlace = null;
        this.originParity = 0;
    }

    enter(options) {
        if (!options || !options.cells) {
            console.error("PlacePatternStrategy: No cell data provided.");
            this.manager.setStrategy('pan');
            return;
        }
        this.patternToPlace = options.cells;
        this.originParity = options.originParity ?? 0;
        this.manager.canvas.classList.add('placing-pattern-cursor');
    }

    exit() {
        this.patternToPlace = null;
        this.originParity = 0;
        this.manager.canvas.classList.remove('placing-pattern-cursor');
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
        EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { worldIndex: worldIndexAtCursor, cellIndices: indicesToSet });
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
        const placed = translatePatternCells(this.patternToPlace, anchorCol, anchorRow, this.originParity);
        for (const [newCol, newRow] of placed) {
            if (newCol >= 0 && newCol < Config.GRID_COLS && newRow >= 0 && newRow < Config.GRID_ROWS) {
                indices.add(newRow * Config.GRID_COLS + newCol);
            }
        }
        return indices;
    }
}