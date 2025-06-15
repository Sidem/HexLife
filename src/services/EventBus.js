const subscriptions = {};

export const EventBus = {
    subscribe(eventType, callback) {
        if (!subscriptions[eventType]) {
            subscriptions[eventType] = [];
        }
        const index = subscriptions[eventType].push(callback) - 1;
        return () => { 
            subscriptions[eventType].splice(index, 1);
            if (subscriptions[eventType].length === 0) {
                
            }
        };
    },

    dispatch(eventType, data) {
        if (subscriptions[eventType]) {
            [...subscriptions[eventType]].forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`Error in EventBus callback for ${eventType}:`, e, data);
                }
            });
        }
    },
    _getSubscriptions() { 
        return subscriptions;
    }
};

/**
 * @description Centralized event definitions for the application.
 * Each event is documented with its expected payload structure.
 */
export const EVENTS = {
    // --- Simulation State Change Events ---
    /** @param {boolean} isPaused - The new pause state. */
    SIMULATION_PAUSED: 'simulation:paused', 
    /** @param {number} newSpeed - The new simulation speed (ticks per second). */
    SIMULATION_SPEED_CHANGED: 'simulation:speedChanged', 
    /** @param {string} rulesetHex - The new 32-character ruleset hex string. */
    RULESET_CHANGED: 'simulation:rulesetChanged', 
    /** @param {number} newSize - The new brush size (radius). */
    BRUSH_SIZE_CHANGED: 'simulation:brushSizeChanged',
    /** @param {number} newIndex - The index of the newly selected world. */
    SELECTED_WORLD_CHANGED: 'simulation:selectedWorldChanged', 
    /** @param {{worldIndex: number, tick: number, activeCount: number, ratio: number, binaryEntropy?: number, blockEntropy?: number, isEnabled: boolean, tps: number, rulesetHex: string, ruleUsage: Uint32Array, isInCycle: boolean, cycleLength: number}} stats - The updated statistics object for a world. */
    WORLD_STATS_UPDATED: 'simulation:worldStatsUpdated',                              
    /** @event Emitted with no payload when all worlds are reset simultaneously. */
    ALL_WORLDS_RESET: 'simulation:allWorldsReset', 
    /** @param {Array<{initialDensity: number, enabled: boolean, rulesetHex: string}>} settings - The complete array of settings for all worlds. */
    WORLD_SETTINGS_CHANGED: 'simulation:worldSettingsChanged', 
    /** @param {{enabled: boolean, rate: number}} params - The new entropy sampling parameters. */
    ENTROPY_SAMPLING_CHANGED: 'simulation:entropySamplingChanged', 
    /** @param {{fps: number, tps: number, targetTps: number}} metrics - The latest performance metrics. */
    PERFORMANCE_METRICS_UPDATED: 'simulation:performanceMetricsUpdated', 
    /** @param {{worldIndex: number}} data - The index of the world whose history changed. */
    HISTORY_CHANGED: 'simulation:historyChanged',

    // --- System & File I/O Commands ---
    /** @param {{filename: string, content: string, mimeType: string}} data - The file details for download. */
    TRIGGER_DOWNLOAD: 'system:triggerDownload', 
    /** @param {{file: File}} data - The file object to be loaded. */
    TRIGGER_FILE_LOAD: 'system:triggerFileLoad',
    /** @param {{worldIndex: number}} data - Acknowledges a worker has finished its initialization. */
    WORKER_INITIALIZED: 'system:workerInitialized',
    /** @param {{selectedView: object, miniMap: object}} layout - The calculated layout for the main canvas views. */
    LAYOUT_CALCULATED: 'system:layoutCalculated',

    // --- High-Level UI Commands ---
    /** @param {boolean} isPaused - The desired pause state. */
    COMMAND_TOGGLE_PAUSE: 'command:togglePause',
    /** @param {number} speed - The desired simulation speed. */
    COMMAND_SET_SPEED: 'command:setSpeed', 
    /** @param {number} size - The desired brush size. */
    COMMAND_SET_BRUSH_SIZE: 'command:setBrushSize', 
    /** @param {{bias: number, generationMode: 'random'|'n_count'|'r_sym', resetScopeForThisChange: 'all'|'selected'|'none'}} data - Parameters for generating a random ruleset. */
    COMMAND_GENERATE_RANDOM_RULESET: 'command:generateRandomRuleset', 
    /** @param {{hexString: string, resetScopeForThisChange: 'all'|'selected'|'none'}} data - The ruleset to set. */
    COMMAND_SET_RULESET: 'command:setRuleset', 
    /** @param {{mutationRate: number, scope: 'all'|'selected', mode: 'single'|'r_sym'|'n_count'}} data - Parameters for mutating a ruleset. */
    COMMAND_MUTATE_RULESET: 'command:mutateRuleset',
    /** @param {{mutationRate: number, mode: 'single'|'r_sym'|'n_count'}} data - Parameters for cloning and mutating. */
    COMMAND_CLONE_AND_MUTATE: 'command:cloneAndMutate',
    /** @param {{worldIndex: number}} data - The world index for which to undo a ruleset change. */
    COMMAND_UNDO_RULESET: 'command:undoRuleset',
    /** @param {{worldIndex: number}} data - The world index for which to redo a ruleset change. */
    COMMAND_REDO_RULESET: 'command:redoRuleset',
    /** @param {{worldIndex: number, historyIndex: number}} data - Parameters to revert to a specific history state. */
    COMMAND_REVERT_TO_HISTORY_STATE: 'command:revertToHistoryState',
    /** @param {{ruleIndex: number, modificationScope: 'all'|'selected', conditionalResetScope: 'all'|'selected'|'none'}} data - Parameters for toggling a single rule's output. */
    COMMAND_EDITOR_TOGGLE_RULE_OUTPUT: 'command:editorToggleRuleOutput', 
    /** @param {{targetState: 0|1, modificationScope: 'all'|'selected', conditionalResetScope: 'all'|'selected'|'none'}} data - Parameters to set all rules to a specific state. */
    COMMAND_EDITOR_SET_ALL_RULES_STATE: 'command:editorSetAllRulesState', 
    /** @param {{centerState: 0|1, numActive: number, outputState: 0|1, modificationScope: 'all'|'selected', conditionalResetScope: 'all'|'selected'|'none'}} data - Parameters to set rules based on neighbor count. */
    COMMAND_EDITOR_SET_RULES_FOR_NEIGHBOR_COUNT: 'command:editorSetRulesForNeighborCount', 
    /** @param {{canonicalBitmask: number, centerState: 0|1, outputState: 0|1, modificationScope: 'all'|'selected', conditionalResetScope: 'all'|'selected'|'none'}} data - Parameters to set rules based on their canonical representative. */
    COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE: 'command:editorSetRulesForCanonicalRep', 
    /** @param {{hexString: string, modificationScope: 'all'|'selected', conditionalResetScope: 'all'|'selected'|'none'}} data - The ruleset hex string to apply from the editor. */
    COMMAND_EDITOR_SET_RULESET_HEX: 'command:editorSetRulesetHex', 
    /** @event Emitted with no payload to reset all worlds to their configured initial densities. */
    COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES: 'command:resetAllWorldsToInitialDensities',
    /** @param {{scope: 'all'|'selected', copyPrimaryRuleset: boolean}} data - Parameters for resetting worlds. */
    COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET: 'command:resetWorldsWithCurrentRuleset', 
    /** @param {{scope: 'all'|'selected'}} data - The scope of worlds to clear. */
    COMMAND_CLEAR_WORLDS: 'command:clearWorlds', 
    /** @event Emitted with no payload to save the currently selected world's state to a file. */
    COMMAND_SAVE_SELECTED_WORLD_STATE: 'command:saveSelectedWorldState', 
    /** @param {{worldIndex: number, loadedData: object}} data - The world to load the state into and the data to load. */
    COMMAND_LOAD_WORLD_STATE: 'command:loadWorldState', 
    /** @param {{worldIndex: number, col: number, row: number, brushSize: number}} data - Brush application details. */
    COMMAND_APPLY_BRUSH: 'command:applyBrush', 
    /** @param {{worldIndex: number, cellIndices: Set<number>}} data - A set of specific cell indices to toggle. */
    COMMAND_APPLY_SELECTIVE_BRUSH: 'command:applySelectiveBrush',
    /** @param {{worldIndex: number, col: number, row: number}} data - The grid coordinates for the hover state. */
    COMMAND_SET_HOVER_STATE: 'command:setHoverState', 
    /** @param {{worldIndex: number}} data - The world index for which to clear the hover state. */
    COMMAND_CLEAR_HOVER_STATE: 'command:clearHoverState', 
    /** @param {{worldIndex: number, density: number}} data - The new initial density for a specific world. */
    COMMAND_SET_WORLD_INITIAL_DENSITY: 'command:setWorldInitialDensity', 
    /** @param {{worldIndex: number, isEnabled: boolean}} data - The new enabled state for a specific world. */
    COMMAND_SET_WORLD_ENABLED: 'command:setWorldEnabled', 
    /** @param {{enabled: boolean, rate: number}} data - New parameters for entropy sampling. */
    COMMAND_SET_ENTROPY_SAMPLING: 'command:setEntropySampling', 
    /** @param {number} newIndex - The index of the world to select. */
    COMMAND_SELECT_WORLD: 'command:selectWorld',
    /** @event Emitted with no payload to apply the selected world's density to all other worlds. */
    COMMAND_APPLY_SELECTED_DENSITY_TO_ALL: 'command:applySelectedDensityToAll',
    /** @event Emitted with no payload to reset all world densities to their default values. */
    COMMAND_RESET_DENSITIES_TO_DEFAULT: 'command:resetDensitiesToDefault',
    /** @param {{panelName: string, shouldShow: boolean}} data - Command to show or hide a specific popout panel. */
    COMMAND_SHOW_POPOUT: 'command:showPopout',
    /** @param {{cells: Array<[number, number]>}} data - The pattern data (relative cell coordinates) for placing mode. */
    COMMAND_ENTER_PLACING_MODE: 'command:enterPlacingMode',
    /** @param {{indices: Set<number>}} data - The set of cell indices to show as a ghost preview. */
    COMMAND_UPDATE_GHOST_PREVIEW: 'command:updateGhostPreview',
    /** @event Emitted with no payload to clear any active ghost preview. */
    COMMAND_CLEAR_GHOST_PREVIEW: 'command:clearGhostPreview',
    /** @event Emitted with no payload to toggle between pan and draw interaction modes. */
    COMMAND_TOGGLE_INTERACTION_MODE: 'command:toggleInteractionMode',
    
    // --- UI State Change Events ---
    /** @param {{scope: 'all'|'selected'}} data - The new scope from a UI component. */
    UI_RULESET_SCOPE_CHANGED: 'ui:rulesetScopeChanged', 
    /** @param {{scope: 'all'|'selected'}} data - The new scope from the editor panel's UI. */
    UI_EDITOR_RULESET_SCOPE_CHANGED: 'ui:editorRulesetScopeChanged', 
    /** @param {{value: string}} data - The changed value from the ruleset input field. */
    UI_RULESET_INPUT_CHANGED: 'ui:rulesetInputPopoutChanged',
    /** @param {'pan'|'draw'|'place'} mode - The new interaction mode. */
    INTERACTION_MODE_CHANGED: 'ui:interactionModeChanged',
    /** @param {{mode: 'desktop'|'mobile'}} data - The new UI mode. */
    UI_MODE_CHANGED: 'ui:modeChanged',
    /** @param {{targetView: string, currentView: string}} data - Parameters for changing the active mobile view. */
    COMMAND_SHOW_VIEW: 'command:showView',
    /** @param {{activeView: string}} data - The name of the mobile view that became active. */
    MOBILE_VIEW_CHANGED: 'ui:mobileViewChanged',
    /** @event Emitted with no payload to command the FAB UI to re-render based on persisted settings. */
    COMMAND_UPDATE_FAB_UI: 'command:updateFabUI',
    /** @event Emitted with no payload when the ruleset visualization type (e.g., binary, color) changes. */
    RULESET_VISUALIZATION_CHANGED: 'ui:rulesetVisualizationChanged',
    /** @param {{tourName: string}} data - The name of the tour that was completed. */
    TOUR_ENDED: 'onboarding:tourEnded',
    /** @param {{panel: object}} data - The popout panel that was shown. */
    POPOUT_SHOWN: 'ui:popoutShown',
    /** @param {{panel: object}} data - The popout panel that had an interaction. */
    POPOUT_INTERACTION: 'ui:popoutInteraction',
    /** @param {{sheet: object}} data - The bottom sheet that was shown. */
    BOTTOM_SHEET_SHOWN: 'ui:bottomSheetShown',
};
