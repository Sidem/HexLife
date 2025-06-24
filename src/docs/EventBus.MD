# HexLife Explorer - EventBus Payload Documentation

This document formalizes the data structures (payloads) for all events dispatched through the application's central `EventBus`. This serves as a critical reference for developers to ensure components communicate correctly.

### Event Naming Convention

  - **`simulation:*`**: Reports a change in the state of one or more simulation worlds.
  - **`command:*`**: Represents a user's intent to change the application state.
  - **`ui:*`**: Signals a change in the UI's state itself.
  - **`system:*`**: Relates to system-level operations like file I/O or rendering.
  - **`onboarding:*`**: Relates to the interactive tour system.

-----

### Simulation State Events (`simulation:*`)

*Events that report changes originating from the simulation core.*

| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `SIMULATION_PAUSED` | `isPaused: boolean` | Dispatched when the global simulation play/pause state changes. |
| `SIMULATION_SPEED_CHANGED` | `newSpeed: number` | Dispatched when the simulation speed target is updated. |
| `RULESET_CHANGED` | `rulesetHex: string` | Dispatched for the selected world when its ruleset changes. |
| `BRUSH_SIZE_CHANGED` | `newSize: number` | Dispatched when the user's drawing brush size is changed. |
| `SELECTED_WORLD_CHANGED`| `newIndex: number` | Dispatched when the user selects a different world as the main view. |
| `WORLD_STATS_UPDATED` | `{ worldIndex, tick, ratio, ... }` | Dispatched periodically with the latest stats for a specific world. |
| `ALL_WORLDS_RESET` | `(none)` | Dispatched when an action causes all worlds to be reset simultaneously. |
| `WORLD_SETTINGS_CHANGED`| `settings: Array<{...}>` | Dispatched when a world's persistent settings (density, etc.) change. |
| `ENTROPY_SAMPLING_CHANGED`| `{ enabled, rate }` | Dispatched when entropy sampling is enabled/disabled or the rate changes. |
| `PERFORMANCE_METRICS_UPDATED`| `{ fps, tps, targetTps }` | Dispatched periodically with rendering and simulation performance data. |
| `HISTORY_CHANGED` | `{ worldIndex: number }` | Dispatched when a world's ruleset history (undo/redo stack) is modified. |

-----

### Command Events (`command:*`)

*Events that represent a user's intent to perform an action.*

| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `COMMAND_TOGGLE_PAUSE` | `(none)` | Command to toggle the global pause state. |
| `COMMAND_SET_PAUSE_STATE` | `isPaused: boolean` | Command to explicitly set the global pause state. |
| `COMMAND_SET_SPEED` | `speed: number` | Command to set the global simulation speed. |
| `COMMAND_GENERATE_RANDOM_RULESET` | `{ bias, generationMode, ... }`| Command to generate a new, random ruleset. |
| `COMMAND_EXECUTE_GENERATE_RULESET` | `(none)` | User-initiated command to execute the generate ruleset action with the controller's current settings. |
| `COMMAND_SET_RULESET` | `{ hexString, resetScope... }` | Command to apply a specific ruleset from a hex string. |
| `COMMAND_MUTATE_RULESET`| `{ mutationRate, scope, mode }` | Command to mutate the ruleset of the target scope. |
| `COMMAND_EXECUTE_MUTATE_RULESET` | `(none)` | User-initiated command to execute the mutate ruleset action with the controller's current settings. |
| `COMMAND_CLONE_AND_MUTATE` | `{ mutationRate, mode }` | Command to copy the selected ruleset and mutate each clone. |
| `COMMAND_EXECUTE_CLONE_AND_MUTATE` | `(none)` | User-initiated command to execute the clone and mutate action with the controller's current settings. |
| `COMMAND_CLONE_RULESET` | `(none)` | Command to clone the selected world's ruleset to all other worlds. |
| `COMMAND_INVERT_RULESET` | `(none)` | Command to invert the ruleset of the selected world. |
| `COMMAND_UNDO_RULESET` | `{ worldIndex: number }` | Command to undo a ruleset change for a world. |
| `COMMAND_REDO_RULESET` | `{ worldIndex: number }` | Command to redo a ruleset change for a world. |
| `COMMAND_REVERT_TO_HISTORY_STATE` | `{ worldIndex, historyIndex }` | Command to jump to a specific point in a world's ruleset history. |
| `COMMAND_EDITOR_*` | `(various)` | Family of commands from the Ruleset Editor for fine-grained modifications. |
| `COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES` | `(none)` | Command to reset all worlds to their configured initial densities. |
| `COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET` | `{ scope, copyPrimaryRuleset }` | Command to reset worlds, optionally copying the primary ruleset first. |
| `COMMAND_CLEAR_WORLDS` | `{ scope: 'all'\|'selected' }` | Command to clear all cells in the specified scope. |
| `COMMAND_SAVE_SELECTED_WORLD_STATE` | `(none)` | Command to trigger a file download of the selected world's state. |
| `COMMAND_LOAD_WORLD_STATE` | `{ worldIndex, loadedData }` | Command to load a world state from a JSON object. |
| `COMMAND_APPLY_SELECTIVE_BRUSH` | `{ worldIndex, cellIndices }` | Command to toggle the state of a specific set of cells. |
| `COMMAND_ENTER_PLACING_MODE` | `{ cells: Array<[x, y]> }` | Command to switch the input strategy to place a specific pattern. |
| `COMMAND_UPDATE_GHOST_PREVIEW` | `{ indices: Set<number> }` | Command to show a ghost preview for pattern placement. |
| `COMMAND_CLEAR_GHOST_PREVIEW` | `(none)` | Command to clear any active ghost preview. |
| `COMMAND_TOGGLE_INTERACTION_MODE` | `(none)` | Command to toggle between pan and draw interaction modes. |
| `COMMAND_SET_INTERACTION_MODE` | `mode: 'pan'\|'draw'\|'place'` | Command to explicitly set the interaction mode. |
| `COMMAND_SET_PAUSE_WHILE_DRAWING` | `shouldPause: boolean` | Command to set the pause-while-drawing preference. |
| `COMMAND_SET_VISUALIZATION_TYPE` | `type: string` | Command to set the visualization type ('binary', 'color'). |
| `COMMAND_SET_SHOW_MINIMAP_OVERLAY` | `shouldShow: boolean` | Command to show/hide minimap overlays. |
| `COMMAND_SET_SHOW_CYCLE_INDICATOR` | `shouldShow: boolean` | Command to show/hide cycle indicators. |
| `COMMAND_TOGGLE_PANEL` | `{ panelName, show? }` | Command to show, hide, or toggle a draggable panel. |
| `COMMAND_TOGGLE_POPOUT` | `{ popoutName, show? }` | Command to show, hide, or toggle a popout panel. |
| `COMMAND_SHOW_MOBILE_VIEW` | `{ viewName }` | Command to switch to a specific full-screen mobile view. |
| `COMMAND_HIDE_ALL_OVERLAYS` | `(none)` | Command to hide all transient UI overlays (popouts, panels). |
| `COMMAND_SHARE_SETUP` | `(none)` | Command to trigger the share functionality. |

-----

### UI & System Events (`ui:*, system:*, renderer:*, onboarding:*`)

*Events related to UI state, system-level operations, and interactive tours.*

| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `INTERACTION_MODE_CHANGED`| `mode: 'pan'\|'draw'\|'place'` | Signals a change between interaction modes. |
| `BRUSH_MODE_CHANGED` | `mode: 'invert'\|'draw'\|'erase'` | Signals that the brush's logical mode has changed. |
| `UI_MODE_CHANGED` | `{ mode: 'desktop'\|'mobile' }`| Signals a change between desktop and mobile UI layouts. |
| `MOBILE_VIEW_CHANGED` | `{ activeView: string }` | Signals that the active full-screen view on mobile has changed. |
| `VIEW_SHOWN` | `{ view, viewType, contentComponent }` | Fired when a Panel view becomes visible, used for component reparenting. |
| `POPOUT_INTERACTION` | `{ panel: object }` | Fired when a popout panel is interacted with, used to close other popouts. |
| `SYSTEM:TRIGGER_DOWNLOAD` | `{ filename, content, mimeType }` | A generic command for the UI to trigger a file download. |
| `SYSTEM:TRIGGER_FILE_LOAD` | `{ file: File }` | Command to trigger loading a user-provided file. |
| `SYSTEM:WORKER_INITIALIZED` | `{ worldIndex: number }` | Fired when a worker signals it is ready. |
| `LAYOUT_UPDATED` | `{ selectedView: object, miniMap: object }` | Dispatched by the renderer when the main canvas view layout is calculated or recalculated. |
| `ONBOARDING:TOUR_ENDED` | `{ tourName: string }` | Fired when an interactive tour is completed or skipped. |

-----