# HexLife Explorer - EventBus Payload Documentation

This document formalizes the data structures (payloads) for all events dispatched through the application's central `EventBus`. This serves as a critical reference for developers to ensure components communicate correctly.

### Event Naming Convention
- **`simulation:*`**: Reports a change in the state of one or more simulation worlds.
- **`command:*`**: Represents a user's intent to change the application state.
- **`ui:*`**: Signals a change in the UI's state itself.
- **`system:*`**: Relates to system-level operations like file I/O or rendering.

---

### Simulation State Events
*Events that report changes originating from the simulation core.*

| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `SIMULATION_PAUSED` | `isPaused: boolean` | Dispatched when the global simulation play/pause state changes. |
| `SIMULATION_SPEED_CHANGED` | `newSpeed: number` | Dispatched when the simulation speed target is updated. |
| `RULESET_CHANGED` | `rulesetHex: string` | Dispatched for the selected world when its ruleset changes. |
| `BRUSH_SIZE_CHANGED` | `newSize: number` | Dispatched when the user's drawing brush size is changed. |
| `SELECTED_WORLD_CHANGED`| `newIndex: number` | Dispatched when the user selects a different world as the main view. |
| `WORLD_STATS_UPDATED` | `{ worldIndex, tick, ... }` | Dispatched periodically with the latest stats for a specific world. |
| `ALL_WORLDS_RESET` | `(none)` | Dispatched when an action causes all worlds to be reset simultaneously. |
| `WORLD_SETTINGS_CHANGED`| `settings: Array<{...}>` | Dispatched when a world's persistent settings (density, etc.) change. |
| `ENTROPY_SAMPLING_CHANGED`| `{ enabled, rate }` | Dispatched when entropy sampling is enabled/disabled or the rate changes. |
| `PERFORMANCE_METRICS_UPDATED`| `{ fps, tps, targetTps }` | Dispatched periodically with rendering and simulation performance data. |
| `HISTORY_CHANGED` | `{ worldIndex: number }` | Dispatched when a world's ruleset history (undo/redo stack) is modified. |

---

### Command Events
*Events that represent a user's intent to perform an action.*

| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `COMMAND_TOGGLE_PAUSE` | `isPaused: boolean` | Command to toggle the global pause state. |
| `COMMAND_SET_SPEED` | `speed: number` | Command to set the global simulation speed. |
| `COMMAND_GENERATE_RANDOM_RULESET` | `{ bias, generationMode, ... }`| Command to generate a new, random ruleset. |
| `COMMAND_SET_RULESET` | `{ hexString, resetScope... }` | Command to apply a specific ruleset from a hex string. |
| `COMMAND_MUTATE_RULESET`| `{ mutationRate, scope, mode }` | Command to mutate the ruleset of the target scope. |
| `COMMAND_CLONE_AND_MUTATE` | `{ mutationRate, mode }` | Command to copy the selected ruleset and mutate each clone. |
| `COMMAND_UNDO_RULESET` | `{ worldIndex: number }` | Command to undo a ruleset change for a world. |
| `COMMAND_REDO_RULESET` | `{ worldIndex: number }` | Command to redo a ruleset change for a world. |
| `COMMAND_REVERT_TO_HISTORY_STATE` | `{ worldIndex, historyIndex }` | Command to jump to a specific point in a world's ruleset history. |
| `COMMAND_EDITOR_*` | `(various)` | Family of commands from the Ruleset Editor for fine-grained modifications. |
| `COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET` | `{ scope, copyPrimaryRuleset }` | Command to reset worlds, optionally copying the primary ruleset first. |
| `COMMAND_CLEAR_WORLDS` | `{ scope: 'all'\|'selected' }` | Command to clear all cells in the specified scope. |
| `COMMAND_SAVE_SELECTED_WORLD_STATE` | `(none)` | Command to trigger a file download of the selected world's state. |
| `COMMAND_LOAD_WORLD_STATE` | `{ worldIndex, loadedData }` | Command to load a world state from a JSON object. |
| `COMMAND_APPLY_SELECTIVE_BRUSH` | `{ worldIndex, cellIndices }` | Command to toggle the state of a specific set of cells. |
| `COMMAND_ENTER_PLACING_MODE` | `{ cells: Array<[x, y]> }` | Command to switch the input strategy to place a specific pattern. |

---

### UI & System Events
*Events related to UI state and system-level operations.*

| Event Name | Payload Structure | Description |
| :--- | :--- | :--- |
| `INTERACTION_MODE_CHANGED`| `mode: 'pan'\|'draw'\|'place'` | Signals a change between interaction modes. |
| `UI_MODE_CHANGED` | `{ mode: 'desktop'\|'mobile' }`| Signals a change between desktop and mobile UI layouts. |
| `MOBILE_VIEW_CHANGED` | `{ activeView: string }` | Signals that the active full-screen view on mobile has changed. |
| `WORKER_INITIALIZED` | `{ worldIndex: number }` | Fired when a worker signals it is ready. |
| `TRIGGER_DOWNLOAD` | `{ filename, content, mimeType }` | A generic command for the UI to trigger a file download. |