import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

class InteractionController {
    constructor() {
        this.state = {
            mode: 'pan', // 'pan' or 'draw'
            pauseWhileDrawing: PersistenceService.loadUISetting('pauseWhileDrawing', true)
        };
    }

    getState() {
        return { ...this.state };
    }

    toggleMode = () => {
        const newMode = this.state.mode === 'pan' ? 'draw' : 'pan';
        this.setMode(newMode);
    }

    setMode = (mode) => {
        if (mode !== 'pan' && mode !== 'draw') return;
        if (this.state.mode === mode) return;
        
        this.state.mode = mode;
        EventBus.dispatch(EVENTS.INTERACTION_MODE_CHANGED, this.state.mode);
    }

    setPauseWhileDrawing = (shouldPause) => {
        if (this.state.pauseWhileDrawing === shouldPause) return;
        this.state.pauseWhileDrawing = shouldPause;
        PersistenceService.saveUISetting('pauseWhileDrawing', shouldPause);
    }
}

export const interactionController = new InteractionController(); 