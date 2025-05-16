// src/ui/components/RulesetEditor.js
import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class RulesetEditor {
    constructor(panelElement, worldManagerInterface) { // Changed to worldManagerInterface
        if (!panelElement || !worldManagerInterface) {
            console.error('RulesetEditor: panelElement or worldManagerInterface is null.');
            return;
        }
        this.panelElement = panelElement;
        this.worldManager = worldManagerInterface; // Store the interface
        this.panelIdentifier = 'ruleset';
        this.uiElements = {
            closeButton: panelElement.querySelector('#closeEditorButton') || panelElement.querySelector('.close-panel-button'),
            editorRulesetInput: panelElement.querySelector('#editorRulesetInput'),
            clearRulesButton: panelElement.querySelector('#clearRulesButton'),
            rulesetEditorMode: panelElement.querySelector('#rulesetEditorMode'),
            rulesetEditorGrid: panelElement.querySelector('#rulesetEditorGrid'),
            neighborCountRulesetEditorGrid: panelElement.querySelector('#neighborCountRulesetEditorGrid'),
            rotationalSymmetryRulesetEditorGrid: panelElement.querySelector('#rotationalSymmetryRulesetEditorGrid'),
            editorApplyScopeSelectedRadio: panelElement.querySelector('#editorApplyScopeSelected'),
            editorApplyScopeAllRadio: panelElement.querySelector('#editorApplyScopeAll'),
            editorApplyScopeControls: panelElement.querySelector('.editor-apply-scope-controls .radio-group'), // Ensure correct selector
            editorAutoResetCheckbox: panelElement.querySelector('#editorAutoResetCheckbox'),
        };
        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this._loadPanelState();
        this._setupInternalListeners();
        if (!this.panelElement.classList.contains('hidden')) this.refreshViews();
    }

    _getEditorModificationScope() {
        return this.uiElements.editorApplyScopeAllRadio?.checked ? 'all' : 'selected';
    }

    _getConditionalResetScopeForEditor() {
        if (this.uiElements.editorAutoResetCheckbox?.checked) {
            return this._getEditorModificationScope();
        }
        return 'none';
    }

    _setupInternalListeners() {
        if (this.uiElements.closeButton) this.uiElements.closeButton.addEventListener('click', () => this.hide());
        if (this.uiElements.rulesetEditorMode) {
            this.uiElements.rulesetEditorMode.addEventListener('change', () => {
                this.refreshViews();
                PersistenceService.saveUISetting('rulesetEditorMode', this.uiElements.rulesetEditorMode.value);
            });
        }
        if (this.uiElements.editorApplyScopeControls) {
             this.uiElements.editorApplyScopeControls.querySelectorAll('input[name="editorApplyScope"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    if (radio.checked) {
                        PersistenceService.saveUISetting('editorRulesetApplyScope', radio.value);
                        EventBus.dispatch(EVENTS.UI_EDITOR_RULESET_SCOPE_CHANGED, { scope: radio.value });
                    }
                });
            });
        }
        if (this.uiElements.editorAutoResetCheckbox) {
            this.uiElements.editorAutoResetCheckbox.addEventListener('change', (e) => {
                PersistenceService.saveUISetting('editorAutoReset', e.target.checked);
            });
        }

        if (this.uiElements.clearRulesButton) {
            this.uiElements.clearRulesButton.addEventListener('click', () => {
                const currentArr = this.worldManager.getCurrentRulesetArray(); // Uses selected world's ruleset
                const targetState = currentArr.every(state => state === 0) ? 1 : 0; // Toggle between all 0s and all 1s
                EventBus.dispatch(EVENTS.COMMAND_EDITOR_SET_ALL_RULES_STATE, {
                    targetState,
                    modificationScope: this._getEditorModificationScope(),
                    conditionalResetScope: this._getConditionalResetScopeForEditor()
                });
            });
        }

        const handleEditorInputChange = () => {
            if (!this.uiElements.editorRulesetInput) return;
            const hexString = this.uiElements.editorRulesetInput.value.trim().toUpperCase();
            const currentSelectedWorldHex = this.worldManager.getCurrentRulesetHex();

            if (!hexString) { // If empty, revert to current selected world's hex
                this.uiElements.editorRulesetInput.value = (currentSelectedWorldHex === "Error" || currentSelectedWorldHex === "N/A") ? "" : currentSelectedWorldHex;
                return;
            }
            if (!/^[0-9A-F]{32}$/.test(hexString)) {
                alert("Invalid Hex Code in Editor: Must be 32 hex chars.\nReverting.");
                this.uiElements.editorRulesetInput.value = (currentSelectedWorldHex === "Error" || currentSelectedWorldHex === "N/A") ? "" : currentSelectedWorldHex;
            } else {
                EventBus.dispatch(EVENTS.COMMAND_EDITOR_SET_RULESET_HEX, {
                    hexString,
                    modificationScope: this._getEditorModificationScope(),
                    conditionalResetScope: this._getConditionalResetScopeForEditor()
                });
            }
        };

        if (this.uiElements.editorRulesetInput) {
            this.uiElements.editorRulesetInput.addEventListener('change', handleEditorInputChange);
            this.uiElements.editorRulesetInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    handleEditorInputChange();
                    this.uiElements.editorRulesetInput.blur(); // Lose focus
                }
            });
        }

        const createRuleInteractionHandler = (commandType, detailExtractor) => (event) => {
            const vizElement = event.target.closest(detailExtractor.selector);
            if (vizElement) {
                const details = detailExtractor.getDetails(vizElement, this.worldManager); // Pass worldManager
                if (details) { // Ensure details could be extracted
                    EventBus.dispatch(commandType, {
                        ...details,
                        modificationScope: this._getEditorModificationScope(),
                        conditionalResetScope: this._getConditionalResetScopeForEditor()
                    });
                }
            }
        };

        if (this.uiElements.rulesetEditorGrid) {
            this.uiElements.rulesetEditorGrid.addEventListener('click', createRuleInteractionHandler(EVENTS.COMMAND_EDITOR_TOGGLE_RULE_OUTPUT, {
                selector: '.rule-viz', getDetails: (el) => ({ ruleIndex: parseInt(el.dataset.ruleIndex, 10) })
            }));
        }
        if (this.uiElements.neighborCountRulesetEditorGrid) {
            this.uiElements.neighborCountRulesetEditorGrid.addEventListener('click', createRuleInteractionHandler(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_NEIGHBOR_COUNT, {
                selector: '.neighbor-count-rule-viz',
                getDetails: (el, wm) => { // wm is worldManager
                    const cs = parseInt(el.dataset.centerState, 10);
                    const na = parseInt(el.dataset.numActive, 10);
                    const currentOut = wm.getEffectiveRuleForNeighborCount(cs, na); // Uses selected world's ruleset
                    return { centerState: cs, numActive: na, outputState: (currentOut === 1 || currentOut === 2) ? 0 : 1 };
                }
            }));
        }
        if (this.uiElements.rotationalSymmetryRulesetEditorGrid) {
            this.uiElements.rotationalSymmetryRulesetEditorGrid.addEventListener('click', createRuleInteractionHandler(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, {
                selector: '.r-sym-rule-viz',
                getDetails: (el, wm) => { // wm is worldManager
                    const cb = parseInt(el.dataset.canonicalBitmask, 10);
                    const cs = parseInt(el.dataset.centerState, 10);
                    // To get effective output for a canonical group, we need the full ruleset details
                    // This is slightly more complex than neighbor count. We need to find the specific group.
                    const canonicalDetails = wm.getCanonicalRuleDetails();
                    const detail = canonicalDetails.find(d => d.canonicalBitmask === cb && d.centerState === cs);
                    const currentOut = detail ? detail.effectiveOutput : 2; // Default to mixed if not found
                    return { canonicalBitmask: cb, centerState: cs, outputState: (currentOut === 1 || currentOut === 2) ? 0 : 1 };
                }
            }));
        }

        if (this.draggablePanel) this.draggablePanel.onDragEnd = () => this._savePanelState();
    }

    refreshViews() {
        if (!this.worldManager || this.panelElement.classList.contains('hidden')) return;
        const currentSelectedWorldHex = this.worldManager.getCurrentRulesetHex(); // From selected world
        if (this.uiElements.editorRulesetInput) {
            this.uiElements.editorRulesetInput.value = (currentSelectedWorldHex === "Error" || currentSelectedWorldHex === "N/A") ? "" : currentSelectedWorldHex;
        }
        this._updateEditorGrids();
    }

    _updateEditorGrids() {
        if (!this.uiElements.rulesetEditorMode) return;
        const currentMode = this.uiElements.rulesetEditorMode.value;
        const grids = {
            detailed: this.uiElements.rulesetEditorGrid,
            neighborCount: this.uiElements.neighborCountRulesetEditorGrid,
            rotationalSymmetry: this.uiElements.rotationalSymmetryRulesetEditorGrid
        };
        for (const key in grids) grids[key]?.classList.add('hidden');

        const activeGrid = grids[currentMode] || grids.detailed; // Default to detailed
        activeGrid.classList.remove('hidden');

        if (currentMode === 'detailed') {
            this._populateDetailedGrid(this.worldManager.getCurrentRulesetArray()); // Uses selected world
        } else if (currentMode === 'neighborCount') {
            this._populateNeighborCountGrid(); // Uses selected world via worldManager methods
        } else if (currentMode === 'rotationalSymmetry') {
            this._populateRotationalSymmetryGrid(); // Uses selected world via worldManager methods
        } else {
            this._populateDetailedGrid(this.worldManager.getCurrentRulesetArray());
        }
    }

    _populateDetailedGrid(rulesetArray) {
        const grid = this.uiElements.rulesetEditorGrid;
        if (!grid || !rulesetArray) { if (grid) grid.innerHTML = '<p>Error loading ruleset for detailed view.</p>'; return; }
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 128; i++) {
            const centerState = (i >> 6) & 1;
            const neighborMask = i & 0x3F;
            const outputState = rulesetArray[i];
            const viz = document.createElement('div');
            viz.className = 'rule-viz';
            viz.title = `Rule ${i}: Center ${centerState}, Neighbors ${neighborMask.toString(2).padStart(6, '0')} -> Output ${outputState}`;
            viz.dataset.ruleIndex = i;
            viz.innerHTML =
                `<div class="hexagon center-hex state-${centerState}"><div class="hexagon inner-hex state-${outputState}"></div></div>` +
                Array.from({ length: 6 }, (_, n) => `<div class="hexagon neighbor-hex neighbor-${n} state-${(neighborMask >> n) & 1}"></div>`).join('');
            frag.appendChild(viz);
        }
        grid.appendChild(frag);
    }

    _populateNeighborCountGrid() {
        const grid = this.uiElements.neighborCountRulesetEditorGrid;
        if (!grid || !this.worldManager) { if (grid) grid.innerHTML = '<p>Error loading data for neighbor count view.</p>'; return; }
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (let cs = 0; cs <= 1; cs++) { // Center State
            for (let na = 0; na <= 6; na++) { // Number of Active Neighbors
                const effectiveOutput = this.worldManager.getEffectiveRuleForNeighborCount(cs, na);
                const outputDisplay = effectiveOutput === 1 ? 'ON' : (effectiveOutput === 0 ? 'OFF' : 'MIXED');
                const viz = document.createElement('div');
                viz.className = 'neighbor-count-rule-viz';
                viz.dataset.centerState = cs;
                viz.dataset.numActive = na;
                viz.title = `Center ${cs ? 'ON' : 'OFF'}, ${na} Neighbors Active -> Output ${outputDisplay}`;
                viz.innerHTML =
                    `<div class="neighbor-count-label">C:${cs ? '<b>ON</b>' : 'OFF'}<br>${na}/6 N&rarr;${outputDisplay}</div>` +
                    `<div class="hexagon center-hex state-${cs}"><div class="hexagon inner-hex state-${effectiveOutput}"></div></div>`;
                frag.appendChild(viz);
            }
        }
        grid.appendChild(frag);
    }

    _populateRotationalSymmetryGrid() {
        const grid = this.uiElements.rotationalSymmetryRulesetEditorGrid;
        if (!grid || !this.worldManager?.getCanonicalRuleDetails) { if (grid) grid.innerHTML = '<p>Error loading data for symmetry view.</p>'; return; }
        grid.innerHTML = '';
        const canonicalDetails = this.worldManager.getCanonicalRuleDetails(); // This uses selected world's ruleset
        if (!canonicalDetails) { grid.innerHTML = '<p>Symmetry data unavailable.</p>'; return; }

        const frag = document.createDocumentFragment();
        canonicalDetails.forEach(detail => {
            const outputDisplay = detail.effectiveOutput === 1 ? 'ON' : (detail.effectiveOutput === 0 ? 'OFF' : 'MIXED');
            const viz = document.createElement('div');
            viz.className = 'r-sym-rule-viz';
            viz.dataset.canonicalBitmask = detail.canonicalBitmask;
            viz.dataset.centerState = detail.centerState;
            viz.title = `Center ${detail.centerState ? 'ON' : 'OFF'}, Canonical N ${detail.canonicalBitmask.toString(2).padStart(6, '0')} (Orbit: ${detail.orbitSize}) -> Output ${outputDisplay}`;

            viz.innerHTML =
                `<div class="rule-label">C=${detail.centerState},N<sub>c</sub>=${detail.canonicalBitmask.toString(2).padStart(6, '0')}</div>` +
                `<div class="rule-viz-hex-display">` +
                    `<div class="hexagon center-hex state-${detail.centerState}"><div class="hexagon inner-hex state-${detail.effectiveOutput}"></div></div>` +
                    Array.from({ length: 6 }, (_, n) => `<div class="hexagon neighbor-hex neighbor-${n} state-${(detail.canonicalBitmask >> n) & 1}"></div>`).join('') +
                `</div>` +
                `<div class="orbit-size-display">Orbit:${detail.orbitSize}</div>`;
            frag.appendChild(viz);
        });
        grid.appendChild(frag);
    }


    _savePanelState() {
        if (!this.panelElement) return;
        PersistenceService.savePanelState(this.panelIdentifier, {
            isOpen: !this.panelElement.classList.contains('hidden'),
            x: this.panelElement.style.left, y: this.panelElement.style.top,
        });
        if (this.uiElements.rulesetEditorMode) PersistenceService.saveUISetting('rulesetEditorMode', this.uiElements.rulesetEditorMode.value);
        if (this.uiElements.editorApplyScopeControls) PersistenceService.saveUISetting('editorRulesetApplyScope', this._getEditorModificationScope());
        if (this.uiElements.editorAutoResetCheckbox) PersistenceService.saveUISetting('editorAutoReset', this.uiElements.editorAutoResetCheckbox.checked);
    }

    _loadPanelState() {
        if(!this.panelElement) return;
        const s = PersistenceService.loadPanelState(this.panelIdentifier);

        if(this.uiElements.rulesetEditorMode) this.uiElements.rulesetEditorMode.value = PersistenceService.loadUISetting('rulesetEditorMode', 'rotationalSymmetry');
        if(this.uiElements.editorApplyScopeControls) {
            const scopeSetting = PersistenceService.loadUISetting('editorRulesetApplyScope', 'selected');
            if(scopeSetting === 'all' && this.uiElements.editorApplyScopeAllRadio) this.uiElements.editorApplyScopeAllRadio.checked = true;
            else if(this.uiElements.editorApplyScopeSelectedRadio) this.uiElements.editorApplyScopeSelectedRadio.checked = true;
        }
        if (this.uiElements.editorAutoResetCheckbox) this.uiElements.editorAutoResetCheckbox.checked = PersistenceService.loadUISetting('editorAutoReset', true);


        if(s.isOpen) this.show(false); else this.hide(false);
        if(s.x && s.x.endsWith('px')) this.panelElement.style.left = s.x;
        if(s.y && s.y.endsWith('px')) this.panelElement.style.top = s.y;

        const hasPosition = (s.x && s.x.endsWith('px')) || (s.y && s.y.endsWith('px'));
        if (hasPosition && (parseFloat(this.panelElement.style.left) > 0 || parseFloat(this.panelElement.style.top) > 0 || this.panelElement.style.left !== '50%' || this.panelElement.style.top !== '50%')) {
            this.panelElement.style.transform = 'none';
        } else if (!hasPosition && s.isOpen) { // If no specific position saved, but panel is open, center it.
             this.panelElement.style.left = '50%';
             this.panelElement.style.top = '50%';
             this.panelElement.style.transform = 'translate(-50%, -50%)';
        }
    }
    show(save=true){this.draggablePanel.show();this.refreshViews();if(save)this._savePanelState();}
    hide(save=true){this.draggablePanel.hide();if(save)this._savePanelState();}
    toggle(){const v=this.draggablePanel.toggle(); this.refreshViews(); this._savePanelState();return v;}
    destroy(){if(this.draggablePanel)this.draggablePanel.destroy();}
    isHidden(){return this.draggablePanel.isHidden();}
}