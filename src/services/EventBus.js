// src/services/EventBus.js
const subscriptions = {};

export const EventBus = {
    subscribe(eventType, callback) {
        if (!subscriptions[eventType]) {
            subscriptions[eventType] = [];
        }
        subscriptions[eventType].push(callback);
        console.log(`EventBus: Subscribed to ${eventType}`);

        // Return an unsubscribe function
        return () => {
            subscriptions[eventType] = subscriptions[eventType].filter(cb => cb !== callback);
            console.log(`EventBus: Unsubscribed from ${eventType}`);
        };
    },

    dispatch(eventType, data) {
        //console.log(`EventBus: Dispatching ${eventType}`, data);
        if (subscriptions[eventType]) {
            subscriptions[eventType].forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`Error in EventBus callback for ${eventType}:`, e);
                }
            });
        }
    },

    // For debugging or specific use cases
    _getSubscriptions() {
        return subscriptions;
    }
};

// Define standard event types to avoid typos
export const EVENTS = {
    // Simulation State Changes
    SIMULATION_PAUSED: 'simulation:paused', // data: boolean (isPaused)
    SIMULATION_SPEED_CHANGED: 'simulation:speedChanged', // data: number (newSpeed)
    RULESET_CHANGED: 'simulation:rulesetChanged', // data: string (newRulesetHex)
    BRUSH_SIZE_CHANGED: 'simulation:brushSizeChanged', // data: number (newBrushSize)
    SELECTED_WORLD_CHANGED: 'simulation:selectedWorldChanged', // data: number (newWorldIndex)
    WORLD_STATS_UPDATED: 'simulation:worldStatsUpdated', // data: object (stats for selected world)
    ALL_WORLDS_RESET: 'simulation:allWorldsReset', // no specific data, implies refresh all
    WORLD_SETTINGS_CHANGED: 'simulation:worldSettingsChanged', // data: array (all world settings) - for SetupPanel refresh
    ENTROPY_SAMPLING_CHANGED: 'simulation:entropySamplingChanged', // data: { enabled, rate }
    PERFORMANCE_METRICS_UPDATED: 'simulation:performanceMetricsUpdated', // data: { fps, tps }

    // UI Commands / User Actions (to be handled by simulation or main)
    COMMAND_TOGGLE_PAUSE: 'command:togglePause',
    COMMAND_SET_SPEED: 'command:setSpeed', // data: number (newSpeed)
    COMMAND_SET_BRUSH_SIZE: 'command:setBrushSize', // data: number (newSize)
    COMMAND_GENERATE_RANDOM_RULESET: 'command:generateRandomRuleset', // data: { bias, symmetrical }
    COMMAND_SET_RULESET: 'command:setRuleset', // data: string (rulesetHex)
    COMMAND_TOGGLE_RULE_OUTPUT: 'command:toggleRuleOutput', // data: number (ruleIndex)
    COMMAND_SET_ALL_RULES_STATE: 'command:setAllRulesState', // data: number (targetState)
    COMMAND_SET_RULES_FOR_NEIGHBOR_COUNT: 'command:setRulesForNeighborCount', // data: { centerState, numActive, outputState }
    COMMAND_RESET_ALL_WORLDS: 'command:resetAllWorldsToCurrentSettings',
    COMMAND_SAVE_SELECTED_WORLD_STATE: 'command:saveSelectedWorldState',
    COMMAND_LOAD_WORLD_STATE: 'command:loadWorldState', // data: { worldIndex, loadedData }
    COMMAND_APPLY_BRUSH: 'command:applyBrush', // data: { worldIndex, col, row, brushSize }
    COMMAND_SET_HOVER_STATE: 'command:setHoverState', // data: { worldIndex, col, row, brushSize }
    COMMAND_CLEAR_HOVER_STATE: 'command:clearHoverState', // data: { worldIndex }
    COMMAND_SET_WORLD_INITIAL_DENSITY: 'command:setWorldInitialDensity', // data: { worldIndex, density }
    COMMAND_SET_WORLD_ENABLED: 'command:setWorldEnabled', // data: { worldIndex, isEnabled }
    COMMAND_SET_ENTROPY_SAMPLING: 'command:setEntropySampling', // data: { enabled, rate }
    COMMAND_SELECT_WORLD: 'command:selectWorld', // data: number (worldIndex)
}; 