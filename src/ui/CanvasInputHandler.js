import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { getLayoutCache } from '../rendering/renderer.js'; // Import getLayoutCache from renderer
import { textureCoordsToGridCoords, findHexagonsInNeighborhood, gridToPixelCoords, calculateHexSizeForTexture } from '../utils/utils.js';

export class CanvasInputHandler {
    constructor(canvas, worldManager) {
        this.canvas = canvas;
        this.worldManager = worldManager;
        this.gl = canvas.getContext('webgl2');

        // --- Mouse Input State ---
        this.isMouseDrawing = false;
        this.justFinishedDrawing = false;
        this.wasSimulationRunningBeforeStroke = false;
        this.strokeAffectedCells = new Set();
        this.lastDrawnCellIndex = null;
        
        // --- Panning State (Mouse & Touch) ---
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // --- Gesture Recognition State ---
        this.gestureState = 'idle';
        this.initialTouch = null;
        this.lastTouchCenter = null;
        this.lastTouchDistance = 0;
        
        this.TAP_THRESHOLD = 10;

        // --- Pattern Placing State ---
        this.isPlacingPattern = false;
        this.patternToPlace = null;

        // --- UI Layout Cache ---
        this.layoutCache = getLayoutCache(); // Replaced _calculateAndCacheLayout()

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
        this.patternToPlace = patternData.cells;
        this.canvas.classList.add('placing-pattern-cursor');
        // NEW: Add listener for escape key to cancel
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
        // Mouse Listeners
        this.canvas.addEventListener('click', this._handleCanvasClick.bind(this));
        this.canvas.addEventListener('mousedown', this._handleCanvasMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this._handleCanvasMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this._handleCanvasMouseUp.bind(this));
        this.canvas.addEventListener('mouseout', this._handleCanvasMouseOut.bind(this));
        this.canvas.addEventListener('wheel', this._handleCanvasMouseWheel.bind(this), { passive: false });
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());

        // Touch Listeners
        this.canvas.addEventListener('touchstart', this._handleTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this._handleTouchEnd.bind(this), { passive: false });
        this.canvas.addEventListener('touchcancel', this._handleTouchEnd.bind(this), { passive: false });
        
