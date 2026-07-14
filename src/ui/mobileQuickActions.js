import { EVENTS } from '../services/EventBus.js';
import { ICONS } from './icons.js';

/**
 * Single source of truth for the mobile "quick actions" (mobile redesign M2).
 * Formerly the left customizable FAB stack (UIManager.renderCustomFabs) and the
 * ToolsBottomSheet "Customize FABs" list maintained parallel arrays that drifted;
 * both now read this list. Each entry: id, icon, label, and the command/payload to
 * dispatch. Order here is the canonical order shown in the customize list.
 */
export const QUICK_ACTIONS = [
    { id: 'generate', icon: ICONS.sparkles, label: 'Generate', command: EVENTS.COMMAND_EXECUTE_GENERATE_RULESET, payload: {} },
    { id: 'mutate', icon: ICONS.shuffle, label: 'Mutate', command: EVENTS.COMMAND_EXECUTE_MUTATE_RULESET, payload: {} },
    { id: 'clone', icon: ICONS.copy, label: 'Clone', command: EVENTS.COMMAND_CLONE_RULESET, payload: {} },
    { id: 'clone-mutate', icon: ICONS.copyPlus, label: 'Clone & Mutate', command: EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE, payload: {} },
    { id: 'clear-one', icon: ICONS.eraser, label: 'Clear', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'selected' } },
    { id: 'clear-all', icon: ICONS.trash, label: 'Clear All', command: EVENTS.COMMAND_CLEAR_WORLDS, payload: { scope: 'all' } },
    { id: 'reset-one', icon: ICONS.rotateCcw, label: 'Reset', command: EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, payload: { scope: 'selected' } },
    { id: 'reset-all', icon: ICONS.refreshCw, label: 'Reset All', command: EVENTS.COMMAND_RESET_ALL_WORLDS_TO_INITIAL_DENSITIES, payload: {} },
    { id: 'reset-densities', icon: ICONS.droplet, label: 'Default Densities', command: EVENTS.COMMAND_RESET_INITIAL_STATES_TO_DEFAULT, payload: {} },
    { id: 'apply-density-all', icon: ICONS.target, label: 'Apply Density', command: EVENTS.COMMAND_APPLY_SELECTED_INITIAL_STATE_TO_ALL, payload: {} },
    { id: 'capture-start', icon: ICONS.save, label: 'Capture Start', command: EVENTS.COMMAND_CAPTURE_STATE_TO_LIBRARY, payload: { assignScope: 'selected' } },
];

export const DEFAULT_FAB_SETTINGS = { enabled: ['generate', 'clone-mutate', 'reset-all'], locked: true, order: [] };

export const QUICK_ACTION_MAP = Object.fromEntries(QUICK_ACTIONS.map(a => [a.id, a]));

/** Resolve persisted fabSettings to the ordered list of enabled action ids. */
export function getEnabledQuickActionIds(fabSettings = DEFAULT_FAB_SETTINGS) {
    const orderedIds = (fabSettings.order && fabSettings.order.length > 0) ? fabSettings.order : fabSettings.enabled;
    const enabledSet = new Set(fabSettings.enabled);
    return orderedIds.filter(id => enabledSet.has(id) && QUICK_ACTION_MAP[id]);
}
