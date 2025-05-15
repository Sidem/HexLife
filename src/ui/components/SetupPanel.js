import * as Config from '../../core/config.js';
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { SliderComponent } from './SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class SetupPanel {
    constructor(panelElement, simulationInterface) {
        if (!panelElement || !simulationInterface) {
            console.error('SetupPanel: panelElement or simulationInterface is null or undefined.');
            return;
        }
        this.panelElement = panelElement;
        this.simulationInterface = simulationInterface;
        this.panelIdentifier = 'setup';
        this.uiElements = {
            closeButton: panelElement.querySelector('#closeSetupPanelButton') || panelElement.querySelector('.close-panel-button'),
            worldSetupGrid: panelElement.querySelector('#worldSetupGrid'),
            applySetupButton: panelElement.querySelector('#applySetupButton'), // This is "Apply & Reset All Worlds"
        };
        this.worldSliderComponents = [];
        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this._loadPanelState();
        this._setupInternalListeners();
        if (!this.panelElement.classList.contains('hidden')) this.refreshViews();
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => this.hide());
        }
        if (this.uiElements.applySetupButton) { // "Apply & Reset All Worlds"
            this.uiElements.applySetupButton.addEventListener('click', () => {
                // This resets all worlds to their initial densities, using their respective current rulesets.
                // If the intent is to make all worlds use the "primary/selected" ruleset,
                // then this command needs to be augmented or preceded by a ruleset copy command.
                // For now, it resets with their own rulesets.
                EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, { scope: 'all' });
            });
        }
        if (this.uiElements.worldSetupGrid) {
            this.uiElements.worldSetupGrid.addEventListener('click', (event) => {
                if (event.target.classList.contains('set-ruleset-button')) {
                    const worldIndex = parseInt(event.target.dataset.worldIndex, 10);
                    if (!isNaN(worldIndex)) {
                        // This button copies the ruleset from the currently selected world (main view)
                        // to this specific world (worldIndex) and then resets worldIndex.
                        EventBus.dispatch(EVENTS.COMMAND_RESET_WORLDS_WITH_CURRENT_RULESET, {
                            scope: worldIndex,
                            copyPrimaryRuleset: true // Signal to copy selected world's ruleset
                        });
                    }
                }
            });
        }
        if (this.draggablePanel) this.draggablePanel.onDragEnd = () => this._savePanelState();
    }

    refreshViews() {
        if (!this.simulationInterface || !this.uiElements.worldSetupGrid || this.isHidden()) return;
        this._populateWorldSetupGrid();
    }

    _populateWorldSetupGrid() {
        const grid = this.uiElements.worldSetupGrid;
        grid.innerHTML = '';
        this.worldSliderComponents.forEach(slider => slider.destroy());
        this.worldSliderComponents = [];
        const fragment = document.createDocumentFragment();
        const worldSettings = this.simulationInterface.getWorldSettings(); // Now includes per-world rulesetHex

        for (let i = 0; i < Config.NUM_WORLDS; i++) {
            const settings = worldSettings[i] || { initialDensity: 0.5, enabled: true, rulesetHex: "0".repeat(32) };
            const cell = document.createElement('div'); cell.className = 'world-config-cell';
            cell.innerHTML = `<div class="world-label">World ${i}</div>` +
                             `<div class="setting-control density-control"><div id="densitySliderMount_${i}"></div></div>` +
                             `<div class="setting-control enable-control">` +
                                `<input type="checkbox" id="enableSwitch_${i}" class="enable-switch checkbox-input" ${settings.enabled ? 'checked' : ''}>` +
                                `<label for="enableSwitch_${i}" class="checkbox-label">${settings.enabled ? 'Enabled' : 'Disabled'}</label>` +
                             `</div>` +
                             `<button class="button set-ruleset-button" data-world-index="${i}" title="Apply selected world's ruleset to World ${i} & reset">Use Main Ruleset</button>`;
            
            const sliderMount = cell.querySelector(`#densitySliderMount_${i}`);
            const densitySlider = new SliderComponent(sliderMount, {
                id: `densitySlider_${i}`, label: 'Density:', min: 0, max: 1, step: 0.001,
                value: settings.initialDensity, unit: '', showValue: true,
                onChange: (newDensity) => EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_INITIAL_DENSITY, { worldIndex: i, density: newDensity })
            });
            this.worldSliderComponents.push(densitySlider);
            
            const enableSwitch = cell.querySelector(`#enableSwitch_${i}`);
            const enableLabel = cell.querySelector(`label[for="enableSwitch_${i}"]`);
            enableSwitch.addEventListener('change', (event) => {
                const isEnabled = event.target.checked;
                enableLabel.textContent = isEnabled ? 'Enabled' : 'Disabled';
                EventBus.dispatch(EVENTS.COMMAND_SET_WORLD_ENABLED, { worldIndex: i, isEnabled: isEnabled });
            });
            fragment.appendChild(cell);
        }
        grid.appendChild(fragment);
    }

    _savePanelState() {
        if (!this.panelElement) return;
        PersistenceService.savePanelState(this.panelIdentifier, {
            isOpen: !this.panelElement.classList.contains('hidden'),
            x: this.panelElement.style.left, y: this.panelElement.style.top,
        });
    }
    _loadPanelState() {
        if(!this.panelElement)return; const s=PersistenceService.loadPanelState(this.panelIdentifier);
        if(s.isOpen)this.show(false);else this.hide(false); if(s.x)this.panelElement.style.left=s.x;if(s.y)this.panelElement.style.top=s.y;
        if((s.x||s.y)&&parseFloat(this.panelElement.style.left)>0&&parseFloat(this.panelElement.style.top)>0)this.panelElement.style.transform='none';
        else if(this.panelElement.style.transform==='none'&&s.isOpen){this.panelElement.style.left='50%';this.panelElement.style.top='50%';this.panelElement.style.transform='translate(-50%,-50%)';}
    }
    show(s=true){this.draggablePanel.show();this.refreshViews();if(s)this._savePanelState();}
    hide(s=true){this.draggablePanel.hide();if(s)this._savePanelState();}
    toggle(){const v=this.draggablePanel.toggle();this.refreshViews();this._savePanelState();return v;}
    destroy(){this.draggablePanel.destroy();this.worldSliderComponents.forEach(s=>s.destroy());this.worldSliderComponents=[];}
    isHidden(){return this.draggablePanel.isHidden();}
}