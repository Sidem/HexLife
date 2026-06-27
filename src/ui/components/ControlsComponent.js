import * as Config from '../../core/config.js';
import { BaseComponent } from './BaseComponent.js';
import { StepperComponent } from './StepperComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { ToggleSwitch } from './ToggleSwitch.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { ICONS } from '../icons.js';
import { patternToHexSVG } from '../../utils/utils.js';

// Radius at which the brush-footprint preview stops drawing individual cells (large
// brushes all read as "a big hex blob"); the coverage caption still reports the true count.
const BRUSH_PREVIEW_DRAW_CAP = 6;

/**
 * Cells covered by a brush of the given radius, as relative offset-coord [col,row] pairs
 * centered at (0,0). A torus-free re-implementation of `findHexagonsInNeighborhood`'s BFS
 * (the real one wraps around the global grid, which would distort a local preview), using
 * the same column-parity neighbour tables so the shape matches the actual brush exactly.
 */
function brushFootprintCells(radius) {
    const cells = [[0, 0]];
    if (radius <= 0) return cells;
    const visited = new Set(['0,0']);
    let frontier = [[0, 0, 0]];
    while (frontier.length) {
        const next = [];
        for (const [c, r, d] of frontier) {
            if (d >= radius) continue;
            const dirs = (c % 2 !== 0) ? Config.NEIGHBOR_DIRS_ODD_R : Config.NEIGHBOR_DIRS_EVEN_R;
            for (const [dx, dy] of dirs) {
                const nc = c + dx, nr = r + dy;
                const key = nc + ',' + nr;
                if (!visited.has(key)) {
                    visited.add(key);
                    cells.push([nc, nr]);
                    next.push([nc, nr, d + 1]);
                }
            }
        }
        frontier = next;
    }
    return cells;
}

// Exact number of cells a hex brush of the given radius covers: 1 + 3r(r+1).
const brushCellCount = (radius) => 1 + 3 * radius * (radius + 1);

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
                    <span class="control-field-label">Speed <span class="control-field-hint">ticks / sec</span></span>
                    <div id="controls-speed-stepper-mount"></div>
                </div>
            </section>

            <section class="control-section">
                <h5 class="control-section-title">Drawing</h5>
                <div class="control-field">
                    <span class="control-field-label">Brush size</span>
                    <div class="brush-size-control">
                        <div class="brush-preview" id="controls-brush-preview" aria-hidden="true"></div>
                        <div class="brush-stepper-col">
                            <div id="controls-brush-stepper-mount"></div>
                            <span class="brush-coverage" id="controls-brush-coverage"></span>
                        </div>
                    </div>
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

        const speedConfig = simController.getSpeedConfig();
        new StepperComponent(this.element.querySelector(`#controls-speed-stepper-mount`), {
            id: `controls-speed-stepper`,
            min: speedConfig.min,
            max: speedConfig.max,
            step: speedConfig.step,
            unit: speedConfig.unit,
            ariaLabel: 'Simulation speed in ticks per second',
            value: simController.getSpeed(),
            presets: [
                { label: 'Slow', value: 10 },
                { label: 'Normal', value: Config.DEFAULT_SPEED },
                { label: 'Fast', value: 120 },
                { label: 'Max', value: speedConfig.max }
            ],
            onChange: (speed) => EventBus.dispatch(EVENTS.COMMAND_SET_SPEED, speed)
        });

        const brushConfig = brushController.getBrushConfig();
        this.brushStepper = new StepperComponent(this.element.querySelector(`#controls-brush-stepper-mount`), {
            id: `controls-brush-stepper`,
            min: brushConfig.min,
            max: brushConfig.max,
            step: brushConfig.step,
            ariaLabel: 'Brush size (hex radius)',
            value: brushController.getBrushSize(),
            presets: [
                { label: 'Point', value: 0, title: 'Point — a single cell' },
                { label: 'Small', value: 2 },
                { label: 'Medium', value: 5 },
                { label: 'Large', value: 10 }
            ],
            onInput: (size) => this._updateBrushPreview(size),
            onChange: (size) => EventBus.dispatch(EVENTS.COMMAND_SET_BRUSH_SIZE, size)
        });
        this.brushPreviewEl = this.element.querySelector('#controls-brush-preview');
        this.brushCoverageEl = this.element.querySelector('#controls-brush-coverage');
        this._updateBrushPreview(brushController.getBrushSize());

        // Keep the stepper & preview in sync when the brush size changes elsewhere
        // (Ctrl+wheel over the grid, keyboard shortcuts).
        this._subscribeToEvent(EVENTS.BRUSH_SIZE_CHANGED, (size) => {
            if (this.brushStepper.getValue() !== size) this.brushStepper.setValue(size);
            this._updateBrushPreview(size);
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

    // Re-render the hex-footprint thumbnail and coverage caption for a brush radius.
    _updateBrushPreview(size) {
        if (!this.brushPreviewEl) return;
        const drawR = Math.min(size, BRUSH_PREVIEW_DRAW_CAP);
        this.brushPreviewEl.innerHTML = patternToHexSVG(brushFootprintCells(drawR), {
            size: 6, className: 'brush-preview-svg'
        });
        if (this.brushCoverageEl) {
            const count = brushCellCount(size);
            this.brushCoverageEl.textContent = count === 1 ? '1 cell' : `${count} cells`;
        }
    }

    getElement() {
        return this.element;
    }

    destroy() {
        if (this.brushStepper) this.brushStepper.destroy();
        super.destroy();
    }
}
