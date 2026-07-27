import { EventBus, EVENTS } from './EventBus.js';
import * as PersistenceService from './PersistenceService.js';

const SETTINGS_KEY = 'torusViewSettings';

export const TORUS_VIEW_DEFAULTS = Object.freeze({
    offOpacity: 0.12,
    radiusRatio: 1.55,
    autoRotate: true,
    rotationSpeed: 14,
});

const clamp = (value, min, max, fallback) => {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, value))
        : fallback;
};

export function sanitizeTorusViewSettings(settings = {}) {
    return {
        offOpacity: clamp(settings.offOpacity, 0, 1, TORUS_VIEW_DEFAULTS.offOpacity),
        radiusRatio: clamp(settings.radiusRatio, 1.05, 3, TORUS_VIEW_DEFAULTS.radiusRatio),
        autoRotate: typeof settings.autoRotate === 'boolean'
            ? settings.autoRotate
            : TORUS_VIEW_DEFAULTS.autoRotate,
        rotationSpeed: clamp(settings.rotationSpeed, 1, 45, TORUS_VIEW_DEFAULTS.rotationSpeed),
    };
}

let currentSettings = null;

export function getTorusViewSettings() {
    if (!currentSettings) {
        currentSettings = sanitizeTorusViewSettings(
            PersistenceService.loadUISetting(SETTINGS_KEY, TORUS_VIEW_DEFAULTS),
        );
    }
    return { ...currentSettings };
}

export function updateTorusViewSettings(patch) {
    currentSettings = sanitizeTorusViewSettings({
        ...getTorusViewSettings(),
        ...patch,
    });
    PersistenceService.saveUISetting(SETTINGS_KEY, currentSettings);
    EventBus.dispatch(EVENTS.TORUS_SETTINGS_CHANGED, { ...currentSettings });
    return { ...currentSettings };
}
