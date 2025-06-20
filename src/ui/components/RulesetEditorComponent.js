import { BaseComponent } from './BaseComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { getRuleIndexColor, createOrUpdateRuleVizElement } from '../../utils/ruleVizUtils.js';

export class RulesetEditorComponent extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options); 
        
        const appContext = options.appContext;
        if (!appContext || !appContext.worldManager) {
            console.error('RulesetEditorComponent: appContext or worldManager is null.');
            return;
        }
        
        this.appContext = appContext;
        this.worldManager = appContext.worldManager;
        this.context = this.options.context || 'desktop';

        
        this.element = document.createElement('div');
        this.element.className = 'ruleset-editor-component-content';
        
        this.cachedDetailedRules = [];
        this.cachedNeighborCountRules = [];
        this.cachedRotationalSymmetryRules = [];
        this.areGridsCreated = false;
        
        this.scopeSwitch = null;
        this.resetSwitch = null;

        this.render();
        this._loadEditorSettings();
        this._setupInternalListeners();
        this.refresh();
    }
    
    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <div class="editor-controls">
                <input type="text" id="${this.context}-editorRulesetInput" class="editor-hex-input"
                    placeholder="32 hex chars (e.g., FFFFFF...000000)"
                    title="Current ruleset hex code. Edit and press Enter or click away to apply."
                    autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                <button id="${this.context}-clearRulesButton" class="button"
                    title="Set all rules to inactive, or active if all are already inactive">Clear/Fill</button>
                <select id="${this.context}-rulesetEditorMode" title="Choose editor mode">
                    <option value="detailed">Detailed (128 rules)</option>
                    <option value="neighborCount">Neighbor Count (14 groups)</option>
                    <option value="rotationalSymmetry" selected>Rotational Symmetry (28 groups)</option>
                </select>
            </div>
            <div class="editor-apply-scope-controls">
                <div id="editorScopeSwitchMount"></div>
                <div id="editorResetSwitchMount"></div>
            </div>
            <div class="panel-content-area">
                <div id="rulesetEditorGrid" class="hidden"></div>
                <div id="neighborCountRulesetEditorGrid" class="hidden"></div>
                <div id="rotationalSymmetryRulesetEditorGrid"></div>
                <div class="editor-text">
                    <p>This editor modifies the ruleset of the currently selected world. Use "Apply Changes To" to
                        propagate these changes.</p>
                    <p>Click rule visualizations to toggle output states.</p>
                    <div class="editor-text-rules">
                        <p><span class="inline-hex state-0"><span class="inline-hex-inner state-0"></span></span> stays
                            inactive</p>
                        <p><span class="inline-hex state-0"><span class="inline-hex-inner state-1"></span></span>
                            becomes active</p>
                        <p><span class="inline-hex state-1"><span class="inline-hex-inner state-0"></span></span>
                            becomes inactive</p>
                        <p><span class="inline-hex state-1"><span class="inline-hex-inner state-1"></span></span> stays
                            active</p>
                    </div>
                </div>
            </div>
        `;
        
        this.uiElements = {
            editorRulesetInput: this.element.querySelector(`#${this.context}-editorRulesetInput`),
            clearRulesButton: this.element.querySelector(`#${this.context}-clearRulesButton`),
            rulesetEditorMode: this.element.querySelector(`#${this.context}-rulesetEditorMode`),
            rulesetEditorGrid: this.element.querySelector('#rulesetEditorGrid'),
            neighborCountRulesetEditorGrid: this.element.querySelector('#neighborCountRulesetEditorGrid'),
            rotationalSymmetryRulesetEditorGrid: this.element.querySelector('#rotationalSymmetryRulesetEditorGrid'),
            editorScopeSwitchMount: this.element.querySelector('#editorScopeSwitchMount'),
            editorResetSwitchMount: this.element.querySelector('#editorResetSwitchMount'),
        };
    }

    refresh() {
        if (!this.worldManager) return;
        if (!this.areGridsCreated) {
            this._createAllGrids();
        }
        const currentSelectedWorldHex = this.worldManager.getCurrentRulesetHex();
        if (this.uiElements.editorRulesetInput) {
            this.uiElements.editorRulesetInput.value = (currentSelectedWorldHex === "Error" || currentSelectedWorldHex === "N/A") ? "" : currentSelectedWorldHex;
        }
        this._updateEditorGrids();
    }

    _createAllGrids() {
        if (this.areGridsCreated) return;

        const detailedGrid = this.uiElements.rulesetEditorGrid;
        const detailedFrag = document.createDocumentFragment();
        for (let i = 0; i < 128; i++) {
            const viz = createOrUpdateRuleVizElement({ ruleIndex: i, outputState: 0 }); 
            const innerHex = viz.querySelector('.inner-hex');
            this.cachedDetailedRules[i] = { viz, innerHex }; 
            detailedFrag.appendChild(viz);
        }
        detailedGrid.appendChild(detailedFrag);
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
        return this.scopeSwitch ? this.scopeSwitch.getValue() : 'selected';
    }

    _getConditionalResetScopeForEditor() {
        if (this.resetSwitch && this.resetSwitch.getValue()) {
            return this._getEditorModificationScope();
        }
        return 'none';
    }

    _setupInternalListeners() {
        if (this.uiElements.rulesetEditorMode) {
            this.uiElements.rulesetEditorMode.addEventListener('change', () => {
                this._updateEditorGrids();
                PersistenceService.saveUISetting('rulesetEditorMode', this.uiElements.rulesetEditorMode.value);
            });
        }
        
        const initialScope = PersistenceService.loadUISetting('editorRulesetApplyScope', 'selected');
        if (this.uiElements.editorScopeSwitchMount) {
            this.scopeSwitch = new SwitchComponent(this.uiElements.editorScopeSwitchMount, {
                label: 'Apply changes to:',
                type: 'radio',
                name: 'editorApplyScope',
                initialValue: initialScope,
                items: [
                    { value: 'selected', text: 'Selected World' },
                    { value: 'all', text: 'All Worlds' }
                ],
                onChange: (value) => {
                    PersistenceService.saveUISetting('editorRulesetApplyScope', value);
                    EventBus.dispatch(EVENTS.UI_EDITOR_RULESET_SCOPE_CHANGED, { scope: value });
                }
            });
        }
        
        const initialReset = PersistenceService.loadUISetting('editorAutoReset', true);
        if (this.uiElements.editorResetSwitchMount) {
            this.resetSwitch = new SwitchComponent(this.uiElements.editorResetSwitchMount, {
                type: 'checkbox',
                name: 'editorAutoReset',
                initialValue: initialReset,
                items: [{ value: 'reset', text: 'Auto-Reset on Change' }],
                onChange: (isChecked) => {
                    PersistenceService.saveUISetting('editorAutoReset', isChecked);
                }
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
    }

    _loadEditorSettings() {
        if (this.uiElements.rulesetEditorMode) {
            this.uiElements.rulesetEditorMode.value = PersistenceService.loadUISetting('rulesetEditorMode', 'rotationalSymmetry');
        }
    }

    destroy() {
        if (this.scopeSwitch) {
            this.scopeSwitch.destroy?.();
        }
        if (this.resetSwitch) {
            this.resetSwitch.destroy?.();
        }
        super.destroy?.();
    }
} 