import * as Config from '../core/config.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { getLayoutCache } from '../rendering/renderer.js';
import { textureCoordsToGridCoords, findHexagonsInNeighborhood, gridToPixelCoords, calculateHexSizeForTexture } from '../utils/utils.js';
import { brushController } from './controllers/BrushController.js';
import { interactionController } from './controllers/InteractionController.js';
import { PanStrategy } from './inputStrategies/PanStrategy.js';
import { DrawStrategy } from './inputStrategies/DrawStrategy.js';
import { PlacePatternStrategy } from './inputStrategies/PlacePatternStrategy.js';

/**
 * @class InputManager
 * @description Manages all user input on the canvas by delegating to specific strategy classes.
 */
export class InputManager {
    constructor(canvas, worldManager, isMobile = false) {
        this.canvas = canvas;
        this.worldManager = worldManager;
        this.gl = canvas.getContext('webgl2');
        this.isMobile = isMobile;
        this.layoutCache = getLayoutCache(); 
        this.strategies = {
            pan: new PanStrategy(this),
            draw: new DrawStrategy(this),
            place: new PlacePatternStrategy(this),
        };

        this.currentStrategyName = 'pan'; 
        this.previousStrategyName = 'pan';
        this.currentStrategy = this.strategies.pan;

        this._calculateGridBounds();
        this._setupListeners();
    }

    _setupListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.currentStrategy.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.currentStrategy.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.currentStrategy.handleMouseUp(e));
        this.canvas.addEventListener('mouseout', (e) => this.currentStrategy.handleMouseOut(e));
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (this.isMobile) return; 
            const { viewType } = this.getCoordsFromPointerEvent(e);
            if (viewType !== 'selected') return;
            if (e.ctrlKey || e.shiftKey) {
                const scrollAmount = Math.sign(e.deltaY);
                const newSize = brushController.getState().brushSize - scrollAmount;
                brushController.setBrushSize(newSize);
                this.currentStrategy.handleMouseMove(e);
            } else {
                const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
                this.zoomAtPoint(e.clientX, e.clientY, zoomFactor);
            }
        }, { passive: false });
        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.target.closest('.mobile-fab-container')) return; 
            e.preventDefault();
            this.currentStrategy.handleTouchStart(e);
        }, { passive: false });
        this.canvas.addEventListener('touchmove', (e) => {
            if (e.target.closest('.mobile-fab-container')) return;
            e.preventDefault();
            this.currentStrategy.handleTouchMove(e);
        }, { passive: false });
        this.canvas.addEventListener('touchend', (e) => {
            if (e.target.closest('.mobile-fab-container')) return;
            e.preventDefault();
            this.currentStrategy.handleTouchEnd(e);
        }, { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => {
            if (e.target.closest('.mobile-fab-container')) return;
            e.preventDefault();
            this.currentStrategy.handleTouchEnd(e);
        }, { passive: false });
        document.addEventListener('keydown', (e) => this.currentStrategy.handleKeyDown(e));
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE, interactionController.toggleMode);
        EventBus.subscribe(EVENTS.INTERACTION_MODE_CHANGED, (mode) => this.setStrategy(mode));
        EventBus.subscribe(EVENTS.COMMAND_ENTER_PLACING_MODE, (data) => this.setStrategy('place', data));
        EventBus.subscribe(EVENTS.LAYOUT_CALCULATED, (newLayout) => { this.layoutCache = newLayout; });
    }

    /**
     * Sets the active input handling strategy.
     * @param {string} name - The name of the strategy to activate ('pan', 'draw', 'place').
     * @param {object} [options] - Optional data to pass to the new strategy's `enter` method.
     */
    setStrategy(name, options) {
        if (!this.strategies[name] || this.currentStrategyName === name) {
            return;
        }
        if (this.currentStrategyName !== 'place') {
            this.previousStrategyName = this.currentStrategyName;
        }
        this.currentStrategy.exit();
        this.currentStrategyName = name;
        this.currentStrategy = this.strategies[name];
        this.currentStrategy.enter(options);
    }
    
    

    getCoordsFromPointerEvent(event) {
        if (!this.gl || !this.gl.canvas || !this.worldManager || !this.layoutCache.selectedView) {
            return { worldIndexAtCursor: null, col: null, row: null, viewType: null };
        }
        const camera = this.worldManager.getCurrentCameraState();
        if (!camera) return { worldIndexAtCursor: null, col: null, row: null, viewType: null };
        const rect = this.gl.canvas.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const { x: selectedViewX, y: selectedViewY, width: selectedViewWidth, height: selectedViewHeight } = this.layoutCache.selectedView;
        if (pointerX >= selectedViewX && pointerX < selectedViewX + selectedViewWidth &&
            pointerY >= selectedViewY && pointerY < selectedViewY + selectedViewHeight) {
            const texCoordX = (pointerX - selectedViewX) / selectedViewWidth;
            const texCoordY = (pointerY - selectedViewY) / selectedViewHeight;
            return { ...textureCoordsToGridCoords(texCoordX, texCoordY, camera), viewType: 'selected', worldIndexAtCursor: this.worldManager.getSelectedWorldIndex() };
        }
        const { gridContainerX, gridContainerY, miniMapW, miniMapH, miniMapSpacing } = this.layoutCache.miniMap;
        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const r_map = Math.floor(i / Config.WORLD_LAYOUT_COLS);
            const c_map = i % Config.WORLD_LAYOUT_COLS;
            const miniX = gridContainerX + c_map * (miniMapW + miniMapSpacing);
            const miniY = gridContainerY + r_map * (miniMapH + miniMapSpacing);
            if (pointerX >= miniX && pointerX < miniX + miniMapW && pointerY >= miniY && pointerY < miniY + miniMapH) {
                return { worldIndexAtCursor: i, col: null, row: null, viewType: 'mini' };
            }
        }
        return { worldIndexAtCursor: null, col: null, row: null, viewType: null };
    }
    
    zoomAtPoint(pivotClientX, pivotClientY, zoomFactor) {
        const camera = this.worldManager.getCurrentCameraState();
        if (!camera) return;
        const { worldX, worldY } = this.getCoordsFromPointerEvent({ clientX: pivotClientX, clientY: pivotClientY });
        if (worldX === null) return;
        const oldZoom = camera.zoom;
        const newZoom = Math.max(1.0, Math.min(25.0, oldZoom * zoomFactor));
        if (newZoom !== oldZoom) {
            const ratio = oldZoom / newZoom;
            camera.x = worldX * (1 - ratio) + camera.x * ratio;
            camera.y = worldY * (1 - ratio) + camera.y * ratio;
            camera.zoom = newZoom;
            this.clampCameraPan();
        }
    }
    
    handleBrushSizeWheel(event) {
        if (event.ctrlKey) {
            const scrollAmount = Math.sign(event.deltaY);
            const newSize = brushController.getState().brushSize - scrollAmount;
            brushController.setBrushSize(newSize);
        }
    }

    _calculateGridBounds() {
        const hexSize = calculateHexSizeForTexture();
        this.gridWorldBounds = {
            minX: -hexSize,
            maxX: Config.GRID_COLS * (hexSize * 2 * 0.75) + hexSize,
            minY: -hexSize,
            maxY: Config.GRID_ROWS * (hexSize * Math.sqrt(3)) + hexSize
        };
    }
    
    clampCameraPan() {
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
}