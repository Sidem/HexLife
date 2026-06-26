import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { ToggleSwitch } from './ToggleSwitch.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { ICONS } from '../icons.js';

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
            <section class="control-section">
                <h5 class="control-section-title">Simulation</h5>
                <div class="control-field">
                    <span class="control-field-label">Speed</span>
                    <div id="controls-speed-slider-mount"></div>
                </div>
            </section>

            <section class="control-section">
                <h5 class="control-section-title">Drawing</h5>
                <div class="control-field">
                    <span class="control-field-label">Brush size</span>
                    <div id="controls-brush-slider-mount"></div>
                </div>
                <div class="control-field">
                    <span class="control-field-label">Brush action</span>
                    <div id="controls-brush-mode-mount"></div>
                </div>
                <div id="controls-pause-while-drawing-mount"></div>
            </section>

            <section class="control-section">
                <h5 class="control-section-title">Display</h5>
                <div class="control-field">
                    <span class="control-field-label">Cell coloring</span>
                    <div id="controls-ruleset-viz-mount"></div>
                </div>
                <div class="control-toggle-list">
                    <div id="controls-show-minimap-overlay-mount"></div>
                    <div id="controls-show-status-badges-mount"></div>
                    <div id="controls-show-command-toasts-mount"></div>
                </div>
            </section>
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
            initialValue: interactionController.getBrushMode(),
            items: [
                { value: 'invert', text: `${ICONS.shuffle}<span>Invert</span>` },
                { value: 'draw', text: `${ICONS.pencil}<span>Draw</span>` },
                { value: 'erase', text: `${ICONS.eraser}<span>Erase</span>` }
            ],
            onChange: (mode) => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_MODE, mode)
        });

        new ToggleSwitch(this.element.querySelector(`#controls-pause-while-drawing-mount`), {
            id: 'controls-pause-while-drawing',
            label: 'Pause while drawing',
            description: 'Freeze the simulation while you paint cells.',
            initialValue: interactionController.getPauseWhileDrawing(),
            onChange: (shouldPause) => EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_WHILE_DRAWING, shouldPause)
        });

        new SwitchComponent(this.element.querySelector(`#controls-ruleset-viz-mount`), {
            type: 'radio',
            name: `controls-ruleset-viz`,
            initialValue: vizController.getVizType(),
            items: vizController.getVisualizationOptions(),
            onChange: (type) => EventBus.dispatch(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, type)
        });

        new ToggleSwitch(this.element.querySelector(`#controls-show-minimap-overlay-mount`), {
            id: 'controls-show-minimap-overlay',
            label: 'Minimap overlays',
            initialValue: vizController.getShowMinimapOverlay(),
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, shouldShow)
        });

        new ToggleSwitch(this.element.querySelector(`#controls-show-status-badges-mount`), {
            id: 'controls-show-status-badges',
            label: 'Status badges',
            initialValue: vizController.getShowStatusBadges(),
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_STATUS_BADGES, shouldShow)
        });

        new ToggleSwitch(this.element.querySelector(`#controls-show-command-toasts-mount`), {
            id: 'controls-show-command-toasts',
            label: 'Action toasts',
            initialValue: vizController.getShowCommandToasts(),
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_COMMAND_TOASTS, shouldShow)
        });
    }

    getElement() {
        return this.element;
    }
}
