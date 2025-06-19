import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class ControlsComponent extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.element = document.createElement('div');
        this.element.className = 'controls-component-content';
        this.render();
    }

    render() {
        this.element.innerHTML = `
            <div class="tool-group">
                <h5>Speed</h5>
                <div id="sharedSpeedSliderMount"></div>
            </div>
            <div class="tool-group">
                <h5>Brush Size</h5>
                <div id="sharedBrushSliderMount"></div>
            </div>
            <div class="tool-group">
                <h5>Interaction</h5>
                <div id="sharedPauseWhileDrawingMount"></div>
            </div>
            <div class="tool-group">
                <h5>Visualization</h5>
                <div id="sharedRulesetVizMount"></div>
                <div id="sharedShowMinimapOverlayMount" style="margin-top: 15px;"></div>
                <div id="sharedShowCycleIndicatorMount" style="margin-top: 5px;"></div>
            </div>
        `;

        // Instantiate controls using appContext
        const simController = this.appContext.simulationController;
        const brushController = this.appContext.brushController;
        const interactionController = this.appContext.interactionController;
        const vizController = this.appContext.visualizationController;

        new SliderComponent(this.element.querySelector('#sharedSpeedSliderMount'), {
            id: 'sharedSpeedSlider',
            ...simController.getSpeedConfig(),
            value: simController.getState().speed,
            showValue: true,
            onChange: (speed) => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, speed)
        });

        new SliderComponent(this.element.querySelector('#sharedBrushSliderMount'), {
            id: 'sharedBrushSlider',
            ...brushController.getBrushConfig(),
            value: brushController.getState().brushSize,
            showValue: true,
            onChange: (size) => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, size)
        });

        new SwitchComponent(this.element.querySelector('#sharedPauseWhileDrawingMount'), {
            type: 'checkbox',
            name: 'sharedPauseWhileDrawing',
            initialValue: interactionController.getState().pauseWhileDrawing,
            items: [{ value: 'pause', text: 'Pause While Drawing' }],
            onChange: (shouldPause) => EventBus.dispatch(EVENTS.COMMAND_SET_PAUSE_WHILE_DRAWING, shouldPause)
        });

        new SwitchComponent(this.element.querySelector('#sharedRulesetVizMount'), {
            type: 'radio',
            name: 'sharedRulesetViz',
            label: 'Display Type:',
            initialValue: vizController.getState().vizType,
            items: vizController.getVisualizationOptions(),
            onChange: (type) => EventBus.dispatch(EVENTS.COMMAND_SET_VISUALIZATION_TYPE, type)
        });

        new SwitchComponent(this.element.querySelector('#sharedShowMinimapOverlayMount'), {
            type: 'checkbox',
            name: 'sharedShowMinimapOverlay',
            initialValue: vizController.getState().showMinimapOverlay,
            items: [{ value: 'show', text: 'Show Minimap Overlays' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_MINIMAP_OVERLAY, shouldShow)
        });

        new SwitchComponent(this.element.querySelector('#sharedShowCycleIndicatorMount'), {
            type: 'checkbox',
            name: 'sharedShowCycleIndicator',
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