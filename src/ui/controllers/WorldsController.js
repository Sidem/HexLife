import { EventBus, EVENTS } from '../../services/EventBus.js';

export class WorldsController {
    constructor() {
        // This controller is action-oriented. State is managed by WorldManager.
    }

    selectWorld = (worldIndex) => {
        EventBus.dispatch(EVENTS.COMMAND_SELECT_WORLD, worldIndex);
    }

    setWorldEnabled = (worldIndex, isEnabled) => {
        EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex, isEnabled });
    }
    
    setWorldInitialDensity = (worldIndex, density) => {
        EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, { worldIndex, density });
    }

    resetAllWorldsToInitialDensities = () => {
        EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES);
    }

    resetWorldsWithCurrentRuleset = (scope, copyPrimaryRuleset = false) => {
        EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope, copyPrimaryRuleset });
    }
    
    clearWorlds = (scope) => {
        EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope });
    }

    applySelectedDensityToAll = () => {
         EventBus.dispatch(EVENTS.COMMAND_APPLY_SELECTED_DENSITY_TO_ALL);
    }

    resetDensitiesToDefault = () => {
         EventBus.dispatch(EVENTS.COMMAND_RESET_DENSITIES_TO_DEFAULT);
    }
    
    saveSelectedWorldState = () => {
        EventBus.dispatch(EVENTS.COMMAND_SAVE_SELECTED_WORLD_STATE);
    }
    
    loadWorldState = (worldIndex, loadedData) => {
        EventBus.dispatch(EVENTS.COMMAND_LOAD_WORLD_STATE, { worldIndex, loadedData });
    }
} 