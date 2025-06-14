import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { getLayoutCache } from '../rendering/renderer.js';
import { textureCoordsToGridCoords, findHexagonsInNeighborhood, gridToPixelCoords, calculateHexSizeForTexture } from '../utils/utils.js';
import { brushController } from './controllers/BrushController.js';
import { interactionController } from './controllers/InteractionController.js';
import { simulationController } from './controllers/SimulationController.js';

export class CanvasInputHandler {
    constructor(canvas, worldManager, isMobile = false) {
        this.canvas = canvas;
        this.worldManager = worldManager;
        this.gl = canvas.getContext('webgl2');
        this.isMobile = isMobile;

        // --- Interaction State ---
        this.interactionMode = interactionController.getState().mode;
        this.isMouseDrawing = false;
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // --- Stroke State for Drawing ---
        this.justFinishedDrawing = false;
        this.wasSimulationRunningBeforeStroke = false;
        this.strokeAffectedCells = new Set();
        this.lastDrawnCellIndex = null;

        // --- Touch Gesture State ---
        this.touchState = {
            isDown: false,
            isDragging: false,
            gesture: 'none', // 'none', 'pan', 'draw', 'pinch'
            startPoint: { x: 0, y: 0 },
            lastPoint: { x: 0, y: 0 },
            lastDistance: 0,
            TAP_THRESHOLD: 10,
        };

        // --- Pattern Placing State ---
        this.isPlacingPattern = false;
        this.patternToPlace = null;

        // --- UI Layout Cache ---
        this.layoutCache = getLayoutCache();

        this._calculateGridBounds();
        this._setupListeners();
    }



    _handleEscKey(event) {
        if (event.key === 'Escape' && this.isPlacingPattern) {
            this.exitPlacingMode();
        }
    }

    enterPlacingMode(patternData) {
        if (this.isPlacingPattern) return;
        this.isPlacingPattern = true;
        this.interactionMode = 'draw'; // Force draw mode
        this.patternToPlace = patternData.cells;
        this.canvas.classList.add('placing-pattern-cursor');
        this.boundHandleEsc = this._handleEscKey.bind(this);
        document.addEventListener('keydown', this.boundHandleEsc);
    }

    exitPlacingMode() {
        if (!this.isPlacingPattern) return;
        this.isPlacingPattern = false;
        this.patternToPlace = null;
        this.canvas.classList.remove('placing-pattern-cursor');
        document.removeEventListener('keydown', this.boundHandleEsc);
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
    }

    _calculateGridBounds() {
        const hexSize = calculateHexSizeForTexture();
        const topLeft = gridToPixelCoords(0, 0, hexSize);
        const topRight = gridToPixelCoords(Config.GRID_COLS - 1, 0, hexSize);
        const bottomLeft = gridToPixelCoords(0, Config.GRID_ROWS - 1, hexSize);
        const bottomRight = gridToPixelCoords(Config.GRID_COLS - 1, Config.GRID_ROWS - 1, hexSize);

        this.gridWorldBounds = {
            minX: topLeft.x - hexSize,
            maxX: topRight.x + hexSize,
            minY: topRight.y - hexSize,
            maxY: bottomRight.y + hexSize
        };
    }

    _clampCameraPan() {
        const camera = this.worldManager.getCurrentCameraState();
        if (!camera) return;
        const { RENDER_TEXTURE_SIZE } = Config;
        const viewWidth = RENDER_TEXTURE_SIZE / camera.zoom;
        const viewHeight = RENDER_TEXTURE_SIZE / camera.zoom;

        const minX = this.gridWorldBounds.minX + viewWidth / 2;
        const maxX = this.gridWorldBounds.maxX - viewWidth / 2;
        const minY = this.gridWorldBounds.minY + viewHeight / 2;
        const maxY = this.gridWorldBounds.maxY - viewHeight / 2;

        camera.x = (minX > maxX) ? (minX + maxX) / 2 : Math.max(minX, Math.min(maxX, camera.x));
        camera.y = (minY > maxY) ? (minY + maxY) / 2 : Math.max(minY, Math.min(maxY, camera.y));
    }

