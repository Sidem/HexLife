import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SimulationController {
    constructor() {
        this.state = {
            isPaused: true,
            speed: PersistenceService.loadSimSpeed() ?? Config.DEFAULT_SPEED,
        };

        // Controllers now subscribe to commands to change their own state
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

    // Private handler for setting speed
    #handleSetSpeed = (speed) => {
        const newSpeed = Math.max(1, Math.min(Config.MAX_SIM_SPEED, speed));
        if (this.state.speed === newSpeed) return;
        this.state.speed = newSpeed;
        PersistenceService.saveSimSpeed(newSpeed);
        // Dispatch a state change event for the UI and WorldManager to consume
        EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED, newSpeed);
    }

    // Private handler for toggling pause
    #handleTogglePause = () => {
        this.state.isPaused = !this.state.isPaused;
        // Dispatch a state change event for the UI and WorldManager to consume
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.state.isPaused);
    }

    // Private handler for setting explicit pause state
    #handleSetPauseState = (shouldBePaused) => {
        if (this.state.isPaused === shouldBePaused) return; // No change needed
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