        // Listen for placing mode command
        EventBus.subscribe(EVENTS.COMMAND_ENTER_PLACING_MODE, (data) => this.enterPlacingMode(data));
    }

    _getCoordsFromPointerEvent(event) {
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
                const texCoordX = (pointerX - miniX) / miniMapW;
                const texCoordY = (pointerY - miniY) / miniMapH;
                const defaultCamera = { x: Config.RENDER_TEXTURE_SIZE / 2, y: Config.RENDER_TEXTURE_SIZE / 2, zoom: 1.0 };
                const { col, row } = textureCoordsToGridCoords(texCoordX, texCoordY, defaultCamera);
                return { worldIndexAtCursor: i, col, row, viewType: 'mini', worldX: null, worldY: null };
            }
        }
        return { worldIndexAtCursor: null, col: null, row: null, viewType: null, worldX: null, worldY: null };
    }

    _zoomAtPoint(zoomFactor, pivotClientX, pivotClientY) {
        const camera = this.worldManager.getCurrentCameraState();
        if (!camera) return;

        const { worldX, worldY } = this._getCoordsFromPointerEvent({ clientX: pivotClientX, clientY: pivotClientY });
        if (worldX === null) return;

        const oldZoom = camera.zoom;
        const newZoom = Math.max(1.0, Math.min(20.0, oldZoom * zoomFactor));

        if (newZoom !== oldZoom) {
            if (newZoom === 1.0) {
                camera.x = Config.RENDER_TEXTURE_SIZE / 2;
                camera.y = Config.RENDER_TEXTURE_SIZE / 2;
            } else {
                const ratio = oldZoom / newZoom;
                camera.x = worldX * (1 - ratio) + camera.x * ratio;
                camera.y = worldY * (1 - ratio) + camera.y * ratio;
            }
            camera.zoom = newZoom;
            this._clampCameraPan();
        }
    }
    
    _performClickAction(event) {
        if (this.isPlacingPattern) {
            const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(event);
            if (viewType === 'selected' && col !== null && row !== null) {
                const finalCellIndices = new Set();
                this.patternToPlace.forEach(([px, py]) => {
                    const targetCol = col + px;
                    const targetRow = row + py;
                    if (targetCol >= 0 && targetCol < Config.GRID_COLS && targetRow >= 0 && targetRow < Config.GRID_ROWS) {
                        finalCellIndices.add(targetRow * Config.GRID_COLS + targetCol);
                    }
                });
                EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
                    worldIndex: worldIndexAtCursor,
                    cellIndices: finalCellIndices
                });
            }
            
            if (!event.shiftKey) {
                this.exitPlacingMode();
            }

            const stopClick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                document.removeEventListener('click', stopClick, true);
            };
            document.addEventListener('click', stopClick, true);

            return;
        }

        const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(event);
        if (worldIndexAtCursor === null) return;
    
        if (worldIndexAtCursor !== this.worldManager.getSelectedWorldIndex()) {
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
        }
        else if (viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_APPLY_BRUSH, { worldIndex: worldIndexAtCursor, col, row });
        }
    }

    _handleCanvasClick(event) {
        if (this.justFinishedDrawing || this.gestureState === 'drawing') return;
        this._performClickAction(event);
    }
    
    _handleCanvasMouseDown(event) {
        event.preventDefault();
        if (this.isPlacingPattern && event.button === 2) { 
            this.exitPlacingMode();
            return;
        }

        if (this.isPlacingPattern && event.button !== 0) {
            this.exitPlacingMode();
            return;
        }

        if (event.button === 1 || (event.button === 0 && event.altKey)) {
            if (this._getCoordsFromPointerEvent(event).viewType === 'selected') {
                this.isPanning = true;
                this.lastPanX = event.clientX;
                this.lastPanY = event.clientY;
                this.canvas.style.cursor = 'grabbing';
            }
            return;
        }
        if (event.button === 0) {
             if (this.isPlacingPattern) {
                this._performClickAction(event);
                return;
            }
            const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(event);
            if (viewType !== 'selected' || col === null) return;
            this.isMouseDrawing = true;
            this.strokeAffectedCells.clear();
            this.lastDrawnCellIndex = row * Config.GRID_COLS + col;
            this.wasSimulationRunningBeforeStroke = !this.worldManager.isSimulationPaused();
            if (this.wasSimulationRunningBeforeStroke) EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
            findHexagonsInNeighborhood(col, row, this.worldManager.getCurrentBrushSize(), this.strokeAffectedCells);
            EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, { worldIndex: worldIndexAtCursor, cellIndices: this.strokeAffectedCells });
        }
    }

    _handleCanvasMouseMove(event) {
        if (this.isPanning) {
            const camera = this.worldManager.getCurrentCameraState();
            if (!camera) return;
            const dx = event.clientX - this.lastPanX;
            const dy = event.clientY - this.lastPanY;
            camera.x -= (dx / camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientWidth);
            camera.y -= (dy / camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientHeight);
            this.lastPanX = event.clientX;
            this.lastPanY = event.clientY;
            this._clampCameraPan();
            return;
        }
        
        const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromPointerEvent(event);
        const selectedWorldIdx = this.worldManager.getSelectedWorldIndex();
        
        if (this.isPlacingPattern) {
            if (viewType === 'selected' && col !== null && row !== null) {
                const hoverIndices = new Set();
                this.patternToPlace.forEach(([px, py]) => {
                    const targetCol = col + px;
                    const targetRow = row + py;
                    if (targetCol >= 0 && targetCol < Config.GRID_COLS && targetRow >= 0 && targetRow < Config.GRID_ROWS) {
                        hoverIndices.add(targetRow * Config.GRID_COLS + targetCol);
                    }
                });
                EventBus.dispatch(EVENTS.COMMAND_UPDATE_GHOST_PREVIEW, { indices: hoverIndices });
            } else {
                EventBus.dispatch(EVENTS.COMMAND_CLEAR_GHOST_PREVIEW);
            }
            return;
        }

        if (this.isMouseDrawing && worldIndexAtCursor === selectedWorldIdx && viewType === 'selected' && col !== null) {
            const currentCellIndex = row * Config.GRID_COLS + col;
            if (currentCellIndex !== this.lastDrawnCellIndex) {
                this.lastDrawnCellIndex = currentCellIndex;
                const newCellsInBrush = new Set();
                findHexagonsInNeighborhood(col, row, this.worldManager.getCurrentBrushSize(), newCellsInBrush);
                
                const cellsToToggle = Array.from(newCellsInBrush).filter(cellIndex => !this.strokeAffectedCells.has(cellIndex));
                cellsToToggle.forEach(cellIndex => this.strokeAffectedCells.add(cellIndex));

                if (cellsToToggle.length > 0) {
                    EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
                        worldIndex: selectedWorldIdx,
                        cellIndices: cellsToToggle
                    });
                }
            }
        }

        if (worldIndexAtCursor === selectedWorldIdx && viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SET_HOVER_STATE, { worldIndex: selectedWorldIdx, col, row });
        } else {
            EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
        }
    }

    _handleCanvasMouseUp(event) {
        if (this.isPanning) {
            this.isPanning = false;
            this.canvas.style.cursor = 'default';
        }
        if (this.isMouseDrawing) {
            this.isMouseDrawing = false;
            this.justFinishedDrawing = true;
            setTimeout(() => { this.justFinishedDrawing = false; }, 50);
            if (this.wasSimulationRunningBeforeStroke) EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
            this.strokeAffectedCells.clear();
            this.lastDrawnCellIndex = null;
        }
    }

    _handleCanvasMouseOut(event) {
        this._handleCanvasMouseUp(event);
        if (this.isPlacingPattern) {
            this.exitPlacingMode();
        }
        const selectedWorldIdx = this.worldManager.getSelectedWorldIndex();
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
    }

    _handleCanvasMouseWheel(event) {
        event.preventDefault();
        
        if (this.isPlacingPattern) return;

        const { viewType } = this._getCoordsFromPointerEvent(event);
        if (viewType !== 'selected') return;
        if (event.ctrlKey) {
            const scrollAmount = Math.sign(event.deltaY);
            const newSize = this.worldManager.getCurrentBrushSize() - scrollAmount;
            EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, newSize);
            this._handleCanvasMouseMove(event);
        } else {
            const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
            this._zoomAtPoint(zoomFactor, event.clientX, event.clientY);
        }
    }

    _handleTouchStart(event) {
        event.preventDefault();
        const touches = event.touches;

        if (touches.length === 1 && this.gestureState === 'idle') {
            this.gestureState = 'pending';
            const touch = touches[0];
            this.initialTouch = {
                clientX: touch.clientX,
                clientY: touch.clientY,
                identifier: touch.identifier
            };
        } else if (touches.length >= 2) {
            if (this.gestureState === 'drawing') {
                 this._handleCanvasMouseUp(this._createMouseEventFromTouch(this.initialTouch, 'mouseup'));
            }
            this.gestureState = 'panning_zooming';
            this.initialTouch = null;

            const t0 = touches[0];
            const t1 = touches[1];
            this.lastTouchDistance = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
            this.lastTouchCenter = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
        }
    }

    _handleTouchMove(event) {
        event.preventDefault();

        if (this.gestureState === 'panning_zooming') {
            if (event.touches.length < 2) return; // Need two fingers
            const t0 = event.touches[0];
            const t1 = event.touches[1];
            const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
            const newCenter = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
            const camera = this.worldManager.getCurrentCameraState();
            
            if (camera && this.lastTouchCenter) {
                const dx = newCenter.x - this.lastTouchCenter.x;
                const dy = newCenter.y - this.lastTouchCenter.y;
                camera.x -= (dx / camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientWidth);
                camera.y -= (dy / camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientHeight);
            }
            
            if (this.lastTouchDistance > 0) {
                const zoomFactor = newDist / this.lastTouchDistance;
                this._zoomAtPoint(zoomFactor, newCenter.x, newCenter.y);
            }

            this.lastTouchDistance = newDist;
            this.lastTouchCenter = newCenter;
            this._clampCameraPan();

        } else if (this.gestureState === 'pending') {
            if (!this.initialTouch) return;
            const touch = this._findTouchById(event.touches, this.initialTouch.identifier);
            if (!touch) return;
            
            const distance = Math.hypot(touch.clientX - this.initialTouch.clientX, touch.clientY - this.initialTouch.clientY);

            if (distance > this.TAP_THRESHOLD) {
                this.gestureState = 'drawing';
                this._handleCanvasMouseDown(this._createMouseEventFromTouch(this.initialTouch, 'mousedown'));
                this._handleCanvasMouseMove(this._createMouseEventFromTouch(touch, 'mousemove'));
            }
        } else if (this.gestureState === 'drawing') {
            if (!this.initialTouch) return; 
            const touch = this._findTouchById(event.touches, this.initialTouch.identifier);
            if (!touch) {
                this._handleCanvasMouseUp(this._createMouseEventFromTouch(this.initialTouch, 'mouseup'));
                this.gestureState = 'idle';
                this.initialTouch = null;
                return;
            }
            this._handleCanvasMouseMove(this._createMouseEventFromTouch(touch, 'mousemove'));
        }
    }

    _handleTouchEnd(event) {
        event.preventDefault();
        
        if (this.gestureState === 'pending') {
            // Finger lifted before moving enough for a swipe. This is a TAP.
            const changedTouch = this._findTouchById(event.changedTouches, this.initialTouch.identifier);
            if(changedTouch) {
                this._performClickAction(this._createMouseEventFromTouch(changedTouch, 'click'));
            }
        } else if (this.gestureState === 'drawing') {
            // Finger lifted after a swipe-draw. End the drawing stroke.
            const changedTouch = this._findTouchById(event.changedTouches, this.initialTouch.identifier);
            if (changedTouch) {
                 this._handleCanvasMouseUp(this._createMouseEventFromTouch(changedTouch, 'mouseup'));
            }
        }
        
        if (event.touches.length === 0) {
            // All fingers are lifted, reset to idle state.
            this.gestureState = 'idle';
            this.initialTouch = null;
            this.lastTouchCenter = null;
            this.lastTouchDistance = 0;
        }
    }

    _findTouchById(touchList, identifier) {
        if (identifier === null) return null;
        for (let i = 0; i < touchList.length; i++) {
            if (touchList[i].identifier === identifier) {
                return touchList[i];
            }
        }
        return null;
    }

    _createMouseEventFromTouch(touch, type) {
        return new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window, detail: 1,
            screenX: touch.screenX, screenY: touch.screenY,
            clientX: touch.clientX, clientY: touch.clientY,
            button: 0, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
        });
    }
    
    handleResize() {
        this.layoutCache = getLayoutCache();
    }
}