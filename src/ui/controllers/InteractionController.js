import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class InteractionController {
    constructor() {
        this.state = {
            mode: 'pan', // 'pan', 'draw', or 'place'
            pauseWhileDrawing: PersistenceService.loadUISetting('pauseWhileDrawing', true)
        };
        // Subscribe to command events
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_INTERACTION_MODE, this.#handleToggleMode);
        EventBus.subscribe(EVENTS.COMMAND_SET_INTERACTION_MODE, this.#handleSetMode);
        EventBus.subscribe(EVENTS.COMMAND_SET_PAUSE_WHILE_DRAWING, this.#handleSetPauseWhileDrawing);
    }

    getState() {
        return { ...this.state };
    }

    #handleToggleMode = () => {
        const newMode = this.state.mode === 'pan' ? 'draw' : 'pan';
        this.#handleSetMode(newMode);
    }

    #handleSetMode = (mode) => {
        if (mode !== 'pan' && mode !== 'draw' && mode !== 'place') return;
        if (this.state.mode === mode) return;
        
        this.state.mode = mode;
        EventBus.dispatch(EVENTS.INTERACTION_MODE_CHANGED, this.state.mode);
    }

    #handleSetPauseWhileDrawing = (shouldPause) => {
        if (this.state.pauseWhileDrawing === shouldPause) return;
        this.state.pauseWhileDrawing = shouldPause;
        PersistenceService.saveUISetting('pauseWhileDrawing', shouldPause);
    }
} 