// src/ui/components/SetupPanel.js
import * as Config from '../../core/config.js'; // For NUM_WORLDS and localStorage keys
import { DraggablePanel } from './DraggablePanel.js';

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
        this.simInterface = simulationInterface;
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
                this.simInterface.resetAllWorldsToCurrentSettings();
                // Optionally, give some feedback or close the panel
                // alert("World settings applied and worlds have been reset!");
            });
        }
        // Listeners for dynamically created sliders/switches will be added in _populateWorldSetupGrid
    }

    refreshViews() {
        if (!this.simInterface || !this.uiElements.worldSetupGrid) return;
        this._populateWorldSetupGrid();
    }

    _populateWorldSetupGrid() {
        const grid = this.uiElements.worldSetupGrid;
        grid.innerHTML = ''; // Clear previous content
        const fragment = document.createDocumentFragment();
        const worldSettings = this.simInterface.getWorldSettings();

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
                this.simInterface.setWorldInitialDensity(i, newDensity);
            });

            densitySlider.addEventListener('wheel', (event) => { // Optional: Wheel support for sliders
                event.preventDefault();
                const step = parseFloat(densitySlider.step) || 0.01;
                let currentValue = parseFloat(densitySlider.value);
                currentValue += event.deltaY < 0 ? step : -step;
                currentValue = Math.max(parseFloat(densitySlider.min), Math.min(parseFloat(densitySlider.max), currentValue));
                densitySlider.value = currentValue;
                densityValueDisplay.textContent = currentValue.toFixed(3);
                this.simInterface.setWorldInitialDensity(i, currentValue);
            }, { passive: false });


            enableSwitch.addEventListener('change', (event) => {
                const isEnabled = event.target.checked;
                enableLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
                this.simInterface.setWorldEnabled(i, isEnabled);
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
        try {
            localStorage.setItem(Config.LS_KEY_SETUP_PANEL_STATE, JSON.stringify(state));
        } catch (e) {
            console.error("Error saving setup panel state to localStorage:", e);
        }
    }

    _loadPanelState() {
        if (!this.panelElement) return;
        try {
            const savedStateJSON = localStorage.getItem(Config.LS_KEY_SETUP_PANEL_STATE);
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                if (savedState.isOpen) {
                    this.show(false); // Show without re-saving state immediately
                } else {
                    this.hide(false); // Hide without re-saving state immediately
                }
                // Restore position if valid pixel values
                if (savedState.x && savedState.x.endsWith('px')) {
                     this.panelElement.style.left = savedState.x;
                     // Ensure transform is none if position is set, DraggablePanel handles this on first drag
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
                 // If no explicit position, DraggablePanel default (CSS centering) will apply
                 if ( (!savedState.x || !savedState.y ) && this.panelElement.style.transform === 'none' && savedState.isOpen) {
                    // If it was open but had no position, re-center it via transform
                    this.panelElement.style.left = '50%';
                    this.panelElement.style.top = '50%';
                    this.panelElement.style.transform = 'translate(-50%, -50%)';
                 }

            } else {
                // Default to hidden if no saved state
                this.hide(false);
            }
        } catch (e) {
            console.error("Error loading setup panel state from localStorage:", e);
            this.hide(false); // Default to hidden on error
        }
    }

    show(saveState = true) {
        this.draggablePanel.show(); // DraggablePanel's show handles class and centering logic
        if (saveState) this._savePanelState();
        this.refreshViews(); // Refresh content when shown
    }

    hide(saveState = true) {
        this.draggablePanel.hide();
        if (saveState) this._savePanelState();
    }

    toggle() {
        const nowVisible = this.draggablePanel.toggle();
        this._savePanelState(); // Save state after toggle
        if (nowVisible) {
            this.refreshViews();
        }
    }

    destroy() {
        this.draggablePanel.destroy();
        // Any other cleanup
    }
}