// src/ui/components/RulesetEditor.js
//import * as Config from '../../core/config.js'; // No longer needed for LS_KEYs
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js'; // Import new service

export class RulesetEditor {
    constructor(panelElement, simulationInterface) {
        if (!panelElement) {
            console.error('RulesetEditor: panelElement is null or undefined.');
            return;
        }
        if (!simulationInterface) {
            console.error('RulesetEditor: simulationInterface is null or undefined.');
            return;
        }

        this.panelElement = panelElement;
        this.simInterface = simulationInterface;
        this.panelIdentifier = 'ruleset'; // Add this
        this.uiElements = {
            closeButton: this.panelElement.querySelector('#closeEditorButton') || this.panelElement.querySelector('.close-panel-button'),
            editorRulesetInput: this.panelElement.querySelector('#editorRulesetInput'),
            clearRulesButton: this.panelElement.querySelector('#clearRulesButton'),
            rulesetEditorMode: this.panelElement.querySelector('#rulesetEditorMode'),
            rulesetEditorGrid: this.panelElement.querySelector('#rulesetEditorGrid'),
            neighborCountRulesetEditorGrid: this.panelElement.querySelector('#neighborCountRulesetEditorGrid'),
        };

        for (const key in this.uiElements) {
            if (!this.uiElements[key]) {
                console.warn(`RulesetEditor: UI element '${key}' not found within the panel.`);
            }
        }

        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this._loadPanelState(); // Load position and open/closed state
        this._setupInternalListeners();
        // refreshViews will be called by show/toggle or explicitly if needed
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => this.hide());
        }

        if (this.uiElements.rulesetEditorMode) {
            this.uiElements.rulesetEditorMode.addEventListener('change', () => {
                this.refreshViews();
            });
        }

        if (this.uiElements.clearRulesButton) {
            this.uiElements.clearRulesButton.addEventListener('click', () => {
                const currentArr = this.simInterface.getCurrentRulesetArray();
                const isCurrentlyAllInactive = currentArr.every(state => state === 0);
                const targetState = isCurrentlyAllInactive ? 1 : 0;
                this.simInterface.setAllRulesState(targetState);
                this.refreshViews();
            });
        }

        const handleEditorInputChange = () => {
            if (!this.uiElements.editorRulesetInput) return;
            const hexString = this.uiElements.editorRulesetInput.value.trim().toUpperCase();
            if (!hexString) {
                this.refreshViews();
                return;
            }
            if (!/^[0-9A-F]{32}$/.test(hexString)) {
                alert("Invalid Hex Code in Editor: Must be 32 hexadecimal characters (0-9, A-F).\nReverting to current ruleset.");
            } else {
                const success = this.simInterface.setRuleset(hexString);
                if (!success) {
                     alert("Error setting ruleset from editor. The ruleset might have been rejected.\nReverting to current ruleset.");
                }
            }
            this.refreshViews();
        };

        if (this.uiElements.editorRulesetInput) {
            this.uiElements.editorRulesetInput.addEventListener('change', handleEditorInputChange);
            this.uiElements.editorRulesetInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleEditorInputChange();
                    this.uiElements.editorRulesetInput.blur();
                }
            });
        }

        if (this.uiElements.rulesetEditorGrid) {
            this.uiElements.rulesetEditorGrid.addEventListener('click', (event) => {
                const ruleVizElement = event.target.closest('.rule-viz');
                if (ruleVizElement && ruleVizElement.dataset.ruleIndex !== undefined) {
                    const ruleIndex = parseInt(ruleVizElement.dataset.ruleIndex, 10);
                    if (!isNaN(ruleIndex)) {
                        this.simInterface.toggleRuleOutputState(ruleIndex);
                        this.refreshViews();
                    }
                }
            });
        }

        if (this.uiElements.setAllDeadButton) {
            this.uiElements.setAllDeadButton.addEventListener('click', () => {
                this.simInterface.setAllRulesState(0);
                if (this.simInterface.getResetOnNewRule()) this.simInterface.resetAllWorldsToCurrentSettings();
                this.refreshViews();
                this.simInterface.refreshAllRulesetViews();
            });
        }

        if (this.uiElements.setAllAliveButton) {
            this.uiElements.setAllAliveButton.addEventListener('click', () => {
                this.simInterface.setAllRulesState(1);
                if (this.simInterface.getResetOnNewRule()) this.simInterface.resetAllWorldsToCurrentSettings();
                this.refreshViews();
                this.simInterface.refreshAllRulesetViews();
            });
        }

        if (this.uiElements.invertAllButton) {
            this.uiElements.invertAllButton.addEventListener('click', () => {
                const currentRuleset = this.simInterface.getCurrentRuleset();
                for(let i = 0; i < currentRuleset.length; i++) {
                    this.simInterface.toggleRuleOutputState(i); // This will save each toggle, might be inefficient
                } // Consider a batch toggle if performance is an issue.
                if (this.simInterface.getResetOnNewRule()) this.simInterface.resetAllWorldsToCurrentSettings();
                this.refreshViews();
                this.simInterface.refreshAllRulesetViews();
            });
        }

        // Listen for drag events on the DraggablePanel to save state
        if (this.draggablePanel) {
            this.draggablePanel.onDragEnd = () => this._savePanelState();
        }
    }

    refreshViews() {
        if (!this.simInterface || this.panelElement.classList.contains('hidden')) return;

        const currentHex = this.simInterface.getCurrentRulesetHex();
        const currentArr = this.simInterface.getCurrentRulesetArray();

        if (this.uiElements.editorRulesetInput) {
            this.uiElements.editorRulesetInput.value = (currentHex === "Error" || currentHex === "N/A") ? "" : currentHex;
        }
        this._updateEditorGrids(currentArr);
    }

    _updateEditorGrids(rulesetArray) {
        // ... (rest of _updateEditorGrids, _populateDetailedGrid, _populateNeighborCountGrid unchanged from before)
        if (!this.uiElements.rulesetEditorMode || !this.uiElements.rulesetEditorGrid || !this.uiElements.neighborCountRulesetEditorGrid) {
            return;
        }
        const currentMode = this.uiElements.rulesetEditorMode.value;

        if (currentMode === 'detailed') {
            this.uiElements.rulesetEditorGrid.classList.remove('hidden');
            this.uiElements.neighborCountRulesetEditorGrid.classList.add('hidden');
            this._populateDetailedGrid(rulesetArray);
        } else { // neighborCount
            this.uiElements.rulesetEditorGrid.classList.add('hidden');
            this.uiElements.neighborCountRulesetEditorGrid.classList.remove('hidden');
            this._populateNeighborCountGrid();
        }
    }

    _populateDetailedGrid(rulesetArray) {
        const grid = this.uiElements.rulesetEditorGrid;
        if (!grid || !rulesetArray || rulesetArray.length !== 128) {
            console.warn("Cannot update detailed ruleset editor grid - missing element or invalid ruleset array.");
            if (grid) {
                grid.innerHTML = '<p style="color:red; text-align:center;">Error loading detailed editor.</p>';
            }
            return;
        }

        grid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 128; i++) {
            const centerState = (i >> 6) & 1;
            const neighborMask = i & 0x3F;
            const outputState = rulesetArray[i];
            const ruleViz = document.createElement('div');
            ruleViz.className = 'rule-viz';
            ruleViz.title = `Rule ${i}: Input C=${centerState} N=${neighborMask.toString(2).padStart(6, '0')} -> Output C=${outputState}\n(Click inner hex to toggle output)`;
            ruleViz.dataset.ruleIndex = i;
            const centerHex = document.createElement('div');
            centerHex.className = `hexagon center-hex state-${centerState}`;
            const innerHex = document.createElement('div');
            innerHex.className = `hexagon inner-hex state-${outputState}`;
            centerHex.appendChild(innerHex);
            ruleViz.appendChild(centerHex);
            for (let n = 0; n < 6; n++) {
                const neighborState = (neighborMask >> n) & 1;
                const neighborHex = document.createElement('div');
                neighborHex.className = `hexagon neighbor-hex neighbor-${n} state-${neighborState}`;
                ruleViz.appendChild(neighborHex);
            }
            fragment.appendChild(ruleViz);
        }
        grid.appendChild(fragment);
    }

    _populateNeighborCountGrid() {
        const grid = this.uiElements.neighborCountRulesetEditorGrid;
        if (!grid || !this.simInterface) {
            console.warn("Cannot update N-count editor grid - missing element or sim interface.");
            if (grid) {
                grid.innerHTML = '<p style="color:red; text-align:center;">Error loading N-count editor.</p>';
            }
            return;
        }
        grid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (let centerState = 0; centerState <= 1; centerState++) {
            for (let numActive = 0; numActive <= 6; numActive++) {
                const effectiveOutput = this.simInterface.getEffectiveRuleForNeighborCount(centerState, numActive);
                const ruleViz = document.createElement('div');
                ruleViz.className = 'neighbor-count-rule-viz';
                ruleViz.dataset.centerState = centerState;
                ruleViz.dataset.numActive = numActive;
                let outputDescription = 'OFF';
                if (effectiveOutput === 1) outputDescription = 'ON';
                else if (effectiveOutput === 2) outputDescription = 'MIXED';
                ruleViz.title = `Center ${centerState === 1 ? 'ON' : 'OFF'}, ${numActive} Neighbors ON -> Result ${outputDescription}\n(Click to toggle output batch)`;
                const vizCenterHex = document.createElement('div');
                vizCenterHex.className = `hexagon center-hex state-${centerState}`;
                const vizInnerHex = document.createElement('div');
                vizInnerHex.className = `hexagon inner-hex state-${effectiveOutput}`;
                vizCenterHex.appendChild(vizInnerHex);
                const label = document.createElement('div');
                label.className = 'neighbor-count-label';
                label.innerHTML = `Center: ${centerState === 1 ? '<b>ON</b>' : 'OFF'}<br>${numActive}/6 N-ON &rarr; ${outputDescription}`;
                ruleViz.appendChild(label);
                ruleViz.appendChild(vizCenterHex);
                ruleViz.addEventListener('click', () => {
                    const cs = parseInt(ruleViz.dataset.centerState, 10);
                    const na = parseInt(ruleViz.dataset.numActive, 10);
                    const currentEffOutput = this.simInterface.getEffectiveRuleForNeighborCount(cs, na);
                    const newOutput = (currentEffOutput === 1 || currentEffOutput === 2) ? 0 : 1;
                    this.simInterface.setRulesForNeighborCountCondition(cs, na, newOutput);
                    this.refreshViews();
                });
                fragment.appendChild(ruleViz);
            }
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
        if (savedState.x && savedState.x.endsWith('px')) this.panelElement.style.left = savedState.x;
        if (savedState.y && savedState.y.endsWith('px')) this.panelElement.style.top = savedState.y;

        if ((savedState.x || savedState.y) && parseFloat(this.panelElement.style.left) > 0 && parseFloat(this.panelElement.style.top) > 0) {
            this.panelElement.style.transform = 'none';
        } else if (this.panelElement.style.transform === 'none' && savedState.isOpen) {
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
        this._savePanelState();
        if (nowVisible) {
            this.refreshViews();
        }
    }

    destroy() {
        this.draggablePanel.destroy();
        this.panelElement = null;
        this.simInterface = null;
        this.draggablePanel = null;
    }

    isHidden() {
        return this.draggablePanel.isHidden();
    }
}