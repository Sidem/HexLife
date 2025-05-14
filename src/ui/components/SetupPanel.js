
import * as Config from '../../core/config.js'; 
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js'; 
import { SliderComponent } from './SliderComponent.js'; 
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SetupPanel {
    constructor(panelElement, simulationInterface) {
        if (!panelElement) {
            console.error('SetupPanel: panelElement is null or undefined.');
            return;
        }
        if (!simulationInterface) {
            console.error('SetupPanel: simulationInterface is null or undefined.');
            return;
        }

        this.panelElement = panelElement;
        this.simulationInterface = simulationInterface;
        this.panelIdentifier = 'setup'; 
        this.uiElements = {
            closeButton: this.panelElement.querySelector('#closeSetupPanelButton'),
            worldSetupGrid: this.panelElement.querySelector('#worldSetupGrid'),
            applySetupButton: this.panelElement.querySelector('#applySetupButton'),
        };
        this.worldSliderComponents = []; 
        this.simInterface = simulationInterface; 
        this.worldSettingsCache = null; 
        for (const key in this.uiElements) {
            if (!this.uiElements[key] && key !== 'closeButton') { 
                 console.warn(`SetupPanel: UI element '${key}' not found within the panel.`);
            }
        }
        if (!this.uiElements.closeButton) { 
            this.uiElements.closeButton = this.panelElement.querySelector('.close-panel-button');
        }

        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this._loadPanelState(); 
        this._setupInternalListeners();
        this.refreshViews(); 
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => {
                this.hide();
            });
        }

        if (this.uiElements.applySetupButton) {
            this.uiElements.applySetupButton.addEventListener('click', () => {
                EventBus.dispatch(EVENTS.COMMAND_RESET_ALL_WORLDS); 
                
                
            });
        }
        if (this.uiElements.resetAllButton) {
            this.uiElements.resetAllButton.addEventListener('click', () => {
                if (confirm("Are you sure you want to reset all worlds to their initial configurations? This will also reset their enabled/disabled states.")) {
                    this.simulationInterface.resetAllWorldsToCurrentSettings(); 
                    this.refreshViews();
                }
            });
        }
        
        
        if (this.draggablePanel) {
            this.draggablePanel.onDragEnd = () => this._savePanelState();
        }
    }

    refreshViews() {
        if (!this.simulationInterface || !this.uiElements.worldSetupGrid) return;
        this._populateWorldSetupGrid();
        const worldSettings = this.simulationInterface.getWorldSettings();
        this.worldSliderComponents.forEach((slider, i) => {
            if (worldSettings[i]) {
                slider.setValue(worldSettings[i].initialDensity);
                
                const enableSwitch = this.uiElements.worldSetupGrid.querySelector(`#enableSwitch_${i}`);
                const enableLabel = this.uiElements.worldSetupGrid.querySelector(`label[for="enableSwitch_${i}"]`);
                if (enableSwitch) {
                    enableSwitch.checked = worldSettings[i].enabled;
                    if(enableLabel) enableLabel.textContent = worldSettings[i].enabled ? 'Enabled' : 'Disabled';
                }
            }
        });
    }

    _populateWorldSetupGrid() {
        const grid = this.uiElements.worldSetupGrid;
        grid.innerHTML = '';
        this.worldSliderComponents = []; 
        const fragment = document.createDocumentFragment();
        const worldSettings = this.simulationInterface.getWorldSettings();

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = worldSettings[i] || { initialDensity: 0.5, enabled: true };
            const cell = document.createElement('div');
            cell.className = 'world-config-cell';
            const label = document.createElement('div');
            label.className = 'world-label';
            label.textContent = `World ${i}`;
            cell.appendChild(label);
            const densityControlDiv = document.createElement('div');
            densityControlDiv.className = 'density-control setting-control';
            const sliderMountPoint = document.createElement('div'); 
            densityControlDiv.appendChild(sliderMountPoint);
            cell.appendChild(densityControlDiv);

            const densitySlider = new SliderComponent(sliderMountPoint, {
                id: `densitySlider_${i}`,
                label: 'Density:',
                min: 0,
                max: 1,
                step: 0.001,
                value: settings.initialDensity,
                isBias: true, 
                unit: '',
                showValue: true, 
                onChange: (newDensity) => {
                    EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, { worldIndex: i, density: newDensity });
                }
            });
            this.worldSliderComponents.push(densitySlider);
            const enableControlDiv = document.createElement('div');
            enableControlDiv.className = 'enable-control setting-control';
            const enableSwitch = document.createElement('input');
            enableSwitch.type = 'checkbox';
            enableSwitch.id = `enableSwitch_${i}`;
            enableSwitch.className = 'enable-switch checkbox-input';
            enableSwitch.checked = settings.enabled;
            enableControlDiv.appendChild(enableSwitch);
            const enableLabelElement = document.createElement('label');
            enableLabelElement.htmlFor = `enableSwitch_${i}`;
            enableLabelElement.className = 'checkbox-label';
            enableLabelElement.textContent = settings.enabled ? 'Enabled' : 'Disabled';
            enableControlDiv.appendChild(enableLabelElement);
            cell.appendChild(enableControlDiv);
            enableSwitch.addEventListener('change', (event) => {
                const isEnabled = event.target.checked;
                enableLabelElement.textContent = isEnabled ? 'Enabled' : 'Disabled';
                EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex: i, isEnabled: isEnabled });
            });
            fragment.appendChild(cell);
        }
        grid.appendChild(fragment);
    }

    _savePanelState() {
        if (!this.panelElement) return;
        const state = {
            isOpen: !this.panelElement.classList.contains('hidden'),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
        };
        PersistenceService.savePanelState(this.panelIdentifier, state); 
    }

    _loadPanelState() {
        if (!this.panelElement) return;
        const savedState = PersistenceService.loadPanelState(this.panelIdentifier); 
        if (savedState.isOpen) {
            this.show(false); 
        } else {
            this.hide(false); 
        }
        if (savedState.x && savedState.x.endsWith('px')) {
            this.panelElement.style.left = savedState.x;
            if(this.panelElement.style.transform !== 'none' && parseFloat(savedState.x) > 0) {
                this.panelElement.style.transform = 'none';
            }
        }
        if (savedState.y && savedState.y.endsWith('px')) {
            this.panelElement.style.top = savedState.y;
            if(this.panelElement.style.transform !== 'none' && parseFloat(savedState.y) > 0) {
                this.panelElement.style.transform = 'none';
            }
        }
        if ( (!savedState.x || !savedState.y ) && this.panelElement.style.transform === 'none' && savedState.isOpen) {
            this.panelElement.style.left = '50%';
            this.panelElement.style.top = '50%';
            this.panelElement.style.transform = 'translate(-50%, -50%)';
        }
    }

    show(saveState = true) {
        this.draggablePanel.show(); 
        if (saveState) this._savePanelState();
        this.refreshViews(); 
    }

    hide(saveState = true) {
        this.draggablePanel.hide();
        if (saveState) this._savePanelState();
    }

    toggle() {
        const nowVisible = this.draggablePanel.toggle();
        this._savePanelState(); 
        if (nowVisible) {
            this.refreshViews();
        }
    }

    destroy() {
        this.draggablePanel.destroy();
        this.worldSliderComponents.forEach(slider => slider.destroy());
        this.worldSliderComponents = [];
    }

    isHidden(){
        return this.draggablePanel.isHidden();
    }
}