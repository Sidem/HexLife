import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

/**
 * @class PanStrategy
 * @description Handles panning and zooming the main canvas view.
 */
export class PanStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        this.touchState = {
            isDown: false,
            isDragging: false,
            lastDistance: 0,
            TAP_THRESHOLD: 10,
            startPoint: { x: 0, y: 0 },
            lastPoint: { x: 0, y: 0 },
        };
    }



    handleMouseDown(event) {
        const { viewType, worldIndexAtCursor } = this.manager.getCoordsFromPointerEvent(event);
        if (viewType === 'mini' && worldIndexAtCursor !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
            return;
        }
        if (event.button === 1 || (event.button === 0 && event.ctrlKey)) {
            this.isPanning = true;
            this.lastPanX = event.clientX;
            this.lastPanY = event.clientY;
        } else if (event.button === 0) { 
            this.manager.setStrategy('draw');
            this.manager.currentStrategy.handleMouseDown(event);
        }
    }

    handleMouseMove(event) {
        if (this.isPanning) {
            const camera = this.manager.worldManager.getCurrentCameraState();
            if (!camera) return;
            const dx = event.clientX - this.lastPanX;
            const dy = event.clientY - this.lastPanY;
            camera.x -= dx / camera.zoom;
            camera.y -= dy / camera.zoom;
            this.lastPanX = event.clientX;
            this.lastPanY = event.clientY;
            this.manager.clampCameraPan();
        }
    }

    handleMouseUp(event) {
        this.isPanning = false;
    }

    handleMouseOut(event) {
        this.isPanning = false;
    }

    handleTouchStart(event) {
        const touches = event.touches;
        this.touchState.isDown = true;
        this.touchState.isDragging = false;
        const primaryTouch = touches[0];
        this.touchState.startPoint = { x: primaryTouch.clientX, y: primaryTouch.clientY };
        this.touchState.lastPoint = { ...this.touchState.startPoint };

        if (touches.length >= 2) {
            this.touchState.lastDistance = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
        }
    }

    handleTouchMove(event) {
        if (!this.touchState.isDown) return;
        const touches = event.touches;
        const camera = this.manager.worldManager.getCurrentCameraState();
        const primaryTouch = touches[0];
        const newPoint = { x: primaryTouch.clientX, y: primaryTouch.clientY };
        if (!this.touchState.isDragging) {
            const dist = Math.hypot(newPoint.x - this.touchState.startPoint.x, newPoint.y - this.touchState.startPoint.y);
            if (dist > this.touchState.TAP_THRESHOLD) {
                this.touchState.isDragging = true;
            }
        }

        if (touches.length >= 2) { 
            const newDist = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
            const pinchCenter = { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
            if (this.touchState.lastDistance > 0) {
                const zoomFactor = newDist / this.touchState.lastDistance;
                this.manager.zoomAtPoint(pinchCenter.x, pinchCenter.y, zoomFactor);
            }
            this.touchState.lastDistance = newDist;
        } else if (this.touchState.isDragging) { 
            const dx = newPoint.x - this.touchState.lastPoint.x;
            const dy = newPoint.y - this.touchState.lastPoint.y;
            if (camera) {
                camera.x -= dx / camera.zoom;
                camera.y -= dy / camera.zoom;
                this.manager.clampCameraPan();
            }
        }
        this.touchState.lastPoint = newPoint;
    }

    handleTouchEnd(event) {
        const endTouch = event.changedTouches[0];
        if (endTouch && !this.touchState.isDragging) {
            const { worldIndexAtCursor, viewType } = this.manager.getCoordsFromPointerEvent(endTouch);
            if (viewType === 'mini' && worldIndexAtCursor !== null) {
                EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
            }
        }
        this.resetTouchState();
    }
    
    resetTouchState() {
        this.touchState.isDown = false;
        this.touchState.isDragging = false;
        this.touchState.lastDistance = 0;
    }
}