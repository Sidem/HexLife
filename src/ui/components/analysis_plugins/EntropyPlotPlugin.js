import { IAnalysisPlugin } from './IAnalysisPlugin.js';
import { SliderComponent } from '../SliderComponent.js';
import { SwitchComponent } from '../SwitchComponent.js';
import * as PersistenceService from '../../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../../services/EventBus.js';

export class EntropyPlotPlugin extends IAnalysisPlugin {
    constructor() {
        super('entropyPlot', 'Sampled Entropy History');
        this.plotCanvas = null;
        this.currentBinaryEntropyHistory = [];
        this.currentBlockEntropyHistory = [];
        this.lastKnownBinaryEntropy = null;
        this.lastKnownBlockEntropy = null;
        this.entropySampleRateSlider = null;
        this.enableSwitch = null;
        this.isInitialized = false;
        this.selectedEntropyType = 'binary'; 
        this.uiElements = {
            enableSamplingMount: null,
            entropySampleRateSliderMount: null,
            statBinaryEntropy: null,
            statBlockEntropy: null,
            statActivityRatio: null,
            statEntropyDifference: null,
            entropyTypeSelector: null
        };
    }

    init(mountPoint, simulationInterface) {
        super.init(mountPoint, simulationInterface);

        this.mountPoint.innerHTML = `
            <div class="entropy-plugin-container">
                <div class="entropy-controls-section">
                    <div class="entropy-display-section">
                        <div class="entropy-type-selector">
                            <label for="entropyTypeSelector">Entropy Type:</label>
                            <select id="entropyTypeSelector" class="entropy-type-select">
                                <option value="binary">Binary Entropy</option>
                                <option value="block">Block Entropy</option>
                            </select>
                        </div>
                        <div class="entropy-values">
                            <div class="entropy-value-row">
                                <label>Binary Entropy:</label>
                                <span id="stat-binary-entropy-plugin" class="entropy-value">Disabled</span>
                            </div>
                            <div class="entropy-value-row">
                                <label>Block Entropy:</label>
                                <span id="stat-block-entropy-plugin" class="entropy-value">Disabled</span>
                            </div>
                            <div class="entropy-value-row">
                                <label>Activity Ratio:</label>
                                <span id="stat-activity-ratio-plugin" class="entropy-value">--</span>
                            </div>
                            <div class="entropy-value-row">
                                <label>Entropy Difference:</label>
                                <span id="stat-entropy-difference-plugin" class="entropy-value">--</span>
                            </div>
                        </div>
                    </div>
                    <div class="entropy-sampling-controls">
                        <div id="enableSamplingMount" class="sampling-enable-control"></div>
                        <div id="entropySampleRateSliderMount" class="slider-mount"></div>
                    </div>
                </div>
                <div class="plot-container">
                    <canvas class="plugin-canvas" width="400" height="100"></canvas>
                </div>
            </div>
        `;

        
        this.uiElements.enableSamplingMount = this.mountPoint.querySelector('#enableSamplingMount');
        this.uiElements.entropySampleRateSliderMount = this.mountPoint.querySelector('#entropySampleRateSliderMount');
        this.uiElements.statBinaryEntropy = this.mountPoint.querySelector('#stat-binary-entropy-plugin');
        this.uiElements.statBlockEntropy = this.mountPoint.querySelector('#stat-block-entropy-plugin');
        this.uiElements.statActivityRatio = this.mountPoint.querySelector('#stat-activity-ratio-plugin');
        this.uiElements.statEntropyDifference = this.mountPoint.querySelector('#stat-entropy-difference-plugin');
        this.uiElements.entropyTypeSelector = this.mountPoint.querySelector('#entropyTypeSelector');

        this.plotCanvas = this.mountPoint.querySelector('.plugin-canvas');

        this._setupEventSubscriptions();
        this._setupEntropyControls();
        this._setupEntropyTypeSelector();
        this._syncWithCurrentState();
        this.isInitialized = true;
        this.updatePlot();
    }

