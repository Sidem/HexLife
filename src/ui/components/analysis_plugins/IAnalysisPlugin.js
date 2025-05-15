import { BaseComponent } from '../BaseComponent.js';
import { EventBus } from '../../../services/EventBus.js'; // For potential direct subscriptions

export class IAnalysisPlugin extends BaseComponent {
    constructor(pluginId, pluginName) {
        super(); // BaseComponent constructor for mountPoint and options
        this.id = pluginId;
        this.name = pluginName;
        this.mountPoint = null; // DOM element provided by AnalysisPanel
        this.simulationInterface = null; // Interface to access simulation data
        this.currentResults = {}; // Store various results if needed
        this.lastFitnessValue = null; // Store the primary fitness value
    }

    /**
     * Called by AnalysisPanel to initialize the plugin's UI and internal state.
     * @param {HTMLElement} mountPoint - The DOM element where the plugin should render its UI.
     * @param {object} simulationInterface - An interface to request/receive simulation data.
     */
    init(mountPoint, simulationInterface) {
        this.mountPoint = mountPoint;
        this.simulationInterface = simulationInterface;
        if (!this.mountPoint) {
            console.error(`Plugin ${this.id}: Mount point not provided during init.`);
            return;
        }
        if (!this.simulationInterface) {
            console.error(`Plugin ${this.id}: Simulation interface not provided during init.`);
            return;
        }
        // Example: Basic structure
        // this.mountPoint.innerHTML = `<h4>${this.name}</h4><div class="plugin-content"></div>`;
    }

    /**
     * Called by AnalysisPanel when relevant simulation data is updated.
     * This method should be overridden by concrete plugins.
     * @param {object} data - The data payload from the simulation (e.g., { type: 'worldStats', payload: statsData }).
     */
    onDataUpdate(data) {
        // Abstract method - to be implemented by subclasses
        // console.log(`Plugin ${this.id} received data:`, data);
    }

    /**
     * Returns the current primary result of the analysis, suitable for a fitness function.
     * This method should be overridden by concrete plugins.
     * @returns {number|null} The fitness value or null if not applicable/available.
     */
    getFitnessValue() {
        // Abstract method - to be implemented by subclasses
        return this.lastFitnessValue;
    }

    /**
     * Optional: Returns a configuration object for the plugin.
     * E.g., data requirements, preferred update rates.
     * @returns {object}
     */
    getPluginConfig() {
        return {
            requiredDataTypes: [] // e.g., ['worldStats', 'ratioHistory', 'entropyHistory']
        };
    }

    /**
     * Overrides BaseComponent's destroy to include plugin-specific cleanup.
     */
    destroy() {
        if (this.mountPoint) {
            this.mountPoint.innerHTML = ''; // Clear UI
        }
        this.mountPoint = null;
        this.simulationInterface = null;
        super.destroy(); // Calls BaseComponent's destroy for event listeners etc.
        // console.log(`Plugin ${this.id} destroyed.`);
    }

    /**
     * Helper to draw minimalist plots, adapted from ui.js
     * @param {HTMLCanvasElement} canvas
     * @param {number[]} dataHistory
     * @param {string} color Line color
     * @param {string} label Text label for the plot
     */
    drawPlot(canvas, dataHistory, color = '#FFFFFF', label = '') {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const padding = 5;

        ctx.fillStyle = '#2a2a2a'; // Background
        ctx.fillRect(0, 0, width, height);

        if (label) {
            ctx.fillStyle = '#aaa';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, width / 2, 12); // Adjust y-offset for label
        }

        if (!dataHistory || dataHistory.length === 0) {
            return;
        }

        const plotWidth = width - 2 * padding;
        const plotHeight = height - 2 * padding - (label ? 10 : 0); // Adjust plot height if label is present
        const plotYStart = padding + (label ? 10 : 0);


        const dataLength = dataHistory.length;
        ctx.strokeStyle = '#555'; // Grid lines
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(padding, plotYStart); ctx.lineTo(width - padding, plotYStart); // Top line (0.0)
        ctx.moveTo(padding, plotYStart + plotHeight); ctx.lineTo(width - padding, plotYStart + plotHeight); // Bottom line (1.0)
        ctx.stroke();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let i = 0; i < dataLength; i++) {
            const x = padding + (i / (dataLength - 1 || 1)) * plotWidth;
            // Ensure yValue is clamped between 0 and 1 for plotting
            const yValue = Math.max(0, Math.min(1, dataHistory[i] === null || dataHistory[i] === undefined ? 0 : dataHistory[i]));
            const y = plotYStart + (1 - yValue) * plotHeight;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        if (dataLength > 0) {
            ctx.stroke();
        }
    }
} 