// @ts-check
import { EVENT_BUS_LOGGING } from '../core/config.js';

/**
 * @typedef {(data: any) => void} EventCallback
 */

/** @type {Record<string, EventCallback[]>} */
const subscriptions = {};

/**
 * Logs a dispatched event to the console if enabled and not filtered out.
 * @param {string} eventType The name of the event.
 * @param {*} data The payload of the event.
 */
function logEvent(eventType, data) {
    
    if (!EVENT_BUS_LOGGING.enabled) {
        return;
    }
    const filter = EVENT_BUS_LOGGING.filter;
    if (filter && filter.length > 0) {
        
        const shouldLog = filter.some(prefix => eventType.startsWith(prefix));
        if (!shouldLog) {
            return; 
        }
    }

    console.log(
        `%cEVENT%c ${eventType}`,
        'background-color: #f0c674; color: #1e1e1e; font-weight: bold; padding: 2px 6px; border-radius: 3px;',
        'font-weight: bold; color: #87CEEB;', 
        data 
    );
}

/**
 * Registered-event set, built lazily from `EVENTS` (which is defined below this object). Dev-only guard:
 * a subscribe/dispatch with a name that isn't a registered `EVENTS` value is almost always a typo or a
 * raw string literal that will silently never match — surface it once per bad name.
 * @type {Set<string>|null}
 */
let _knownEvents = null;
const _warnedUnknownEvents = new Set();

/**
 * @returns {boolean} Whether the dev-only build (Vite `import.meta.env.DEV`) is active. Guarded so the
 * module still loads where `import.meta.env` is undefined (e.g. a non-Vite runtime).
 */
function isDevBuild() {
    try { return !!(/** @type {any} */ (import.meta).env?.DEV); } catch { return false; }
}

/**
 * Dev-only: warn (once per name) when an event name isn't a registered `EVENTS` value.
 * @param {string} op - 'subscribe' | 'dispatch' (for the message).
 * @param {string} eventType
 */
function warnIfUnknownEvent(op, eventType) {
    if (!isDevBuild()) return;
    if (!_knownEvents) _knownEvents = new Set(Object.values(EVENTS));
    if (_knownEvents.has(eventType) || _warnedUnknownEvents.has(eventType)) return;
    _warnedUnknownEvents.add(eventType);
    console.warn(`EventBus.${op}: "${eventType}" is not a registered EVENTS value (typo or raw string literal?).`);
}

