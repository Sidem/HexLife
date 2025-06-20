import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { RulesetDirectInput } from './RulesetDirectInput.js';

export class RulesetActionsComponent extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);
        this.appContext = options.appContext;
        this.context = options.context || 'shared';
        this.libraryData = options.libraryData;
        this.sliders = {};
        this.switches = {};
        this.element = document.createElement('div');
        this.element.className = 'ruleset-actions-container';

        this.render();
        this.attachEventListeners();
        this.setActivePane('generate');
    }

    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <div class="ruleset-actions-header">
                <button id="${this.context}-generate-tab" class="ruleset-actions-segment active" data-pane="generate">Generate</button>
                <button id="${this.context}-mutate-tab" class="ruleset-actions-segment" data-pane="mutate">Mutate</button>
                <button id="${this.context}-library-tab" class="ruleset-actions-segment" data-pane="library">Library</button>
                <button id="${this.context}-direct-tab" class="ruleset-actions-segment" data-pane="direct">Direct</button>
            </div>
            <div class="ruleset-actions-content">
                <div id="${this.context}-generate-pane" class="ruleset-pane"></div>
                <div id="${this.context}-mutate-pane" class="ruleset-pane hidden"></div>
                <div id="${this.context}-library-pane" class="ruleset-pane hidden"></div>
                <div id="${this.context}-direct-pane" class="ruleset-pane hidden"></div>
            </div>
        `;

        this.panes = {
            generate: this.element.querySelector(`#${this.context}-generate-pane`),
            mutate: this.element.querySelector(`#${this.context}-mutate-pane`),
            library: this.element.querySelector(`#${this.context}-library-pane`),
            direct: this.element.querySelector(`#${this.context}-direct-pane`),
        };

        this.segments = {
            generate: this.element.querySelector('[data-pane="generate"]'),
            mutate: this.element.querySelector('[data-pane="mutate"]'),
            library: this.element.querySelector('[data-pane="library"]'),
            direct: this.element.querySelector('[data-pane="direct"]'),
        };

        this._renderGeneratePane();
        this._renderMutatePane();
        this._renderLibraryPane();
        this._renderDirectPane();
    }

    _renderGeneratePane() {
        const pane = this.panes.generate;
        const controllerState = this.appContext.rulesetActionController.getState();
        
        pane.innerHTML = `
            <div class="form-group" id="${this.context}-gen-mode-mount"></div>
            <div class="form-group bias-controls">
                <input type="checkbox" id="${this.context}-use-custom-bias" class="checkbox-input" checked>
                <label for="${this.context}-use-custom-bias" class="checkbox-label">Custom Bias:</label>
                <div id="${this.context}-bias-slider-mount"></div>
            </div>
            <div class="form-group" id="${this.context}-gen-scope-mount"></div>
            <div class="form-group" id="${this.context}-gen-reset-mount"></div>
            <button class="button action-button" data-action="generate">Generate New Ruleset</button>
        `;

        new SwitchComponent(pane.querySelector(`#${this.context}-gen-mode-mount`), {
            label: 'Generation Mode:', 
            type: 'radio', 
            name: `${this.context}-gen-mode`,
            initialValue: controllerState.genMode,
            items: this.appContext.rulesetActionController.getGenerationConfig(),
            onChange: this.appContext.rulesetActionController.setGenMode
        });
        
        this.sliders.bias = new SliderComponent(pane.querySelector(`#${this.context}-bias-slider-mount`), {
            ...this.appContext.rulesetActionController.getBiasSliderConfig(),
            id: `${this.context}-bias-slider`, 
            value: controllerState.bias,
            disabled: !controllerState.useCustomBias
        });

        new SwitchComponent(pane.querySelector(`#${this.context}-gen-scope-mount`), {
            ...this.appContext.rulesetActionController.getGenScopeSwitchConfig(),
            name: `${this.context}-gen-scope`, 
            initialValue: controllerState.genScope,
        });

        new SwitchComponent(pane.querySelector(`#${this.context}-gen-reset-mount`), {
            ...this.appContext.rulesetActionController.getGenAutoResetSwitchConfig(),
            name: `${this.context}-gen-reset`, 
            initialValue: controllerState.genAutoReset,
        });

        
        const biasCheckbox = pane.querySelector(`#${this.context}-use-custom-bias`);
        biasCheckbox.checked = controllerState.useCustomBias;
        biasCheckbox.addEventListener('change', e => {
            this.appContext.rulesetActionController.setUseCustomBias(e.target.checked);
            this.sliders.bias?.setDisabled(!e.target.checked);
        });
    }

    _renderMutatePane() {
        const pane = this.panes.mutate;
        const controllerState = this.appContext.rulesetActionController.getState();
        
        pane.innerHTML = `
            <div class="form-group" id="${this.context}-mutate-rate-mount"></div>
            <div class="form-group" id="${this.context}-mutate-mode-mount"></div>
            <div class="form-group" id="${this.context}-mutate-scope-mount"></div>
            <div class="form-group-buttons">
                <button class="button" data-action="mutate">Mutate</button>
                <button class="button" data-action="clone">Clone</button>
                <button class="button" data-action="clone-mutate">Clone & Mutate</button>
            </div>
        `;
        
        new SliderComponent(pane.querySelector(`#${this.context}-mutate-rate-mount`), {
            ...this.appContext.rulesetActionController.getMutationRateSliderConfig(),
            id: `${this.context}-mutate-rate`, 
            value: controllerState.mutateRate,
        });

        new SwitchComponent(pane.querySelector(`#${this.context}-mutate-mode-mount`), {
            label: 'Mutation Mode:', 
            type: 'radio', 
            name: `${this.context}-mutate-mode`,
            initialValue: controllerState.mutateMode,
            items: this.appContext.rulesetActionController.getMutationModeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateMode
        });

        new SwitchComponent(pane.querySelector(`#${this.context}-mutate-scope-mount`), {
            label: 'Apply to:',
            type: 'radio',
            name: `${this.context}-mutate-scope`,
            initialValue: controllerState.mutateScope,
            items: this.appContext.rulesetActionController.getMutationScopeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateScope
        });
    }

    _renderLibraryPane() {
        const pane = this.panes.library;
        pane.innerHTML = `
            <div class="library-sub-tabs">
                <button class="sub-tab-button active" data-sub-pane="rulesets">Rulesets</button>
                <button class="sub-tab-button" data-sub-pane="patterns">Patterns</button>
            </div>
            <div id="${this.context}-library-rulesets-content" class="library-list"></div>
            <div id="${this.context}-library-patterns-content" class="library-list hidden"></div>
        `;

        
        this.populateLibraryData();
    }

    _renderDirectPane() {
        const mountPoint = this.panes.direct;
        mountPoint.innerHTML = '';
        new RulesetDirectInput(mountPoint, this.appContext, { context: `${this.context}-direct` });
    }

    attachEventListeners() {
        this.element.querySelector('.ruleset-actions-header').addEventListener('click', e => {
            if (e.target.matches('.ruleset-actions-segment')) {
                this.setActivePane(e.target.dataset.pane);
            }
        });

        const libraryPane = this.element.querySelector(`#${this.context}-library-pane`);
        libraryPane.addEventListener('click', e => {
            const target = e.target;
            if (target.matches('.sub-tab-button')) {
                libraryPane.querySelectorAll('.sub-tab-button').forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                libraryPane.querySelectorAll('.library-list').forEach(p => p.classList.add('hidden'));
                libraryPane.querySelector(`#${this.context}-library-${target.dataset.subPane}-content`).classList.remove('hidden');
            } else if (target.matches('[data-action="load-rule"]')) {
                const controllerState = this.appContext.rulesetActionController.getState();
                this.appContext.libraryController.loadRuleset(
                    target.dataset.hex,
                    controllerState.genScope,
                    controllerState.genAutoReset
                );
                EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            } else if (target.matches('[data-action="place-pattern"]')) {
                this.appContext.libraryController.placePattern(target.dataset.patternName);
                EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            }
        });

        this.element.querySelector('[data-action="generate"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET);
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
        
        const mutatePane = this.element.querySelector(`#${this.context}-mutate-pane`);
        mutatePane.querySelector('[data-action="mutate"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET);
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
        mutatePane.querySelector('[data-action="clone"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_CLONE_RULESET);
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
        mutatePane.querySelector('[data-action="clone-mutate"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE);
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
    }

    setActivePane(paneName) {
        for (const key in this.panes) {
            this.panes[key].classList.add('hidden');
            this.segments[key].classList.remove('active');
        }
        this.panes[paneName].classList.remove('hidden');
        this.segments[paneName].classList.add('active');
    }

    populateLibraryData(libraryData = null) {
        const data = libraryData || this.libraryData;
        if (!data) return;

        
        const rulesetsList = this.element.querySelector(`#${this.context}-library-rulesets-content`);
        if (rulesetsList && data.rulesets) {
            rulesetsList.innerHTML = '';
            data.rulesets.forEach(rule => {
                const item = document.createElement('div');
                item.className = 'library-item-mobile';
                item.innerHTML = `
                    <div class="name">${rule.name}</div>
                    <div class="description">${rule.description}</div>
                    <button id="${this.context}-load-${rule.hex}" class="button" data-action="load-rule" data-hex="${rule.hex}">Load Ruleset</button>
                `;
                rulesetsList.appendChild(item);
            });
        }

        
        const patternsList = this.element.querySelector(`#${this.context}-library-patterns-content`);
        if (patternsList && data.patterns) {
            patternsList.innerHTML = '';
            data.patterns.forEach(pattern => {
                const item = document.createElement('div');
                item.className = 'library-item-mobile';
                item.innerHTML = `
                    <div class="name">${pattern.name}</div>
                    <div class="description">${pattern.description}</div>
                    <button class="button" data-action="place-pattern" data-pattern-name="${pattern.name}">Place Pattern</button>
                `;
                patternsList.appendChild(item);
            });
        }

        
        if (libraryData) {
            this.libraryData = libraryData;
        }
    }
} 