import * as Config from '../../core/config.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SimulationController {
    constructor() {
        this.state = {
            isPaused: true,
            speed: PersistenceService.loadSimSpeed() ?? Config.DEFAULT_SPEED,
        };
    }

    getState() {
        return { ...this.state };
    }

    setSpeed = (speed) => {
        const newSpeed = Math.max(1, Math.min(Config.MAX_SIM_SPEED, speed));
        if (this.state.speed === newSpeed) return;
        this.state.speed = newSpeed;
        PersistenceService.saveSimSpeed(newSpeed);
        EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, newSpeed);
        EventBus.dispatch(EVENTS.SIMULATION_SPEED_CHANGED, newSpeed);
    }

    togglePause = () => {
        this.setPause(!this.state.isPaused);
    }
    
    setPause = (isPaused) => {
        this.state.isPaused = isPaused;
        EventBus.dispatch(EVENTS.COMMAND_TOGGLE_PAUSE, this.state.isPaused);
        EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.state.isPaused);
    }

    _syncPauseState = (isPaused) => {
        if (this.state.isPaused !== isPaused) {
            this.state.isPaused = isPaused;
            EventBus.dispatch(EVENTS.SIMULATION_PAUSED, this.state.isPaused);
        }
    }
} 