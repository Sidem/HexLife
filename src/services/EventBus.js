// src/services/EventBus.js
const subscriptions = {};

export const EventBus = {
    subscribe(eventType, callback) {
        if (!subscriptions[eventType]) {
            subscriptions[eventType] = [];
        }
        const index = subscriptions[eventType].push(callback) - 1;
        return () => { // Unsubscribe function
            subscriptions[eventType].splice(index, 1);
            if (subscriptions[eventType].length === 0) {
                // delete subscriptions[eventType]; // Optional: clean up empty event types
            }
        };
    },

    dispatch(eventType, data) {
        if (subscriptions[eventType]) {
            // Iterate over a copy in case a callback unsubscribes itself or others
            [...subscriptions[eventType]].forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`Error in EventBus callback for ${eventType}:`, e, data);
                }
            });
        }
    },
    _getSubscriptions() { // For debugging or testing
        return subscriptions;
    }
};

export const EVENTS = {
    // Simulation lifecycle & state updates
    SIMULATION_PAUSED: 'simulation:paused', // Global pause state from WorldManager
    SIMULATION_SPEED_CHANGED: 'simulation:speedChanged', // Global speed target
    RULESET_CHANGED: 'simulation:rulesetChanged', // For THE SELECTED world, payload: hexString
    BRUSH_SIZE_CHANGED: 'simulation:brushSizeChanged',
    SELECTED_WORLD_CHANGED: 'simulation:selectedWorldChanged', // payload: newIndex
    WORLD_STATS_UPDATED: 'simulation:worldStatsUpdated', // For THE SELECTED world, payload: { worldIndex, tick, ratio, avgRatio, entropy, isEnabled }
                                                       // avgRatio might be harder to maintain per-world without main thread history
    ALL_WORLDS_RESET: 'simulation:allWorldsReset', // Indicates a global reset operation finished
    WORLD_SETTINGS_CHANGED: 'simulation:worldSettingsChanged', // payload: new full world settings array from WorldManager
    ENTROPY_SAMPLING_CHANGED: 'simulation:entropySamplingChanged', // If this feature is kept globally
    PERFORMANCE_METRICS_UPDATED: 'simulation:performanceMetricsUpdated', // payload: { fps, tps (of selected world) }
    TRIGGER_DOWNLOAD: 'system:triggerDownload', // payload: { filename, content, mimeType }

    // UI Commands to WorldManager / System
    COMMAND_TOGGLE_PAUSE: 'command:togglePause',
    COMMAND_SET_SPEED: 'command:setSpeed', // payload: speedValue
    COMMAND_SET_BRUSH_SIZE: 'command:setBrushSize', // payload: sizeValue

    // Ruleset modification commands from UI Bar (Main UI, targets WorldManager)
    // Payloads now might need to be richer or interpreted by WorldManager based on UI scope toggles
    COMMAND_GENERATE_RANDOM_RULESET: 'command:generateRandomRuleset', // payload: { bias, generationMode, resetScopeForThisChange: 'all' | 'selected' | 'none' }
    COMMAND_SET_RULESET: 'command:setRuleset', // payload: { hexString, resetScopeForThisChange: 'all' | 'selected' | 'none' }

    // Editor-specific commands: modificationScope + conditionalResetScope
    // These are dispatched by RulesetEditor to WorldManager
    COMMAND_EDITOR_TOGGLE_RULE_OUTPUT: 'command:editorToggleRuleOutput', // payload: { ruleIndex, modificationScope: 'all' | 'selected', conditionalResetScope: 'all' | 'selected' | 'none' }
    COMMAND_EDITOR_SET_ALL_RULES_STATE: 'command:editorSetAllRulesState', // payload: { targetState, modificationScope: 'all' | 'selected', conditionalResetScope: 'all' | 'selected' | 'none' }
    COMMAND_EDITOR_SET_RULES_FOR_NEIGHBOR_COUNT: 'command:editorSetRulesForNeighborCount', // payload: { centerState, numActive, outputState, modificationScope: 'all' | 'selected', conditionalResetScope: 'all' | 'selected' | 'none' }
    COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE: 'command:editorSetRulesForCanonicalRep', // payload: { canonicalBitmask, centerState, outputState, modificationScope: 'all' | 'selected', conditionalResetScope: 'all' | 'selected' | 'none' }
    COMMAND_EDITOR_SET_RULESET_HEX: 'command:editorSetRulesetHex', // payload: { hexString, modificationScope: 'all' | 'selected', conditionalResetScope: 'all' | 'selected' | 'none' }

    // World state commands
    COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES: 'command:resetAllWorldsToInitialDensities',
    COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET: 'command:resetWorldsWithCurrentRuleset', // payload: { scope: 'all'|'selected'|worldIndex, copyPrimaryRuleset?: boolean }
    COMMAND_CLEAR_WORLDS: 'command:clearWorlds', // payload: { scope: 'all'|'selected'|worldIndex }

    COMMAND_SAVE_SELECTED_WORLD_STATE: 'command:saveSelectedWorldState', // Handled by WorldManager
    COMMAND_LOAD_WORLD_STATE: 'command:loadWorldState', // payload: { worldIndex, loadedData } -> to WorldManager

    // Interaction commands (target specific worlds, handled by WorldManager which routes to WorldProxy)
    COMMAND_APPLY_BRUSH: 'command:applyBrush', // payload: { worldIndex, col, row } (brushSize is known by WorldManager)
    COMMAND_SET_HOVER_STATE: 'command:setHoverState', // payload: { worldIndex, col, row } (brushSize known by WM)
    COMMAND_CLEAR_HOVER_STATE: 'command:clearHoverState', // payload: { worldIndex }

    // Setup panel commands
    COMMAND_SET_WORLD_INITIAL_DENSITY: 'command:setWorldInitialDensity', // payload: { worldIndex, density }
    COMMAND_SET_WORLD_ENABLED: 'command:setWorldEnabled', // payload: { worldIndex, isEnabled }
    COMMAND_SET_ENTROPY_SAMPLING: 'command:setEntropySampling', // payload: { enabled, rate } (if global)
    COMMAND_SELECT_WORLD: 'command:selectWorld', // payload: newIndex

    // UI internal state changes (if needed for cross-component communication not via simulation state)
    UI_RULESET_SCOPE_CHANGED: 'ui:rulesetScopeChanged', // e.g. from main bar scope switch
    UI_EDITOR_RULESET_SCOPE_CHANGED: 'ui:editorRulesetScopeChanged', // e.g. from editor's apply-to switch
};