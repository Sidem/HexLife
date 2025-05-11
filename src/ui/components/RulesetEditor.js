// src/ui/components/RulesetEditor.js
import { DraggablePanel } from './DraggablePanel.js';

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
        this.uiElements = {
            closeButton: this.panelElement.querySelector('#closeEditorButton'),
            editorRulesetInput: this.panelElement.querySelector('#editorRulesetInput'),
            clearRulesButton: this.panelElement.querySelector('#clearRulesButton'),
            rulesetEditorMode: this.panelElement.querySelector('#rulesetEditorMode'),
            rulesetEditorGrid: this.panelElement.querySelector('#rulesetEditorGrid'),
            neighborCountRulesetEditorGrid: this.panelElement.querySelector('#neighborCountRulesetEditorGrid'),
            // Add any other elements specifically managed by this component
        };

        // Validate essential elements
        for (const key in this.uiElements) {
            if (!this.uiElements[key]) {
                console.warn(`RulesetEditor: UI element '${key}' not found within the panel.`);
            }
        }

        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3'); // Assuming 'h3' is the drag handle
        this._setupInternalListeners();
        this.refreshViews(); // Initial population of views
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
                this.refreshViews(); // Refresh to show updated state
            });
        }

        const handleEditorInputChange = () => {
            if (!this.uiElements.editorRulesetInput) return;
            const hexString = this.uiElements.editorRulesetInput.value.trim().toUpperCase();
            if (!hexString) {
                this.refreshViews(); // Revert to current ruleset hex if cleared
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
            this.refreshViews(); // Refresh to show (potentially new) current ruleset
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
                        this.refreshViews(); // Update the visuals
                    }
                }
            });
        }
        // Listener for neighborCountRulesetEditorGrid will be added in _populateNeighborCountGrid
        // as its elements are dynamically created.
    }

    refreshViews() {
        if (!this.simInterface) return;

        const currentHex = this.simInterface.getCurrentRulesetHex();
        const currentArr = this.simInterface.getCurrentRulesetArray();

        if (this.uiElements.editorRulesetInput) {
            this.uiElements.editorRulesetInput.value = (currentHex === "Error" || currentHex === "N/A") ? "" : currentHex;
        }
        this._updateEditorGrids(currentArr);
    }

    _updateEditorGrids(rulesetArray) {
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

        grid.innerHTML = ''; // Clear previous content
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
                // Standard neighbor order for visualization: 0:SE, 1:NE, 2:N, 3:NW, 4:SW, 5:S
                // This needs to map to the bit order in neighborMask (e.g., bit 0 = neighbor 0, etc.)
                const neighborState = (neighborMask >> n) & 1;
                const neighborHex = document.createElement('div');
                // The class `neighbor-${n}` is for CSS positioning
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

        grid.innerHTML = ''; // Clear previous content
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
                // state-2 for mixed, state-1 for ON, state-0 for OFF
                vizInnerHex.className = `hexagon inner-hex state-${effectiveOutput}`;
                vizCenterHex.appendChild(vizInnerHex);

                const label = document.createElement('div');
                label.className = 'neighbor-count-label';
                label.innerHTML = `Center: ${centerState === 1 ? '<b>ON</b>' : 'OFF'}<br>${numActive}/6 N-ON &rarr; ${outputDescription}`;

                ruleViz.appendChild(label); // Label first for better layout
                ruleViz.appendChild(vizCenterHex);

                // Add event listener directly here as elements are created
                ruleViz.addEventListener('click', () => {
                    const cs = parseInt(ruleViz.dataset.centerState, 10);
                    const na = parseInt(ruleViz.dataset.numActive, 10);
                    const currentEffOutput = this.simInterface.getEffectiveRuleForNeighborCount(cs, na);
                    // Toggle logic: if 1 or mixed(2), go to 0. If 0, go to 1.
                    const newOutput = (currentEffOutput === 1 || currentEffOutput === 2) ? 0 : 1;
                    this.simInterface.setRulesForNeighborCountCondition(cs, na, newOutput);
                    this.refreshViews(); // Re-render all rule views
                });

                fragment.appendChild(ruleViz);
            }
        }
        grid.appendChild(fragment);
    }

    show() {
        this.draggablePanel.show();
        this.refreshViews(); // Refresh content when shown
    }

    hide() {
        this.draggablePanel.hide();
    }

    toggle() {
        const nowVisible = this.draggablePanel.toggle();
        if (nowVisible) {
            this.refreshViews();
        }
    }

    // Optional: If this component itself could be "destroyed" or removed from UI
    destroy() {
        this.draggablePanel.destroy();
        // Remove other event listeners added by this component if necessary
        // For example, if listeners were added to elements outside this.panelElement
    }
}