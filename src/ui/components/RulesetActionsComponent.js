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
                <button id="ruleset-actions-breed-tab" class="ruleset-actions-segment" data-pane="breed">Breed</button>
            </div>
            <div class="ruleset-actions-content">
                <div id="ruleset-actions-generate-pane" class="ruleset-pane"></div>
                <div id="ruleset-actions-mutate-pane" class="ruleset-pane hidden"></div>
                <div id="ruleset-actions-breed-pane" class="ruleset-pane hidden"></div>
            </div>
        `;

        this.panes = {
            generate: this.element.querySelector(`#ruleset-actions-generate-pane`),
            mutate: this.element.querySelector(`#ruleset-actions-mutate-pane`),
            breed: this.element.querySelector(`#ruleset-actions-breed-pane`),
        };

        this.segments = {
            generate: this.element.querySelector('[data-pane="generate"]'),
            mutate: this.element.querySelector('[data-pane="mutate"]'),
            breed: this.element.querySelector('[data-pane="breed"]'),
        };

        this._renderGeneratePane();
        this._renderMutatePane();
        this._renderBreedPane();
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
    }

    _renderBreedPane() {
        const pane = this.panes.breed;
        const controller = this.appContext.rulesetActionController;

        const grid = Array.from({ length: 9 }, (_, i) =>
            `<button type="button" class="breed-parent-cell" data-world="${i}" title="Toggle World ${i + 1} as a breeding parent">${i + 1}</button>`
        ).join('');

        pane.innerHTML = `
            <p class="breed-hint">Flag worlds as <strong>parents</strong> (click a cell below, or press
            <kbd>B</kbd> on the selected world). The remaining worlds become offspring recombined from
            the parent genepool. One parent ≈ clone&nbsp;&amp; mutate; two or more cross-breed.</p>
            <div class="form-group">
                <label>Parent worlds:</label>
                <div class="breed-parent-grid">${grid}</div>
                <div class="breed-parent-readout" id="ruleset-actions-breed-readout"></div>
            </div>
            <div class="form-group" id="ruleset-actions-breed-mode-mount"></div>
            <div class="form-group" id="ruleset-actions-breed-rate-mount"></div>
            <div class="form-group-buttons">
                <button class="button" data-action="breed-clear" title="Clear all parent flags">Clear Parents</button>
                <button class="button" data-action="breed" title="Recombine the parent genepool into the offspring worlds">Breed Offspring</button>
            </div>
        `;

        new SwitchComponent(pane.querySelector('#ruleset-actions-breed-mode-mount'), {
            label: 'Inheritance:',
            type: 'radio',
            name: 'ruleset-actions-breed-mode',
            initialValue: controller.getBreedMode(),
            items: controller.getBreedModeConfig(),
            onChange: controller.setBreedMode
        });

        new SliderComponent(pane.querySelector('#ruleset-actions-breed-rate-mount'), {
            ...controller.getBreedMutationRateSliderConfig(),
            id: 'ruleset-actions-breed-rate',
            value: controller.getBreedMutationRate(),
        });

        this.breedReadout = pane.querySelector('#ruleset-actions-breed-readout');
        this.breedParentCells = Array.from(pane.querySelectorAll('.breed-parent-cell'));

        pane.querySelector('.breed-parent-grid').addEventListener('click', e => {
            const cell = e.target.closest('.breed-parent-cell');
            if (!cell || cell.disabled) return;
            EventBus.dispatch(EVENTS.COMMAND_TOGGLE_WORLD_PARENT, { worldIndex: parseInt(cell.dataset.world, 10) });
        });

        // Keep the grid + readout in sync with the authoritative world settings.
        EventBus.subscribe(EVENTS.WORLD_SETTINGS_CHANGED, () => this._refreshBreedParents());
        this._refreshBreedParents();
    }

    /** Repaint the parent-toggle grid and readout from the current world settings. */
    _refreshBreedParents() {
        if (!this.breedParentCells) return;
        const settings = this.appContext.worldManager.getWorldSettingsForUI();
        const parents = [];
        this.breedParentCells.forEach((cell, i) => {
            const ws = settings[i];
            const isParent = !!ws?.isParent;
            const enabled = !!ws?.enabled;
            cell.classList.toggle('active', isParent);
            cell.disabled = !enabled;
            cell.classList.toggle('disabled', !enabled);
            if (isParent && enabled) parents.push(i + 1);
        });
        if (this.breedReadout) {
            this.breedReadout.textContent = parents.length
                ? `Parents: ${parents.map(n => `World ${n}`).join(', ')}`
                : 'No parents flagged yet.';
        }
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

        // Breed keeps the panel open (the genepool stays visible, and a no-parents attempt should not
        // dismiss the UI). _breedFromGenepool emits its own success/error toast.
        this.panes.breed.querySelector('[data-action="breed"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_BREED_WORLDS);
        });
        this.panes.breed.querySelector('[data-action="breed-clear"]').addEventListener('click', () => {
             const settings = this.appContext.worldManager.getWorldSettingsForUI();
             settings.forEach((ws, i) => {
                 if (ws?.isParent) EventBus.dispatch(EVENTS.COMMAND_TOGGLE_WORLD_PARENT, { worldIndex: i });
             });
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
