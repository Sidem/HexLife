import { DraggablePanel } from './DraggablePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class RulesetEditor {
    constructor(panelElement, simulationInterface) {
        if (!panelElement || !simulationInterface) {
            console.error('RulesetEditor: panelElement or simulationInterface is null or undefined.');
            return;
        }
        this.panelElement = panelElement;
        this.simInterface = simulationInterface;
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
            editorApplyScopeControls: panelElement.querySelector('.editor-apply-scope-controls .radio-group'),
            editorAutoResetCheckbox: panelElement.querySelector('#editorAutoResetCheckbox'),
        };
        this.draggablePanel = new DraggablePanel(this.panelElement, 'h3');
        this._loadPanelState();
        this._setupInternalListeners();
        if (!this.panelElement.classList.contains('hidden')) this.refreshViews();
    }

    _getEditorModificationScope() { // This is from "Apply Changes To:" radios
        return this.uiElements.editorApplyScopeAllRadio?.checked ? 'all' : 'selected';
    }

    _getConditionalResetScopeForEditor() { // This depends on "Auto-Reset" checkbox
        if (this.uiElements.editorAutoResetCheckbox?.checked) {
            return this._getEditorModificationScope(); // Reset whatever was modified
        }
        return 'none'; // No reset if auto-reset is off
    }

    _setupInternalListeners() {
        // ... (listeners for close, mode, scope radios, auto-reset checkbox save to persistence) ...
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
                    if (radio.checked) PersistenceService.saveUISetting('editorRulesetApplyScope', radio.value);
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
                const currentArr = this.simInterface.getCurrentRulesetArray();
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
            const currentSelectedWorldHex = this.simInterface.getCurrentRulesetHex();
            if (!hexString) {
                this.uiElements.editorRulesetInput.value = (currentSelectedWorldHex === "Error" || currentSelectedWorldHex === "N/A") ? "" : currentSelectedWorldHex;
                return;
            }
            if (!/^[0-9A-F]{32}$/.test(hexString)) {
                alert("Invalid Hex Code in Editor: Must be 32 chars.\nReverting.");
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
                if (event.key === 'Enter') { event.preventDefault(); handleEditorInputChange(); this.uiElements.editorRulesetInput.blur(); }
            });
        }

        const createRuleInteractionHandler = (commandType, detailExtractor) => (event) => {
            const vizElement = event.target.closest(detailExtractor.selector);
            if (vizElement) {
                const details = detailExtractor.getDetails(vizElement, this.simInterface);
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
                getDetails: (el, sim) => {
                    const cs = parseInt(el.dataset.centerState, 10); const na = parseInt(el.dataset.numActive, 10);
                    const currentOut = sim.getEffectiveRuleForNeighborCount(cs, na);
                    return { centerState: cs, numActive: na, outputState: (currentOut === 1 || currentOut === 2) ? 0 : 1 };
                }
            }));
        }
        if (this.uiElements.rotationalSymmetryRulesetEditorGrid) {
            this.uiElements.rotationalSymmetryRulesetEditorGrid.addEventListener('click', createRuleInteractionHandler(EVENTS.COMMAND_EDITOR_SET_RULES_FOR_CANONICAL_REPRESENTATIVE, {
                selector: '.r-sym-rule-viz',
                getDetails: (el, sim) => {
                    const cb = parseInt(el.dataset.canonicalBitmask, 10); const cs = parseInt(el.dataset.centerState, 10);
                    const currentOut = sim.getEffectiveRuleForCanonicalRepresentative(cb, cs);
                    return { canonicalBitmask: cb, centerState: cs, outputState: (currentOut === 1 || currentOut === 2) ? 0 : 1 };
                }
            }));
        }
        if (this.draggablePanel) this.draggablePanel.onDragEnd = () => this._savePanelState();
    }

    refreshViews() {
        if (!this.simInterface || this.panelElement.classList.contains('hidden')) return;
        const currentSelectedWorldHex = this.simInterface.getCurrentRulesetHex();
        if (this.uiElements.editorRulesetInput) {
            this.uiElements.editorRulesetInput.value = (currentSelectedWorldHex === "Error" || currentSelectedWorldHex === "N/A") ? "" : currentSelectedWorldHex;
        }
        this._updateEditorGrids();
    }

    _updateEditorGrids() {
        if (!this.uiElements.rulesetEditorMode) return;
        const currentMode = this.uiElements.rulesetEditorMode.value;
        const grids = { detailed: this.uiElements.rulesetEditorGrid, neighborCount: this.uiElements.neighborCountRulesetEditorGrid, rotationalSymmetry: this.uiElements.rotationalSymmetryRulesetEditorGrid };
        for (const key in grids) grids[key]?.classList.add('hidden');
        const activeGrid = grids[currentMode] || grids.detailed;
        activeGrid.classList.remove('hidden');

        if (currentMode === 'detailed') this._populateDetailedGrid(this.simInterface.getCurrentRulesetArray());
        else if (currentMode === 'neighborCount') this._populateNeighborCountGrid();
        else if (currentMode === 'rotationalSymmetry') this._populateRotationalSymmetryGrid();
        else this._populateDetailedGrid(this.simInterface.getCurrentRulesetArray());
    }

    _populateDetailedGrid(rulesetArray) {
        const grid = this.uiElements.rulesetEditorGrid; if (!grid || !rulesetArray) { if (grid) grid.innerHTML = '<p>Error.</p>'; return; }
        grid.innerHTML = ''; const frag = document.createDocumentFragment();
        for (let i=0; i<128; i++) {
            const cs=(i>>6)&1, mask=i&0x3F, os=rulesetArray[i];
            const v=document.createElement('div'); v.className='rule-viz'; v.title=`R${i}: C${cs} N${mask.toString(2).padStart(6,'0')}->O${os}`; v.dataset.ruleIndex=i;
            v.innerHTML=`<div class="hexagon center-hex state-${cs}"><div class="hexagon inner-hex state-${os}"></div></div>`+Array.from({length:6},(_,n)=>`<div class="hexagon neighbor-hex neighbor-${n} state-${(mask>>n)&1}"></div>`).join('');
            frag.appendChild(v);
        } grid.appendChild(frag);
    }
    _populateNeighborCountGrid() {
        const grid=this.uiElements.neighborCountRulesetEditorGrid; if(!grid||!this.simInterface){if(grid)grid.innerHTML='<p>Error.</p>';return;}
        grid.innerHTML=''; const frag=document.createDocumentFragment();
        for(let cs=0;cs<=1;cs++)for(let na=0;na<=6;na++){
            const effOut=this.simInterface.getEffectiveRuleForNeighborCount(cs,na); const outD=effOut===1?'ON':(effOut===0?'OFF':'MIXED');
            const v=document.createElement('div');v.className='neighbor-count-rule-viz';v.dataset.centerState=cs;v.dataset.numActive=na; v.title=`C${cs?'ON':'OFF'},${na}N->${outD}`;
            v.innerHTML=`<div class="neighbor-count-label">C:${cs?'<b>ON</b>':'OFF'}<br>${na}/6 N&rarr;${outD}</div>`+`<div class="hexagon center-hex state-${cs}"><div class="hexagon inner-hex state-${effOut}"></div></div>`;
            frag.appendChild(v);
        } grid.appendChild(frag);
    }
    _populateRotationalSymmetryGrid() {
        const grid=this.uiElements.rotationalSymmetryRulesetEditorGrid; if(!grid||!this.simInterface?.getCanonicalRuleDetails){if(grid)grid.innerHTML='<p>Error.</p>';return;}
        grid.innerHTML=''; const frag=document.createDocumentFragment();
        this.simInterface.getCanonicalRuleDetails().forEach(d=>{
            const outD=d.effectiveOutput===1?'ON':(d.effectiveOutput===0?'OFF':'MIXED');
            const v=document.createElement('div');v.className='r-sym-rule-viz';v.dataset.canonicalBitmask=d.canonicalBitmask;v.dataset.centerState=d.centerState; v.title=`C${d.centerState?'ON':'OFF'},Nc${d.canonicalBitmask.toString(2).padStart(6,'0')}(O:${d.orbitSize})->${outD}`;
            v.innerHTML=`<div class="rule-label">C=${d.centerState},N<sub>c</sub>=${d.canonicalBitmask.toString(2).padStart(6,'0')}</div>`+
            `<div class="rule-viz-hex-display"><div class="hexagon center-hex state-${d.centerState}"><div class="hexagon inner-hex state-${d.effectiveOutput}"></div></div>`+Array.from({length:6},(_,n)=>`<div class="hexagon neighbor-hex neighbor-${n} state-${(d.canonicalBitmask>>n)&1}"></div>`).join('')+`</div>`+
            `<div class="orbit-size-display">Orbit:${d.orbitSize}</div>`;
            frag.appendChild(v);
        }); grid.appendChild(frag);
    }

    _getEditorApplyChangesScope() {
        return this.uiElements.editorApplyScopeAllRadio?.checked ? 'all' : 'selected';
    }

    _savePanelState() {
        if (!this.panelElement) return;
        PersistenceService.savePanelState(this.panelIdentifier, {isOpen:!this.panelElement.classList.contains('hidden'),x:this.panelElement.style.left,y:this.panelElement.style.top});
        if (this.uiElements.rulesetEditorMode) PersistenceService.saveUISetting('rulesetEditorMode', this.uiElements.rulesetEditorMode.value);
        if (this.uiElements.editorApplyScopeControls) PersistenceService.saveUISetting('editorRulesetApplyScope', this._getEditorApplyChangesScope());
        if (this.uiElements.editorAutoResetCheckbox) PersistenceService.saveUISetting('editorAutoReset', this.uiElements.editorAutoResetCheckbox.checked);
    }
    _loadPanelState() {
        if(!this.panelElement)return; const s=PersistenceService.loadPanelState(this.panelIdentifier);
        if(this.uiElements.rulesetEditorMode)this.uiElements.rulesetEditorMode.value=PersistenceService.loadUISetting('rulesetEditorMode','rotationalSymmetry');
        if(this.uiElements.editorApplyScopeControls){const sc=PersistenceService.loadUISetting('editorRulesetApplyScope','selected'); if(sc==='all'&&this.uiElements.editorApplyScopeAllRadio)this.uiElements.editorApplyScopeAllRadio.checked=true;else if(this.uiElements.editorApplyScopeSelectedRadio)this.uiElements.editorApplyScopeSelectedRadio.checked=true;}
        if (this.uiElements.editorAutoResetCheckbox) this.uiElements.editorAutoResetCheckbox.checked = PersistenceService.loadUISetting('editorAutoReset', true); // Default to true

        if(s.isOpen)this.show(false);else this.hide(false); if(s.x)this.panelElement.style.left=s.x;if(s.y)this.panelElement.style.top=s.y;
        if((s.x||s.y)&&parseFloat(this.panelElement.style.left)>0&&parseFloat(this.panelElement.style.top)>0)this.panelElement.style.transform='none';
        else if(this.panelElement.style.transform==='none'&&s.isOpen){this.panelElement.style.left='50%';this.panelElement.style.top='50%';this.panelElement.style.transform='translate(-50%,-50%)';}
    }
    show(save=true){this.draggablePanel.show();this.refreshViews();if(save)this._savePanelState();}
    hide(save=true){this.draggablePanel.hide();if(save)this._savePanelState();}
    toggle(){const v=this.draggablePanel.toggle();this.refreshViews();this._savePanelState();return v;}
    destroy(){if(this.draggablePanel)this.draggablePanel.destroy();}
    isHidden(){return this.draggablePanel.isHidden();}
}