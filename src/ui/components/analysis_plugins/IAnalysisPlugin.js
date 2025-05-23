import { BaseComponent } from '../BaseComponent.js';
import { EventBus } from '../../../services/EventBus.js'; 

export class IAnalysisPlugin extends BaseComponent {
    constructor(pluginId, pluginName) {
        super(); 
        this.id = pluginId;
        this.name = pluginName;
        this.mountPoint = null; 
        this.simulationInterface = null; 
        this.currentResults = {}; 
        this.lastFitnessValue = null; 
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
    }

    /**
     * Called by AnalysisPanel when relevant simulation data is updated.
     * This method should be overridden by concrete plugins.
     * @param {object} data - The data payload from the simulation (e.g., { type: 'worldStats', payload: statsData }).
     */
    onDataUpdate(data) {
        
        
    }

    /**
     * Returns the current primary result of the analysis, suitable for a fitness function.
     * This method should be overridden by concrete plugins.
     * @returns {number|null} The fitness value or null if not applicable/available.
     */
    getFitnessValue() {
        
        return this.lastFitnessValue;
    }

    /**
     * Optional: Returns a configuration object for the plugin.
     * E.g., data requirements, preferred update rates.
     * @returns {object}
     */
    getPluginConfig() {
        return {
            requiredDataTypes: [] 
        };
    }

    /**
     * Overrides BaseComponent's destroy to include plugin-specific cleanup.
     */
    destroy() {
        if (this.mountPoint) {
            this.mountPoint.innerHTML = ''; 
        }
        this.mountPoint = null;
        this.simulationInterface = null;
        super.destroy(); 
        
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

        ctx.fillStyle = '#2a2a2a'; 
        ctx.fillRect(0, 0, width, height);

        if (label) {
            ctx.fillStyle = '#aaa';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, width / 2, 12); 
        }

        if (!dataHistory || dataHistory.length === 0) {
            return;
        }

        const plotWidth = width - 2 * padding;
        const plotHeight = height - 2 * padding - (label ? 10 : 0); 
        const plotYStart = padding + (label ? 10 : 0);


        const dataLength = dataHistory.length;
        ctx.strokeStyle = '#555'; 
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(padding, plotYStart); ctx.lineTo(width - padding, plotYStart); 
        ctx.moveTo(padding, plotYStart + plotHeight); ctx.lineTo(width - padding, plotYStart + plotHeight); 
        ctx.stroke();

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let i = 0; i < dataLength; i++) {
            const x = padding + (i / (dataLength - 1 || 1)) * plotWidth;
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