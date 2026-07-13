import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';

// Swipe-to-page tuning (mobile redesign M4). A single-finger horizontal fling on
// the selected view, at (or near) min zoom, pages between worlds. At min zoom the
// camera cannot pan (clampCameraPan recenters), so the horizontal drag is otherwise
// inert — making it the natural paging gesture without stealing real pans.
const PAGE_MIN_ZOOM = 1.02;
const PAGE_MIN_DX = 55;
const PAGE_HORIZONTAL_RATIO = 1.4;

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

        if (event.button === 0) {
            if (viewType === 'mini' && worldIndexAtCursor !== null) {
                EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
                return; 
            } else if (viewType === 'selected' && !event.ctrlKey) {
                this.manager.setStrategy('draw');
                this.manager.currentStrategy.handleMouseDown(event);
                return; 
            }
        }
        
        if (event.button === 1 || (event.button === 0 && event.ctrlKey)) {
            if (viewType === 'selected') {
                this.isPanning = true;
                this.lastPanX = event.clientX;
                this.lastPanY = event.clientY;
            }
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

    handleMouseUp(_event) {
        this.isPanning = false;
    }

    handleMouseOut(_event) {
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
            this.touchState.multiTouch = true;
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
            this.touchState.multiTouch = true;
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
        } else if (endTouch && this.touchState.isDragging && event.touches.length === 0) {
            // Last finger up after a drag — consider a page gesture.
            this._maybePageWorld(endTouch);
        }
        this.resetTouchState();
    }

    /**
     * Page between worlds on a single-finger horizontal fling at min zoom (M4).
     * Never runs during a draw stroke (DrawStrategy is active in draw mode) or after
     * a pinch (multiTouch), so it can't fire mid-gesture.
     */
    _maybePageWorld(endTouch) {
        if (this.touchState.multiTouch) return;
        const camera = this.manager.worldManager.getCurrentCameraState();
        if (camera && camera.zoom > PAGE_MIN_ZOOM) return; // real pan is available; don't page

        const startView = this.manager.getCoordsFromPointerEvent({
            clientX: this.touchState.startPoint.x, clientY: this.touchState.startPoint.y,
        }).viewType;
        if (startView !== 'selected') return;

        const dx = endTouch.clientX - this.touchState.startPoint.x;
        const dy = endTouch.clientY - this.touchState.startPoint.y;
        if (Math.abs(dx) < PAGE_MIN_DX || Math.abs(dx) < Math.abs(dy) * PAGE_HORIZONTAL_RATIO) return;

        const dir = dx < 0 ? 1 : -1; // swipe left → next world
        const count = Config.NUM_WORLDS;
        const cur = this.manager.worldManager.getSelectedWorldIndex();
        const target = ((cur + dir) % count + count) % count;
        EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, target);
    }

    resetTouchState() {
        this.touchState.isDown = false;
        this.touchState.isDragging = false;
        this.touchState.lastDistance = 0;
        this.touchState.multiTouch = false;
    }
}