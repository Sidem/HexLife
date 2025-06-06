import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { textureCoordsToGridCoords, findHexagonsInNeighborhood, gridToPixelCoords, calculateHexSizeForTexture } from '../utils/utils.js';

/**
 * Manages all user input for the main canvas, including clicking, drawing,
 * panning, and zooming with boundaries.
 */
export class CanvasInputHandler {
    constructor(canvas, worldManager) {
        this.canvas = canvas;
        this.worldManager = worldManager;
        this.gl = canvas.getContext('webgl2');

        // --- State for input handling ---
        this.isMouseDrawing = false;
        this.justFinishedDrawing = false;
        this.wasSimulationRunningBeforeStroke = false;
        this.strokeAffectedCells = new Set();
        this.lastDrawnCellIndex = null;
        
        // State for mouse panning
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // --- State for multi-touch gestures ---
        this.isMultiTouching = false; // True when two fingers are down
        this.multiTouchOccurred = false; // Flag to prevent click after multi-touch
        this.lastTouchDistance = 0;   // For pinch-to-zoom
        this.lastTouchCenter = null;  // For two-finger pan

        // State for single-touch interaction
        this.touchIdentifier = null; // To track a single touch
        this.touchTimeout = null;    // To distinguish tap from press-and-draw
        this.hasTouchMoved = false;

        // --- NEW: Cache for UI layout dimensions ---
        this.layoutCache = {};

        this._calculateGridBounds();
        this._calculateAndCacheLayout(); // Initial layout calculation
        this._setupListeners();
    }

    /**
     * NEW: Public method to be called on window resize.
     */
    handleResize() {
        this._calculateAndCacheLayout();
    }

