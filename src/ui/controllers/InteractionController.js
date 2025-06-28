import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class InteractionController {
    constructor() {
        this.mode = 'pan'; 
        
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE, this.#handleToggleMode);
        EventBus.subscribe(EVENTS.COMMAND_SET_INTERACTION_MODE, this.#handleSetMode);
        EventBus.subscribe(EVENTS.COMMAND_SET_BRUSH_MODE, this.#handleSetBrushMode);
        EventBus.subscribe(EVENTS.COMMAND_SET_PAUSE_WHILE_DRAWING, this.#handleSetPauseWhileDrawing);
    }

    getMode() {
        return this.mode;
    }

    getBrushMode() {
        return PersistenceService.loadUISetting('brushMode', 'invert');
    }

    getPauseWhileDrawing() {
        return PersistenceService.loadUISetting('pauseWhileDrawing', true);
    }

    #handleToggleMode = () => {
        const newMode = this.mode === 'pan' ? 'draw' : 'pan';
        this.#handleSetMode(newMode);
    }

    #handleSetMode = (mode) => {
        if (mode !== 'pan' && mode !== 'draw' && mode !== 'place') return;
        if (this.mode === mode) return;
        
        this.mode = mode;
        EventBus.dispatch(EVENTS.INTERACTION_MODE_CHANGED, this.mode);
    }

    #handleSetPauseWhileDrawing = (shouldPause) => {
        PersistenceService.saveUISetting('pauseWhileDrawing', shouldPause);
    }

    #handleSetBrushMode = (mode) => {
        if (mode !== 'invert' && mode !== 'draw' && mode !== 'erase') return;

        PersistenceService.saveUISetting('brushMode', mode);
        EventBus.dispatch(EVENTS.BRUSH_MODE_CHANGED, mode);
    }
} 