    _setupListeners() {
        // --- Mouse (Desktop) Listeners ---
        this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this._handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseout', this._handleMouseOut.bind(this));
        this.canvas.addEventListener('wheel', this._handleMouseWheel.bind(this), { passive: false });
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        // --- Touch (Mobile) Listeners ---
        this.canvas.addEventListener('touchstart', this._handleTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this._handleTouchEnd.bind(this), { passive: false });
        this.canvas.addEventListener('touchcancel', this._handleTouchEnd.bind(this), { passive: false });

        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE, interactionController.toggleMode);
        EventBus.subscribe(EVENTS.COMMAND_ENTER_PLACING_MODE, (data) => this.enterPlacingMode(data));
        EventBus.subscribe(EVENTS.INTERACTION_MODE_CHANGED, (mode) => { this.interactionMode = mode; });
        EventBus.subscribe(EVENTS.LAYOUT_CALCULATED, (newLayout) => {
            this.layoutCache = newLayout;
        });
    }

    _getCoordsFromPointerEvent(event) {
        //console.log('Pointer Event Triggered. Layout Cache:', JSON.parse(JSON.stringify(this.layoutCache)));
        if (!this.layoutCache.selectedView) {
            console.error('CRITICAL: layoutCache.selectedView is missing. Layout has not been calculated.');
        }
        const camera = this.worldManager.getCurrentCameraState();
        if (!this.gl || !this.gl.canvas || !this.worldManager || !camera || !this.layoutCache.selectedView) {
            return { worldIndexAtCursor: null, col: null, row: null, viewType: null, worldX: null, worldY: null };
        }

        const rect = this.gl.canvas.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;

        const { x: selectedViewX, y: selectedViewY, width: selectedViewWidth, height: selectedViewHeight } = this.layoutCache.selectedView;

        const currentSelectedWorldIdx = this.worldManager.getSelectedWorldIndex();
        if (pointerX >= selectedViewX && pointerX < selectedViewX + selectedViewWidth &&
            pointerY >= selectedViewY && pointerY < selectedViewY + selectedViewHeight) {
            const texCoordX = (pointerX - selectedViewX) / selectedViewWidth;
            const texCoordY = (pointerY - selectedViewY) / selectedViewHeight;
            const { col, row, worldX, worldY } = textureCoordsToGridCoords(texCoordX, texCoordY, camera);
            return { worldIndexAtCursor: currentSelectedWorldIdx, col, row, viewType: 'selected', worldX, worldY };
        }

        const { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing } = this.layoutCache.miniMap;
        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const r_map = Math.floor(i / Config.WORLD_LAYOUT_COLS);
            const c_map = i % Config.WORLD_LAYOUT_COLS;
            const miniX = gridContainerX + c_map * (miniMapW + miniMapSpacing);
            const miniY = gridContainerY + r_map * (miniMapH + miniMapSpacing);
            if (pointerX >= miniX && pointerX < miniX + miniMapW &&
                pointerY >= miniY && pointerY < miniY + miniMapH) {
                //EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, i);
                return { worldIndexAtCursor: i, col: null, row: null, viewType: 'mini', worldX: null, worldY: null };
            }
        }
        return { worldIndexAtCursor: null, col: null, row: null, viewType: null, worldX: null, worldY: null };
    }

    // --- MOUSE EVENT HANDLERS (DESKTOP) ---
    _handleMouseDown(event) {
        event.preventDefault();
        if (this.isMobile) return; // Ignore mouse events on mobile

        // Middle mouse or Alt+Click for panning
        if (event.button === 1 || (event.button === 0 && event.altKey)) {
            this.isPanning = true;
            this.lastPanX = event.clientX;
            this.lastPanY = event.clientY;
            return;
        }

        if (event.button === 0) {
            const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(event);
            if (viewType === 'mini' && worldIndexAtCursor !== null) {
                EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
                return;
            }
            if (viewType !== 'selected' || col === null) return;
            this.isMouseDrawing = true;
            this.strokeAffectedCells.clear();
            this.lastDrawnCellIndex = row * Config.GRID_COLS + col;
            
            this.wasSimulationRunningBeforeStroke = false; // Reset flag
            if (interactionController.getState().pauseWhileDrawing && !simulationController.getState().isPaused) {
                this.wasSimulationRunningBeforeStroke = true;
                simulationController.setPause(true);
            }

            findHexagonsInNeighborhood(col, row, brushController.getState().brushSize, this.strokeAffectedCells);
            EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { worldIndex: worldIndexAtCursor, cellIndices: this.strokeAffectedCells });
        }
    }

    _handleMouseMove(event) {
        if (this.isMobile) return;

        if (this.isPanning) {
            const camera = this.worldManager.getCurrentCameraState();
            if (!camera) return;
            const dx = event.clientX - this.lastPanX;
            const dy = event.clientY - this.lastPanY;
            camera.x -= dx / camera.zoom;
            camera.y -= dy / camera.zoom;
            this.lastPanX = event.clientX;
            this.lastPanY = event.clientY;
            this._clampCameraPan();
            return;
        }

        const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(event);
        const selectedWorldIdx = this.worldManager.getSelectedWorldIndex();

        if (this.isMouseDrawing && viewType === 'selected' && col !== null) {
            // Drawing logic
            const currentCellIndex = row * Config.GRID_COLS + col;
            if (currentCellIndex !== this.lastDrawnCellIndex) {
                this.lastDrawnCellIndex = currentCellIndex;
                const newCellsInBrush = new Set();
                findHexagonsInNeighborhood(col, row, brushController.getState().brushSize, newCellsInBrush);
                const cellsToToggle = Array.from(newCellsInBrush).filter(cellIndex => !this.strokeAffectedCells.has(cellIndex));
                if (cellsToToggle.length > 0) {
                    cellsToToggle.forEach(c => this.strokeAffectedCells.add(c));
                    EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { worldIndex: selectedWorldIdx, cellIndices: new Set(cellsToToggle) });
                }
            }
        }

        // Hover logic for desktop
        if (viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, { worldIndex: selectedWorldIdx, col, row });
        } else {
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
        }
    }

    _handleMouseUp(event) {
        if (this.isMobile) return;
        this.isPanning = false;

        if (this.isMouseDrawing) {
            this.isMouseDrawing = false;
            if (this.wasSimulationRunningBeforeStroke) {
                simulationController.setPause(false);
            }
            this.wasSimulationRunningBeforeStroke = false; // Reset flag
            this.strokeAffectedCells.clear();
            this.lastDrawnCellIndex = null;
        }
    }

    _handleMouseOut(event) {
        if (this.isMobile) return;
        this._handleMouseUp(event);
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: this.worldManager.getSelectedWorldIndex() });
    }

    _handleMouseWheel(event) {
        event.preventDefault();
        if (this.isMobile) return;

        const { viewType } = this._getCoordsFromPointerEvent(event);
        if (viewType !== 'selected') return;

        if (event.ctrlKey) {
            const scrollAmount = Math.sign(event.deltaY);
            const newSize = brushController.getState().brushSize - scrollAmount;
            brushController.setBrushSize(newSize);
            this._handleMouseMove(event); // Update hover
        } else {
            const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
            this._zoomAtPoint(event.clientX, event.clientY, zoomFactor);
        }
    }

    // --- TOUCH EVENT HANDLERS (MOBILE) ---
    _handleTouchStart(event) {
        event.preventDefault();
        if (!this.isMobile) return;

        const touches = event.touches;
        this.touchState.isDown = true;
        this.touchState.isDragging = false;
        // We only care about the first touch for drawing/panning
        const primaryTouch = touches[0];
        this.touchState.startPoint = { x: primaryTouch.clientX, y: primaryTouch.clientY };
        this.touchState.lastPoint = { ...this.touchState.startPoint };

        if (touches.length >= 2) {
            // Correctly handle pinch gesture only in pan mode
            if (this.interactionMode === 'pan') {
                this.touchState.gesture = 'pinch';
                this.isPanning = false; // Stop single-finger panning if a second finger is added
                this.touchState.lastDistance = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
            }
        } else {
            this.touchState.gesture = 'pending';

            if (this.interactionMode === 'pan') {
                this.isPanning = true;
            } else { // Draw mode
                this.isPanning = false;
                this.wasSimulationRunningBeforeStroke = false; // Reset flag
                if (interactionController.getState().pauseWhileDrawing && !simulationController.getState().isPaused) {
                    this.wasSimulationRunningBeforeStroke = true;
                    simulationController.setPause(true);
                }
                
                // CRITICAL FIX: Pass the correct touch object to get coordinates
                const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(primaryTouch);
                if (viewType === 'selected' && col !== null) {
                    this.strokeAffectedCells.clear();
                    this.lastDrawnCellIndex = row * Config.GRID_COLS + col;
                    findHexagonsInNeighborhood(col, row, brushController.getState().brushSize, this.strokeAffectedCells);
                    EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
                        worldIndex: worldIndexAtCursor,
                        cellIndices: this.strokeAffectedCells
                    });
                }
            }
        }
    }

    _handleTouchMove(event) {
        event.preventDefault();
        if (!this.isMobile || !this.touchState.isDown) return;

        const touches = event.touches;
        const camera = this.worldManager.getCurrentCameraState();
        const primaryTouch = touches[0];
        const newPoint = { x: primaryTouch.clientX, y: primaryTouch.clientY };

        // Determine if the user is dragging
        if (!this.touchState.isDragging) {
            const dist = Math.hypot(newPoint.x - this.touchState.startPoint.x, newPoint.y - this.touchState.startPoint.y);
            if (dist > this.touchState.TAP_THRESHOLD) {
                this.touchState.isDragging = true;
            }
        }
        
        // CRITICAL FIX: Get coordinates from the correct touch object for hover and drawing
        const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(primaryTouch);
        const selectedWorldIdx = this.worldManager.getSelectedWorldIndex();

        // FIX: Dispatch hover state, just like in the desktop mousemove handler. This fixes the missing shadow.
        if (viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, { worldIndex: selectedWorldIdx, col, row });
        } else {
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
        }

        // --- Gesture Handling ---
        if (touches.length >= 2 && this.interactionMode === 'pan') {
            this.touchState.gesture = 'pinch';
            const newDist = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
            const pinchCenter = { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };

            if (this.touchState.lastDistance > 0) {
                const zoomFactor = newDist / this.touchState.lastDistance;
                this._zoomAtPoint(pinchCenter.x, pinchCenter.y, zoomFactor);
            }
            this.touchState.lastDistance = newDist;
        } else if (this.touchState.isDragging) {
            const dx = newPoint.x - this.touchState.lastPoint.x;
            const dy = newPoint.y - this.touchState.lastPoint.y;

            if (this.interactionMode === 'pan') {
                if (camera) {
                    camera.x -= dx / camera.zoom;
                    camera.y -= dy / camera.zoom;
                    this._clampCameraPan();
                }
            } else if (this.interactionMode === 'draw') {
                if (viewType === 'selected' && col !== null) {
                    const currentCellIndex = row * Config.GRID_COLS + col;
                    if (currentCellIndex !== this.lastDrawnCellIndex) {
                        this.lastDrawnCellIndex = currentCellIndex;
                        const newCellsInBrush = new Set();
                        findHexagonsInNeighborhood(col, row, brushController.getState().brushSize, newCellsInBrush);

                        const cellsToToggle = Array.from(newCellsInBrush).filter(cellIndex => !this.strokeAffectedCells.has(cellIndex));

                        if (cellsToToggle.length > 0) {
                            cellsToToggle.forEach(c => this.strokeAffectedCells.add(c));
                            EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
                                worldIndex: selectedWorldIdx,
                                cellIndices: new Set(cellsToToggle)
                            });
                        }
                    }
                }
            }
        }
        this.touchState.lastPoint = newPoint;
    }


    _handleTouchEnd(event) {
        event.preventDefault();
        if (!this.isMobile) return;

        // Clear any lingering hover state
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: this.worldManager.getSelectedWorldIndex() });

        const endTouch = event.changedTouches[0];
        if (endTouch) {
            const { worldIndexAtCursor, viewType } = this._getCoordsFromPointerEvent(endTouch);

            // Handle tapping on a mini-map to select it
            if (this.touchState.isDown && !this.touchState.isDragging && viewType === 'mini' && worldIndexAtCursor !== null) {
                EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
            }
        }

        // Unpause the simulation if it was running before the stroke began
        if (this.wasSimulationRunningBeforeStroke) {
            simulationController.setPause(false);
        }

        // Reset all touch and drawing states for the next interaction
        this.wasSimulationRunningBeforeStroke = false;
        this.isPanning = false;
        this.lastDrawnCellIndex = null;
        this.strokeAffectedCells.clear();
        this.touchState.isDown = false;
        this.touchState.isDragging = false;
        this.touchState.gesture = 'none';
        this.touchState.lastDistance = 0;
    }

    _zoomAtPoint(pivotClientX, pivotClientY, zoomFactor) {
        const camera = this.worldManager.getCurrentCameraState();
        if (!camera) return;

        const { worldX, worldY } = this._getCoordsFromPointerEvent({ clientX: pivotClientX, clientY: pivotClientY });
        if (worldX === null) return;

        const oldZoom = camera.zoom;
        const newZoom = Math.max(1.0, Math.min(25.0, oldZoom * zoomFactor));

        if (newZoom !== oldZoom) {
            const ratio = oldZoom / newZoom;
            camera.x = worldX * (1 - ratio) + camera.x * ratio;
            camera.y = worldY * (1 - ratio) + camera.y * ratio;
            camera.zoom = newZoom;
            this._clampCameraPan();
        }
    }

    _createMouseEventFromTouch(touch, type) {
        return new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window, detail: 1,
            screenX: touch.screenX, screenY: touch.screenY,
            clientX: touch.clientX, clientY: touch.clientY,
            button: 0, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
        });
    }
}