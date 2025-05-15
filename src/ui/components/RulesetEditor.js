// src/ui/components/RulesetEditor.js
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

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
        this.simInterface = simulationInterface; // Will have getCanonicalRuleDetails, etc.
        this.panelIdentifier = 'ruleset';
        this.uiElements = {
            closeButton: this.panelElement.querySelector('#closeEditorButton') || this.panelElement.querySelector('.close-panel-button'),
            editorRulesetInput: this.panelElement.querySelector('#editorRulesetInput'),
            clearRulesButton: this.panelElement.querySelector('#clearRulesButton'),
            rulesetEditorMode: this.panelElement.querySelector('#rulesetEditorMode'),
            rulesetEditorGrid: this.panelElement.querySelector('#rulesetEditorGrid'),
            neighborCountRulesetEditorGrid: this.panelElement.querySelector('#neighborCountRulesetEditorGrid'),
            rotationalSymmetryRulesetEditorGrid: this.panelElement.querySelector('#rotationalSymmetryRulesetEditorGrid'), // Added
        };

        for (const key in this.uiElements) {
            if (!this.uiElements[key]) {
                console.warn(`RulesetEditor: UI element '${key}' not found within the panel.`);
            }
        }
        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this._loadPanelState(); // This also calls show/hide which might trigger refreshViews
        this._setupInternalListeners();
        // Initial refresh if panel is loaded visible
        if (!this.panelElement.classList.contains('hidden')) {
            this.refreshViews();
        }
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) {
            this.uiElements.closeButton.addEventListener('click', () => this.hide());
        }

        if (this.uiElements.rulesetEditorMode) {
            this.uiElements.rulesetEditorMode.addEventListener('change', () => {
                this.refreshViews(); // This will now handle the new mode
            });
        }

        if (this.uiElements.clearRulesButton) {
            this.uiElements.clearRulesButton.addEventListener('click', () => {
                const currentArr = this.simInterface.getCurrentRulesetArray();
                const isCurrentlyAllInactive = currentArr.every(state => state === 0);
                const targetState = isCurrentlyAllInactive ? 1 : 0;
                EventBus.dispatch(EVENTS.COMMAND_SET_ALL_RULES_STATE, targetState);
                // Ruleset_changed event will trigger refreshViews if panel is open
            });
        }

        const handleEditorInputChange = () => {
            if (!this.uiElements.editorRulesetInput) return;
            const hexString = this.uiElements.editorRulesetInput.value.trim().toUpperCase();
            if (!hexString) { // If input is cleared, refresh to show current ruleset hex
                const currentHex = this.simInterface.getCurrentRulesetHex();
                this.uiElements.editorRulesetInput.value = (currentHex === "Error" || currentHex === "N/A") ? "" : currentHex;
                // No need to dispatch an event here, just visual refresh of input
                return;
            }
            if (!/^[0-9A-F]{32}$/.test(hexString)) {
                alert("Invalid Hex Code in Editor: Must be 32 hexadecimal characters (0-9, A-F).\nReverting to current ruleset.");
                const currentHex = this.simInterface.getCurrentRulesetHex(); // Revert display
                this.uiElements.editorRulesetInput.value = (currentHex === "Error" || currentHex === "N/A") ? "" : currentHex;
            } else {
                EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, hexString);
            }
            // EventBus dispatch for RULESET_CHANGED will call refreshViews if successful
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
                        EventBus.dispatch(EVENTS.COMMAND_TOGGLE_RULE_OUTPUT, ruleIndex);
                    }
                }
            });
        }
        
        if (this.uiElements.neighborCountRulesetEditorGrid) {
             this.uiElements.neighborCountRulesetEditorGrid.addEventListener('click', (event) => {
                const ruleViz = event.target.closest('.neighbor-count-rule-viz');
                if (ruleViz && ruleViz.dataset.centerState !== undefined && ruleViz.dataset.numActive !== undefined) {
                    const cs = parseInt(ruleViz.dataset.centerState, 10);
                    const na = parseInt(ruleViz.dataset.numActive, 10);
                    const currentEffOutput = this.simInterface.getEffectiveRuleForNeighborCount(cs, na);
                    const newOutput = (currentEffOutput === 1 || currentEffOutput === 2) ? 0 : 1; // Toggle logic
                    EventBus.dispatch(EVENTS.COMMAND_SET_RULES_FOR_NEIGHBOR_COUNT, {
                        centerState: cs,
                        numActive: na,
                        outputState: newOutput
                    });
                }
            });
        }

        // Listener for Rotational Symmetry Grid
        if (this.uiElements.rotationalSymmetryRulesetEditorGrid) {
            this.uiElements.rotationalSymmetryRulesetEditorGrid.addEventListener('click', (event) => {
                const rSymRuleVizElement = event.target.closest('.r-sym-rule-viz');
                if (rSymRuleVizElement) {
                    const canonicalBitmask = parseInt(rSymRuleVizElement.dataset.canonicalBitmask, 10);
                    const centerState = parseInt(rSymRuleVizElement.dataset.centerState, 10);

                    if (!isNaN(canonicalBitmask) && !isNaN(centerState)) {
                        const currentEffectiveOutput = this.simInterface.getEffectiveRuleForCanonicalRepresentative(canonicalBitmask, centerState);
                        // Toggle logic: if ON or MIXED, turn OFF. If OFF, turn ON.
                        const newOutputState = (currentEffectiveOutput === 1 || currentEffectiveOutput === 2) ? 0 : 1;
                        EventBus.dispatch(EVENTS.COMMAND_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, {
                            canonicalBitmask,
                            centerState,
                            outputState: newOutputState
                        });
                    }
                }
            });
        }

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
        this._updateEditorGrids(currentArr); // Pass current ruleset array for detailed view
    }

    _updateEditorGrids(rulesetArray) { // rulesetArray is for detailed view
        if (!this.uiElements.rulesetEditorMode || !this.uiElements.rulesetEditorGrid || !this.uiElements.neighborCountRulesetEditorGrid || !this.uiElements.rotationalSymmetryRulesetEditorGrid) {
            console.warn("RulesetEditor: One or more grid elements are missing.");
            return;
        }
        const currentMode = this.uiElements.rulesetEditorMode.value;

        this.uiElements.rulesetEditorGrid.classList.add('hidden');
        this.uiElements.neighborCountRulesetEditorGrid.classList.add('hidden');
        this.uiElements.rotationalSymmetryRulesetEditorGrid.classList.add('hidden');

        if (currentMode === 'detailed') {
            this.uiElements.rulesetEditorGrid.classList.remove('hidden');
            this._populateDetailedGrid(rulesetArray);
        } else if (currentMode === 'neighborCount') {
            this.uiElements.neighborCountRulesetEditorGrid.classList.remove('hidden');
            this._populateNeighborCountGrid();
        } else if (currentMode === 'rotationalSymmetry') {
            this.uiElements.rotationalSymmetryRulesetEditorGrid.classList.remove('hidden');
            this._populateRotationalSymmetryGrid();
        } else { // Default or fallback
            this.uiElements.rulesetEditorGrid.classList.remove('hidden');
            this._populateDetailedGrid(rulesetArray);
        }
    }

    _populateDetailedGrid(rulesetArray) {
        const grid = this.uiElements.rulesetEditorGrid;
        if (!grid || !rulesetArray || rulesetArray.length !== 128) {
            // console.warn("Cannot update detailed ruleset editor grid - missing element or invalid ruleset array.");
            if (grid) grid.innerHTML = '<p style="color:red; text-align:center;">Error loading detailed editor.</p>';
            return;
        }

        grid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 128; i++) {
            const centerState = (i >> 6) & 1;
            const neighborMask = i & 0x3F; // Corrected to 0x3F (6 bits)
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
            // console.warn("Cannot update N-count editor grid - missing element or sim interface.");
            if (grid) grid.innerHTML = '<p style="color:red; text-align:center;">Error loading N-count editor.</p>';
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
                vizCenterHex.className = `hexagon center-hex state-${centerState}`; // Center cell's input state
                const vizInnerHex = document.createElement('div');
                vizInnerHex.className = `hexagon inner-hex state-${effectiveOutput}`; // Output state (0, 1, or 2 for mixed)
                vizCenterHex.appendChild(vizInnerHex);

                const label = document.createElement('div');
                label.className = 'neighbor-count-label';
                label.innerHTML = `Center: ${centerState === 1 ? '<b>ON</b>' : 'OFF'}<br>${numActive}/6 N-ON &rarr; ${outputDescription}`;

                ruleViz.appendChild(label);
                ruleViz.appendChild(vizCenterHex);
                // Click listener is now in _setupInternalListeners using event delegation
                fragment.appendChild(ruleViz);
            }
        }
        grid.appendChild(fragment);
    }

    _populateRotationalSymmetryGrid() {
        const grid = this.uiElements.rotationalSymmetryRulesetEditorGrid;
        if (!grid || !this.simInterface || typeof this.simInterface.getCanonicalRuleDetails !== 'function') {
            if (grid) grid.innerHTML = '<p style="color:red; text-align:center;">Error loading R-Sym editor.</p>';
            console.warn("R-Sym editor: Missing grid, simInterface, or getCanonicalRuleDetails function.");
            return;
        }

        const canonicalDetails = this.simInterface.getCanonicalRuleDetails();
        grid.innerHTML = '';
        const fragment = document.createDocumentFragment();

        for (const detail of canonicalDetails) {
            const rSymRuleViz = document.createElement('div');
            rSymRuleViz.className = 'r-sym-rule-viz';
            rSymRuleViz.dataset.canonicalBitmask = detail.canonicalBitmask;
            rSymRuleViz.dataset.centerState = detail.centerState;

            let outputDescription = 'OFF';
            if (detail.effectiveOutput === 1) outputDescription = 'ON';
            else if (detail.effectiveOutput === 2) outputDescription = 'MIXED';
            
            rSymRuleViz.title = `Center: ${detail.centerState === 1 ? 'ON' : 'OFF'}, N-Canon: ${detail.canonicalBitmask.toString(2).padStart(6, '0')}\nOrbit: ${detail.orbitSize} -> Result: ${outputDescription}\n(Click to toggle output for this group)`;

            // Label for C= and N_canon=
            const ruleLabel = document.createElement('div');
            ruleLabel.className = 'rule-label';
            ruleLabel.innerHTML = `C=${detail.centerState}, N<sub>c</sub>=${detail.canonicalBitmask.toString(2).padStart(6, '0')}`;
            rSymRuleViz.appendChild(ruleLabel);

            // Hex display container
            const hexDisplayWrapper = document.createElement('div');
            hexDisplayWrapper.className = 'rule-viz-hex-display'; // Styled in CSS for scaling

            const centerHex = document.createElement('div');
            centerHex.className = `hexagon center-hex state-${detail.centerState}`;
            const innerHex = document.createElement('div');
            // Use detail.effectiveOutput for the inner hex state (0, 1, or 2 for mixed)
            innerHex.className = `hexagon inner-hex state-${detail.effectiveOutput}`;
            centerHex.appendChild(innerHex);
            hexDisplayWrapper.appendChild(centerHex);

            // Display neighbors based on canonicalBitmask
            for (let n = 0; n < 6; n++) {
                const neighborState = (detail.canonicalBitmask >> n) & 1;
                const neighborHex = document.createElement('div');
                neighborHex.className = `hexagon neighbor-hex neighbor-${n} state-${neighborState}`;
                hexDisplayWrapper.appendChild(neighborHex);
            }
            rSymRuleViz.appendChild(hexDisplayWrapper);

            // Orbit size display
            const orbitDisplay = document.createElement('div');
            orbitDisplay.className = 'orbit-size-display';
            orbitDisplay.textContent = `Orbit: ${detail.orbitSize}`;
            rSymRuleViz.appendChild(orbitDisplay);

            fragment.appendChild(rSymRuleViz);
        }
        grid.appendChild(fragment);
    }


    _savePanelState() {
        if (!this.panelElement) return;
        const state = {
            isOpen: !this.panelElement.classList.contains('hidden'),
            x: this.panelElement.style.left,
            y: this.panelElement.style.top,
            // mode: this.uiElements.rulesetEditorMode ? this.uiElements.rulesetEditorMode.value : 'detailed' // Persist mode
        };
        PersistenceService.savePanelState(this.panelIdentifier, state);
         if (this.uiElements.rulesetEditorMode) { // Persist editor mode separately
            PersistenceService.saveUISetting('rulesetEditorMode', this.uiElements.rulesetEditorMode.value);
        }
    }

    _loadPanelState() {
        if (!this.panelElement) return;
        const savedState = PersistenceService.loadPanelState(this.panelIdentifier);

        if (this.uiElements.rulesetEditorMode) { // Load and apply editor mode
            const savedMode = PersistenceService.loadUISetting('rulesetEditorMode', 'rotationalSymmetry'); // Default to r-sym
            this.uiElements.rulesetEditorMode.value = savedMode;
        }

        if (savedState.isOpen) {
            this.show(false); // show will call refreshViews
        } else {
            this.hide(false);
        }

        // Restore position
        if (savedState.x && savedState.x.endsWith('px')) this.panelElement.style.left = savedState.x;
        if (savedState.y && savedState.y.endsWith('px')) this.panelElement.style.top = savedState.y;

        if ((savedState.x || savedState.y) && parseFloat(this.panelElement.style.left) > 0 && parseFloat(this.panelElement.style.top) > 0) {
            this.panelElement.style.transform = 'none';
        } else if (this.panelElement.style.transform === 'none' && savedState.isOpen) { // If no pos but should be open, center it
            this.panelElement.style.left = '50%';
            this.panelElement.style.top = '50%';
            this.panelElement.style.transform = 'translate(-50%, -50%)';
        }
    }

    show(saveState = true) {
        this.draggablePanel.show();
        this.refreshViews(); // Refresh content when shown
        if (saveState) this._savePanelState();
    }

    hide(saveState = true) {
        this.draggablePanel.hide();
        if (saveState) this._savePanelState();
    }

    toggle() {
        const isNowVisible = this.draggablePanel.toggle(); // toggle returns new visibility state
        if (isNowVisible) {
            this.refreshViews();
        }
        this._savePanelState(); // Save state after toggle
        return isNowVisible; // Return the new state
    }

    destroy() {
        if (this.draggablePanel) this.draggablePanel.destroy();
        // DOM listeners are removed by DraggablePanel's destroy or should be if added directly
        this.panelElement = null;
        this.simInterface = null;
        this.draggablePanel = null;
    }

    isHidden(){
        return this.draggablePanel.isHidden();
    }
}