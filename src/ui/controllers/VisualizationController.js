import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';

export class VisualizationController {
    constructor() {
        EventBus.subscribe(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, this.#handleSetVisualizationType);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, this.#handleSetShowMinimapOverlay);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_STATUS_BADGES, this.#handleSetShowStatusBadges);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_COMMAND_TOASTS, this.#handleSetShowCommandToasts);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_PERFORMANCE, this.#handleSetShowPerformance);
    }

    getVizType = () => PersistenceService.loadUISetting('rulesetVizType', 'binary');
    getShowMinimapOverlay = () => PersistenceService.loadUISetting('showMinimapOverlay', true);
    getShowStatusBadges = () => PersistenceService.loadUISetting('showStatusBadges', true);
    getShowCommandToasts = () => PersistenceService.loadUISetting('showCommandToasts', true);
    // FPS/TPS telemetry defaults to visible (matches pre-Settings behaviour).
    getShowPerformance = () => PersistenceService.loadUISetting('showPerformance', true);

    getVisualizationOptions() {
        return [
            { value: 'binary', text: 'Binary' },
            { value: 'color', text: 'Color' }
        ];
    }

    #handleSetVisualizationType = (type) => {
        if (type !== 'binary' && type !== 'color') return;
        rulesetVisualizer.setVisualizationType(type);
        PersistenceService.saveUISetting('rulesetVizType', type);
    }

    #handleSetShowMinimapOverlay = (shouldShow) => {
        PersistenceService.saveUISetting('showMinimapOverlay', !!shouldShow);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED);
    }

    #handleSetShowStatusBadges = (shouldShow) => {
        PersistenceService.saveUISetting('showStatusBadges', !!shouldShow);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED);
    }

    #handleSetShowCommandToasts = (shouldShow) => {
        PersistenceService.saveUISetting('showCommandToasts', !!shouldShow);
    }

    #handleSetShowPerformance = (shouldShow) => {
        PersistenceService.saveUISetting('showPerformance', !!shouldShow);
    }
} 