    /**
     * NEW: Calculates and caches the dimensions of the main view and minimap areas.
     * This logic is moved from _getCoordsFromMouseEvent to avoid recalculation.
     * @private
     */
    _calculateAndCacheLayout() {
        if (!this.gl || !this.gl.canvas) return;

        const canvasWidth = this.gl.canvas.width;
        const canvasHeight = this.gl.canvas.height;
        const isLandscape = canvasWidth >= canvasHeight;
        const padding = Math.min(canvasWidth, canvasHeight) * 0.02;

        let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
        let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;

        if (isLandscape) {
            selectedViewWidth = canvasWidth * 0.6 - padding * 1.5;
            selectedViewHeight = canvasHeight - padding * 2;
            selectedViewX = padding;
            selectedViewY = padding;
            miniMapAreaWidth = canvasWidth * 0.4 - padding * 1.5;
            miniMapAreaHeight = selectedViewHeight;
            miniMapAreaX = selectedViewX + selectedViewWidth + padding;
            miniMapAreaY = padding;
        } else {
            selectedViewHeight = canvasHeight * 0.6 - padding * 1.5;
            selectedViewWidth = canvasWidth - padding * 2;
            selectedViewX = padding;
            selectedViewY = padding;
            miniMapAreaHeight = canvasHeight * 0.4 - padding * 1.5;
            miniMapAreaWidth = selectedViewWidth;
            miniMapAreaX = padding;
            miniMapAreaY = selectedViewY + selectedViewHeight + padding;
        }

        this.layoutCache.selectedView = { x: selectedViewX, y: selectedViewY, width: selectedViewWidth, height: selectedViewHeight };

        const miniMapGridRatio = Config.WORLD_LAYOUT_COLS / Config.WORLD_LAYOUT_ROWS;
        const miniMapAreaRatio = miniMapAreaWidth / miniMapAreaHeight;
        let gridContainerWidth, gridContainerHeight;
        const miniMapContainerPaddingFactor = 0.95;

        if (miniMapAreaRatio > miniMapGridRatio) {
            gridContainerHeight = miniMapAreaHeight * miniMapContainerPaddingFactor;
            gridContainerWidth = gridContainerHeight * miniMapGridRatio;
        } else {
            gridContainerWidth = miniMapAreaWidth * miniMapContainerPaddingFactor;
            gridContainerHeight = gridContainerWidth / miniMapGridRatio;
        }
        const gridContainerX = miniMapAreaX + (miniMapAreaWidth - gridContainerWidth) / 2;
        const gridContainerY = miniMapAreaY + (miniMapAreaHeight - gridContainerHeight) / 2;
        const miniMapSpacing = Math.min(gridContainerWidth, gridContainerHeight) * 0.01;
        const miniMapW = (gridContainerWidth - (Config.WORLD_LAYOUT_COLS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_COLS;
        const miniMapH = (gridContainerHeight - (Config.WORLD_LAYOUT_ROWS - 1) * miniMapSpacing) / Config.WORLD_LAYOUT_ROWS;

        this.layoutCache.miniMap = {
            gridContainerX,
            gridContainerY,
            miniMapW,
            miniMapH,
            miniMapSpacing,
        };
    }

    /**
     * Calculates the world-space bounding box of the entire hex grid.
     * This is used to clamp the camera pan.
     * @private
     */
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

    /**
     * Clamps the camera's pan coordinates to the pre-calculated grid boundaries.
     * This prevents the user from panning into empty space.
     * @private
     */
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
    }

    /**
     * REFACTORED: This function now uses the cached layout dimensions.
     */
    _getCoordsFromMouseEvent(event) {
        const camera = this.worldManager.getCurrentCameraState();
        if (!this.gl || !this.gl.canvas || !this.worldManager || !camera || !this.layoutCache.selectedView) {
            return { worldIndexAtCursor: null, col: null, row: null, viewType: null, worldX: null, worldY: null };
        }
        
        const rect = this.gl.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const { x: selectedViewX, y: selectedViewY, width: selectedViewWidth, height: selectedViewHeight } = this.layoutCache.selectedView;
        
        const currentSelectedWorldIdx = this.worldManager.getSelectedWorldIndex();
        if (mouseX >= selectedViewX && mouseX < selectedViewX + selectedViewWidth &&
            mouseY >= selectedViewY && mouseY < selectedViewY + selectedViewHeight) {
            const texCoordX = (mouseX - selectedViewX) / selectedViewWidth;
            const texCoordY = (mouseY - selectedViewY) / selectedViewHeight;
            const { col, row, worldX, worldY } = textureCoordsToGridCoords(texCoordX, texCoordY, camera);
            return { worldIndexAtCursor: currentSelectedWorldIdx, col, row, viewType: 'selected', worldX, worldY };
        }

        const { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing } = this.layoutCache.miniMap;
        
        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const r_map = Math.floor(i / Config.WORLD_LAYOUT_COLS);
            const c_map = i % Config.WORLD_LAYOUT_COLS;
            const miniX = gridContainerX + c_map * (miniMapW + miniMapSpacing);
            const miniY = gridContainerY + r_map * (miniMapH + miniMapSpacing);
            if (mouseX >= miniX && mouseX < miniX + miniMapW &&
                mouseY >= miniY && mouseY < miniY + miniMapH) {
                const texCoordX = (mouseX - miniX) / miniMapW;
                const texCoordY = (mouseY - miniY) / miniMapH;
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

        const { worldX, worldY } = this._getCoordsFromMouseEvent({ clientX: pivotClientX, clientY: pivotClientY });
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
        const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromMouseEvent(event);
        if (worldIndexAtCursor === null) return;
    
        if (worldIndexAtCursor !== this.worldManager.getSelectedWorldIndex()) {
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
        }
        else if (viewType === 'selected' && col !== null) {
            EventBus.dispatch(EVENTS.COMMAND_APPLY_BRUSH, { worldIndex: worldIndexAtCursor, col, row });
        }
    }
    
    _handleCanvasClick(event) {
        if (this.justFinishedDrawing) return;
        this._performClickAction(event);
    }

    _handleCanvasMouseDown(event) {
        event.preventDefault();
        if (event.button === 1 || (event.button === 0 && event.altKey)) {
            if (this._getCoordsFromMouseEvent(event).viewType === 'selected') {
                this.isPanning = true;
                this.lastPanX = event.clientX;
                this.lastPanY = event.clientY;
                this.canvas.style.cursor = 'grabbing';
            }
            return;
        }
        if (event.button === 0) {
            const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromMouseEvent(event);
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

        const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromMouseEvent(event);
        const selectedWorldIdx = this.worldManager.getSelectedWorldIndex();
        
        if (this.isMouseDrawing && worldIndexAtCursor === selectedWorldIdx && viewType === 'selected' && col !== null) {
            const currentCellIndex = row * Config.GRID_COLS + col;
            if (currentCellIndex !== this.lastDrawnCellIndex) {
                this.lastDrawnCellIndex = currentCellIndex;
                const newCellsInBrush = new Set();
                findHexagonsInNeighborhood(col, row, this.worldManager.getCurrentBrushSize(), newCellsInBrush);
                
                const cellsToToggle = [];
                newCellsInBrush.forEach(cellIndex => {
                    if (!this.strokeAffectedCells.has(cellIndex)) {
                        cellsToToggle.push(cellIndex);
                        this.strokeAffectedCells.add(cellIndex);
                    }
                });

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
        const selectedWorldIdx = this.worldManager.getSelectedWorldIndex();
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_HOVER_STATE, { worldIndex: selectedWorldIdx });
    }

    /**
     * UPDATED: Handles mouse wheel events for zooming or changing brush size (with Ctrl).
     * Zooming is centered on the cursor's position.
     * @param {WheelEvent} event
     * @private
     */
    _handleCanvasMouseWheel(event) {
        event.preventDefault();
        const { viewType } = this._getCoordsFromMouseEvent(event);
        if (viewType !== 'selected') return;
        if (event.ctrlKey) {
            let currentBrush = this.worldManager.getCurrentBrushSize();
            const scrollAmount = Math.sign(event.deltaY);
            let newSize = currentBrush - scrollAmount;
            newSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, newSize));
            if (newSize !== currentBrush) {
                EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, newSize);
                this._handleCanvasMouseMove(event);
            }
        } else {
            const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
            this._zoomAtPoint(zoomFactor, event.clientX, event.clientY);
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

    _handleTouchStart(event) {
        event.preventDefault();
        clearTimeout(this.touchTimeout);
    
        if (event.touches.length >= 2) {
            this.isMultiTouching = true;
            this.multiTouchOccurred = true; 
            this.isMouseDrawing = false; 
            const t0 = event.touches[0];
            const t1 = event.touches[1];
            this.lastTouchDistance = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
            this.lastTouchCenter = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
        } else if (event.touches.length === 1) {
            if (!this.isMultiTouching) {
                this.isMultiTouching = false;
                const touch = event.touches[0];
                this.touchIdentifier = touch.identifier;
                this.hasTouchMoved = false;
                this.touchTimeout = setTimeout(() => {
                    if (!this.hasTouchMoved) {
                        this._handleCanvasMouseDown(this._createMouseEventFromTouch(touch, 'mousedown'));
                    }
                }, 150);
            }
        }
    }

    _handleTouchMove(event) {
        event.preventDefault();

        if (event.touches.length === 2 && this.isMultiTouching) {
            const t0 = event.touches[0];
            const t1 = event.touches[1];
            const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
            const newCenter = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
            
            // Handle Pan
            const camera = this.worldManager.getCurrentCameraState();
            if (camera) {
                const dx = newCenter.x - this.lastTouchCenter.x;
                const dy = newCenter.y - this.lastTouchCenter.y;
                if (dx !== 0 || dy !== 0) {
                     camera.x -= (dx / camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientWidth);
                     camera.y -= (dy / camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientHeight);
                }
            }
            
            // Handle Zoom
            const zoomFactor = newDist / this.lastTouchDistance;
            if (zoomFactor !== 1.0) {
                 this._zoomAtPoint(zoomFactor, newCenter.x, newCenter.y);
            }

            this.lastTouchDistance = newDist;
            this.lastTouchCenter = newCenter;
            this._clampCameraPan();

        } else if (event.touches.length === 1 && !this.isMultiTouching) {
            const touch = this._findTouch(event.touches);
            if (!touch) return;
            this.hasTouchMoved = true;
            this._handleCanvasMouseMove(this._createMouseEventFromTouch(touch, 'mousemove'));
        }
    }


    _handleTouchEnd(event) {
        event.preventDefault();
        clearTimeout(this.touchTimeout);
    
        if (this.isMultiTouching && event.touches.length < 2) {
            this.isMultiTouching = false;
            this.lastTouchDistance = 0;
            this.lastTouchCenter = null;
        }
    
        const touch = this._findTouch(event.changedTouches);
        if (touch) {
            if (!this.isMouseDrawing && !this.multiTouchOccurred) {
                this._performClickAction(this._createMouseEventFromTouch(touch, 'click'));
            }
            
            this._handleCanvasMouseUp(this._createMouseEventFromTouch(touch, 'mouseup'));
            this.touchIdentifier = null;
        }
    
        if (event.touches.length === 0) {
            this.multiTouchOccurred = false;
        }
    }

    _findTouch(touchList) {
        for (let i = 0; i < touchList.length; i++) {
            if (touchList[i].identifier === this.touchIdentifier) {
                return touchList[i];
            }
        }
        return touchList.length > 0 ? touchList[0] : null; // Fallback
    }
}