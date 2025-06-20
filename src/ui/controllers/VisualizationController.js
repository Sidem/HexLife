import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';

export class VisualizationController {
    constructor() {
        this.state = {
            vizType: PersistenceService.loadUISetting('rulesetVizType', 'binary'),
            showMinimapOverlay: PersistenceService.loadUISetting('showMinimapOverlay', true),
            showCycleIndicator: PersistenceService.loadUISetting('showCycleIndicator', true),
        };
        // Subscribe to command events
        EventBus.subscribe(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, this.#handleSetVisualizationType);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, this.#handleSetShowMinimapOverlay);
        EventBus.subscribe(EVENTS.COMMAND_SET_SHOW_CYCLE_INDICATOR, this.#handleSetShowCycleIndicator);
        
        // Note: The visualizer singleton is now initialized by AppContext with the correct state
    }

    getState() {
        return { ...this.state };
    }

    getVisualizationOptions() {
        return [
            { value: 'binary', text: 'Binary' },
            { value: 'color', text: 'Color' }
        ];
    }

    #handleSetVisualizationType = (type) => {
        if (type !== 'binary' && type !== 'color') return;
        if (this.state.vizType === type) return;
        this.state.vizType = type;
        rulesetVisualizer.setVisualizationType(type);
        PersistenceService.saveUISetting('rulesetVizType', type);
        // The event dispatch is now handled by the visualizer's setVisualizationType method
    }

    #handleSetShowMinimapOverlay = (shouldShow) => {
        if (this.state.showMinimapOverlay === !!shouldShow) return;
        this.state.showMinimapOverlay = !!shouldShow;
        PersistenceService.saveUISetting('showMinimapOverlay', this.state.showMinimapOverlay);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED);
    }

    #handleSetShowCycleIndicator = (shouldShow) => {
        if (this.state.showCycleIndicator === !!shouldShow) return;
        this.state.showCycleIndicator = !!shouldShow;
        PersistenceService.saveUISetting('showCycleIndicator', this.state.showCycleIndicator);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED);
    }
} 