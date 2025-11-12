import * as Config from '../core/config.js';

const LS_KEY_PREFIX = 'hexLifeExplorer_';
const KEYS = {
    RULESET: `${LS_KEY_PREFIX}ruleset`,
    WORLD_SETTINGS: `${LS_KEY_PREFIX}worldSettings`,
    SIM_SPEED: `${LS_KEY_PREFIX}simSpeed`,
    BRUSH_SIZE: `${LS_KEY_PREFIX}brushSize`,
    RULESET_PANEL_STATE: `${LS_KEY_PREFIX}rulesetPanelState`,
    SETUP_PANEL_STATE: `${LS_KEY_PREFIX}setupPanelState`,
    ANALYSIS_PANEL_STATE: `${LS_KEY_PREFIX}analysisPanelState`,
    RULERANK_PANEL_STATE: `${LS_KEY_PREFIX}ruleRankPanelState`,
    LEARNING_PANEL_STATE: `${LS_KEY_PREFIX}learningPanelState`,
    RULESETACTIONS_PANEL_STATE: `${LS_KEY_PREFIX}rulesetActionsPanelState`,
    WORLDSETUP_PANEL_STATE: `${LS_KEY_PREFIX}worldSetupPanelState`,
    CHROMALAB_PANEL_STATE: `${LS_KEY_PREFIX}chromaLabPanelState`,
    SHORTCUTS_PANEL_STATE: `${LS_KEY_PREFIX}shortcutsPanelState`,
    UI_SETTINGS: `${LS_KEY_PREFIX}uiSettings`,
    USER_RULESETS: `${LS_KEY_PREFIX}userRulesets`,
    FAB_SETTINGS: `${LS_KEY_PREFIX}fabSettings`,
    ONBOARDING_STATES: `${LS_KEY_PREFIX}onboardingStates`,
    COLOR_SETTINGS: `${LS_KEY_PREFIX}colorSettings`
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

// --- MODIFICATION START ---
// Helper function to migrate old color settings format to the new dual-color format.
function migrateColorGroups(colorGroups) {
    if (!colorGroups || typeof colorGroups !== 'object') {
        return {};
    }
    const migratedGroups = {};
    for (const key in colorGroups) {
        const value = colorGroups[key];
        if (typeof value === 'string') {
            // This is the old format. Convert it.
            // Use the old color for the 'on' state and a default dark color for 'off'.
            migratedGroups[key] = { on: value, off: '#333333' };
        } else if (typeof value === 'object' && value !== null && value.on && value.off) {
            // This is already the new format. Keep it.
            migratedGroups[key] = value;
        }
    }
    return migratedGroups;
}
// --- MODIFICATION END ---


export function loadRuleset() {
    return _getItem(KEYS.RULESET) || Config.INITIAL_RULESET_CODE;
}

export function saveRuleset(rulesetHex) {
    _setItem(KEYS.RULESET, rulesetHex);
}

export function loadWorldSettings() {
    const loaded = _getItem(KEYS.WORLD_SETTINGS);
    if (loaded && Array.isArray(loaded) && loaded.length === Config.NUM_WORLDS) {
        // --- MODIFICATION START ---
        const isValid = loaded.every(s =>
            (typeof s.initialDensity === 'number' || typeof s.initialState === 'object') &&
            typeof s.enabled === 'boolean' &&
            (typeof s.rulesetHex === 'string' && /^[0-9a-fA-F]{32}$/.test(s.rulesetHex))
        );

        if (isValid) {
            return loaded.map(s => {
                if (s.initialState) {
                    return s; // Already in new format
                }
                // Migration for old format
                return {
                    ...s,
                    initialState: {
                        mode: 'density',
                        params: { density: s.initialDensity }
                    }
                };
            });
        }
        // --- MODIFICATION END ---
        console.warn("Loaded world settings format error or missing rulesetHex, reverting to defaults.");
    }

    const defaultSettings = [];
    const defaultRuleset = loadRuleset() || "0".repeat(32);
    for (let i = 0; i < Config.NUM_WORLDS; i++) {
        defaultSettings.push({
            // --- MODIFICATION START ---
            initialState: {
                mode: 'density',
                params: { density: Config.DEFAULT_INITIAL_DENSITIES[i] ?? 0.5 }
            },
            // --- MODIFICATION END ---
            enabled: Config.DEFAULT_WORLD_ENABLED_STATES[i] ?? true,
            rulesetHex: defaultRuleset
        });
    }
    return defaultSettings;
}

export function saveWorldSettings(worldSettingsArray) {
    if (Array.isArray(worldSettingsArray) && worldSettingsArray.length === Config.NUM_WORLDS) {
        // --- MODIFICATION START ---
        const isValid = worldSettingsArray.every(s =>
            typeof s.initialState === 'object' &&
            typeof s.enabled === 'boolean' &&
            (typeof s.rulesetHex === 'string' && /^[0-9a-fA-F]{32}$/.test(s.rulesetHex))
        );
        if (isValid) {
            _setItem(KEYS.WORLD_SETTINGS, worldSettingsArray);
        } else {
            console.error("Attempted to save invalid world settings array format (incl. initialState).");
        }
        // --- MODIFICATION END ---
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
    if (state && typeof state.isOpen === 'boolean') {
        _setItem(keyToSave, {
            isOpen: state.isOpen,
            x: (typeof state.x === 'string' && state.x.endsWith('px')) ? state.x : null,
            y: (typeof state.y === 'string' && state.y.endsWith('px')) ? state.y : null,
        });
    } else {
        console.warn(`PersistenceService: Invalid state provided for panel "${panelKey}".`);
    }
}

export function loadUISetting(settingKey, defaultValue) {
    const allUISettings = _getItem(KEYS.UI_SETTINGS) || {};
    if (Object.prototype.hasOwnProperty.call(allUISettings, settingKey) && allUISettings[settingKey] !== undefined) {
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

export function loadOnboardingStates() {
    return _getItem(KEYS.ONBOARDING_STATES) || {};
}

export function saveOnboardingStates(statesObject) {
    _setItem(KEYS.ONBOARDING_STATES, statesObject);
}

export function loadUserRulesets() {
    return _getItem(KEYS.USER_RULESETS) || [];
}

export function saveUserRulesets(userRulesets) {
    _setItem(KEYS.USER_RULESETS, userRulesets);
}

export function loadColorSettings() {
    const defaults = {
        mode: 'preset',
        activePreset: 'default',
        customGradient: {
            on: ['#3cb44b', '#ffe119'],
            off: ['#1a4a23', '#665a0a']
        },
        customNeighborColors: Config.DEFAULT_COLOR_SCHEMES.customNeighborColors,
        customSymmetryColors: Config.DEFAULT_COLOR_SCHEMES.customSymmetryColors,
        flickerProofPresets: true
    };
    const loaded = _getItem(KEYS.COLOR_SETTINGS);
    
    if (loaded) {
        // Create a new object to ensure we don't mutate the defaults
        const migratedSettings = { ...defaults, ...loaded };

        // Run the migration function on the loaded custom color groups
        migratedSettings.customNeighborColors = migrateColorGroups(loaded.customNeighborColors);
        migratedSettings.customSymmetryColors = migrateColorGroups(loaded.customSymmetryColors);

        // Ensure gradient has the correct structure
        if (!migratedSettings.customGradient || !migratedSettings.customGradient.on) {
            migratedSettings.customGradient = defaults.customGradient;
        }
        
        // Ensure flickerProofPresets
        if (typeof loaded.flickerProofPresets !== 'boolean') {
            migratedSettings.flickerProofPresets = defaults.flickerProofPresets;
        }
        
        return migratedSettings;
    }
    
    return defaults;
}


export function saveColorSettings(settings) {
    _setItem(KEYS.COLOR_SETTINGS, settings);
}