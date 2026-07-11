import * as Config from '../core/config.js';

/**
 * Share-link codec: encodes a world-settings snapshot into a shareable URL and
 * parses the same URL params back into a `sharedSettings` object.
 *
 * `encode` and `parseParams` are pure (no window access) so they unit-test in node
 * and round-trip against each other. WorldManager.generateShareUrl delegates to
 * `encode`; SettingsLoader.loadFromUrl reads window.location, calls `parseParams`,
 * then performs the history.replaceState side-effect.
 */
export class ShareCodec {
    /**
     * Build a shareable URL from a plain snapshot of the current configuration.
     * @param {object} snapshot
     * @param {Array<{rulesetHex: string, initialState: object, enabled: boolean}>} snapshot.worldSettings
     * @param {number} snapshot.selectedWorldIndex
     * @param {{x: number, y: number, zoom: number}} snapshot.camera
     * @param {number} snapshot.gridRows - Current grid row count.
     * @param {string} snapshot.origin - e.g. window.location.origin
     * @param {string} snapshot.pathname - e.g. window.location.pathname
     * @param {boolean} [snapshot.includeWorldState=true] - When false, encode only the
     *   ruleset(s) and omit the per-world state (initial states, enabled mask, selection,
     *   grid size, camera) so the link stays short. Defaults to true (full setup).
     * @returns {string} Full shareable URL.
     */
    static encode({ worldSettings, selectedWorldIndex, camera, gridRows, origin, pathname, includeWorldState = true }) {
        const params = new URLSearchParams();

        const allRulesets = worldSettings.map(ws => ws.rulesetHex);
        const uniqueRulesets = [...new Set(allRulesets)];
        if (uniqueRulesets.length === 1) {
            params.set('r', uniqueRulesets[0]);
        } else {
            params.set('r_all', allRulesets.join(','));
        }

        // Ruleset-only links stop here — everything below describes the world state.
        if (!includeWorldState) {
            return `${origin}${pathname}?${params.toString()}`;
        }

        // Handle initial states - check if all are simple density mode for backward compatibility
        const initialStates = worldSettings.map(ws => ws.initialState);
        const allDensityMode = initialStates.every(state => state && state.mode === 'density');

        if (allDensityMode) {
            // Use compact density format for backward compatibility
            const densities = initialStates.map(state => state.params.density);
            const defaultDensities = Config.DEFAULT_INITIAL_DENSITIES.slice(0, Config.NUM_WORLDS);

            // Only include if different from default
            if (JSON.stringify(densities) !== JSON.stringify(defaultDensities)) {
                params.set('d', densities.map(d => d.toFixed(3)).join(','));
            }
        } else {
            // Use full initial state format for complex configurations
            try {
                const statesJson = JSON.stringify(initialStates);
                params.set('is', encodeURIComponent(statesJson));
            } catch (e) {
                console.error('Failed to encode initial states for URL:', e);
                // Fallback to density-only format
                const densities = initialStates.map(state =>
                    state && state.mode === 'density' ? state.params.density : 0.5
                );
                params.set('d', densities.map(d => d.toFixed(3)).join(','));
            }
        }

        let enabledMask = 0;
        worldSettings.forEach((ws, i) => {
            if (ws.enabled) {
                enabledMask |= (1 << i);
            }
        });
        if (enabledMask !== 0b111111111) {
            params.set('e', enabledMask);
        }

        if (selectedWorldIndex !== Config.DEFAULT_SELECTED_WORLD_INDEX) {
            params.set('w', selectedWorldIndex);
        }

        // Grid size (only when it differs from the default preset).
        if (gridRows !== Config.GRID_SIZE_PRESETS[Config.DEFAULT_GRID_SIZE_KEY]) {
            params.set('g', gridRows);
        }

        if (camera && (camera.zoom !== 1.0 || camera.x !== Config.RENDER_TEXTURE_SIZE / 2 || camera.y !== Config.RENDER_TEXTURE_SIZE / 2)) {
            params.set('cam', `${parseFloat(camera.x.toFixed(1))},${parseFloat(camera.y.toFixed(1))},${parseFloat(camera.zoom.toFixed(2))}`);
        }

        return `${origin}${pathname}?${params.toString()}`;
    }

