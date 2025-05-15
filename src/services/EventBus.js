const subscriptions = {};

export const EventBus = {
    subscribe(eventType, callback) {
        if (!subscriptions[eventType]) {
            subscriptions[eventType] = [];
        }
        subscriptions[eventType].push(callback);
        console.log(`EventBus: Subscribed to ${eventType}`);
        return () => {
            subscriptions[eventType] = subscriptions[eventType].filter(cb => cb !== callback);
            console.log(`EventBus: Unsubscribed from ${eventType}`);
        };
    },

    dispatch(eventType, data) {
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
    _getSubscriptions() {
        return subscriptions;
    }
};


export const EVENTS = {
    SIMULATION_PAUSED: 'simulation:paused', 
    SIMULATION_SPEED_CHANGED: 'simulation:speedChanged', 
    RULESET_CHANGED: 'simulation:rulesetChanged', 
    BRUSH_SIZE_CHANGED: 'simulation:brushSizeChanged', 
    SELECTED_WORLD_CHANGED: 'simulation:selectedWorldChanged', 
    WORLD_STATS_UPDATED: 'simulation:worldStatsUpdated', 
    ALL_WORLDS_RESET: 'simulation:allWorldsReset', 
    WORLD_SETTINGS_CHANGED: 'simulation:worldSettingsChanged', 
    ENTROPY_SAMPLING_CHANGED: 'simulation:entropySamplingChanged', 
    PERFORMANCE_METRICS_UPDATED: 'simulation:performanceMetricsUpdated', 
    COMMAND_TOGGLE_PAUSE: 'command:togglePause',
    COMMAND_SET_SPEED: 'command:setSpeed', 
    COMMAND_SET_BRUSH_SIZE: 'command:setBrushSize', 
    COMMAND_GENERATE_RANDOM_RULESET: 'command:generateRandomRuleset', 
    COMMAND_SET_RULESET: 'command:setRuleset', 
    COMMAND_TOGGLE_RULE_OUTPUT: 'command:toggleRuleOutput', 
    COMMAND_SET_ALL_RULES_STATE: 'command:setAllRulesState', 
    COMMAND_SET_RULES_FOR_NEIGHBOR_COUNT: 'command:setRulesForNeighborCount', 
    COMMAND_RESET_ALL_WORLDS: 'command:resetAllWorldsToCurrentSettings',
    COMMAND_SAVE_SELECTED_WORLD_STATE: 'command:saveSelectedWorldState',
    COMMAND_LOAD_WORLD_STATE: 'command:loadWorldState', 
    COMMAND_APPLY_BRUSH: 'command:applyBrush', 
    COMMAND_SET_HOVER_STATE: 'command:setHoverState', 
    COMMAND_CLEAR_HOVER_STATE: 'command:clearHoverState', 
    COMMAND_SET_WORLD_INITIAL_DENSITY: 'command:setWorldInitialDensity', 
    COMMAND_SET_WORLD_ENABLED: 'command:setWorldEnabled', 
    COMMAND_SET_ENTROPY_SAMPLING: 'command:setEntropySampling', 
    COMMAND_SELECT_WORLD: 'command:selectWorld', 
    COMMAND_SET_RULES_FOR_CANONICAL_REPRESENTATIVE: 'command:setRulesForCanonicalRepresentative',
}; 