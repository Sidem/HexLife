import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class BrushController {
    constructor() {
        EventBus.subscribe(EVENTS.COMMAND_SET_BRUSH_SIZE, this.#handleSetBrushSize);
        EventBus.subscribe(EVENTS.COMMAND_INCREMENT_BRUSH_SIZE, this.#handleIncrementBrushSize);
    }

    getBrushSize() {
        return PersistenceService.loadBrushSize() ?? Config.DEFAULT_NEIGHBORHOOD_SIZE;
    }

    getBrushConfig() {
        return {
            min: 0,
            max: Config.MAX_NEIGHBORHOOD_SIZE,
            step: 1,
            unit: ''
        };
    }

    #handleSetBrushSize = (size) => {
        const newSize = Math.max(0, Math.min(Config.MAX_NEIGHBORHOOD_SIZE, size));
        PersistenceService.saveBrushSize(newSize);
        EventBus.dispatch(EVENTS.BRUSH_SIZE_CHANGED, newSize);
    }

    #handleIncrementBrushSize = (increment) => {
        const currentSize = this.getBrushSize();
        const newSize = currentSize + increment;
        this.#handleSetBrushSize(newSize);
    }
} 