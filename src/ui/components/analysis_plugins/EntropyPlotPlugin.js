import { IAnalysisPlugin } from './IAnalysisPlugin.js';
import { SliderComponent } from '../SliderComponent.js';
import * as PersistenceService from '../../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../../services/EventBus.js';

export class EntropyPlotPlugin extends IAnalysisPlugin {
    constructor() {
        super('entropyPlot', 'Sampled Entropy History');
        this.plotCanvas = null;
        this.currentEntropyHistory = [];
        this.lastKnownEntropy = null;
        this.entropySampleRateSlider = null;
        this.isInitialized = false;
        this.uiElements = {
            enableEntropySamplingCheckbox: null,
            entropySampleRateSliderMount: null,
            statEntropy: null
        };
    }

    init(mountPoint, simulationInterface) {
        super.init(mountPoint, simulationInterface);

        this.mountPoint.innerHTML = `
            <div class="entropy-plugin-container">
                <div class="entropy-controls-section">
                    <div class="entropy-display-section">
                        <label>Current Sampled Entropy:</label>
                        <span id="stat-entropy-plugin" class="entropy-value">Disabled</span>
                    </div>
                    <div class="entropy-sampling-controls">
                        <div class="sampling-enable-control">
                            <input type="checkbox" id="enableEntropySamplingCheckbox" class="checkbox-input">
                            <label for="enableEntropySamplingCheckbox" class="checkbox-label">Enable Sampling</label>
                        </div>
                        <div id="entropySampleRateSliderMount" class="slider-mount"></div>
                    </div>
                </div>
                <div class="plot-container">
                    <canvas class="plugin-canvas" width="400" height="100"></canvas>
                </div>
            </div>
        `;

        // Get references to UI elements
        this.uiElements.enableEntropySamplingCheckbox = this.mountPoint.querySelector('#enableEntropySamplingCheckbox');
        this.uiElements.entropySampleRateSliderMount = this.mountPoint.querySelector('#entropySampleRateSliderMount');
        this.uiElements.statEntropy = this.mountPoint.querySelector('#stat-entropy-plugin');

        this.plotCanvas = this.mountPoint.querySelector('.plugin-canvas');

        this._setupEventSubscriptions();
        this._setupEntropyControls();
        this._syncWithCurrentState();
        this.isInitialized = true;
        this.updatePlot();
    }

    _setupEntropyControls() {
        if (this.uiElements.enableEntropySamplingCheckbox) {
            this.uiElements.enableEntropySamplingCheckbox.addEventListener('change', (e) => {
                this._handleSamplingControlsChange();
                PersistenceService.saveUISetting('entropySamplingEnabled', e.target.checked);
            });
        }

        if (this.uiElements.entropySampleRateSliderMount) {
            // Get current state from simulationInterface to initialize slider
            const currentState = this.simulationInterface.getEntropySamplingState();

            this.entropySampleRateSlider = new SliderComponent(this.uiElements.entropySampleRateSliderMount, {
                id: 'entropySampleRateSliderInPlugin', 
                label: 'Rate:',
                min: 1, 
                max: 100, 
                step: 1, 
                showValue: true, 
                unit: '/tick',
                value: currentState.rate,
                disabled: !currentState.enabled,
                onChange: (value) => {
                    this._handleSamplingControlsChange();
                    PersistenceService.saveUISetting('entropySampleRate', value);
                }
            });
        }
    }

