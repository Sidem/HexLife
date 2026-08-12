import { EventBus, EVENTS } from './EventBus.js';
import * as PersistenceService from './PersistenceService.js';

const SETTINGS_KEY = 'spacetimeViewSettings';

export const SPACETIME_VIEW_DEFAULTS = Object.freeze({
    /**
     * How opaque one tick of history is. 0 makes the volume a solid — cheaper to draw, but then all
     * you can see is its silhouette, and the whole point of the mode is the structure *inside*.
     *
     * Note the cost runs the other way from intuition: a LOWER alpha is more expensive, because the
     * ray saturates later and keeps marching (measured 4.4 ms at 0.12 vs 3.8 ms at 0.15 — #40 §6).
     * The floor below is what keeps a user-chosen value from turning every ray into a full-depth
     * traversal; the plan's own worst case, an empty volume, sits at 5.3 ms.
     */
    layerAlpha: 0.12,
});

const clamp = (value, min, max, fallback) => {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, value))
        : fallback;
};

export function sanitizeSpacetimeViewSettings(settings = {}) {
    return {
        // 0 is a real, meaningful setting (fully solid); 1 is fully opaque per tick.
        layerAlpha: clamp(settings.layerAlpha, 0, 1, SPACETIME_VIEW_DEFAULTS.layerAlpha),
    };
}

let currentSettings = null;

export function getSpacetimeViewSettings() {
    if (!currentSettings) {
        currentSettings = sanitizeSpacetimeViewSettings(
            PersistenceService.loadUISetting(SETTINGS_KEY, SPACETIME_VIEW_DEFAULTS),
        );
    }
    return { ...currentSettings };
}

export function updateSpacetimeViewSettings(patch) {
    currentSettings = sanitizeSpacetimeViewSettings({
        ...getSpacetimeViewSettings(),
        ...patch,
    });
    PersistenceService.saveUISetting(SETTINGS_KEY, currentSettings);
    EventBus.dispatch(EVENTS.SPACETIME_SETTINGS_CHANGED, { ...currentSettings });
    return { ...currentSettings };
}
