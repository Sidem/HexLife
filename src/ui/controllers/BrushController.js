import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class BrushController {
    constructor() {
        this.state = {
            brushSize: PersistenceService.loadBrushSize() ?? Config.DEFAULT_NEIGHBORHOOD_SIZE,
        };
    }

    getState() {
        return { ...this.state };
    }

    getBrushConfig() {
        return {
            min: 0,
            max: Config.MAX_NEIGHBORHOOD_SIZE,
            step: 1,
            unit: ''
        };
    }

    setBrushSize = (size) => {
        const newSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, size));
        if (this.state.brushSize === newSize) return;
        this.state.brushSize = newSize;
        PersistenceService.saveBrushSize(newSize);
        // Event for UI updates. The input handler will read from this controller directly.
        EventBus.dispatch(EVENTS.BRUSH_SIZE_CHANGED, newSize);
    }
} 