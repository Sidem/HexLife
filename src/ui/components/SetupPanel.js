// src/ui/components/SetupPanel.js
import * as Config from '../../core/config.js'; // No longer needed for LS_KEYs
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js'; // Import new service
import { SliderComponent } from './SliderComponent.js'; // Import new component

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
        this.panelIdentifier = 'setup'; // Add this
        this.uiElements = {
            closeButton: this.panelElement.querySelector('#closeSetupPanelButton'),
            worldSetupGrid: this.panelElement.querySelector('#worldSetupGrid'),
            applySetupButton: this.panelElement.querySelector('#applySetupButton'),
        };
        this.worldSliderComponents = []; // To store references to density sliders

        // Validate essential elements
        for (const key in this.uiElements) {
            if (!this.uiElements[key] && key !== 'closeButton') { // Close button might be styled differently
                 console.warn(`SetupPanel: UI element '${key}' not found within the panel.`);
            }
        }
        if (!this.uiElements.closeButton) { // Try common class if ID specific not found
            this.uiElements.closeButton = this.panelElement.querySelector('.close-panel-button');
        }

        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this._loadPanelState(); // Load position and open/closed state
        this._setupInternalListeners();
        this.refreshViews(); // Populate the grid
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => {
                this.hide();
            });
        }

        if (this.uiElements.applySetupButton) {
            this.uiElements.applySetupButton.addEventListener('click', () => {
                this.simulationInterface.resetAllWorldsToCurrentSettings();
                // Optionally, give some feedback or close the panel
                // alert("World settings applied and worlds have been reset!");
            });
        }
        if (this.uiElements.resetAllButton) {
            this.uiElements.resetAllButton.addEventListener('click', () => {
                if (confirm("Are you sure you want to reset all worlds to their initial configurations? This will also reset their enabled/disabled states.")) {
                    this.simulationInterface.resetAllWorldsToCurrentSettings(); // This function in simulation.js needs to handle its own state persistence
                    this.refreshViews();
                }
            });
        }
        // Listeners for dynamically created sliders/switches will be added in _populateWorldSetupGrid
        // Listen for drag events on the DraggablePanel to save state
        if (this.draggablePanel) {
            this.draggablePanel.onDragEnd = () => this._savePanelState();
        }
    }

    refreshViews() {
        if (!this.simulationInterface || !this.uiElements.worldSetupGrid) return;
        this._populateWorldSetupGrid();

        // If world settings can change outside of this panel,
        // you might need to update slider values here.
        const worldSettings = this.simulationInterface.getWorldSettings();
        this.worldSliderComponents.forEach((slider, i) => {
            if (worldSettings[i]) {
                slider.setValue(worldSettings[i].initialDensity);
                // Also update the 'enabled' checkbox state if it's managed here and can change elsewhere
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
        this.worldSliderComponents = []; // Clear previous instances
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

            // Density Control using SliderComponent
            const densityControlDiv = document.createElement('div');
            densityControlDiv.className = 'density-control setting-control';
            // The SliderComponent will create its own label if configured,
            // or we can have a separate one here. Let's use its internal label.
            // No need for densityLabel span or densityValueDisplay span explicitly here.

            const sliderMountPoint = document.createElement('div'); // Mount point for this world's slider
            densityControlDiv.appendChild(sliderMountPoint);
            cell.appendChild(densityControlDiv);

            const densitySlider = new SliderComponent(sliderMountPoint, {
                id: `densitySlider_${i}`,
                label: 'Density:', // SliderComponent will create this label
                min: 0,
                max: 1,
                step: 0.001,
                value: settings.initialDensity,
                isBias: true, // Treat density like bias for 3 decimal places
                unit: '',
                showValue: true, // The component handles its value display
                onChange: (newDensity) => {
                    this.simulationInterface.setWorldInitialDensity(i, newDensity);
                }
            });
            this.worldSliderComponents.push(densitySlider);


            // Enable/Disable Control
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
                this.simulationInterface.setWorldEnabled(i, isEnabled);
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
        PersistenceService.savePanelState(this.panelIdentifier, state); // Use service
    }

    _loadPanelState() {
        if (!this.panelElement) return;
        const savedState = PersistenceService.loadPanelState(this.panelIdentifier); // Use service
        
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