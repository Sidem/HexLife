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

        this.touchState = {
            isDown: false,
            isDragging: false,
            TAP_THRESHOLD: 10,
            startPoint: { x: 0, y: 0 },
        };
    }

    exit() {
        
        if (this.wasSimulationRunningBeforeStroke) {
            EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
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
            EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
        }

        this.applyBrush(worldIndexAtCursor, col, row);
    }

    handleMouseMove(event) {
        if (this.isDrawing) {
            const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(event);
            if (viewType === 'selected' && col !== null) {
                this.applyBrush(worldIndexAtCursor, col, row);
            }
        }
    }

    handleMouseUp(event) {
        this.endDrawing();
    }

    handleMouseOut(event) {
        this.endDrawing();
    }

    handleTouchStart(event) {
        const primaryTouch = event.touches[0];

        this.touchState.isDown = true;
        this.touchState.isDragging = false;
        this.touchState.startPoint = { x: primaryTouch.clientX, y: primaryTouch.clientY };

        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(primaryTouch);
        if (viewType === 'selected' && col !== null) {
            this.isDrawing = true;
            this.resetStrokeState();
            
            if (this.manager.appContext.interactionController.getState().pauseWhileDrawing && !this.manager.appContext.simulationController.getState().isPaused) {
                this.wasSimulationRunningBeforeStroke = true;
                EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, true);
            }
            
            this.applyBrush(worldIndexAtCursor, col, row);
        }
    }

    handleTouchMove(event) {
        const primaryTouch = event.touches[0];
        if (this.touchState.isDown && !this.touchState.isDragging) {
            const dist = Math.hypot(primaryTouch.clientX - this.touchState.startPoint.x, primaryTouch.clientY - this.touchState.startPoint.y);
            if (dist > this.touchState.TAP_THRESHOLD) {
                this.touchState.isDragging = true;
            }
        }
        if (this.isDrawing) {
            const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(primaryTouch);
            if (viewType === 'selected' && col !== null) {
                this.applyBrush(worldIndexAtCursor, col, row);
            }
        }
    }

    handleTouchEnd(event) {
        if (this.touchState.isDown && !this.touchState.isDragging) {
            const endTouch = event.changedTouches[0];
            const { worldIndexAtCursor, viewType } = this.manager.getCoordsFromPointerEvent(endTouch);
            
            if (viewType === 'mini' && worldIndexAtCursor !== null) {
                EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
                this.isDrawing = false;
                this.resetStrokeState();
                this.touchState.isDown = false;
                return;
            }
        }

        this.endDrawing();
        this.touchState.isDown = false;
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
            const brushMode = this.manager.appContext.interactionController.getState().brushMode;
            EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { 
                worldIndex: worldIndex, 
                cellIndices: new Set(cellsToToggle),
                brushMode: brushMode
            });
        }
    }

    endDrawing() {
        if (!this.isDrawing) return;
        
        if (this.wasSimulationRunningBeforeStroke) {
            EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_STATE, false);
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