    _setupEntropyControls() {
        const currentState = this.simulationInterface.getEntropySamplingState();

        if (this.uiElements.enableSamplingMount) {
            this.enableSwitch = new SwitchComponent(this.uiElements.enableSamplingMount, {
                type: 'checkbox',
                name: 'enableEntropySampling',
                initialValue: currentState.enabled,
                items: [{ value: 'enabled', text: 'Enable Sampling' }],
                onChange: (isChecked) => {
                    this._handleSamplingControlsChange(isChecked);
                    PersistenceService.saveUISetting('entropySamplingEnabled', isChecked);
                }
            });
        }

        if (this.uiElements.entropySampleRateSliderMount) {
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
                    this._handleSamplingControlsChange(this.enableSwitch ? this.enableSwitch.getValue() : false);
                    PersistenceService.saveUISetting('entropySampleRate', value);
                }
            });
        }
    }

    _setupEntropyTypeSelector() {
        if (this.uiElements.entropyTypeSelector) {
            
            const savedType = PersistenceService.loadUISetting('selectedEntropyType', 'binary');
            this.selectedEntropyType = savedType;
            this.uiElements.entropyTypeSelector.value = savedType;

            this.uiElements.entropyTypeSelector.addEventListener('change', (e) => {
                this.selectedEntropyType = e.target.value;
                PersistenceService.saveUISetting('selectedEntropyType', this.selectedEntropyType);
                this.updatePlot();
            });
        }
    }

    _setupEventSubscriptions() {
        
        this._subscribeToEvent(EVENTS.ENTROPY_SAMPLING_CHANGED, (samplingData) => {
            this._updateSamplingControlsUI(samplingData);
            
            
            if (!samplingData.enabled) {
                this.lastKnownBinaryEntropy = null;
                this.lastKnownBlockEntropy = null;
            }
            
            this._updateCurrentEntropyDisplay();
        });

        
        this._subscribeToEvent(EVENTS.ALL_WORLDS_RESET, () => {
            this.lastKnownBinaryEntropy = null;
            this.lastKnownBlockEntropy = null;
            this._updateCurrentEntropyDisplay();
        });

        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, () => {
            this.lastKnownBinaryEntropy = null;
            this.lastKnownBlockEntropy = null;
            this._updateCurrentEntropyDisplay();
        });
    }

    _syncWithCurrentState() {
        
        const currentState = this.simulationInterface.getEntropySamplingState();
        this._updateSamplingControlsUI(currentState);
        this._updateCurrentEntropyDisplay();
    }

    _handleSamplingControlsChange(enabled) {
        if (!this.entropySampleRateSlider) return;
        
        const rate = this.entropySampleRateSlider.getValue();
        this.entropySampleRateSlider.setDisabled(!enabled);
        
        EventBus.dispatch(EVENTS.COMMAND_SET_ENTROPY_SAMPLING, { enabled, rate });
    }

    _updateSamplingControlsUI(samplingData) {
        if (this.enableSwitch) {
            this.enableSwitch.setValue(samplingData.enabled);
        }
        if (this.entropySampleRateSlider) {
            this.entropySampleRateSlider.setValue(samplingData.rate);
            this.entropySampleRateSlider.setDisabled(!samplingData.enabled);
        }
    }

    _updateCurrentEntropyDisplay(statsData = null) {
        if (!this.uiElements.statBinaryEntropy || !this.uiElements.statBlockEntropy) return;

        const samplingState = this.simulationInterface.getEntropySamplingState();
        
        
        if (statsData && statsData.binaryEntropy !== undefined) {
            this.lastKnownBinaryEntropy = statsData.binaryEntropy;
            this.uiElements.statBinaryEntropy.textContent = statsData.binaryEntropy.toFixed(4);
        } else if (samplingState.enabled && this.lastKnownBinaryEntropy !== null) {
            this.uiElements.statBinaryEntropy.textContent = this.lastKnownBinaryEntropy.toFixed(4);
        } else if (samplingState.enabled) {
            this.uiElements.statBinaryEntropy.textContent = "Pending...";
        } else {
            this.uiElements.statBinaryEntropy.textContent = "Disabled";
        }

        
        if (statsData && statsData.blockEntropy !== undefined) {
            this.lastKnownBlockEntropy = statsData.blockEntropy;
            this.uiElements.statBlockEntropy.textContent = statsData.blockEntropy.toFixed(4);
        } else if (samplingState.enabled && this.lastKnownBlockEntropy !== null) {
            this.uiElements.statBlockEntropy.textContent = this.lastKnownBlockEntropy.toFixed(4);
        } else if (samplingState.enabled) {
            this.uiElements.statBlockEntropy.textContent = "Pending...";
        } else {
            this.uiElements.statBlockEntropy.textContent = "Disabled";
        }

        
        if (statsData && statsData.ratio !== undefined) {
            this.uiElements.statActivityRatio.textContent = (statsData.ratio * 100).toFixed(2) + '%';
        } else {
            const currentStats = this.simulationInterface.getSelectedWorldStats();
            if (currentStats && currentStats.ratio !== undefined) {
                this.uiElements.statActivityRatio.textContent = (currentStats.ratio * 100).toFixed(2) + '%';
            } else {
                this.uiElements.statActivityRatio.textContent = '--';
            }
        }

        
        const binaryEntropy = statsData?.binaryEntropy ?? this.lastKnownBinaryEntropy;
        const blockEntropy = statsData?.blockEntropy ?? this.lastKnownBlockEntropy;
        
        if (binaryEntropy !== null && blockEntropy !== null && binaryEntropy !== undefined && blockEntropy !== undefined) {
            
            
            if (binaryEntropy === 0) {
                if (blockEntropy === 0) {
                    this.uiElements.statEntropyDifference.textContent = '0.00%';
                } else {
                    this.uiElements.statEntropyDifference.textContent = '+∞%';
                }
            } else {
                const percentDiff = ((blockEntropy - binaryEntropy) / binaryEntropy) * 100;
                const sign = percentDiff >= 0 ? '+' : '';
                this.uiElements.statEntropyDifference.textContent = sign + percentDiff.toFixed(2) + '%';
            }
        } else if (samplingState.enabled) {
            this.uiElements.statEntropyDifference.textContent = "Pending...";
        } else {
            this.uiElements.statEntropyDifference.textContent = "Disabled";
        }
    }

    onDataUpdate(data) {
        if (!this.isInitialized) return;

        if (data && (data.type === 'worldStats' || data.type === 'entropySamplingChanged') && data.payload) {
            
            if (data.payload.entropyHistory) {
                this.currentBinaryEntropyHistory = [...data.payload.entropyHistory];
            } else {
                this.currentBinaryEntropyHistory = this.simulationInterface.getSelectedWorldEntropyHistory() || [];
            }

            
            if (data.payload.hexBlockEntropyHistory) {
                this.currentBlockEntropyHistory = [...data.payload.hexBlockEntropyHistory];
            } else {
                this.currentBlockEntropyHistory = this.simulationInterface.getSelectedWorldBlockEntropyHistory() || [];
            }

            
            this._updateFitnessValue();
        } else if (data && data.type === 'allWorldsReset') { 
            this.currentBinaryEntropyHistory = (data.payload && data.payload.entropyHistory) ? [...data.payload.entropyHistory] : [];
            this.currentBlockEntropyHistory = (data.payload && data.payload.hexBlockEntropyHistory) ? [...data.payload.hexBlockEntropyHistory] : [];
            this._updateFitnessValue();
        }
        
        
        this._updateCurrentEntropyDisplay(data?.payload);
        
        this.updatePlot();
    }

    _updateFitnessValue() {
        const currentHistory = this.selectedEntropyType === 'binary' ? this.currentBinaryEntropyHistory : this.currentBlockEntropyHistory;
        this.lastFitnessValue = currentHistory.length > 0 ? currentHistory[currentHistory.length - 1] : 0;
    }

    getFitnessValue() {
        const currentHistory = this.selectedEntropyType === 'binary' ? this.currentBinaryEntropyHistory : this.currentBlockEntropyHistory;
        if (currentHistory && currentHistory.length > 0) {
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
            const currentHistory = this.selectedEntropyType === 'binary' ? this.currentBinaryEntropyHistory : this.currentBlockEntropyHistory;
            const label = this.selectedEntropyType === 'binary' ? 'Binary Entropy (0.0-1.0)' : 'Block Entropy (0.0-1.0)';
            const color = this.selectedEntropyType === 'binary' ? '#FFA500' : '#00CED1';
            super.drawPlot(this.plotCanvas, currentHistory, color, label);
        }
    }

    destroy() {
        if (this.entropySampleRateSlider) {
            this.entropySampleRateSlider.destroy();
            this.entropySampleRateSlider = null;
        }
        if (this.enableSwitch) {
            this.enableSwitch.destroy();
            this.enableSwitch = null;
        }
        this.plotCanvas = null;
        this.isInitialized = false;
        super.destroy();
    }
} 