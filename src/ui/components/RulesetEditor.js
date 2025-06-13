import { DraggablePanel } from './DraggablePanel.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { getRuleIndexColor, createOrUpdateRuleVizElement } from '../../utils/ruleVizUtils.js';

export class RulesetEditor extends PersistentDraggablePanel {
    constructor(panelElement, worldManagerInterface, options = {}) {

        super(panelElement, 'h3', 'ruleset', options);

        if (!worldManagerInterface) {
            console.error('RulesetEditor: worldManagerInterface is null.');
            return;
        }

        if (options.isMobile) {
            const header = this.panelElement.querySelector('h3');
            if (header) header.classList.add('hidden');
            const closeButton = this.panelElement.querySelector('.close-panel-button');
            if (closeButton) closeButton.classList.add('hidden');
        }

        this.worldManager = worldManagerInterface;
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
            editorApplyScopeControls: panelElement.querySelector('.editor-apply-scope-controls .radio-group'),
            editorAutoResetCheckbox: panelElement.querySelector('#editorAutoResetCheckbox'),
        };

        this.cachedDetailedRules = [];
        this.cachedNeighborCountRules = [];
        this.cachedRotationalSymmetryRules = [];
        this.areGridsCreated = false;

        this._loadEditorSettings();
        this._setupInternalListeners();

        if (!this.isHidden()) this.refreshViews();