    /**
     * Build a shareable auto-explore SEARCH link: replays the identical search trajectory (same
     * champions, mutants, finds) on another machine. The starting ruleset rides in the standard `r`
     * param so the normal load path applies it to the worlds; `xs` carries the run's base seed and
     * `xc` the explore-config subset that shapes the trajectory. Grid size is included (as the
     * standard `g` param) when it differs from the default, since seeds are grid-dependent.
     * @param {object} descriptor
     * @param {number} descriptor.baseSeed - The run's base seed (AutoExploreService._exploreBaseSeed).
     * @param {string} descriptor.seedHex - 32-char ruleset hex the search started from.
     * @param {object} [descriptor.config] - Explore-config subset (mutationRate, mutationMode,
     *   evalTicks, maxGenerations, icLabels).
     * @param {number} [descriptor.gridRows] - Current grid row count.
     * @param {string} descriptor.origin
     * @param {string} descriptor.pathname
     * @returns {string} Full shareable URL.
     */
    static encodeSearch({ baseSeed, seedHex, config, gridRows, origin, pathname }) {
        const params = new URLSearchParams();
        if (/^[0-9a-fA-F]{32}$/.test(seedHex || '')) {
            params.set('r', seedHex);
        }
        params.set('xs', String(Math.floor(baseSeed)));
        if (config && typeof config === 'object') {
            params.set('xc', JSON.stringify(config));
        }
        if (gridRows && gridRows !== Config.GRID_SIZE_PRESETS[Config.DEFAULT_GRID_SIZE_KEY]) {
            params.set('g', gridRows);
        }
        return `${origin}${pathname}?${params.toString()}`;
    }

    /**
     * Parse URL search params into a `sharedSettings` object. Pure: takes a
     * `URLSearchParams` (no window access). Returns `{}` for an empty param set.
     * @param {URLSearchParams} params
     * @returns {object} sharedSettings
     */
    static parseParams(params) {
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

        // Initial States - new format with full cluster support
        if (params.has('is')) {
            try {
                const initialStatesJson = decodeURIComponent(params.get('is'));
                const initialStates = JSON.parse(initialStatesJson);
                if (Array.isArray(initialStates) && initialStates.length === Config.NUM_WORLDS) {
                    sharedSettings.initialStates = initialStates;
                }
            } catch (e) {
                console.warn('Failed to parse initial states from URL:', e);
            }
        }
        // Backward compatibility: Densities (old format)
        else if (params.has('d')) {
            const densities = params.get('d').split(',').map(Number);
            if (densities.length === Config.NUM_WORLDS && densities.every(d => !isNaN(d))) {
                sharedSettings.densities = densities;
            }
        }

        // Grid size (row count). Columns are derived from this on load.
        if (params.has('g')) {
            const gridRows = parseInt(params.get('g'), 10);
            if (!isNaN(gridRows) && gridRows >= 16 && gridRows <= 2048) {
                sharedSettings.gridRows = gridRows;
            }
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

        // Auto-explore search replay descriptor (see encodeSearch): xs = base seed, xc = explore
        // config subset. The starting ruleset rides in the standard `r` param, parsed above.
        if (params.has('xs')) {
            const baseSeed = parseInt(params.get('xs'), 10);
            if (Number.isFinite(baseSeed)) {
                const search = { baseSeed };
                if (sharedSettings.rulesetHex) search.seedHex = sharedSettings.rulesetHex;
                if (params.has('xc')) {
                    try {
                        const config = JSON.parse(params.get('xc'));
                        if (config && typeof config === 'object') search.config = config;
                    } catch (e) {
                        console.warn('Failed to parse explore search config from URL:', e);
                    }
                }
                sharedSettings.exploreSearch = search;
            }
        }

        return sharedSettings;
    }
}
