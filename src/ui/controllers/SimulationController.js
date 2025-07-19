import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SimulationController {
    constructor() {
        this.isPaused = true;

        EventBus.subscribe(EVENTS.COMMAND_SET_SPEED, this.#handleSetSpeed);
        EventBus.subscribe(EVENTS.COMMAND_TOGGLE_PAUSE, this.#handleTogglePause);
        EventBus.subscribe(EVENTS.COMMAND_SET_PAUSE_STATE, this.#handleSetPauseState);
    }

    getIsPaused() {
        return this.isPaused;
    }

    getSpeed() {
        return PersistenceService.loadSimSpeed() ?? Config.DEFAULT_SPEED;
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
        PersistenceService.saveSimSpeed(newSpeed);
        EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED, newSpeed);
    }

    #handleTogglePause = () => {
        this.isPaused = !this.isPaused;
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.isPaused);
        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: this.isPaused ? 'Simulation paused' : 'Simulation resumed' });
    }

    #handleSetPauseState = (shouldBePaused) => {
        if (this.isPaused === shouldBePaused) return; 
        this.isPaused = shouldBePaused;
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.isPaused);
    }

    _syncPauseState = (isPaused) => {
        if (this.isPaused !== isPaused) {
            this.isPaused = isPaused;
            EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.isPaused);
        }
    }
} 