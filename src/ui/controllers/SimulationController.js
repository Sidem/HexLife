import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SimulationController {
    constructor() {
        this.state = {
            isPaused: true,
            speed: PersistenceService.loadSimSpeed() ?? Config.DEFAULT_SPEED,
        };

        
        EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, this.#handleSetSpeed);
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PAUSE, this.#handleTogglePause);
        EventBus.subscribe(EVENTS.COMMAND_SET_PAUSE_STATE, this.#handleSetPauseState);
    }

    getState() {
        return { ...this.state };
    }

    getSpeedConfig() {
        return {
            min: 1,
            max: Config.MAX_SIM_SPEED,
            step: 1,
            unit: 'tps'
        };
    }
    #handleSetSpeed = (speed) => {
        const newSpeed = Math.max(1, Math.min(Config.MAX_SIM_SPEED, speed));
        if (this.state.speed === newSpeed) return;
        this.state.speed = newSpeed;
        PersistenceService.saveSimSpeed(newSpeed);
        EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED, newSpeed);
    }

    
    #handleTogglePause = () => {
        this.state.isPaused = !this.state.isPaused;
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.state.isPaused);
    }

    
    #handleSetPauseState = (shouldBePaused) => {
        if (this.state.isPaused === shouldBePaused) return; 
        this.state.isPaused = shouldBePaused;
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.state.isPaused);
    }

    _syncPauseState = (isPaused) => {
        if (this.state.isPaused !== isPaused) {
            this.state.isPaused = isPaused;
            EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.state.isPaused);
        }
    }
} 