import { IAnalysisPlugin } from './IAnalysisPlugin.js';

export class EntropyPlotPlugin extends IAnalysisPlugin {
    constructor() {
        super('entropyPlot', 'Sampled Entropy History');
        this.plotCanvas = null;
        this.currentEntropyHistory = [];
    }

    init(mountPoint, simulationInterface) {
        super.init(mountPoint, simulationInterface);

        this.mountPoint.innerHTML = `
            <div class="plot-container">
                <canvas class="plugin-canvas" width="400" height="100"></canvas>
            </div>
        `;
        this.plotCanvas = this.mountPoint.querySelector('.plugin-canvas');
        this.updatePlot(); 
    }

    onDataUpdate(data) {
        
        if (data && (data.type === 'worldStats' || data.type === 'entropySamplingChanged') && data.payload) {
            this.currentEntropyHistory = this.simulationInterface.getSelectedWorldEntropyHistory() || [];
             if (this.currentEntropyHistory.length > 0) {
                 this.lastFitnessValue = this.currentEntropyHistory[this.currentEntropyHistory.length -1];
            } else {
                this.lastFitnessValue = 0;
            }
        } else if (data && data.type === 'allWorldsReset') { 
            this.currentEntropyHistory = [];
            this.lastFitnessValue = 0;
        }
        this.updatePlot();
    }

    getFitnessValue() {
        if (this.currentEntropyHistory && this.currentEntropyHistory.length > 0) {
            return this.lastFitnessValue;
        }
        return 0;
    }

    getPluginConfig() {
        return {
            requiredDataTypes: ['worldStats', 'entropyHistory', 'entropySamplingChanged', 'allWorldsReset']
        };
    }

    updatePlot() {
        if (this.plotCanvas) {
            super.drawPlot(this.plotCanvas, this.currentEntropyHistory, '#FFA500', 'Sampled Entropy (0.0-1.0)');
        }
    }

    destroy() {
        this.plotCanvas = null;
        super.destroy();
    }
} 