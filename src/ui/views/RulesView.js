import { BaseComponent } from '../components/BaseComponent.js';
import { SliderComponent } from '../components/SliderComponent.js';
import { SwitchComponent } from '../components/SwitchComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { rulesetActionController } from '../controllers/RulesetActionController.js';
import { libraryController } from '../controllers/LibraryController.js';

export class RulesView extends BaseComponent {
    constructor(mountPoint, libraryData, worldManagerInterface) {
        super(mountPoint);
        this.libraryData = libraryData;
        this.worldManager = worldManagerInterface;
        this.element = null;
        this.panes = {};
        this.segments = {};
        this.sliders = {};
        this.switches = {};
        
        // Initialize library controller
        libraryController.init(this.libraryData);
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
            <div class="form-group" id="mobileGenerateModeMount"></div>
            <div class="form-group" id="mobileBiasSliderMount"></div>
            <div class="form-group" id="mobileRulesetScopeMount"></div>
            <div class="form-group" id="mobileResetOnNewRuleMount"></div>
            <button class="action-button" data-action="generate">Generate New Ruleset</button>
        `;
        
        const controllerState = rulesetActionController.getState();

        this.switches.genMode = new SwitchComponent(pane.querySelector('#mobileGenerateModeMount'), {
            label: 'Generation Mode:',
            type: 'radio', 
            name: 'mobileGenerateMode',
            initialValue: controllerState.genMode,
            items: [
                { value: 'random', text: 'Random' },
                { value: 'n_count', text: 'N-Count' },
                { value: 'r_sym', text: 'R-Sym' }
            ],
            onChange: rulesetActionController.setGenMode
        });

        this.sliders.bias = new SliderComponent(pane.querySelector('#mobileBiasSliderMount'), {
            label: 'Bias (0=OFF, 1=ON):',
            min: 0, max: 1, step: 0.01,
            value: controllerState.bias,
            showValue: true,
            onChange: rulesetActionController.setBias
        });

        this.switches.genScope = new SwitchComponent(pane.querySelector('#mobileRulesetScopeMount'), {
            label: 'Apply to:',
            type: 'radio', 
            name: 'mobileRulesetScope',
            initialValue: controllerState.genScope,
            items: [
                { value: 'selected', text: 'Selected' },
                { value: 'all', text: 'All' }
            ],
            onChange: rulesetActionController.setGenScope
        });

        this.switches.genAutoReset = new SwitchComponent(pane.querySelector('#mobileResetOnNewRuleMount'), {
            type: 'checkbox', 
            name: 'mobileResetOnNewRule',
            initialValue: controllerState.genAutoReset,
            items: [{ value: 'reset', text: 'Auto-Reset World(s)' }],
            onChange: rulesetActionController.setGenAutoReset
        });
    }

    _renderMutatePane() {
        const pane = this.panes.mutate;
        pane.innerHTML = `
            <div class="form-group" id="mobileMutateSliderMount"></div>
            <div class="form-group" id="mobileMutateModeMount"></div>
            <div class="form-group" id="mobileMutateScopeMount"></div>
            <div class="form-group-buttons" style="display: flex; gap: 10px; margin-top: 10px;">
                <button class="action-button" data-action="mutate" style="flex: 1;">Mutate</button>
                <button class="action-button" data-action="clone-mutate" style="flex: 1;">Clone & Mutate</button>
            </div>
        `;
    
        const controllerState = rulesetActionController.getState();

        this.sliders.mutate = new SliderComponent(pane.querySelector('#mobileMutateSliderMount'), {
            label: 'Mutation Rate (%):',
            min: 1, max: 50, step: 1,
            value: controllerState.mutateRate,
            showValue: true, unit: '%',
            onChange: rulesetActionController.setMutateRate
        });

        this.switches.mutateMode = new SwitchComponent(pane.querySelector('#mobileMutateModeMount'), {
            label: 'Mutation Mode:',
            type: 'radio', 
            name: 'mobileMutateMode',
            initialValue: controllerState.mutateMode,
            items: [
                { value: 'single', text: 'Single' },
                { value: 'r_sym', text: 'R-Sym' },
                { value: 'n_count', text: 'N-Count' }
            ],
            onChange: rulesetActionController.setMutateMode
        });

        this.switches.mutateScope = new SwitchComponent(pane.querySelector('#mobileMutateScopeMount'), {
            label: 'Apply to:',
            type: 'radio', 
            name: 'mobileMutateScope',
            initialValue: controllerState.mutateScope,
            items: [
                { value: 'selected', text: 'Selected' },
                { value: 'all', text: 'All' }
            ],
            onChange: rulesetActionController.setMutateScope
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
            rulesetActionController.generate();
        });

        this.panes.mutate.querySelector('[data-action="mutate"]').addEventListener('click', () => {
            rulesetActionController.mutate();
        });

        this.panes.mutate.querySelector('[data-action="clone-mutate"]').addEventListener('click', () => {
            rulesetActionController.cloneAndMutate();
        });

        this.panes["library-rulesets"].addEventListener('click', e => {
            if (e.target.matches('button[data-hex]')) {
                const controllerState = rulesetActionController.getState();
                libraryController.loadRuleset(
                    e.target.dataset.hex, 
                    controllerState.genScope, 
                    controllerState.genAutoReset
                );
            }
        });

        this.panes["library-patterns"].addEventListener('click', e => {
            if (e.target.matches('button[data-action="place-pattern"]')) {
                const patternName = e.target.dataset.patternName;
                libraryController.placePattern(patternName);
                document.querySelector('.tab-bar-button[data-view="simulate"]').click(); // Go back to sim view
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