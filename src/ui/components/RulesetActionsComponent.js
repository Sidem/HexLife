import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';

export class RulesetActionsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;

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
                <button id="ruleset-actions-generate-tab" class="ruleset-actions-segment active" data-pane="generate">Generate</button>
                <button id="ruleset-actions-mutate-tab" class="ruleset-actions-segment" data-pane="mutate">Mutate</button>
            </div>
            <div class="ruleset-actions-content">
                <div id="ruleset-actions-generate-pane" class="ruleset-pane"></div>
                <div id="ruleset-actions-mutate-pane" class="ruleset-pane hidden"></div>
            </div>
        `;

        this.panes = {
            generate: this.element.querySelector(`#ruleset-actions-generate-pane`),
            mutate: this.element.querySelector(`#ruleset-actions-mutate-pane`),
        };

        this.segments = {
            generate: this.element.querySelector('[data-pane="generate"]'),
            mutate: this.element.querySelector('[data-pane="mutate"]'),
        };

        this._renderGeneratePane();
        this._renderMutatePane();
    }

    _renderGeneratePane() {
        const pane = this.panes.generate;

        pane.innerHTML = `
            <div class="form-group" id="ruleset-actions-gen-mode-mount"></div>
            <div class="form-group bias-controls">
                <input type="checkbox" id="ruleset-actions-use-custom-bias" class="checkbox-input" checked>
                <label for="ruleset-actions-use-custom-bias" class="checkbox-label">Custom Bias:</label>
                <div id="ruleset-actions-bias-slider-mount"></div>
            </div>
            <div class="form-group" id="ruleset-actions-gen-scope-mount"></div>
            <div class="form-group" id="ruleset-actions-gen-reset-mount"></div>
            <button class="button action-button" data-action="generate">Generate New Ruleset</button>
        `;

        new SwitchComponent(pane.querySelector(`#ruleset-actions-gen-mode-mount`), {
            label: 'Generation Mode:',
            type: 'radio',
            name: `ruleset-actions-gen-mode`,
            initialValue: this.appContext.rulesetActionController.getGenMode(),
            items: this.appContext.rulesetActionController.getGenerationConfig(),
            onChange: this.appContext.rulesetActionController.setGenMode
        });

        this.sliders.bias = new SliderComponent(pane.querySelector(`#ruleset-actions-bias-slider-mount`), {
            ...this.appContext.rulesetActionController.getBiasSliderConfig(),
            id: `ruleset-actions-bias-slider`,
            value: this.appContext.rulesetActionController.getBias(),
            disabled: !this.appContext.rulesetActionController.getUseCustomBias()
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-gen-scope-mount`), {
            ...this.appContext.rulesetActionController.getGenScopeSwitchConfig(),
            name: `ruleset-actions-gen-scope`,
            initialValue: this.appContext.rulesetActionController.getGenScope(),
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-gen-reset-mount`), {
            ...this.appContext.rulesetActionController.getGenAutoResetSwitchConfig(),
            name: `ruleset-actions-gen-reset`,
            initialValue: this.appContext.rulesetActionController.getGenAutoReset(),
        });


        const biasCheckbox = pane.querySelector(`#ruleset-actions-use-custom-bias`);
        biasCheckbox.checked = this.appContext.rulesetActionController.getUseCustomBias();
        biasCheckbox.addEventListener('change', e => {
            this.appContext.rulesetActionController.setUseCustomBias(e.target.checked);
            this.sliders.bias?.setDisabled(!e.target.checked);
        });
    }

    _renderMutatePane() {
        const pane = this.panes.mutate;

        pane.innerHTML = `
            <div class="form-group" id="ruleset-actions-mutate-rate-mount"></div>
            <div class="form-group" id="ruleset-actions-mutate-mode-mount"></div>
            <div class="form-group" id="ruleset-actions-mutate-scope-mount"></div>
            <div class="form-group" id="ruleset-actions-ensure-mutation-mount"></div>
            <div class="form-group-buttons">
                <button class="button" data-action="mutate">Mutate</button>
                <button class="button" data-action="clone">Clone</button>
                <button class="button" data-action="clone-mutate">Clone & Mutate</button>
            </div>
            <div class="form-group breed-controls">
                <label for="ruleset-actions-breed-partner">Breed selected with:</label>
                <select id="ruleset-actions-breed-partner" title="Second parent world to cross the selected world with">
                    ${Array.from({ length: 9 }, (_, i) => `<option value="${i}">World ${i + 1}</option>`).join('')}
                </select>
                <button class="button" data-action="breed" title="Crossover the selected world with the chosen world; children fill the remaining worlds">Breed</button>
            </div>
        `;

        new SliderComponent(pane.querySelector(`#ruleset-actions-mutate-rate-mount`), {
            ...this.appContext.rulesetActionController.getMutationRateSliderConfig(),
            id: `ruleset-actions-mutate-rate`,
            value: this.appContext.rulesetActionController.getMutateRate(),
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-mutate-mode-mount`), {
            label: 'Mutation Mode:',
            type: 'radio',
            name: `ruleset-actions-mutate-mode`,
            initialValue: this.appContext.rulesetActionController.getMutateMode(),
            items: this.appContext.rulesetActionController.getMutationModeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateMode
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-mutate-scope-mount`), {
            label: 'Apply to:',
            type: 'radio',
            name: `ruleset-actions-mutate-scope`,
            initialValue: this.appContext.rulesetActionController.getMutateScope(),
            items: this.appContext.rulesetActionController.getMutationScopeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateScope
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-ensure-mutation-mount`), {
            type: 'checkbox',
            name: `ruleset-actions-ensure-mutation`,
            initialValue: this.appContext.rulesetActionController.getEnsureMutation(),
            items: [{ value: 'ensure', text: 'Ensure at least one mutation' }],
            onChange: this.appContext.rulesetActionController.setEnsureMutation
        });

        const breedPartnerSelect = pane.querySelector('#ruleset-actions-breed-partner');
        breedPartnerSelect.value = String(this.appContext.rulesetActionController.getBreedPartner());
        breedPartnerSelect.addEventListener('change', e => {
            this.appContext.rulesetActionController.setBreedPartner(parseInt(e.target.value, 10));
        });
    }

    attachEventListeners() {
        this.element.querySelector('.ruleset-actions-header').addEventListener('click', e => {
            if (e.target.matches('.ruleset-actions-segment')) {
                this.setActivePane(e.target.dataset.pane);
            }
        });

        this.element.querySelector('[data-action="generate"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET);
             EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Generated New Ruleset' });
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });

        const mutatePane = this.element.querySelector(`#ruleset-actions-mutate-pane`);
        mutatePane.querySelector('[data-action="mutate"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET);
             EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Mutated Ruleset' });
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
        mutatePane.querySelector('[data-action="clone"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_CLONE_RULESET);
             EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cloned Ruleset' });
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
        mutatePane.querySelector('[data-action="clone-mutate"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE);
             EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Cloned & Mutated Ruleset' });
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
        mutatePane.querySelector('[data-action="breed"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_BREED_WORLDS);
             EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Bred Rulesets' });
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


}
