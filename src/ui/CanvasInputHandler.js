import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { textureCoordsToGridCoords, findHexagonsInNeighborhood, gridToPixelCoords, calculateHexSizeForTexture } from '../utils/utils.js';

/**
 * Manages all user input for the main canvas, including clicking, drawing,
 * panning, and zooming with boundaries.
 */
export class CanvasInputHandler {
    constructor(canvas, camera, worldManager) {
        this.canvas = canvas;
        this.camera = camera;
        this.worldManager = worldManager;
        this.gl = canvas.getContext('webgl2');

        // State for input handling
        this.isMouseDrawing = false;
        this.justFinishedDrawing = false;
        this.wasSimulationRunningBeforeStroke = false;
        this.strokeAffectedCells = new Set();
        this.lastDrawnCellIndex = null;

        // State for panning
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // State for touch interaction
        this.touchStartX = null;
        this.touchStartY = null;
        this.hasTouchMoved = false;
        this.touchStartTime = null;
        
        // Pre-calculate the grid's world boundaries for panning limits
        this._calculateGridBounds();

        this._setupListeners();
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
            minY: topRight.y - hexSize, // Use topRight for min Y due to odd-r layout
            maxY: bottomRight.y + hexSize
        };
    }

    /**
     * Clamps the camera's pan coordinates to the pre-calculated grid boundaries.
     * This prevents the user from panning into empty space.
     * @private
     */
    _clampCameraPan() {
        const { RENDER_TEXTURE_SIZE } = Config;

        const viewWidth = RENDER_TEXTURE_SIZE / this.camera.zoom;
        const viewHeight = RENDER_TEXTURE_SIZE / this.camera.zoom;
        
        const minX = this.gridWorldBounds.minX + viewWidth / 2;
        const maxX = this.gridWorldBounds.maxX - viewWidth / 2;
        const minY = this.gridWorldBounds.minY + viewHeight / 2;
        const maxY = this.gridWorldBounds.maxY - viewHeight / 2;

        this.camera.x = (minX > maxX) ? (minX + maxX) / 2 : Math.max(minX, Math.min(maxX, this.camera.x));
        this.camera.y = (minY > maxY) ? (minY + maxY) / 2 : Math.max(minY, Math.min(maxY, this.camera.y));
    }

    _setupListeners() {
        this.canvas.addEventListener('click', this._handleCanvasClick.bind(this));
        this.canvas.addEventListener('mousedown', this._handleCanvasMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this._handleCanvasMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this._handleCanvasMouseUp.bind(this));
        this.canvas.addEventListener('mouseout', this._handleCanvasMouseOut.bind(this));
        this.canvas.addEventListener('wheel', this._handleCanvasMouseWheel.bind(this), { passive: false });
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());

        this.canvas.addEventListener('touchstart', this._handleCanvasTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this._handleCanvasTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this._handleCanvasTouchEnd.bind(this), { passive: false });
        this.canvas.addEventListener('touchcancel', this._handleCanvasTouchEnd.bind(this), { passive: false });
    }

    _getCoordsFromMouseEvent(event) {
        if (!this.gl || !this.gl.canvas || !this.worldManager) return { worldIndexAtCursor: null, col: null, row: null, viewType: null };
        const rect = this.gl.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const canvasWidth = this.gl.canvas.width;
        const canvasHeight = this.gl.canvas.height;
        const isLandscape = canvasWidth >= canvasHeight;
        let selectedViewX, selectedViewY, selectedViewWidth, selectedViewHeight;
        let miniMapAreaX, miniMapAreaY, miniMapAreaWidth, miniMapAreaHeight;
        const padding = Math.min(canvasWidth, canvasHeight) * 0.02;

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

        const currentSelectedWorldIdx = this.worldManager.getSelectedWorldIndex();
        if (mouseX >= selectedViewX && mouseX < selectedViewX + selectedViewWidth &&
            mouseY >= selectedViewY && mouseY < selectedViewY + selectedViewHeight) {
            const texCoordX = (mouseX - selectedViewX) / selectedViewWidth;
            const texCoordY = (mouseY - selectedViewY) / selectedViewHeight;
            const { col, row, worldX, worldY } = textureCoordsToGridCoords(texCoordX, texCoordY, this.camera);
            return { worldIndexAtCursor: currentSelectedWorldIdx, col, row, viewType: 'selected', worldX, worldY };
        }

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
    
    _handleCanvasClick(event) {
        if (this.justFinishedDrawing) {
            this.justFinishedDrawing = false;
            return;
        }

        const { worldIndexAtCursor, col, row, viewType } = this._getCoordsFromMouseEvent(event);
        if (worldIndexAtCursor === null) return;

        const previousSelectedWorld = this.worldManager.getSelectedWorldIndex();
        if (worldIndexAtCursor !== previousSelectedWorld) {
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
        }

        if (viewType === 'selected' && col !== null && row !== null) {
            EventBus.dispatch(EVENTS.COMMAND_APPLY_BRUSH, { worldIndex: worldIndexAtCursor, col, row });
        }
    }

    _handleCanvasMouseDown(event) {
        event.preventDefault();
        
        if (event.button === 1 || (event.button === 0 && event.altKey)) {
            const { viewType } = this._getCoordsFromMouseEvent(event);
            if (viewType === 'selected') {
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
            if (this.wasSimulationRunningBeforeStroke) {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
            }

            findHexagonsInNeighborhood(col, row, this.worldManager.getCurrentBrushSize(), this.strokeAffectedCells);
            EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTIVE_BRUSH, {
                worldIndex: worldIndexAtCursor,
                cellIndices: this.strokeAffectedCells
            });
        }
    }

    _handleCanvasMouseMove(event) {
        if (this.isPanning) {
            const dx = event.clientX - this.lastPanX;
            const dy = event.clientY - this.lastPanY;

            this.camera.x -= (dx / this.camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientWidth);
            this.camera.y -= (dy / this.camera.zoom) * (Config.RENDER_TEXTURE_SIZE / this.canvas.clientHeight);
            
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
            
            if (this.wasSimulationRunningBeforeStroke) {
                EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE);
            }
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
     * UPDATED: Handles mouse wheel events for zooming (with Ctrl) or changing brush size.
     * Zooming is now centered on the cursor's position.
     * @param {WheelEvent} event
     * @private
     */
    _handleCanvasMouseWheel(event) {
        event.preventDefault();
        
        const { viewType, worldX, worldY } = this._getCoordsFromMouseEvent(event);
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
            if (worldX === null) return; // Cannot zoom without a valid world coordinate under cursor

            const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
            const newZoom = Math.max(1.0, Math.min(20.0, this.camera.zoom * zoomFactor));

            if (newZoom !== this.camera.zoom) {
                const oldZoom = this.camera.zoom;
                
                const pivotX = worldX;
                const pivotY = worldY;

                const ratio = oldZoom / newZoom;
                this.camera.x = pivotX * (1 - ratio) + this.camera.x * ratio;
                this.camera.y = pivotY * (1 - ratio) + this.camera.y * ratio;

                this.camera.zoom = newZoom;
                
                this._clampCameraPan();
            }
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

    _handleCanvasTouchStart(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.hasTouchMoved = false;
            this.touchStartTime = Date.now();
            this.touchStartX = touch.clientX;
            this.touchStartY = touch.clientY;
            
            setTimeout(() => {
                if (!this.hasTouchMoved) {
                    const syntheticEvent = this._createMouseEventFromTouch(touch, 'mousedown');
                    this._handleCanvasMouseDown(syntheticEvent);
                }
            }, 150);
        }
    }

    _handleCanvasTouchMove(event) {
        event.preventDefault();
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            const deltaX = Math.abs(touch.clientX - this.touchStartX);
            const deltaY = Math.abs(touch.clientY - this.touchStartY);
            
            if (deltaX > 5 || deltaY > 5) {
                this.hasTouchMoved = true;
                const syntheticEvent = this._createMouseEventFromTouch(touch, 'mousemove');
                this._handleCanvasMouseMove(syntheticEvent);
            }
        }
    }

    _handleCanvasTouchEnd(event) {
        event.preventDefault();
        const touch = event.changedTouches[0];
        if (!this.hasTouchMoved) {
             const syntheticClick = this._createMouseEventFromTouch(touch, 'click');
             this._handleCanvasClick(syntheticClick);
        }
        const syntheticEvent = this._createMouseEventFromTouch(touch, 'mouseup');
        this._handleCanvasMouseUp(syntheticEvent);
        this.touchStartX = null;
        this.touchStartY = null;
    }
}