    _setupEventSubscriptions() {
        // Subscribe to entropy sampling changes
        this._subscribeToEvent(EVENTS.ENTROPY_SAMPLING_CHANGED, (samplingData) => {
            this._updateSamplingControlsUI(samplingData);
            
            // Clear last known entropy when sampling is disabled
            if (!samplingData.enabled) {
                this.lastKnownEntropy = null;
            }
            
            this._updateCurrentEntropyDisplay();
        });

        // Subscribe to world events that should clear entropy
        this._subscribeToEvent(EVENTS.ALL_WORLDS_RESET, () => {
            this.lastKnownEntropy = null;
            this._updateCurrentEntropyDisplay();
        });

        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, () => {
            this.lastKnownEntropy = null;
            this._updateCurrentEntropyDisplay();
        });
    }

    _syncWithCurrentState() {
        // Get the current state from the WorldManager and sync UI
        const currentState = this.simulationInterface.getEntropySamplingState();
        this._updateSamplingControlsUI(currentState);
        this._updateCurrentEntropyDisplay();
    }

    _handleSamplingControlsChange() {
        if (!this.uiElements.enableEntropySamplingCheckbox || !this.entropySampleRateSlider) return;
        
        const enabled = this.uiElements.enableEntropySamplingCheckbox.checked;
        const rate = this.entropySampleRateSlider.getValue();
        this.entropySampleRateSlider.setDisabled(!enabled);
        
        EventBus.dispatch(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, { enabled, rate });
    }

    _updateSamplingControlsUI(samplingData) {
        if (this.uiElements.enableEntropySamplingCheckbox) {
            this.uiElements.enableEntropySamplingCheckbox.checked = samplingData.enabled;
        }
        if (this.entropySampleRateSlider) {
            this.entropySampleRateSlider.setValue(samplingData.rate);
            this.entropySampleRateSlider.setDisabled(!samplingData.enabled);
        }
    }

    _updateCurrentEntropyDisplay(statsData = null) {
        if (!this.uiElements.statEntropy) return;

        const samplingState = this.simulationInterface.getEntropySamplingState();
        
        if (statsData && statsData.entropy !== undefined) {
            // Update last known entropy when we have a new value
            this.lastKnownEntropy = statsData.entropy;
            this.uiElements.statEntropy.textContent = statsData.entropy.toFixed(4);
        } else if (samplingState.enabled && this.lastKnownEntropy !== null) {
            // Show last known entropy when sampling is enabled but no current value
            this.uiElements.statEntropy.textContent = this.lastKnownEntropy.toFixed(4);
        } else if (samplingState.enabled) {
            // Sampling enabled but no entropy value yet
            this.uiElements.statEntropy.textContent = "Pending...";
        } else {
            // Sampling is disabled
            this.uiElements.statEntropy.textContent = "Disabled";
        }
    }

    onDataUpdate(data) {
        if (!this.isInitialized) return;

        if (data && (data.type === 'worldStats' || data.type === 'entropySamplingChanged') && data.payload && data.payload.entropyHistory) {
            // Use data directly from payload if available
            this.currentEntropyHistory = [...data.payload.entropyHistory];
            if (this.currentEntropyHistory.length > 0) {
                this.lastFitnessValue = this.currentEntropyHistory[this.currentEntropyHistory.length - 1];
            } else {
                this.lastFitnessValue = 0;
            }
        } else if (data && (data.type === 'worldStats' || data.type === 'entropySamplingChanged') && data.payload) {
            // Fallback: retrieve from simulationInterface
            this.currentEntropyHistory = this.simulationInterface.getSelectedWorldEntropyHistory() || [];
            if (this.currentEntropyHistory.length > 0) {
                this.lastFitnessValue = this.currentEntropyHistory[this.currentEntropyHistory.length - 1];
            } else {
                this.lastFitnessValue = 0;
            }
        } else if (data && data.type === 'allWorldsReset') { 
            this.currentEntropyHistory = (data.payload && data.payload.entropyHistory) ? [...data.payload.entropyHistory] : [];
            this.lastFitnessValue = this.currentEntropyHistory.length > 0 ? this.currentEntropyHistory[this.currentEntropyHistory.length - 1] : 0;
        }
        
        // Update current entropy display
        this._updateCurrentEntropyDisplay(data?.payload);
        
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
        if (this.entropySampleRateSlider) {
            this.entropySampleRateSlider.destroy();
            this.entropySampleRateSlider = null;
        }
        this.plotCanvas = null;
        this.isInitialized = false;
        super.destroy();
    }
} 