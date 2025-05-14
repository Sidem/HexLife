// src/services/PersistenceService.js
import * as Config from '../core/config.js';

const LS_KEY_PREFIX = 'hexLifeExplorer_';
const KEYS = {
    RULESET: `${LS_KEY_PREFIX}ruleset`,
    WORLD_SETTINGS: `${LS_KEY_PREFIX}worldSettings`,
    SIM_SPEED: `${LS_KEY_PREFIX}simSpeed`,
    BRUSH_SIZE: `${LS_KEY_PREFIX}brushSize`,
    RULESET_PANEL_STATE: `${LS_KEY_PREFIX}rulesetPanelState`,
    SETUP_PANEL_STATE: `${LS_KEY_PREFIX}setupPanelState`,
    ANALYSIS_PANEL_STATE: `${LS_KEY_PREFIX}analysisPanelState`, // Added for consistency
    UI_SETTINGS: `${LS_KEY_PREFIX}uiSettings` // For other general UI toggles
};

// Helper function to get an item from localStorage
function _getItem(key) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    } catch (e) {
        console.error(`Error getting item ${key} from localStorage:`, e);
        return null;
    }
}

// Helper function to set an item in localStorage
function _setItem(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error(`Error setting item ${key} in localStorage:`, e);
    }
}

// --- Simulation Settings ---
export function loadRuleset() {
    return _getItem(KEYS.RULESET); // Returns hex string or null
}
export function saveRuleset(rulesetHex) {
    _setItem(KEYS.RULESET, rulesetHex);
}

export function loadWorldSettings() {
    const loaded = _getItem(KEYS.WORLD_SETTINGS);
    if (loaded && Array.isArray(loaded) && loaded.length === Config.NUM_WORLDS) {
        return loaded;
    }
    // Return default structure if not found or invalid
    const defaultSettings = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        defaultSettings.push({
            initialDensity: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0,
            enabled: Config.DEFAULT_WORLD_ENABLED_STATES[i] ?? true
        });
    }
    return defaultSettings;
}
export function saveWorldSettings(worldSettingsArray) {
    _setItem(KEYS.WORLD_SETTINGS, worldSettingsArray);
}

export function loadSimSpeed() {
    const speed = _getItem(KEYS.SIM_SPEED);
    return typeof speed === 'number' ? speed : Config.DEFAULT_SPEED;
}
export function saveSimSpeed(speed) {
    _setItem(KEYS.SIM_SPEED, speed);
}

export function loadBrushSize() {
    const size = _getItem(KEYS.BRUSH_SIZE);
    return typeof size === 'number' ? size : Config.DEFAULT_NEIGHBORHOOD_SIZE;
}
export function saveBrushSize(size) {
    _setItem(KEYS.BRUSH_SIZE, size);
}

// --- UI Panel States ---
export function loadPanelState(panelKey) { // panelKey will be 'ruleset', 'setup', 'analysis'
    const key = KEYS[`${panelKey.toUpperCase()}_PANEL_STATE`];
    if (!key) {
        console.warn(`PersistenceService: Unknown panel key "${panelKey}" for loadPanelState.`);
        return { isOpen: false, x: null, y: null }; // Default safe state
    }
    const state = _getItem(key);
    return state || { isOpen: false, x: null, y: null }; // Ensure a default object is returned
}

export function savePanelState(panelKey, state) { // state = { isOpen, x, y }
    const key = KEYS[`${panelKey.toUpperCase()}_PANEL_STATE`];
     if (!key) {
        console.warn(`PersistenceService: Unknown panel key "${panelKey}" for savePanelState.`);
        return;
    }
    _setItem(key, state);
}

// --- General UI Settings (like checkboxes, bias) ---
export function loadUISetting(settingKey, defaultValue) {
    const allUISettings = _getItem(KEYS.UI_SETTINGS) || {};
    if (allUISettings[settingKey] !== undefined) {
        return allUISettings[settingKey];
    }
    return defaultValue;
}

export function saveUISetting(settingKey, value) {
    const allUISettings = _getItem(KEYS.UI_SETTINGS) || {};
    allUISettings[settingKey] = value;
    _setItem(KEYS.UI_SETTINGS, allUISettings);
}

// Function to clear all application-specific localStorage items (for debugging/reset)
export function clearAllAppSettings() {
    console.log("Clearing all HexLife Explorer application settings from localStorage...");
    Object.values(KEYS).forEach(key => {
        try {
            localStorage.removeItem(key);
            console.log(`Removed ${key}`);
        } catch (e) {
            console.error(`Error removing item ${key} from localStorage:`, e);
        }
    });
    console.log("All application settings cleared.");
} 