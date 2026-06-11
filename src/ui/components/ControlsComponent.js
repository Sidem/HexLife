import { BaseComponent } from './BaseComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
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
                <div id="controls-show-status-badges-mount"></div>
                <div id="controls-show-command-toasts-mount"></div>
            </div>
            <div class="tool-group">
                <h5>Patterns</h5>
                <button class="button" id="controls-capture-pattern-button">
                    <span class="inline-icon">${ICONS.crop}</span> Capture Pattern
                </button>
                <div id="controls-patterns-list" class="patterns-list"></div>
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

        new SwitchComponent(this.element.querySelector(`#controls-show-status-badges-mount`), {
            type: 'checkbox',
            name: `controls-show-status-badges`,
            initialValue: vizController.getShowStatusBadges(),
            items: [{ value: 'show', text: 'Show Status Badges' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_STATUS_BADGES, shouldShow)
        });

        new SwitchComponent(this.element.querySelector(`#controls-show-command-toasts-mount`), {
            type: 'checkbox',
            name: `controls-show-command-toasts`,
            initialValue: vizController.getShowCommandToasts(),
            items: [{ value: 'show', text: 'Show Action Toasts' }],
            onChange: (shouldShow) => EventBus.dispatch(EVENTS.COMMAND_SET_SHOW_COMMAND_TOASTS, shouldShow)
        });

        this._setupPatterns();
    }

    _setupPatterns() {
        const captureBtn = this.element.querySelector('#controls-capture-pattern-button');
        this.patternsList = this.element.querySelector('#controls-patterns-list');

        this._addDOMListener(captureBtn, 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            EventBus.dispatch(EVENTS.COMMAND_START_PATTERN_CAPTURE);
        });

        this._addDOMListener(this.patternsList, 'click', (e) => {
            const item = e.target.closest('[data-pattern-id]');
            if (!item) return;
            const id = item.dataset.patternId;
            const libraryController = this.appContext.libraryController;
            if (e.target.closest('[data-action="place-pattern"]')) {
                libraryController.placeUserPattern(id);
                EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            } else if (e.target.closest('[data-action="delete-pattern"]')) {
                const pattern = libraryController.getUserPatterns().find(p => p.id === id);
                EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                    title: 'Delete Pattern',
                    message: `Are you sure you want to permanently delete "${pattern?.name ?? 'this pattern'}"?`,
                    confirmLabel: 'Delete',
                    onConfirm: () => {
                        libraryController.deleteUserPattern(id);
                        EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Deleted "${pattern?.name ?? 'pattern'}".`, type: 'info' });
                    }
                });
            }
        });

        this._renderPatternsList();
        this._subscribeToEvent(EVENTS.USER_PATTERNS_CHANGED, this._renderPatternsList);
    }

    _renderPatternsList() {
        if (!this.patternsList) return;
        const patterns = this.appContext.libraryController.getUserPatterns();
        if (patterns.length === 0) {
            this.patternsList.innerHTML = `<p class="empty-state-text">No saved patterns yet. Click "Capture Pattern", then drag a box over active cells.</p>`;
            return;
        }
        this.patternsList.innerHTML = patterns.map(p => `
            <div class="pattern-list-item" data-pattern-id="${p.id}">
                <span class="pattern-list-name" title="${this._escape(p.name)}">${this._escape(p.name)}</span>
                <div class="pattern-list-actions">
                    <button class="button-icon" data-action="place-pattern" title="Place this pattern">${ICONS.target}</button>
                    <button class="button-icon" data-action="delete-pattern" title="Delete this pattern">${ICONS.trash}</button>
                </div>
            </div>
        `).join('');
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    getElement() {
        return this.element;
    }
}