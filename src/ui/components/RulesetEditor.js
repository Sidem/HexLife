import { BasePanel } from './BasePanel.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class RulesetEditor extends BasePanel {
    constructor(panelElement, worldManagerInterface) { 
        // Call the BasePanel constructor with element, handle selector, and identifier
        super(panelElement, 'h3', 'ruleset');

        if (!worldManagerInterface) {
            console.error('RulesetEditor: worldManagerInterface is null.');
            return;
        }
        // this.panelElement is already set by the super constructor
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
        this._loadEditorSettings();
        this._setupInternalListeners();
        if (!this.isHidden()) this.refreshViews();
        
        // Override the default onDragEnd to also save editor settings
        this.onDragEnd = () => {
            this._savePanelState();
            this._saveEditorSettings();
        };
    }

    /**
     * Converts HSV color to RGB, matching the fragment shader's hsv2rgb function.
     * @param {number} h Hue (0-1)
     * @param {number} s Saturation (0-1) 
     * @param {number} v Value/Brightness (0-1)
     * @returns {{r: number, g: number, b: number}} RGB values (0-1)
     */
    _hsvToRgb(h, s, v) {
        // Port of the GLSL hsv2rgb function
        const K = [1.0, 2.0/3.0, 1.0/3.0, 3.0];
        const p = [
            Math.abs((h + K[0]) % 1.0 * 6.0 - K[3]),
            Math.abs((h + K[1]) % 1.0 * 6.0 - K[3]),
            Math.abs((h + K[2]) % 1.0 * 6.0 - K[3])
        ].map(val => Math.max(0, Math.min(1, val - 1)));
        
        return {
            r: v * (K[0] * (1 - s) + p[0] * s),
            g: v * (K[0] * (1 - s) + p[1] * s),
            b: v * (K[0] * (1 - s) + p[2] * s)
        };
    }

    /**
     * Calculates the color for a hexagon based on rule index and state, matching the fragment shader logic.
     * @param {number} ruleIndex The rule index (0-127)
     * @param {number} state The cell state (0 or 1)
     * @returns {string} CSS color string
     */
    _getRuleIndexColor(ruleIndex, state) {
        const hueOffset = 0.1667; // Offset for yellow (60.0 / 360.0)
        const calculatedHue = ruleIndex / 128.0;
        const hue = (calculatedHue + hueOffset) % 1.0;
        
        let saturation, value;
        if (state === 1) {
            saturation = 1.0;
            value = 1.0;
        } else {
            saturation = 0.5;
            value = 0.15;
        }
        
        const rgb = this._hsvToRgb(hue, saturation, value);
        
        // Convert to 0-255 range and create CSS color string
        const r = Math.round(rgb.r * 255);
        const g = Math.round(rgb.g * 255);
        const b = Math.round(rgb.b * 255);
        
        return `rgb(${r}, ${g}, ${b})`;
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
            this._populateDetailedGrid(this.worldManager.getCurrentRulesetArray()); 
        } else if (currentMode === 'neighborCount') {
            this._populateNeighborCountGrid(); 
        } else if (currentMode === 'rotationalSymmetry') {
            this._populateRotationalSymmetryGrid(); 
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
            
            // Calculate colors based on rule index
            const centerColor = centerState === 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
            const outputColor = this._getRuleIndexColor(i, outputState);
            
            viz.innerHTML =
                `<div class="hexagon center-hex" style="background-color: ${centerColor};"><div class="hexagon inner-hex" style="background-color: ${outputColor};"></div></div>` +
                Array.from({ length: 6 }, (_, n) => {
                    const neighborState = (neighborMask >> n) & 1;
                    const neighborColor = neighborState === 1 ? 'rgb(255, 255, 255)' : 'rgb(100, 100, 100)';
                    return `<div class="hexagon neighbor-hex neighbor-${n}" style="background-color: ${neighborColor};"></div>`;
                }).join('');
            frag.appendChild(viz);
        }
        grid.appendChild(frag);
    }

    _populateNeighborCountGrid() {
        const grid = this.uiElements.neighborCountRulesetEditorGrid;
        if (!grid || !this.worldManager) { if (grid) grid.innerHTML = '<p>Error loading data for neighbor count view.</p>'; return; }
        grid.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (let cs = 0; cs <= 1; cs++) { 
            for (let na = 0; na <= 6; na++) { 
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
        const canonicalDetails = this.worldManager.getCanonicalRuleDetails(); 
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

    _saveEditorSettings() {
        if (this.uiElements.rulesetEditorMode) PersistenceService.saveUISetting('rulesetEditorMode', this.uiElements.rulesetEditorMode.value);
        if (this.uiElements.editorApplyScopeControls) PersistenceService.saveUISetting('editorRulesetApplyScope', this._getEditorModificationScope());
        if (this.uiElements.editorAutoResetCheckbox) PersistenceService.saveUISetting('editorAutoReset', this.uiElements.editorAutoResetCheckbox.checked);
    }

    _loadEditorSettings() {
        if(this.uiElements.rulesetEditorMode) this.uiElements.rulesetEditorMode.value = PersistenceService.loadUISetting('rulesetEditorMode', 'rotationalSymmetry');
        if(this.uiElements.editorApplyScopeControls) {
            const scopeSetting = PersistenceService.loadUISetting('editorRulesetApplyScope', 'selected');
            if(scopeSetting === 'all' && this.uiElements.editorApplyScopeAllRadio) this.uiElements.editorApplyScopeAllRadio.checked = true;
            else if(this.uiElements.editorApplyScopeSelectedRadio) this.uiElements.editorApplyScopeSelectedRadio.checked = true;
        }
        if (this.uiElements.editorAutoResetCheckbox) this.uiElements.editorAutoResetCheckbox.checked = PersistenceService.loadUISetting('editorAutoReset', true);
    }

    show(save = true) {
        super.show(save);
        this.refreshViews();
        if (save) this._saveEditorSettings();
    }

    hide(save = true) {
        super.hide(save);
        if (save) this._saveEditorSettings();
    }

    toggle() {
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