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

        // Initialize tap detection state for the new touch
        this.touchState.isDown = true;
        this.touchState.isDragging = false;
        this.touchState.startPoint = { x: primaryTouch.clientX, y: primaryTouch.clientY };

        const { worldIndexAtCursor, col, row, viewType } = this.manager.getCoordsFromPointerEvent(primaryTouch);

        // Only begin drawing if the touch starts on the main canvas.
        // If it starts on the minimap, we will wait until touchend to see if it was a tap.
        if (viewType === 'selected' && col !== null) {
            this.isDrawing = true;
            this.resetStrokeState();
            
            if (this.manager.appContext.interactionController.getState().pauseWhileDrawing && !this.manager.appContext.simulationController.getState().isPaused) {
                this.wasSimulationRunningBeforeStroke = true;
                this.manager.appContext.simulationController.setPause(true);
            }
            
            this.applyBrush(worldIndexAtCursor, col, row);
        }
    }

    handleTouchMove(event) {
        const primaryTouch = event.touches[0];

        // Check if the movement exceeds the tap threshold, marking it as a drag.
        if (this.touchState.isDown && !this.touchState.isDragging) {
            const dist = Math.hypot(primaryTouch.clientX - this.touchState.startPoint.x, primaryTouch.clientY - this.touchState.startPoint.y);
            if (dist > this.touchState.TAP_THRESHOLD) {
                this.touchState.isDragging = true;
            }
        }

        // The rest of the logic for hover and drawing remains the same.
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
        // Check if the interaction was a tap (not a drag) on the minimap.
        if (this.touchState.isDown && !this.touchState.isDragging) {
            const endTouch = event.changedTouches[0];
            const { worldIndexAtCursor, viewType } = this.manager.getCoordsFromPointerEvent(endTouch);
            
            if (viewType === 'mini' && worldIndexAtCursor !== null) {
                // It was a tap on the minimap, so select the world.
                EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
                this.touchState.isDown = false; // Reset state
                return; // Exit early, skipping the endDrawing logic.
            }
        }

        // If it wasn't a minimap tap, proceed with the normal end-of-drawing logic.
        this.endDrawing();
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: this.manager.worldManager.getSelectedWorldIndex() });
        this.touchState.isDown = false; // Reset state
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