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
                // This button now resets ALL worlds using their current density settings and the global ruleset.
                EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'all' });
            });
        }
        
        if (this.draggablePanel) {
            this.draggablePanel.onDragEnd = () => this._savePanelState();
        }

        // Event delegation for "Set Current Ruleset" buttons
        if (this.uiElements.worldSetupGrid) {
            this.uiElements.worldSetupGrid.addEventListener('click', (event) => {
                if (event.target.classList.contains('set-ruleset-button')) {
                    const worldIndex = parseInt(event.target.dataset.worldIndex, 10);
                    if (!isNaN(worldIndex)) {
                        console.log(`SetupPanel: Applying current ruleset to world ${worldIndex}`);
                        EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: worldIndex });
                    }
                }
            });
        }
    }

    refreshViews() {
        if (!this.simulationInterface || !this.uiElements.worldSetupGrid || this.isHidden()) return;
        this._populateWorldSetupGrid(); // This will re-add listeners correctly due to innerHTML clear
        const worldSettings = this.simulationInterface.getWorldSettings();
        
        // This loop is now part of _populateWorldSetupGrid's value setting
        // this.worldSliderComponents.forEach((slider, i) => { ... });
    }

    _populateWorldSetupGrid() {
        const grid = this.uiElements.worldSetupGrid;
        grid.innerHTML = ''; // Clear existing grid and listeners
        this.worldSliderComponents.forEach(slider => slider.destroy()); // Destroy old slider components
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

            // Add "Set Current Ruleset" button
            const setRulesetButton = document.createElement('button');
            setRulesetButton.className = 'button set-ruleset-button';
            setRulesetButton.textContent = 'Use Main Ruleset';
            setRulesetButton.dataset.worldIndex = i;
            setRulesetButton.title = `Apply the current main ruleset to World ${i} and reset it.`;
            // Event listener for this button is handled by delegation in _setupInternalListeners
            cell.appendChild(setRulesetButton);
            
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
        this.refreshViews(); 
        if (saveState) this._savePanelState();
    }

    hide(saveState = true) {
        this.draggablePanel.hide();
        if (saveState) this._savePanelState();
    }

    toggle() {
        const nowVisible = this.draggablePanel.toggle();
        this.refreshViews();
        this._savePanelState(); 
        return nowVisible;
    }

    destroy() {
        this.draggablePanel.destroy();
        this.worldSliderComponents.forEach(slider => slider.destroy());
        this.worldSliderComponents = [];
        // Remove delegated event listener if panel itself is removed from DOM elsewhere
        // For now, assuming panelElement persists and is only hidden/shown
    }

    isHidden(){
        return this.draggablePanel.isHidden();
    }
}