import { ShareCodec } from './ShareCodec.js';

/**
 * A dedicated service to handle loading initial application settings from various sources.
 */
export class SettingsLoader {
    /**
     * Parses URL search parameters to construct a shared settings object.
     * If no parameters are present, returns an empty object.
     * This function also clears the URL parameters after parsing to provide a clean URL.
     *
     * The actual param→settings parsing lives in {@link ShareCodec.parseParams} (the
     * encode/decode counterpart of `generateShareUrl`); this method owns only the
     * window.location read and the history.replaceState clean-up side-effect.
     * @returns {object} The shared settings object derived from URL parameters.
     */
    static loadFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const sharedSettings = ShareCodec.parseParams(params);

        if (params.toString() !== '') {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
        return sharedSettings;
    }
}