import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

import { findHexagonsInNeighborhood } from '../../utils/utils.js';
import * as Config from '../../core/config.js';

/**
 * @class DrawStrategy
 * @description Handles drawing on the grid.
 */
export class DrawStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.isDrawing = false;
        this.wasSimulationRunningBeforeStroke = false;
        this.strokeAffectedCells = new Set();
        this.lastDrawnCellIndex = null;
    }

    exit() {
        
        if (this.wasSimulationRunningBeforeStroke) {
            this.manager.appContext.simulationController.setPause(false);
        }
        this.resetStrokeState();
    }

    handleMouseDown(event) {
        if (event.button !== 0) return; 
        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(event);
        if (viewType !== 'selected' || col === null) return;
        this.isDrawing = true;
        this.resetStrokeState();
        if (this.manager.appContext.interactionController.getState().pauseWhileDrawing && !this.manager.appContext.simulationController.getState().isPaused) {
            this.wasSimulationRunningBeforeStroke = true;
            this.manager.appContext.simulationController.setPause(true);
        }

        this.applyBrush(worldIndexAtCursor, col, row);
    }

    handleMouseMove(event) {
        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(event);
        const selectedWorldIdx = this.manager.worldManager.getSelectedWorldIndex();
        if (viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, { worldIndex: selectedWorldIdx, col, row });
        } else {
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
        }

        if (this.isDrawing) {
            this.applyBrush(worldIndexAtCursor, col, row);
        }
    }

    handleMouseUp(event) {
        this.endDrawing();
    }

    handleMouseOut(event) {
        this.endDrawing();
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: this.manager.worldManager.getSelectedWorldIndex() });
    }

    handleTouchStart(event) {
        const primaryTouch = event.touches[0];
        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(primaryTouch);
        if (viewType !== 'selected' || col === null) return;

        this.isDrawing = true;
        this.resetStrokeState();
        
        if (this.manager.appContext.interactionController.getState().pauseWhileDrawing && !this.manager.appContext.simulationController.getState().isPaused) {
            this.wasSimulationRunningBeforeStroke = true;
            this.manager.appContext.simulationController.setPause(true);
        }
        
        this.applyBrush(worldIndexAtCursor, col, row);
    }

    handleTouchMove(event) {
        const primaryTouch = event.touches[0];
        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(primaryTouch);
        const selectedWorldIdx = this.manager.worldManager.getSelectedWorldIndex();
        if (viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, { worldIndex: selectedWorldIdx, col, row });
        } else {
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
        }
        
        if (this.isDrawing) {
            this.applyBrush(worldIndexAtCursor, col, row);
        }
    }

    handleTouchEnd(event) {
        this.endDrawing();
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: this.manager.worldManager.getSelectedWorldIndex() });
    }

    applyBrush(worldIndex, col, row) {
        const currentCellIndex = row * Config.GRID_COLS + col;
        if (currentCellIndex === this.lastDrawnCellIndex) return;
        this.lastDrawnCellIndex = currentCellIndex;

        const newCellsInBrush = new Set();
        findHexagonsInNeighborhood(col, row, this.manager.appContext.brushController.getState().brushSize, newCellsInBrush);
        
        const cellsToToggle = Array.from(newCellsInBrush).filter(cellIndex => !this.strokeAffectedCells.has(cellIndex));

        if (cellsToToggle.length > 0) {
            cellsToToggle.forEach(c => this.strokeAffectedCells.add(c));
            EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { worldIndex: worldIndex, cellIndices: new Set(cellsToToggle) });
        }
    }

    endDrawing() {
        if (!this.isDrawing) return;
        
        if (this.wasSimulationRunningBeforeStroke) {
            this.manager.appContext.simulationController.setPause(false);
        }
        this.resetStrokeState();
        this.isDrawing = false;
        if (!this.manager.isMobile) {
            this.manager.setStrategy('pan');
        }
    }

    resetStrokeState() {
        this.strokeAffectedCells.clear();
        this.lastDrawnCellIndex = null;
        this.wasSimulationRunningBeforeStroke = false;
    }
}