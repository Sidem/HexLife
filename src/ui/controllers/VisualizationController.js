import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';

export class VisualizationController {
    constructor() {
        EventBus.subscribe(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, this.#handleSetVisualizationType);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, this.#handleSetShowMinimapOverlay);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_CYCLE_INDICATOR, this.#handleSetShowCycleIndicator);
    }

    getVizType = () => PersistenceService.loadUISetting('rulesetVizType', 'binary');
    getShowMinimapOverlay = () => PersistenceService.loadUISetting('showMinimapOverlay', true);
    getShowCycleIndicator = () => PersistenceService.loadUISetting('showCycleIndicator', true);

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

    #handleSetShowCycleIndicator = (shouldShow) => {
        PersistenceService.saveUISetting('showCycleIndicator', !!shouldShow);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED);
    }
} 