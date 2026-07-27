import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import {
    dollyTorusView,
    orbitTorusView,
    setTorusOrbiting,
} from '../../rendering/renderer.js';

export class OrbitStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.isOrbiting = false;
        this.lastX = 0;
        this.lastY = 0;
    }

    handleMouseDown(event) {
        const { viewType, worldIndexAtCursor } = this.manager.getCoordsFromPointerEvent(event);
        if (event.button === 0 && viewType === 'mini' && worldIndexAtCursor !== null) {
            EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndexAtCursor);
            return;
        }
        if (event.button !== 0 || viewType !== 'selected') return;
        this.isOrbiting = true;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        setTorusOrbiting(true);
        this.manager.canvas.classList.add('torus-orbiting');
    }

    handleMouseMove(event) {
        if (!this.isOrbiting) return;
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        orbitTorusView(dx * 0.008, dy * 0.008);
    }

    handleMouseWheel(event) {
        dollyTorusView(event.deltaY);
    }

    handleMouseUp() {
        this._stopOrbiting();
    }

    handleMouseOut() {
        this._stopOrbiting();
    }

    exit() {
        this._stopOrbiting();
    }

    _stopOrbiting() {
        if (!this.isOrbiting) return;
        this.isOrbiting = false;
        setTorusOrbiting(false);
        this.manager.canvas.classList.remove('torus-orbiting');
    }
}
