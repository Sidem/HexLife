import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class ControlsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
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
                <div id="controls-brush-mode-mount"></div>
                <div id="controls-pause-while-drawing-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Visualization</h5>
                <div id="controls-ruleset-viz-mount"></div>
                <div id="controls-show-minimap-overlay-mount"></div>
                <div id="controls-show-cycle-indicator-mount"></div>
                <div id="controls-show-command-toasts-mount"></div>
            </div>
        `;

        const simController = this.appContext.simulationController;
        const brushController = this.appContext.brushController;
        const interactionController = this.appContext.interactionController;
        const vizController = this.appContext.visualizationController;

        new SliderComponent(this.element.querySelector(`#controls-speed-slider-mount`), {
            id: `controls-speed-slider`, 
            ...simController.getSpeedConfig(),
            value: simController.getSpeed(),
            showValue: true,
            onChange: (speed) => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, speed)
        });

        new SliderComponent(this.element.querySelector(`#controls-brush-slider-mount`), {
            id: `controls-brush-slider`, 
            ...brushController.getBrushConfig(),
            value: brushController.getBrushSize(),
            showValue: true,
            onChange: (size) => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, size)
        });

        new SwitchComponent(this.element.querySelector(`#controls-brush-mode-mount`), {
            type: 'radio',
            name: `controls-brush-mode`,
            label: 'Brush Mode:',
            initialValue: interactionController.getBrushMode(),
            items: [
                { value: 'invert', text: 'Invert' },
                { value: 'draw', text: 'Draw' },
                { value: 'erase', text: 'Erase' }
            ],
            onChange: (mode) => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_MODE, mode)
        });

        new SwitchComponent(this.element.querySelector(`#controls-pause-while-drawing-mount`), {
            type: 'checkbox',
            name: `controls-pause-while-drawing`, 
            initialValue: interactionController.getPauseWhileDrawing(),
            items: [{ value: 'pause', text: 'Pause While Drawing' }],
            onChange: (shouldPause) => EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_WHILE_DRAWING, shouldPause)
        });

        new SwitchComponent(this.element.querySelector(`#controls-ruleset-viz-mount`), {
            type: 'radio',
            name: `controls-ruleset-viz`, 
            label: 'Display Type:',
            initialValue: vizController.getVizType(),
            items: vizController.getVisualizationOptions(),
            onChange: (type) => EventBus.dispatch(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, type)
        });

        new SwitchComponent(this.element.querySelector(`#controls-show-minimap-overlay-mount`), {
            type: 'checkbox',
            name: `controls-show-minimap-overlay`, 
            initialValue: vizController.getShowMinimapOverlay(),
            items: [{ value: 'show', text: 'Show Minimap Overlays' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, shouldShow)
        });

        new SwitchComponent(this.element.querySelector(`#controls-show-cycle-indicator-mount`), {
            type: 'checkbox',
            name: `controls-show-cycle-indicator`, 
            initialValue: vizController.getShowCycleIndicator(),
            items: [{ value: 'show', text: 'Show Cycle Indicators' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_CYCLE_INDICATOR, shouldShow)
        });

        new SwitchComponent(this.element.querySelector(`#controls-show-command-toasts-mount`), {
            type: 'checkbox',
            name: `controls-show-command-toasts`,
            initialValue: vizController.getShowCommandToasts(),
            items: [{ value: 'show', text: 'Show Action Toasts' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_COMMAND_TOASTS, shouldShow)
        });
    }

    getElement() {
        return this.element;
    }
} 