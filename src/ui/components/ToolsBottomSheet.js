import { BottomSheet } from './BottomSheet.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as Config from '../../core/config.js';

export class ToolsBottomSheet extends BottomSheet {
    constructor(id, triggerElement, worldManagerInterface) {
        super(id, triggerElement, { title: 'Simulation Tools' });
        this.worldManager = worldManagerInterface;
        this.render();
        this.attachEventListeners();
    }

    render() {
        const content = document.createElement('div');
        content.className = 'tools-bottom-sheet-content';

        content.innerHTML = `
            <div class="tool-group">
                <h5>Speed</h5>
                <div id="mobileSpeedSliderMount"></div>
            </div>
            <div class="tool-group">
                <h5>Brush Size</h5>
                <div id="mobileBrushSliderMount"></div>
            </div>
            <div class="tool-group">
                <h5>Reset / Clear</h5>
                <div class="reset-clear-buttons">
                    <button class="button" data-action="reset">Reset World</button>
                    <button class="button" data-action="clear">Clear World</button>
                </div>
            </div>
        `;

        this.setContent(content);

        // Initialize Slider Components
        new SliderComponent(content.querySelector('#mobileSpeedSliderMount'), {
            id: 'mobileSpeedSlider',
            min: 1,
            max: Config.MAX_SIM_SPEED,
            step: 1,
            value: this.worldManager.getCurrentSimulationSpeed(),
            unit: 'tps',
            showValue: true,
            onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, val)
        });

        new SliderComponent(content.querySelector('#mobileBrushSliderMount'), {
            id: 'mobileBrushSlider',
            min: 0,
            max: Config.MAX_NEIGHBORHOOD_SIZE,
            step: 1,
            value: this.worldManager.getCurrentBrushSize(),
            showValue: true,
            onChange: val => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, val)
        });
    }

    attachEventListeners() {
        this.sheetContent.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            if (action === 'reset') {
                EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'selected' });
                this.hide();
            } else if (action === 'clear') {
                EventBus.dispatch(EVENTS.COMMAND_CLEAR_WORLDS, { scope: 'selected' });
                this.hide();
            }
        });
    }
}