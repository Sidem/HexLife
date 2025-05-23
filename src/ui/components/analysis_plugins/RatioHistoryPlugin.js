import { IAnalysisPlugin } from './IAnalysisPlugin.js';

export class RatioHistoryPlugin extends IAnalysisPlugin {
    constructor() {
        super('ratioHistory', 'Activity Ratio History');
        this.plotCanvas = null;
        this.currentRatioHistory = [];
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
        if (data && data.type === 'worldStats' && data.payload) {
            this.currentRatioHistory = this.simulationInterface.getSelectedWorldRatioHistory() || [];
            if (this.currentRatioHistory.length > 0) {
                 this.lastFitnessValue = this.currentRatioHistory[this.currentRatioHistory.length -1];
            } else {
                this.lastFitnessValue = 0;
            }
        } else if (data && data.type === 'allWorldsReset') { 
            this.currentRatioHistory = [];
             this.lastFitnessValue = 0;
        }
        this.updatePlot();
    }

    getFitnessValue() {
        
        if (this.currentRatioHistory && this.currentRatioHistory.length > 0) {
            
            return this.lastFitnessValue; 
        }
        return 0; 
    }

    getPluginConfig() {
        return {
            requiredDataTypes: ['worldStats', 'ratioHistory', 'allWorldsReset']
        };
    }

    updatePlot() {
        if (this.plotCanvas) {
            super.drawPlot(this.plotCanvas, this.currentRatioHistory, '#00FFFF', 'Activity Ratio (0.0-1.0)');
        }
    }

    destroy() {
        this.plotCanvas = null;
        super.destroy();
    }
} 