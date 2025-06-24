import * as Config from '../core/config.js';

/**
 * A dedicated service to handle loading initial application settings from various sources.
 */
export class SettingsLoader {
    /**
     * Parses URL search parameters to construct a shared settings object.
     * If no parameters are present, returns an empty object.
     * This function also clears the URL parameters after parsing to provide a clean URL.
     * @returns {object} The shared settings object derived from URL parameters.
     */
    static loadFromUrl() {
        const params = new URLSearchParams(window.location.search);
        if (params.toString() === '') return {};

        const sharedSettings = {
            fromUrl: true // Flag to indicate settings are from URL
        };

        // Rulesets
        if (params.has('r_all')) {
            sharedSettings.rulesets = params.get('r_all').split(',');
        } else if (params.has('r')) {
            const singleRuleset = params.get('r');
            if (/^[0-9a-fA-F]{32}$/.test(singleRuleset)) {
                sharedSettings.rulesetHex = singleRuleset;
            }
        }

        // Densities
        if (params.has('d')) {
            sharedSettings.densities = params.get('d').split(',').map(Number);
        }

        // Enabled Mask
        if (params.has('e')) {
            const enabledMask = parseInt(params.get('e'), 10);
            if (!isNaN(enabledMask)) {
                sharedSettings.enabledMask = enabledMask;
            }
        }

        // Selected World
        if (params.has('w')) {
            const worldIndex = parseInt(params.get('w'), 10);
            if (worldIndex >= 0 && worldIndex < Config.NUM_WORLDS) {
                sharedSettings.selectedWorldIndex = worldIndex;
            }
        }

        // Camera
        if (params.has('cam')) {
            const camParts = params.get('cam').split(',').map(Number);
            if (camParts.length === 3 && !camParts.some(isNaN)) {
                sharedSettings.camera = { x: camParts[0], y: camParts[1], zoom: camParts[2] };
            }
        }

        window.history.replaceState({}, document.title, window.location.pathname);
        return sharedSettings;
    }
} 