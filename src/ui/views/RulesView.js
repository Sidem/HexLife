import { BaseComponent } from '../components/BaseComponent.js';
import { SliderComponent } from '../components/SliderComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class RulesView extends BaseComponent {
    constructor(mountPoint, libraryData, worldManagerInterface) {
        super(mountPoint);
        this.libraryData = libraryData;
        this.worldManager = worldManagerInterface;
        this.element = null;
        this.panes = {};
        this.segments = {};
        this.sliders = {};
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'rules-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
<div class="mobile-view-header">
        <div class="rules-history-controls">
            <button class="button-icon" data-action="undo" title="Undo">↶</button>
            <button class="button-icon" data-action="redo" title="Redo">↷</button>
        </div>
        <h2 class="mobile-view-title">Rulesets</h2>
        <button class="mobile-view-close-button" data-action="close">&times;</button>
    </div>
</div>
<div class="rules-view-header">
    <button class="rules-view-segment active" data-pane="generate">Generate</button>
    <button class="rules-view-segment" data-pane="mutate">Mutate</button>
    <button class="rules-view-segment" data-pane="library-rulesets">Rulesets</button>
    <button class="rules-view-segment" data-pane="library-patterns">Patterns</button>
    <button class="rules-view-segment" data-pane="direct">Direct</button>
</div>
<div class="rules-view-content">
    <div id="generate-pane" class="rules-pane"></div>
    <div id="mutate-pane" class="rules-pane hidden"></div>
    <div id="library-rulesets-pane" class="rules-pane hidden"></div>
    <div id="library-patterns-pane" class="rules-pane hidden"></div>
    <div id="direct-pane" class="rules-pane hidden"></div>
</div>
`;
        this.mountPoint.appendChild(this.element);

        this.panes = {
            generate: this.element.querySelector('#generate-pane'),
            mutate: this.element.querySelector('#mutate-pane'),
            "library-rulesets": this.element.querySelector('#library-rulesets-pane'),
            "library-patterns": this.element.querySelector('#library-patterns-pane'),
            direct: this.element.querySelector('#direct-pane'),
        };

        this.segments = {
            generate: this.element.querySelector('[data-pane="generate"]'),
            mutate: this.element.querySelector('[data-pane="mutate"]'),
            "library-rulesets": this.element.querySelector('[data-pane="library-rulesets"]'),
            "library-patterns": this.element.querySelector('[data-pane="library-patterns"]'),
            direct: this.element.querySelector('[data-pane="direct"]'),
        };

        this._renderGeneratePane();
        this._renderMutatePane();
        this._renderLibraryRulesetsPane();
        this._renderLibraryPatternsPane();
        this._renderDirectPane();
        this.attachEventListeners();
    }

    _renderGeneratePane() {
        const pane = this.panes.generate;
        pane.innerHTML = `
        <div class="form-group">
            <label>Generation Mode:</label>
            <div id="mobileGenerateModeSwitch" class="three-way-switch">
                <input type="radio" id="mobileGenModeRandom" name="mobileGenerateMode" value="random" class="radio-switch-input">
                <label for="mobileGenModeRandom" class="radio-switch-label">Random</label>
                <input type="radio" id="mobileGenModeNCount" name="mobileGenerateMode" value="n_count" class="radio-switch-input">
                <label for="mobileGenModeNCount" class="radio-switch-label">N-Count</label>
                <input type="radio" id="mobileGenModeRSym" name="mobileGenerateMode" value="r_sym" class="radio-switch-input">
                <label for="mobileGenModeRSym" class="radio-switch-label">R-Sym</label>
            </div>
        </div>
        <div class="form-group">
            <label>Bias (0=OFF, 1=ON):</label>
            <div id="mobileBiasSliderMount"></div>
        </div>
        <div class="form-group">
            <label>Apply to:</label>
            <div id="mobileRulesetScopeSwitch" class="three-way-switch">
                <input type="radio" id="mobileScopeSelected" name="mobileRulesetScope" value="selected" class="radio-switch-input">
                <label for="mobileScopeSelected" class="radio-switch-label">Selected</label>
                <input type="radio" id="mobileScopeAll" name="mobileRulesetScope" value="all" class="radio-switch-input">
                <label for="mobileScopeAll" class="radio-switch-label">All</label>
            </div>
        </div>
        <div class="form-group">
            <input type="checkbox" id="mobileResetOnNewRule" class="checkbox-input">
            <label for="mobileResetOnNewRule" class="checkbox-label">Auto-Reset World(s)</label>
        </div>
        <button class="action-button" data-action="generate">Generate New Ruleset</button>
        `;
    
        // Load saved settings and attach persistence listeners
        const genMode = PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym');
        pane.querySelector(`input[value="${genMode}"]`).checked = true;
        pane.querySelector('#mobileGenerateModeSwitch').addEventListener('change', e => {
            PersistenceService.saveUISetting('rulesetGenerationMode', e.target.value);
        });
    
        this.sliders.bias = new SliderComponent(pane.querySelector('#mobileBiasSliderMount'), {
            min: 0, max: 1, step: 0.01,
            value: PersistenceService.loadUISetting('biasValue', 0.33),
            showValue: true,
            onChange: val => PersistenceService.saveUISetting('biasValue', val)
        });
    
        const scopeAll = PersistenceService.loadUISetting('globalRulesetScopeAll', true);
        pane.querySelector(`input[value="${scopeAll ? 'all' : 'selected'}"]`).checked = true;
        pane.querySelector('#mobileRulesetScopeSwitch').addEventListener('change', e => {
            PersistenceService.saveUISetting('globalRulesetScopeAll', e.target.value === 'all');
        });
    
        const resetOnNew = PersistenceService.loadUISetting('resetOnNewRule', true);
        const resetCheckbox = pane.querySelector('#mobileResetOnNewRule');
        resetCheckbox.checked = resetOnNew;
        resetCheckbox.addEventListener('change', e => {
            PersistenceService.saveUISetting('resetOnNewRule', e.target.checked);
        });
    }

    _renderMutatePane() {
        this.panes.mutate.innerHTML = `
        <div class="form-group">
            <label>Mutation Rate (%):</label>
            <div id="mobileMutateSliderMount"></div>
        </div>
        <div class="form-group">
            <label>Mutation Mode:</label>
            <div id="mobileMutateModeSwitch" class="three-way-switch">
                <input type="radio" id="mobileMutateModeSingle" name="mobileMutateMode" value="single" class="radio-switch-input">
                <label for="mobileMutateModeSingle" class="radio-switch-label">Single</label>
                <input type="radio" id="mobileMutateModeRSym" name="mobileMutateMode" value="r_sym" class="radio-switch-input">
                <label for="mobileMutateModeRSym" class="radio-switch-label">R-Sym</label>
                <input type="radio" id="mobileMutateModeNCount" name="mobileMutateMode" value="n_count" class="radio-switch-input">
                <label for="mobileMutateModeNCount" class="radio-switch-label">N-Count</label>
            </div>
        </div>
        <div class="form-group">
            <label>Apply to:</label>
            <div id="mobileMutateScopeSwitch" class="three-way-switch">
                <input type="radio" id="mobileMutateScopeSelected" name="mobileMutateScope" value="selected" class="radio-switch-input">
                <label for="mobileMutateScopeSelected" class="radio-switch-label">Selected</label>
                <input type="radio" id="mobileMutateScopeAll" name="mobileMutateScope" value="all" class="radio-switch-input">
                <label for="mobileMutateScopeAll" class="radio-switch-label">All</label>
            </div>
        </div>
        <div class="form-group-buttons" style="display: flex; gap: 10px; margin-top: 10px;">
            <button class="action-button" data-action="mutate" style="flex: 1;">Mutate</button>
            <button class="action-button" data-action="clone-mutate" style="flex: 1;">Clone & Mutate</button>
        </div>
        `;
    
        // Load saved settings and attach persistence listeners
        this.sliders.mutate = new SliderComponent(this.panes.mutate.querySelector('#mobileMutateSliderMount'), {
            min: 1, max: 50, step: 1,
            value: PersistenceService.loadUISetting('mutationRate', 1),
            showValue: true, unit: '%',
            onChange: val => PersistenceService.saveUISetting('mutationRate', val)
        });
    
        const mutateMode = PersistenceService.loadUISetting('mutateMode', 'single');
        this.panes.mutate.querySelector(`input[value="${mutateMode}"]`).checked = true;
        this.panes.mutate.querySelector('#mobileMutateModeSwitch').addEventListener('change', e => {
            PersistenceService.saveUISetting('mutateMode', e.target.value);
        });
    
        const mutateScope = PersistenceService.loadUISetting('mutateScope', 'selected');
        this.panes.mutate.querySelector(`input[name="mobileMutateScope"][value="${mutateScope}"]`).checked = true;
        this.panes.mutate.querySelector('#mobileMutateScopeSwitch').addEventListener('change', e => {
            PersistenceService.saveUISetting('mutateScope', e.target.value);
        });
    }

    _renderLibraryRulesetsPane() {
        const pane = this.panes["library-rulesets"];
        pane.innerHTML = `<div class="library-list"></div>`;
        const list = pane.querySelector('.library-list');
        this.libraryData.rulesets.forEach(rule => {
            const item = document.createElement('div');
            item.className = 'library-item-mobile';
            item.innerHTML = `
                <div class="name">${rule.name}</div>
                <div class="description">${rule.description}</div>
                <button class="button" data-hex="${rule.hex}">Load Ruleset</button>
            `;
            list.appendChild(item);
        });
    }

    _renderLibraryPatternsPane() {
        const pane = this.panes["library-patterns"];
        pane.innerHTML = `<div class="library-list"></div>`;
        const list = pane.querySelector('.library-list');
        this.libraryData.patterns.forEach(pattern => {
            const item = document.createElement('div');
            item.className = 'library-item-mobile';
            item.innerHTML = `
                <div class="name">${pattern.name}</div>
                <div class="description">${pattern.description}</div>
                <button class="button" data-action="place-pattern" data-pattern-name="${pattern.name}">Place Pattern</button>
            `;
            list.appendChild(item);
        });
    }

    _renderDirectPane() {
        this.panes.direct.innerHTML = `
            <div class="form-group">
                <label>Paste 32-character Hex Code</label>
                <input type="text" class="hex-input" placeholder="0100...8048" maxlength="32">
            </div>
            <button class="action-button" data-action="set-hex">Set Ruleset</button>
        `;
    }

    attachEventListeners() {
        this.element.addEventListener('click', e => {
            if (e.target.matches('.mobile-view-close-button')) {
                document.querySelector('.tab-bar-button[data-view="simulate"]').click();
            }
        });

        this.element.querySelector('.rules-view-header').addEventListener('click', e => {
            if (e.target.matches('.rules-view-segment')) {
                this.setActivePane(e.target.dataset.pane);
            }
        });

        this.element.addEventListener('click', e => {
            const action = e.target.dataset.action;
            if (action === 'undo' || action === 'redo') {
                if (!this.worldManager) return;
                const selectedIndex = this.worldManager.getSelectedWorldIndex();
                const event = action === 'undo' ? EVENTS.COMMAND_UNDO_RULESET : EVENTS.COMMAND_REDO_RULESET;
                EventBus.dispatch(event, { worldIndex: selectedIndex });
            }
        });

        this.panes.generate.querySelector('[data-action="generate"]').addEventListener('click', () => {
            const mode = this.panes.generate.querySelector('input[name="mobileGenerateMode"]:checked').value;
            const scope = this.panes.generate.querySelector('input[name="mobileRulesetScope"]:checked').value;
            const reset = this.panes.generate.querySelector('#mobileResetOnNewRule').checked;
            
            EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
                bias: this.sliders.bias.getValue(),
                generationMode: mode,
                resetScopeForThisChange: reset ? scope : 'none'
            });
        });

        this.panes.mutate.querySelector('[data-action="mutate"]').addEventListener('click', () => {
            const scope = this.panes.mutate.querySelector('input[name="mobileMutateScope"]:checked').value;
            const mode = this.panes.mutate.querySelector('input[name="mobileMutateMode"]:checked').value;
            
            EventBus.dispatch(EVENTS.COMMAND_MUTATE_RULESET, {
                mutationRate: this.sliders.mutate.getValue() / 100.0,
                scope: scope,
                mode: mode
            });
        });

        this.panes.mutate.querySelector('[data-action="clone-mutate"]').addEventListener('click', () => {
            const mode = this.panes.mutate.querySelector('input[name="mobileMutateMode"]:checked').value;
    
            EventBus.dispatch(EVENTS.COMMAND_CLONE_AND_MUTATE, {
                mutationRate: this.sliders.mutate.getValue() / 100.0,
                mode: mode
            });
        });

        this.panes["library-rulesets"].addEventListener('click', e => {
            if (e.target.matches('button[data-hex]')) {
                EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, {
                    hexString: e.target.dataset.hex,
                    resetScopeForThisChange: 'all'
                });
            }
        });

        this.panes["library-patterns"].addEventListener('click', e => {
            if (e.target.matches('button[data-action="place-pattern"]')) {
                const patternName = e.target.dataset.patternName;
                const patternData = this.libraryData.patterns.find(p => p.name === patternName);
                if (patternData) {
                    EventBus.dispatch(EVENTS.COMMAND_ENTER_PLACING_MODE, { cells: patternData.cells });
                    document.querySelector('.tab-bar-button[data-view="simulate"]').click(); // Go back to sim view
                }
            }
        });

        this.panes.direct.querySelector('[data-action="set-hex"]').addEventListener('click', () => {
            const input = this.panes.direct.querySelector('.hex-input');
            const hex = input.value.trim().toUpperCase();
            if (/^[0-9A-F]{32}$/.test(hex)) {
                EventBus.dispatch(EVENTS.COMMAND_SET_RULESET, { hexString: hex, resetScopeForThisChange: 'all' });
            } else {
                alert('Invalid Hex Code. Must be 32 hexadecimal characters.');
            }
        });
    }

    setActivePane(paneName) {
        for (const pane in this.panes) {
            this.panes[pane].classList.add('hidden');
            this.segments[pane].classList.remove('active');
        }
        this.panes[paneName].classList.remove('hidden');
        this.segments[paneName].classList.add('active');
    }

    show() {
        this.element.classList.remove('hidden');
    }

    hide() {
        this.element.classList.add('hidden');
    }
}