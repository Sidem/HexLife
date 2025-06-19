import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class ControlsComponent extends BaseComponent {
    constructor(mountPoint, appContext, options = {}) {
        super(mountPoint, options);
        this.appContext = appContext;
        this.context = this.options.context || 'shared';
        this.element = document.createElement('div');
        this.element.className = 'controls-component-content';
        this.render();
    }

    render() {
        this.element.innerHTML = `
            <div class="tool-group">
                <h5>Speed</h5>
                <div id="${this.context}-speed-slider-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Brush Size</h5>
                <div id="${this.context}-brush-slider-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Interaction</h5>
                <div id="${this.context}-pause-while-drawing-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Visualization</h5>
                <div id="${this.context}-ruleset-viz-mount"></div>
                <div id="${this.context}-show-minimap-overlay-mount"></div>
                <div id="${this.context}-show-cycle-indicator-mount"></div>
            </div>
        `;

        const simController = this.appContext.simulationController;
        const brushController = this.appContext.brushController;
        const interactionController = this.appContext.interactionController;
        const vizController = this.appContext.visualizationController;

        new SliderComponent(this.element.querySelector(`#${this.context}-speed-slider-mount`), {
            id: `${this.context}-speed-slider`,
            ...simController.getSpeedConfig(),
            value: simController.getState().speed,
            showValue: true,
            onChange: (speed) => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, speed)
        });

        new SliderComponent(this.element.querySelector(`#${this.context}-brush-slider-mount`), {
            id: `${this.context}-brush-slider`,
            ...brushController.getBrushConfig(),
            value: brushController.getState().brushSize,
            showValue: true,
            onChange: (size) => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, size)
        });

        new SwitchComponent(this.element.querySelector(`#${this.context}-pause-while-drawing-mount`), {
            type: 'checkbox',
            name: `${this.context}-pause-while-drawing`,
            initialValue: interactionController.getState().pauseWhileDrawing,
            items: [{ value: 'pause', text: 'Pause While Drawing' }],
            onChange: (shouldPause) => EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_WHILE_DRAWING, shouldPause)
        });

        new SwitchComponent(this.element.querySelector(`#${this.context}-ruleset-viz-mount`), {
            type: 'radio',
            name: `${this.context}-ruleset-viz`,
            label: 'Display Type:',
            initialValue: vizController.getState().vizType,
            items: vizController.getVisualizationOptions(),
            onChange: (type) => EventBus.dispatch(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, type)
        });

        new SwitchComponent(this.element.querySelector(`#${this.context}-show-minimap-overlay-mount`), {
            type: 'checkbox',
            name: `${this.context}-show-minimap-overlay`,
            initialValue: vizController.getState().showMinimapOverlay,
            items: [{ value: 'show', text: 'Show Minimap Overlays' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, shouldShow)
        });

        new SwitchComponent(this.element.querySelector(`#${this.context}-show-cycle-indicator-mount`), {
            type: 'checkbox',
            name: `${this.context}-show-cycle-indicator`,
            initialValue: vizController.getState().showCycleIndicator,
            items: [{ value: 'show', text: 'Show Cycle Indicators' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_CYCLE_INDICATOR, shouldShow)
        });
        
        if (this.mountPoint) {
            this.mountPoint.appendChild(this.element);
        }
    }

    getElement() {
        return this.element;
    }
} 