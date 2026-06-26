import { BaseInputStrategy } from './BaseInputStrategy.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { calculateHexSizeForTexture } from '../../utils/utils.js';

/**
 * @class ShiftWorldStrategy
 * @description Activated while the "shift world" hotkey is held. Dragging on the selected view
 * toroidally translates that world's cell content by whole cells (wrapping at the edges), so a
 * pattern that has drifted across the wrap seam can be slid back to the centre. This moves the
 * actual cell state — not the camera — so the simulation continues from the recentred layout.
 *
 * The grid is odd-q (flat-top, odd columns staggered): vertical shifts are a clean torus symmetry,
 * but a horizontal shift by an odd number of columns would flip the stagger phase and shear the
 * pattern. To keep the dynamics identical, horizontal drags are quantised to even (2-column) steps.
 */
export class ShiftWorldStrategy extends BaseInputStrategy {
    constructor(manager) {
        super(manager);
        this.isDragging = false;
        this.lastWorldX = 0;
        this.lastWorldY = 0;
        // Sub-cell drag remainder carried between moves so slow drags still accumulate to whole steps.
        this.accCol = 0;
        this.accRow = 0;
    }

    enter() {
        this.isDragging = false;
        this.accCol = 0;
        this.accRow = 0;
        this.manager.canvas.style.cursor = 'grab';
    }

    exit() {
        this.isDragging = false;
        this.manager.canvas.style.cursor = '';
    }

    // World-pixel spacing between adjacent columns / rows (matches textureCoordsToGridCoords).
    _spacings() {
        const hexSize = calculateHexSizeForTexture();
        return { horiz: hexSize * 2 * 3 / 4, vert: hexSize * Math.sqrt(3) };
    }

    handleMouseDown(event) {
        if (event.button !== 0) return;
        const { viewType, worldX, worldY } = this.manager.getCoordsFromPointerEvent(event);
        if (viewType !== 'selected' || worldX === null) return;
        this.isDragging = true;
        this.lastWorldX = worldX;
        this.lastWorldY = worldY;
        this.accCol = 0;
        this.accRow = 0;
        this.manager.canvas.style.cursor = 'grabbing';
    }

    handleMouseMove(event) {
        if (!this.isDragging) return;
        const { worldX, worldY } = this.manager.getCoordsFromPointerEvent(event);
        if (worldX === null) return;
        const { horiz, vert } = this._spacings();
        this.accCol += (worldX - this.lastWorldX) / horiz;
        this.accRow += (worldY - this.lastWorldY) / vert;
        this.lastWorldX = worldX;
        this.lastWorldY = worldY;

        // Drain whole-cell steps: even columns (preserve hex phase), single rows.
        const dCol = Math.trunc(this.accCol / 2) * 2;
        const dRow = Math.trunc(this.accRow);
        if (dCol === 0 && dRow === 0) return;
        this.accCol -= dCol;
        this.accRow -= dRow;
        EventBus.dispatch(EVENTS.COMMAND_SHIFT_WORLD, {
            worldIndex: this.manager.worldManager.getSelectedWorldIndex(),
            dCol,
            dRow,
        });
    }

    handleMouseUp(_event) {
        this.isDragging = false;
        this.manager.canvas.style.cursor = 'grab';
    }

    handleMouseOut(_event) {
        this.isDragging = false;
        this.manager.canvas.style.cursor = 'grab';
    }
}
