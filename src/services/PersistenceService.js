import * as Config from '../core/config.js';

const LS_KEY_PREFIX = 'hexLifeExplorer_';
const KEYS = {
    RULESET: `${LS_KEY_PREFIX}ruleset`,
    WORLD_SETTINGS: `${LS_KEY_PREFIX}worldSettings`,
    SIM_SPEED: `${LS_KEY_PREFIX}simSpeed`,
    BRUSH_SIZE: `${LS_KEY_PREFIX}brushSize`,
    RULESET_PANEL_STATE: `${LS_KEY_PREFIX}rulesetPanelState`, // Covers open/pos for Ruleset Editor
    SETUP_PANEL_STATE: `${LS_KEY_PREFIX}setupPanelState`,     // Covers open/pos for Setup Panel
    ANALYSIS_PANEL_STATE: `${LS_KEY_PREFIX}analysisPanelState`, // Covers open/pos for Analysis Panel
    UI_SETTINGS: `${LS_KEY_PREFIX}uiSettings` // General bucket for misc UI settings
};


function _getItem(key) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
    } catch (e) {
        console.error(`Error getting item ${key} from localStorage:`, e);
        return null;
    }
}


function _setItem(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error(`Error setting item ${key} in localStorage:`, e);
    }
}


export function loadRuleset() {
    return _getItem(KEYS.RULESET); 
}
export function saveRuleset(rulesetHex) {
    _setItem(KEYS.RULESET, rulesetHex);
}

export function loadWorldSettings() {
    const loaded = _getItem(KEYS.WORLD_SETTINGS);
    if (loaded && Array.isArray(loaded) && loaded.length === Config.NUM_WORLDS) {
        // Basic validation for each setting object
        const isValid = loaded.every(s => typeof s.initialDensity === 'number' && typeof s.enabled === 'boolean');
        if (isValid) return loaded;
        console.warn("Loaded world settings format error, reverting to defaults.");
    }
    
    const defaultSettings = [];
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        defaultSettings.push({
            initialDensity: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0.5, // Ensure fallback if arrays are misconfigured
            enabled: Config.DEFAULT_WORLD_ENABLED_STATES[i] ?? true
        });
    }
    return defaultSettings;
}
export function saveWorldSettings(worldSettingsArray) {
    if (Array.isArray(worldSettingsArray) && worldSettingsArray.length === Config.NUM_WORLDS) {
        const isValid = worldSettingsArray.every(s => typeof s.initialDensity === 'number' && typeof s.enabled === 'boolean');
        if (isValid) {
            _setItem(KEYS.WORLD_SETTINGS, worldSettingsArray);
        } else {
            console.error("Attempted to save invalid world settings array format.");
        }
    } else {
        console.error("Attempted to save world settings array with incorrect length or type.");
    }
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


export function loadPanelState(panelKey) { 
    const keyToLoad = KEYS[`${panelKey.toUpperCase()}_PANEL_STATE`];
    if (!keyToLoad) {
        console.warn(`PersistenceService: Unknown panel key "${panelKey}" for loadPanelState.`);
        return { isOpen: false, x: null, y: null }; 
    }
    const state = _getItem(keyToLoad);
    // Ensure basic structure
    if (state && typeof state.isOpen === 'boolean') {
        return {
            isOpen: state.isOpen,
            x: typeof state.x === 'string' ? state.x : null,
            y: typeof state.y === 'string' ? state.y : null,
        };
    }
    return { isOpen: false, x: null, y: null }; 
}

export function savePanelState(panelKey, state) { 
    const keyToSave = KEYS[`${panelKey.toUpperCase()}_PANEL_STATE`];
     if (!keyToSave) {
        console.warn(`PersistenceService: Unknown panel key "${panelKey}" for savePanelState.`);
        return;
    }
    // Basic validation of state before saving
    if (state && typeof state.isOpen === 'boolean') {
        _setItem(keyToSave, {
            isOpen: state.isOpen,
            x: typeof state.x === 'string' ? state.x : null,
            y: typeof state.y === 'string' ? state.y : null,
        });
    } else {
        console.warn(`PersistenceService: Invalid state provided for panel "${panelKey}".`);
    }
}


export function loadUISetting(settingKey, defaultValue) {
    const allUISettings = _getItem(KEYS.UI_SETTINGS) || {};
    if (allUISettings.hasOwnProperty(settingKey) && allUISettings[settingKey] !== undefined) {
        return allUISettings[settingKey];
    }
    return defaultValue;
}

export function saveUISetting(settingKey, value) {
    const allUISettings = _getItem(KEYS.UI_SETTINGS) || {};
    allUISettings[settingKey] = value;
    _setItem(KEYS.UI_SETTINGS, allUISettings);
}


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