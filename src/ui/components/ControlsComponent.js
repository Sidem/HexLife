import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class ControlsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options); // No mountPoint
        this.appContext = appContext;
        // No more this.context
        this.element = document.createElement('div');
        this.element.className = 'controls-component-content';
        this.render();
    }

    render() {
        this.element.innerHTML = `
            <div class="tool-group">
                <h5>Speed</h5>
                <div id="controls-speed-slider-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Brush Size</h5>
                <div id="controls-brush-slider-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Interaction</h5>
                <div id="controls-pause-while-drawing-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Visualization</h5>
                <div id="controls-ruleset-viz-mount"></div>
                <div id="controls-show-minimap-overlay-mount"></div>
                <div id="controls-show-cycle-indicator-mount"></div>
            </div>
        `;

        const simController = this.appContext.simulationController;
        const brushController = this.appContext.brushController;
        const interactionController = this.appContext.interactionController;
        const vizController = this.appContext.visualizationController;

        new SliderComponent(this.element.querySelector(`#controls-speed-slider-mount`), {
            id: `controls-speed-slider`, // Static ID
            ...simController.getSpeedConfig(),
            value: simController.getState().speed,
            showValue: true,
            onChange: (speed) => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, speed)
        });

        new SliderComponent(this.element.querySelector(`#controls-brush-slider-mount`), {
            id: `controls-brush-slider`, // Static ID
            ...brushController.getBrushConfig(),
            value: brushController.getState().brushSize,
            showValue: true,
            onChange: (size) => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, size)
        });

        new SwitchComponent(this.element.querySelector(`#controls-pause-while-drawing-mount`), {
            type: 'checkbox',
            name: `controls-pause-while-drawing`, // Static name
            initialValue: interactionController.getState().pauseWhileDrawing,
            items: [{ value: 'pause', text: 'Pause While Drawing' }],
            onChange: (shouldPause) => EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_WHILE_DRAWING, shouldPause)
        });

        new SwitchComponent(this.element.querySelector(`#controls-ruleset-viz-mount`), {
            type: 'radio',
            name: `controls-ruleset-viz`, // Static name
            label: 'Display Type:',
            initialValue: vizController.getState().vizType,
            items: vizController.getVisualizationOptions(),
            onChange: (type) => EventBus.dispatch(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, type)
        });

        new SwitchComponent(this.element.querySelector(`#controls-show-minimap-overlay-mount`), {
            type: 'checkbox',
            name: `controls-show-minimap-overlay`, // Static name
            initialValue: vizController.getState().showMinimapOverlay,
            items: [{ value: 'show', text: 'Show Minimap Overlays' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, shouldShow)
        });

        new SwitchComponent(this.element.querySelector(`#controls-show-cycle-indicator-mount`), {
            type: 'checkbox',
            name: `controls-show-cycle-indicator`, // Static name
            initialValue: vizController.getState().showCycleIndicator,
            items: [{ value: 'show', text: 'Show Cycle Indicators' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_CYCLE_INDICATOR, shouldShow)
        });
    }

    getElement() {
        return this.element;
    }
} 