export const EventBus = {
    /**
     * @param {string} eventType
     * @param {EventCallback} callback
     * @returns {() => void} Unsubscribe function.
     */
    subscribe(eventType, callback) {
        warnIfUnknownEvent('subscribe', eventType);
        if (!subscriptions[eventType]) {
            subscriptions[eventType] = [];
        }
        subscriptions[eventType].push(callback);
        return () => {
            const subs = subscriptions[eventType];
            if (!subs) {
                return;
            }
            const currentIndex = subs.indexOf(callback);
            if (currentIndex !== -1) {
                subs.splice(currentIndex, 1);
            }
        };
    },

    /**
     * @param {string} eventType
     * @param {*} [data] - The event payload (see `EVENTS` for per-event shapes).
     */
    dispatch(eventType, data) {
        warnIfUnknownEvent('dispatch', eventType);
        logEvent(eventType, data);
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
 * Recurring payload shapes, defined once so per-event docs reference a single
 * source of truth instead of re-spelling the same object inline. Reference them
 * from event `@param` tags (e.g. `@param {RulesetScopeData} data`). These are
 * available to any file that opts into `// @ts-check`.
 *
 * @typedef {'all'|'selected'} Scope - Which worlds an operation targets.
 * @typedef {'all'|'selected'|'none'} ResetScope - Conditional-reset scope.
 * @typedef {0|1} CellState - A single cell's state (off/on).
 *
 * @typedef {Object} RulesetScopeData
 * @property {Scope} scope
 *
 * @typedef {Object} WorldIndexData
 * @property {number} worldIndex
 *
 * @typedef {Object} WorldStats - Per-world statistics payload (WORLD_STATS_UPDATED).
 * @property {number} worldIndex
 * @property {number} tick
 * @property {number} activeCount
 * @property {number} ratio
 * @property {number} [binaryEntropy]
 * @property {number} [blockEntropy]
 * @property {boolean} isEnabled
 * @property {number} tps
 * @property {string} rulesetHex
 * @property {Uint32Array} ruleUsage
 * @property {boolean} isInCycle
 * @property {number} cycleLength
 * @property {number} [historyLength] - Scrub-back frames available on this world (selected world only).
 * @property {boolean} [isScrubbing] - Whether the world is parked on a past frame.
 *
 * @typedef {Object} WorldSetting - One world's settings entry (WORLD_SETTINGS_CHANGED).
 * @property {{mode: string, params: object}} initialState
 * @property {boolean} enabled
 * @property {string} rulesetHex
 *
 * @typedef {Object} EntropySamplingParams
 * @property {boolean} enabled
 * @property {number} rate
 */

/**
 * @description Centralized event definitions for the application.
 * Each event is documented with its expected payload structure.
 */
export const EVENTS = {
    
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
    /** @param {WorldStats} stats - The updated statistics object for a world. */
    WORLD_STATS_UPDATED: 'simulation:worldStatsUpdated',
    /** @event Emitted with no payload when all worlds are reset simultaneously. */
    ALL_WORLDS_RESET: 'simulation:allWorldsReset',
    /** @param {WorldSetting[]} settings - The complete array of settings for all worlds. */
    WORLD_SETTINGS_CHANGED: 'simulation:worldSettingsChanged',
    /** @param {EntropySamplingParams} params - The new entropy sampling parameters. */
    ENTROPY_SAMPLING_CHANGED: 'simulation:entropySamplingChanged',
    /** @param {{fps: number, tps: number, targetTps: number}} metrics - The latest performance metrics. */
    PERFORMANCE_METRICS_UPDATED: 'simulation:performanceMetricsUpdated',
    /** @param {{recording: boolean}} data - Whether WebM canvas recording is currently active (drives the record button visual). */
    WORLD_RECORDING_STATE_CHANGED: 'simulation:worldRecordingStateChanged',
    /** @param {{worldIndex: number}} data - A world is being borrowed as the scratch world for library thumbnail baking (-1 when the batch finishes and the world is restored). Drives the "in use" minimap badge. */
    WORLD_BAKING_STATE_CHANGED: 'simulation:worldBakingStateChanged',
    /** @param {{worldIndex: number}} data - The index of the world whose history changed. */
    HISTORY_CHANGED: 'simulation:historyChanged',
    /** @param {{worldIndex: number, length: number, offset: number, isScrubbing: boolean}} data - State-history scrub-back position/availability for the selected world (drives the transport bar). */
    STATE_HISTORY_CHANGED: 'simulation:stateHistoryChanged',

    
    /** @param {{filename: string, content: string, mimeType: string}} data - The file details for download. */
    TRIGGER_DOWNLOAD: 'system:triggerDownload', 
    /** @param {{file: File}} data - The file object to be loaded. */
    TRIGGER_FILE_LOAD: 'system:triggerFileLoad',
    /** @param {{worldIndex: number}} data - Acknowledges a worker has finished its initialization. */
    WORKER_INITIALIZED: 'system:workerInitialized',
    /** @param {{selectedView: object, miniMap: object}} layout - The calculated layout for the main canvas views. */
    LAYOUT_CALCULATED: 'system:layoutCalculated',
    /** @param {{selectedView: object, miniMap: object}} layout - Updated layout information for UI components. */
    LAYOUT_UPDATED: 'renderer:layoutUpdated',

    
    /** @param {boolean} isPaused - The desired pause state. */
    COMMAND_TOGGLE_PAUSE: 'command:togglePause',
    /** @param {boolean} isPaused - The desired explicit pause state. */
    COMMAND_SET_PAUSE_STATE: 'command:setPauseState',
    /** @param {number} speed - The desired simulation speed. */
    COMMAND_SET_SPEED: 'command:setSpeed',
    /** @param {{offset: number}} data - Scrub the selected world's state history to `offset` ticks back from the live tip (0 = present). Pauses first. */
    COMMAND_SCRUB_HISTORY: 'command:scrubHistory',
    /** @param {{delta: number}} data - Step the selected world's scrub position by `delta` ticks (positive = back, negative = forward; forward past the tip advances the live sim one tick). */
    COMMAND_STATE_STEP: 'command:stateStep',
    /** @event Emitted with no payload to leave scrub mode and return the selected world to its live tip. */
    COMMAND_EXIT_SCRUB: 'command:exitScrub',
    /** @param {number} size - The desired brush size. */
    COMMAND_SET_BRUSH_SIZE: 'command:setBrushSize',
    /** @param {number} increment - The amount to increment the brush size by (e.g., 1 or -1). */
    COMMAND_INCREMENT_BRUSH_SIZE: 'command:incrementBrushSize',
    /** @param {'invert'|'draw'|'erase'} mode - The desired brush interaction mode. */
    COMMAND_SET_BRUSH_MODE: 'command:setBrushMode', 
    /** @param {{bias: number, generationMode: 'random'|'n_count'|'r_sym'|'totalistic', resetScopeForThisChange: 'all'|'selected'|'none'}} data - Parameters for generating a random ruleset. */
    COMMAND_GENERATE_RANDOM_RULESET: 'command:generateRandomRuleset',
    /** @param {{hexString: string, resetScopeForThisChange: 'all'|'selected'|'none'}} data - The ruleset to set. */
    COMMAND_SET_RULESET: 'command:setRuleset',
    /** @param {{mutationRate: number, scope: 'all'|'selected', mode: 'single'|'r_sym'|'n_count'|'totalistic'}} data - Parameters for mutating a ruleset. */
    COMMAND_MUTATE_RULESET: 'command:mutateRuleset',
    /** @param {{mutationRate: number, mode: 'single'|'r_sym'|'n_count'|'totalistic', ensureMutation: boolean}} data - Parameters for cloning and mutating. */
    COMMAND_CLONE_AND_MUTATE: 'command:cloneAndMutate',
    /** @event Emitted with no payload to clone the selected world's ruleset to all other worlds. */
    COMMAND_CLONE_RULESET: 'command:cloneRuleset',
    /** @param {{mode: 'uniform'|'r_sym'|'n_count'|'totalistic', postMutationRate: number}} data - Breed from the genepool: recombine all worlds flagged `isParent` into every non-parent world. */
    COMMAND_BREED_WORLDS: 'command:breedWorlds',
    /** @event A user-initiated command to execute the genepool breed with the controller's current inheritance mode + offspring-mutation rate. */
    COMMAND_EXECUTE_BREED_WORLDS: 'command:executeBreedWorlds',
    /** @param {{worldIndex?: number}} data - Toggle a world's breeding-parent flag (defaults to the selected world). */
    COMMAND_TOGGLE_WORLD_PARENT: 'command:toggleWorldParent',
    /** @event Emitted with no payload to invert the ruleset of the selected world. */
    COMMAND_INVERT_RULESET: 'command:invertRuleset',
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
    /** @event Emitted with no payload to quick-export the selected world as a native-resolution PNG. */
    COMMAND_EXPORT_WORLD_PNG: 'command:exportWorldPng',
    /** @event No payload. If recording, stops & saves; otherwise opens the Capture Studio on the Video tab. */
    COMMAND_TOGGLE_WORLD_RECORDING: 'command:toggleWorldRecording',
    /** @param {{tab?: 'screenshot'|'video'}} [data] - Open the Capture Studio modal (optionally on a given tab). */
    COMMAND_SHOW_CAPTURE_STUDIO: 'command:showCaptureStudio',
    /** @event No payload. Quick-record toggle (hotkey): start with last-used settings, or stop & save if recording. */
    COMMAND_QUICK_TOGGLE_RECORDING: 'command:quickToggleRecording',
    /** @event No payload. Pause ⇄ resume the active recording (hotkey / HUD button). */
    COMMAND_TOGGLE_RECORDING_PAUSE: 'command:toggleRecordingPause',
    /** @param {{elapsedMs:number, frames:number|null, format:'webm'|'gif', estBytes:number, paused:boolean}} data - Live recording progress for the HUD. */
    CAPTURE_RECORDING_PROGRESS: 'simulation:captureRecordingProgress',
    /** @param {{worldIndex: number, col: number, row: number, brushSize: number}} data - Brush application details. */
    COMMAND_APPLY_BRUSH: 'command:applyBrush', 
    /** @param {{worldIndex: number, cellIndices: Set<number>}} data - A set of specific cell indices to toggle. */
    COMMAND_APPLY_SELECTIVE_BRUSH: 'command:applySelectiveBrush',
    /** @param {{worldIndex: number, dCol: number, dRow: number}} data - Toroidally shift a world's cell state by whole cells (wraps at the edges). dCol must be even to preserve the odd-q hex phase. */
    COMMAND_SHIFT_WORLD: 'command:shiftWorld',
    /** @param {{worldIndex: number, col: number, row: number}} data - The grid coordinates for the hover state. */
    COMMAND_SET_HOVER_STATE: 'command:setHoverState', 
    /** @param {{worldIndex: number}} data - The world index for which to clear the hover state. */
    COMMAND_CLEAR_HOVER_STATE: 'command:clearHoverState', 
    /** @param {{worldIndex: number, initialState: object}} data - The new initial state config for a specific world. */
    COMMAND_SET_WORLD_INITIAL_STATE: 'command:setWorldInitialState',
    /** @param {{worldIndex: number, isEnabled: boolean}} data - The new enabled state for a specific world. */
    COMMAND_SET_WORLD_ENABLED: 'command:setWorldEnabled',
    /** @event Emitted with no payload to toggle the selected world's ruleset lock (protects it from Generate/Mutate/Clone/Breed). */
    COMMAND_TOGGLE_WORLD_LOCK: 'command:toggleWorldLock',
    /** @param {{targetWorldIndex: number}} data - Copy the selected world's cell state (not ruleset) onto the target world. */
    COMMAND_COPY_WORLD_STATE: 'command:copyWorldState',
    /** @param {{assignScope: 'selected'|'all'|'none'}} data - Capture the selected world's current cells as a saved start, and assign it as the initial state of that world / all worlds / no world (library only). */
    COMMAND_CAPTURE_STATE_TO_LIBRARY: 'command:captureStateToLibrary',
    /** @param {object[]} entries - The full saved-starts library, after any add/rename/remove. */
    SAVED_STATES_CHANGED: 'savedStates:changed',
    /** @param {{enabled: boolean, rate: number}} data - New parameters for entropy sampling. */
    COMMAND_SET_ENTROPY_SAMPLING: 'command:setEntropySampling', 
    /** @param {number} newIndex - The index of the world to select. */
    COMMAND_SELECT_WORLD: 'command:selectWorld',
    /** @event Emitted with no payload to apply the selected world's initial state to all other worlds. */
    COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL: 'command:applySelectedInitialStateToAll',
    /** @event Emitted with no payload to reset all world initial states to their default values. */
    COMMAND_RESET_INITIAL_STATES_TO_DEFAULT: 'command:resetInitialStatesToDefault',
    /** @param {{panelName: string, shouldShow: boolean}} data - Command to show or hide a specific popout panel. */
    COMMAND_SHOW_POPOUT: 'command:showPopout',
    /** @param {{cells: Array<[number, number]>, originParity?: number}} data - The pattern data (relative cell coordinates) for placing mode; `originParity` preserves the hex column-stagger phase. */
    COMMAND_ENTER_PLACING_MODE: 'command:enterPlacingMode',
    /** @param {{indices: Set<number>}} data - The set of cell indices to show as a ghost preview. */
    COMMAND_UPDATE_GHOST_PREVIEW: 'command:updateGhostPreview',
    /** @event Emitted with no payload to clear any active ghost preview. */
    COMMAND_CLEAR_GHOST_PREVIEW: 'command:clearGhostPreview',
    /** @param {{mode?: 'save'|'copy'}} [data] - Enter select-region mode to capture a pattern from the selected world. `mode` 'save' (default) opens the save modal; 'copy' sets the pattern clipboard. */
    COMMAND_START_PATTERN_CAPTURE: 'command:startPatternCapture',
    /** @event Emitted with no payload to start a copy-region capture (clipboard). */
    COMMAND_COPY_PATTERN: 'command:copyPattern',
    /** @event Emitted with no payload to paste the pattern clipboard into placing mode. */
    COMMAND_PASTE_PATTERN: 'command:pastePattern',
    /** @param {{cells: Array<[number, number]>, originParity?: number}} data - Stores a captured pattern on the in-memory clipboard for pasting. */
    COMMAND_SET_PATTERN_CLIPBOARD: 'command:setPatternClipboard',
    /** @event Emitted with no payload to toggle between pan and draw interaction modes. */
    COMMAND_TOGGLE_INTERACTION_MODE: 'command:toggleInteractionMode',
    /** @event Emitted with no payload to trigger the share functionality. */
    COMMAND_SHARE_SETUP: 'command:shareSetup',
    /** @event Emitted with no payload: copy the selected world as a portable world code (WorldCodec) — grid + ruleset + exact cells + exact palette — for the Reddit/Devvit post. */
    COMMAND_COPY_WORLD_CODE: 'command:copyWorldCode',
    /** @param {string} mode - The new interaction mode ('pan', 'draw', 'place'). */
    COMMAND_SET_INTERACTION_MODE: 'command:setInteractionMode',
    /** @param {boolean} shouldPause - The desired pause-while-drawing state. */
    COMMAND_SET_PAUSE_WHILE_DRAWING: 'command:setPauseWhileDrawing',
    /** @param {string} type - The new visualization type ('binary', 'color'). */
    COMMAND_SET_VISUALIZATION_TYPE: 'command:setVisualizationType',
    /** @param {boolean} shouldShow - Whether to show the minimap overlays. */
    COMMAND_SET_SHOW_MINIMAP_OVERLAY: 'command:setShowMinimapOverlay',
    /** @param {boolean} shouldShow - Whether to show the per-minimap status badges (extinct/saturated/cycling). */
    COMMAND_SET_SHOW_STATUS_BADGES: 'command:setShowStatusBadges',
    /** @param {boolean} shouldShow - Whether to show the FPS/TPS performance telemetry tiles in the top bar. */
    COMMAND_SET_SHOW_PERFORMANCE: 'command:setShowPerformance',
    /** @event A user-initiated command to execute the generate ruleset action with the controller's current settings. */
    COMMAND_EXECUTE_GENERATE_RULESET: 'command:executeGenerateRuleset',
    /** @event A user-initiated command to execute the mutate ruleset action with the controller's current settings. */
    COMMAND_EXECUTE_MUTATE_RULESET: 'command:executeMutateRuleset',
    /** @event A user-initiated command to execute the clone and mutate action with the controller's current settings. */
    COMMAND_EXECUTE_CLONE_AND_MUTATE: 'command:executeCloneAndMutate',
    /** @param {{panelName: string, show?: boolean}} data - Command to show, hide, or toggle a draggable panel. */
    COMMAND_TOGGLE_PANEL: 'command:togglePanel',
    /** @param {{popoutName: string, show?: boolean}} data - Command to show, hide, or toggle a popout panel. */
    COMMAND_TOGGLE_POPOUT: 'command:togglePopout',
    /** @param {{viewName: string}} data - Command to switch to a specific full-screen mobile view. */
    COMMAND_SHOW_MOBILE_VIEW: 'command:showMobileView',
    /** @event Emitted with no payload to command all popout and draggable panels to hide. */
    COMMAND_HIDE_ALL_OVERLAYS: 'command:hideAllOverlays',
    /** @param {{show?: boolean}} [data] - Command to show, hide, or toggle the Ctrl/⌘-K command palette. */
    COMMAND_TOGGLE_COMMAND_PALETTE: 'command:toggleCommandPalette',

    
    /** @param {{scope: 'all'|'selected'}} data - The new scope from a UI component. */
    UI_RULESET_SCOPE_CHANGED: 'ui:rulesetScopeChanged', 
    /** @param {{scope: 'all'|'selected'}} data - The new scope from the editor panel's UI. */
    UI_EDITOR_RULESET_SCOPE_CHANGED: 'ui:editorRulesetScopeChanged', 
    /** @param {{value: string}} data - The changed value from the ruleset input field. */
    UI_RULESET_INPUT_CHANGED: 'ui:rulesetInputPopoutChanged',
    /** @param {'pan'|'draw'|'place'} mode - The new interaction mode. */
    INTERACTION_MODE_CHANGED: 'ui:interactionModeChanged',
    /** @param {'invert'|'draw'|'erase'} mode - The new brush mode. */
    BRUSH_MODE_CHANGED: 'ui:brushModeChanged',
    /** @param {{mode: 'desktop'|'mobile'}} data - The new UI mode. */
    UI_MODE_CHANGED: 'ui:modeChanged',
    /** @param {{activeView: string}} data - The name of the mobile view that became active. */
    MOBILE_VIEW_CHANGED: 'ui:mobileViewChanged',
    /** @event Emitted with no payload to command the FAB UI to re-render based on persisted settings. */
    COMMAND_UPDATE_FAB_UI: 'command:updateFabUI',
    /** @event Emitted with no payload when the ruleset visualization type (e.g., binary, color) changes. */
    RULESET_VISUALIZATION_CHANGED: 'ui:rulesetVisualizationChanged',
    /** @param {boolean} isDeterministic - The desired state for deterministic resets. */
    COMMAND_SET_DETERMINISTIC_RESET: 'command:setDeterministicReset',
    /** @param {{worldIndex: number, config: object}} data - Command to show the initial state config modal. */
    COMMAND_SHOW_INITIAL_STATE_MODAL: 'command:showInitialStateModal',
    /** @param {{tourName: string}} data - The name of the tour that was completed. */
    ONBOARDING_TOUR_ENDED: 'onboarding:tourEnded',
    /** @param {{view: object, viewType: string, viewName: string, contentComponent: object|null}} data - The view component that was shown. */
    VIEW_SHOWN: 'ui:viewShown',
    /** @param {{panel: object}} data - The popout panel that had an interaction. */
    POPOUT_INTERACTION: 'ui:popoutInteraction',
    /** @param {{hex: string, id?: string, name?: string, description?: string}} data - Command to show the save/edit ruleset modal. */
    COMMAND_SHOW_SAVE_RULESET_MODAL: 'command:showSaveRulesetModal',
    /** @param {{message: string, type: 'success'|'error'|'info', duration?: number}} data - Command to show a toast notification. */
    COMMAND_SHOW_TOAST: 'command:showToast',
    /** @param {{ruleset: object}} data - Fired when a user ruleset is successfully saved or updated. */
    USER_RULESET_SAVED: 'ui:userRulesetSaved',
    /** @event Fired when the user library is modified (add, delete, update). */
    USER_LIBRARY_CHANGED: 'ui:userLibraryChanged',
    /** @param {{cells: Array<[number, number]>, originParity?: number, name?: string}} data - Command to show the save-pattern modal with captured relative cell coordinates. */
    COMMAND_SHOW_SAVE_PATTERN_MODAL: 'command:showSavePatternModal',
    /** @event Fired when the user's saved patterns are modified (add, delete). */
    USER_PATTERNS_CHANGED: 'ui:userPatternsChanged',
    /** @param {{pattern: object}} data - Fired when a user pattern is successfully saved. */
    USER_PATTERN_SAVED: 'ui:userPatternSaved',
    /** @param {{title: string, message: string, onConfirm: function}} data - Command to show a confirmation dialog. */
    COMMAND_SHOW_CONFIRMATION: 'command:showConfirmation',
    /** @param {object} settings - The complete color settings object from the ColorController. */
    COLOR_SETTINGS_CHANGED: 'ui:colorSettingsChanged',
    /** @param {object|null} settings - Transient palette preview (Chroma Lab hover): a full color-settings object to render live WITHOUT persisting, or null to end the preview and re-apply the saved settings. Only the renderer listens; UI components keep reflecting the saved settings. */
    COLOR_PREVIEW_CHANGED: 'ui:colorPreviewChanged',
    /** @param {boolean} shouldShow - Whether to show the command toasts. */
    COMMAND_SET_SHOW_COMMAND_TOASTS: 'command:setShowCommandToasts',

    // --- Auto-explore (Phase 4) ---
    /** @param {Partial<import('../core/AutoExploreService.js').EXPLORE_CONFIG> & {baseSeed?: number}} [options] - Optional overrides (mutationRate, mutationMode, evalTicks, IC-suite knobs). `baseSeed` replays a prior search's exact trajectory (shared search links); omitted ⇒ a fresh random base seed. Starts the auto-explore generation loop seeded from the selected world's ruleset. */
    COMMAND_START_AUTO_EXPLORE: 'command:startAutoExplore',
    /** @param {{adopt?: boolean}} [data] - Stop the auto-explore loop and restore pre-explore worlds. When `adopt` is true, keep the current champion ruleset in the selected world instead of restoring it. */
    COMMAND_STOP_AUTO_EXPLORE: 'command:stopAutoExplore',
    /** @event Emitted with no payload to pause the auto-explore loop at the next generation boundary (no restore). */
    COMMAND_PAUSE_AUTO_EXPLORE: 'command:pauseAutoExplore',
    /** @event Emitted with no payload to resume a paused auto-explore loop. */
    COMMAND_RESUME_AUTO_EXPLORE: 'command:resumeAutoExplore',
    /** @event Emitted with no payload to clear the persisted auto-explore session gallery. */
    COMMAND_CLEAR_AUTO_EXPLORE_GALLERY: 'command:clearAutoExploreGallery',
    /** @param {{find: import('../core/analysis/BehaviorArchive.js').ArchiveEntry}} data - Apply a gallery find to the selected world: set its ruleset and reset with the find's winning IC + seed (reproduces the discovered behavior). Stops the explore loop first if running. */
    COMMAND_APPLY_EXPLORE_FIND: 'command:applyExploreFind',
    /** @param {{find: import('../core/analysis/BehaviorArchive.js').ArchiveEntry}} data - Re-evaluate a gallery find on the selected world over a confirmation-length burst and update its stored score. Only valid when no run is active. */
    COMMAND_RETEST_EXPLORE_FIND: 'command:retestExploreFind',
    /** @param {{phase: string, state: 'idle'|'running'|'paused', generation: number, championHex: string|null, gallerySize: number, bestScore?: number, bestHex?: string, bestComponents?: object|null, perWorldScores?: Array<{score:number, killed:boolean, killReason:string|null}|null>, selectedWorldIndex?: number, targetMode?: boolean}} data - Auto-explore loop progress (per generation + lifecycle transitions). In target mode (v3.2) `bestScore` is the best target-match cosine, not the statistical score. */
    EXPLORE_PROGRESS: 'explore:progress',
    /** @param {{find: import('../core/analysis/BehaviorArchive.js').ArchiveEntry|null, gallerySize: number, cleared?: boolean}} data - A new/improved gallery find was archived (or the gallery was cleared when `cleared` is true and `find` is null). */
    EXPLORE_FIND_ADDED: 'explore:findAdded',
    /** @param {{enabled: boolean}} data - Toggle the optional foundation-model (CLIP) perceptual auto-explore objective (v3.0). When enabled, the embedding model lazily loads in its own worker; the statistical objective is unchanged when disabled (default). */
    COMMAND_SET_EMBEDDING_ENABLED: 'command:setEmbeddingEnabled',
    /** @param {{modelId: string}} data - Switch the perceptual objective's CLIP checkpoint (v3.1; one of EmbeddingService's EMBEDDING_MODELS ids). Refused while a search is running; a switch replaces the model-specific perceptual archive (cells from different embedding spaces are not comparable). */
    COMMAND_SET_EMBEDDING_MODEL: 'command:setEmbeddingModel',
    /** @param {{prompt: string}} data - Set the supervised target-search prompt ("find life that looks like…", v3.2, ASAL). Persisted as the `exploreTargetPrompt` UI setting and read at the next Start (threaded into COMMAND_START_AUTO_EXPLORE options like `scoring`); empty ⇒ the statistical/open-ended pipeline unchanged. Target mode also requires the CLIP embedding objective to be enabled. */
    COMMAND_SET_EXPLORE_TARGET_PROMPT: 'command:setExploreTargetPrompt',
    /** @param {{status: 'disabled'|'loading'|'ready'|'error', message: string|null, enabled: boolean}} data - The perceptual-objective embedding provider changed status (toggled, model loading, ready, or degraded after a failure). */
    EMBEDDING_STATUS_CHANGED: 'explore:embeddingStatusChanged',
    /** @param {{count: number, winner: 'a'|'b'|'skip'}} data - A swipe-to-judge "which is more interesting?" vote was banked (PLAY-LAYER-PLAN §S). `count` is the new total banked vote count; surfaces use it to update their "N votes banked" chips and the refit affordance. */
    VOTE_RECORDED: 'explore:voteRecorded',
};
