// src/ui/components/SetupPanel.js
import * as Config from '../../core/config.js'; // No longer needed for LS_KEYs
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js'; // Import new service

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
    }

    _populateWorldSetupGrid() {
        const grid = this.uiElements.worldSetupGrid;
        grid.innerHTML = ''; // Clear previous content
        const fragment = document.createDocumentFragment();
        const worldSettings = this.simulationInterface.getWorldSettings();

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = worldSettings[i] || { initialDensity: 0.5, enabled: true }; // Fallback

            const cell = document.createElement('div');
            cell.className = 'world-config-cell';

            const label = document.createElement('div');
            label.className = 'world-label';
            label.textContent = `World ${i}`;
            cell.appendChild(label);

            // Density Control
            const densityControlDiv = document.createElement('div');
            densityControlDiv.className = 'density-control setting-control';

            const densityLabel = document.createElement('label');
            densityLabel.htmlFor = `densitySlider_${i}`;
            densityLabel.textContent = 'Density:';
            densityControlDiv.appendChild(densityLabel);

            const densitySlider = document.createElement('input');
            densitySlider.type = 'range';
            densitySlider.id = `densitySlider_${i}`;
            densitySlider.className = 'density-slider';
            densitySlider.min = 0;
            densitySlider.max = 1;
            densitySlider.step = 0.001; // Finer control for density
            densitySlider.value = settings.initialDensity;
            densityControlDiv.appendChild(densitySlider);

            const densityValueDisplay = document.createElement('span');
            densityValueDisplay.id = `densityValue_${i}`;
            densityValueDisplay.className = 'value-display density-value-display'; // Use common class
            densityValueDisplay.textContent = parseFloat(settings.initialDensity).toFixed(3);
            densityControlDiv.appendChild(densityValueDisplay);
            cell.appendChild(densityControlDiv);

            // Enable/Disable Control
            const enableControlDiv = document.createElement('div');
            enableControlDiv.className = 'enable-control setting-control';

            const enableSwitch = document.createElement('input');
            enableSwitch.type = 'checkbox';
            enableSwitch.id = `enableSwitch_${i}`;
            enableSwitch.className = 'enable-switch checkbox-input'; // Use common class
            enableSwitch.checked = settings.enabled;
            enableControlDiv.appendChild(enableSwitch);

            const enableLabel = document.createElement('label');
            enableLabel.htmlFor = `enableSwitch_${i}`;
            enableLabel.className = 'checkbox-label'; // Use common class
            enableLabel.textContent = settings.enabled ? 'Enabled' : 'Disabled';
            enableControlDiv.appendChild(enableLabel);
            cell.appendChild(enableControlDiv);

            // Event Listeners for this world's controls
            densitySlider.addEventListener('input', (event) => {
                const newDensity = parseFloat(event.target.value);
                densityValueDisplay.textContent = newDensity.toFixed(3);
                this.simulationInterface.setWorldInitialDensity(i, newDensity);
            });

            densitySlider.addEventListener('wheel', (event) => { // Optional: Wheel support for sliders
                event.preventDefault();
                const step = parseFloat(densitySlider.step) || 0.01;
                let currentValue = parseFloat(densitySlider.value);
                currentValue += event.deltaY < 0 ? step : -step;
                currentValue = Math.max(parseFloat(densitySlider.min), Math.min(parseFloat(densitySlider.max), currentValue));
                densitySlider.value = currentValue;
                densityValueDisplay.textContent = currentValue.toFixed(3);
                this.simulationInterface.setWorldInitialDensity(i, currentValue);
            }, { passive: false });


            enableSwitch.addEventListener('change', (event) => {
                const isEnabled = event.target.checked;
                enableLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
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
        // Any other cleanup
    }

    isHidden(){
        return this.draggablePanel.isHidden();
    }
}