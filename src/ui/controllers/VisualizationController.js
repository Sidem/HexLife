import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { rulesetVisualizer } from '../../utils/rulesetVisualizer.js';

class VisualizationController {
    constructor() {
        this.state = {
            vizType: PersistenceService.loadUISetting('rulesetVizType', 'binary'),
            showMinimapOverlay: PersistenceService.loadUISetting('showMinimapOverlay', true),
            showCycleIndicator: PersistenceService.loadUISetting('showCycleIndicator', true),
        };
        // Ensure the visualizer singleton is in sync on startup
        rulesetVisualizer.setVisualizationType(this.state.vizType);
    }

    getState() {
        return { ...this.state };
    }

    setVisualizationType = (type) => {
        if (type !== 'binary' && type !== 'color') return;
        this.state.vizType = type;
        rulesetVisualizer.setVisualizationType(type); // Update the actual visualizer
        PersistenceService.saveUISetting('rulesetVizType', type);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED);
    }

    setShowMinimapOverlay = (shouldShow) => {
        this.state.showMinimapOverlay = !!shouldShow;
        PersistenceService.saveUISetting('showMinimapOverlay', this.state.showMinimapOverlay);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED); // This event triggers a redraw
    }

    setShowCycleIndicator = (shouldShow) => {
        this.state.showCycleIndicator = !!shouldShow;
        PersistenceService.saveUISetting('showCycleIndicator', this.state.showCycleIndicator);
        EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED); // Reuse this event to trigger a redraw
    }
}

export const visualizationController = new VisualizationController(); 