        this.onDragEnd = () => {
            this._savePanelState();
            this._saveEditorSettings();
        };
    }

    _createAllGrids() {
        if (this.areGridsCreated) return;

        // --- 1. Create Detailed Grid ---
        const detailedGrid = this.uiElements.rulesetEditorGrid;
        const detailedFrag = document.createDocumentFragment();
        for (let i = 0; i < 128; i++) {
            const viz = createOrUpdateRuleVizElement({ ruleIndex: i, outputState: 0 }); // Create with default state
            const innerHex = viz.querySelector('.inner-hex');
            this.cachedDetailedRules[i] = { viz, innerHex }; // Cache the element and its key part
            detailedFrag.appendChild(viz);
        }
        detailedGrid.appendChild(detailedFrag);

        // --- 2. Create Neighbor Count Grid ---
        const neighborGrid = this.uiElements.neighborCountRulesetEditorGrid;
        const neighborFrag = document.createDocumentFragment();
        for (let cs = 0; cs <= 1; cs++) {
            for (let na = 0; na <= 6; na++) {
                const viz = document.createElement('div');
                viz.className = 'neighbor-count-rule-viz';
                viz.dataset.centerState = cs;
                viz.dataset.numActive = na;

                const centerHex = document.createElement('div');
                centerHex.className = `hexagon center-hex state-${cs}`;
                const innerHex = document.createElement('div');
                innerHex.className = `hexagon inner-hex`;
                centerHex.appendChild(innerHex);

                viz.innerHTML = `<div class="neighbor-count-label">C:${cs ? '<b>ON</b>' : 'OFF'}<br>${na}/6 N&rarr;...</div>`;
                viz.appendChild(centerHex);

                this.cachedNeighborCountRules.push({ viz, innerHex, label: viz.querySelector('.neighbor-count-label') });
                neighborFrag.appendChild(viz);
            }
        }
        neighborGrid.appendChild(neighborFrag);

        // --- 3. Create Rotational Symmetry Grid ---
        const symmetryGrid = this.uiElements.rotationalSymmetryRulesetEditorGrid;
        const symmetryFrag = document.createDocumentFragment();
        const canonicalDetails = this.worldManager.getCanonicalRuleDetails();
        if (canonicalDetails && canonicalDetails.length > 0) {
            canonicalDetails.forEach(detail => {
                const viz = document.createElement('div');
                viz.className = 'r-sym-rule-viz';
                viz.dataset.canonicalBitmask = detail.canonicalBitmask;
                viz.dataset.centerState = detail.centerState;

                viz.innerHTML = `
                <div class="rule-label">C=${detail.centerState},N<sub>c</sub>=${detail.canonicalBitmask.toString(2).padStart(6, '0')}</div>
                <div class="rule-viz-hex-display">
                    <div class="hexagon center-hex state-${detail.centerState}">
                         <div class="hexagon inner-hex"></div>
                    </div>
                    ${Array.from({ length: 6 }, (_, n) => `<div class="hexagon neighbor-hex neighbor-${n} state-${(detail.canonicalBitmask >> n) & 1}"></div>`).join('')}
                </div>
                <div class="orbit-size-display">Orbit:${detail.orbitSize}</div>`;

                const innerHex = viz.querySelector('.inner-hex');
                this.cachedRotationalSymmetryRules.push({ viz, innerHex, ...detail });
                symmetryFrag.appendChild(viz);
            });
        }
        symmetryGrid.appendChild(symmetryFrag);

        this.areGridsCreated = true;
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
                const currentArr = this.worldManager.getCurrentRulesetArray();
                const targetState = currentArr.every(state => state === 0) ? 1 : 0;
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

            if (!hexString) {
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
                    this.uiElements.editorRulesetInput.blur();
                }
            });
        }

        const createRuleInteractionHandler = (commandType, detailExtractor) => (event) => {
            const vizElement = event.target.closest(detailExtractor.selector);
            if (vizElement) {
                const details = detailExtractor.getDetails(vizElement, this.worldManager);
                if (details) {
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
                getDetails: (el, wm) => {
                    const cs = parseInt(el.dataset.centerState, 10);
                    const na = parseInt(el.dataset.numActive, 10);
                    const currentOut = wm.getEffectiveRuleForNeighborCount(cs, na);
                    return { centerState: cs, numActive: na, outputState: (currentOut === 1 || currentOut === 2) ? 0 : 1 };
                }
            }));
        }
        if (this.uiElements.rotationalSymmetryRulesetEditorGrid) {
            this.uiElements.rotationalSymmetryRulesetEditorGrid.addEventListener('click', createRuleInteractionHandler(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, {
                selector: '.r-sym-rule-viz',
                getDetails: (el, wm) => {
                    const cb = parseInt(el.dataset.canonicalBitmask, 10);
                    const cs = parseInt(el.dataset.centerState, 10);


                    const canonicalDetails = wm.getCanonicalRuleDetails();
                    const detail = canonicalDetails.find(d => d.canonicalBitmask === cb && d.centerState === cs);
                    const currentOut = detail ? detail.effectiveOutput : 2;
                    return { canonicalBitmask: cb, centerState: cs, outputState: (currentOut === 1 || currentOut === 2) ? 0 : 1 };
                }
            }));
        }
    }

    refreshViews() {
        if (!this.worldManager || this.isHidden()) return;
        if (!this.areGridsCreated) {
            this._createAllGrids();
        }
        const currentSelectedWorldHex = this.worldManager.getCurrentRulesetHex();
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
    
        const activeGrid = grids[currentMode] || grids.detailed;
        activeGrid.classList.remove('hidden');
    
        if (currentMode === 'detailed') {
            this._updateDetailedGrid(this.worldManager.getCurrentRulesetArray());
        } else if (currentMode === 'neighborCount') {
            this._updateNeighborCountGrid();
        } else if (currentMode === 'rotationalSymmetry') {
            this._updateRotationalSymmetryGrid();
        } else {
            this._updateDetailedGrid(this.worldManager.getCurrentRulesetArray());
        }
    }

    _updateDetailedGrid(rulesetArray) {
        if (!rulesetArray || this.cachedDetailedRules.length === 0) return;
        for (let i = 0; i < 128; i++) {
            const outputState = rulesetArray[i];
            const { innerHex } = this.cachedDetailedRules[i];
            innerHex.style.backgroundColor = getRuleIndexColor(i, outputState);
        }
    }

    _updateNeighborCountGrid() {
        if (this.cachedNeighborCountRules.length === 0) return;
        let cacheIndex = 0;
        for (let cs = 0; cs <= 1; cs++) {
            for (let na = 0; na <= 6; na++) {
                const { innerHex, label } = this.cachedNeighborCountRules[cacheIndex];
                const effectiveOutput = this.worldManager.getEffectiveRuleForNeighborCount(cs, na);
                const outputDisplay = effectiveOutput === 1 ? 'ON' : (effectiveOutput === 0 ? 'OFF' : 'MIXED');
                
                // Update class for color instead of style for better performance
                innerHex.className = `hexagon inner-hex state-${effectiveOutput}`;
                label.innerHTML = `C:${cs ? '<b>ON</b>' : 'OFF'}<br>${na}/6 N&rarr;${outputDisplay}`;
                cacheIndex++;
            }
        }
    }

    _updateRotationalSymmetryGrid() {
        if (this.cachedRotationalSymmetryRules.length === 0) return;
        const canonicalDetails = this.worldManager.getCanonicalRuleDetails();
        if (!canonicalDetails) return;
    
        this.cachedRotationalSymmetryRules.forEach((cachedRule, index) => {
            const detail = canonicalDetails.find(d => 
                d.canonicalBitmask === cachedRule.canonicalBitmask && d.centerState === cachedRule.centerState
            );
            if (detail) {
                cachedRule.innerHex.className = `hexagon inner-hex state-${detail.effectiveOutput}`;
                cachedRule.viz.title = `Center ${detail.centerState ? 'ON' : 'OFF'}, Canonical N ${detail.canonicalBitmask.toString(2).padStart(6, '0')} (Orbit: ${detail.orbitSize}) -> Output ${detail.effectiveOutput === 2 ? 'MIXED' : (detail.effectiveOutput === 1 ? 'ON' : 'OFF')}`;
            }
        });
    }

    _saveEditorSettings() {
        if (this.uiElements.rulesetEditorMode) PersistenceService.saveUISetting('rulesetEditorMode', this.uiElements.rulesetEditorMode.value);
        if (this.uiElements.editorApplyScopeControls) PersistenceService.saveUISetting('editorRulesetApplyScope', this._getEditorModificationScope());
        if (this.uiElements.editorAutoResetCheckbox) PersistenceService.saveUISetting('editorAutoReset', this.uiElements.editorAutoResetCheckbox.checked);
    }

    _loadEditorSettings() {
        if (this.uiElements.rulesetEditorMode) this.uiElements.rulesetEditorMode.value = PersistenceService.loadUISetting('rulesetEditorMode', 'rotationalSymmetry');
        if (this.uiElements.editorApplyScopeControls) {
            const scopeSetting = PersistenceService.loadUISetting('editorRulesetApplyScope', 'selected');
            if (scopeSetting === 'all' && this.uiElements.editorApplyScopeAllRadio) this.uiElements.editorApplyScopeAllRadio.checked = true;
            else if (this.uiElements.editorApplyScopeSelectedRadio) this.uiElements.editorApplyScopeSelectedRadio.checked = true;
        }
        if (this.uiElements.editorAutoResetCheckbox) this.uiElements.editorAutoResetCheckbox.checked = PersistenceService.loadUISetting('editorAutoReset', true);
    }

    show(save = true) {
        this._createAllGrids();
        super.show(save);
        this.refreshViews();
        if (save) this._saveEditorSettings();
    }

    hide(save = true) {
        super.hide(save);
        if (save) this._saveEditorSettings();
    }

    toggle() {
        this._createAllGrids();
        const isVisible = super.toggle();
        if (isVisible) {
            this.refreshViews();
        }
        this._saveEditorSettings();
        return isVisible;
    }

    destroy() {
        super.destroy();
    }
}