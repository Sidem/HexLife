import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { ToggleSwitch } from './ToggleSwitch.js';

const PANE_BLURBS = {
    generate: 'Roll a brand-new ruleset from scratch.',
    mutate: 'Tweak the current ruleset by flipping rule bits — or clone it first.',
    breed: 'Recombine rulesets from parent worlds into the others.'
};

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
            <div class="ruleset-actions-header" role="tablist">
                <button id="ruleset-actions-generate-tab" class="ruleset-actions-segment active" data-pane="generate" role="tab">Generate</button>
                <button id="ruleset-actions-mutate-tab" class="ruleset-actions-segment" data-pane="mutate" role="tab">Mutate</button>
                <button id="ruleset-actions-breed-tab" class="ruleset-actions-segment" data-pane="breed" role="tab">Breed</button>
            </div>
            <p class="ruleset-actions-blurb" id="ruleset-actions-blurb"></p>
            <div class="ruleset-actions-content">
                <div id="ruleset-actions-generate-pane" class="ruleset-pane"></div>
                <div id="ruleset-actions-mutate-pane" class="ruleset-pane hidden"></div>
                <div id="ruleset-actions-breed-pane" class="ruleset-pane hidden"></div>
            </div>
        `;

        this.blurb = this.element.querySelector('#ruleset-actions-blurb');

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
        const controller = this.appContext.rulesetActionController;

        pane.innerHTML = `
            <div class="ruleset-field">
                <span class="ruleset-field-label">Generation method</span>
                <div id="ruleset-actions-gen-mode-mount"></div>
            </div>
            <div id="ruleset-actions-use-custom-bias-mount"></div>
            <div class="ruleset-field ruleset-subfield" id="ruleset-actions-bias-field">
                <span class="ruleset-field-label">Density bias</span>
                <div id="ruleset-actions-bias-slider-mount"></div>
            </div>
            <div class="ruleset-field">
                <span class="ruleset-field-label">Apply to</span>
                <div id="ruleset-actions-gen-scope-mount"></div>
            </div>
            <div id="ruleset-actions-gen-reset-mount"></div>
            <button class="button ruleset-primary-action" data-action="generate">Generate New Ruleset</button>
        `;

        new SwitchComponent(pane.querySelector(`#ruleset-actions-gen-mode-mount`), {
            label: '',
            type: 'radio',
            name: `ruleset-actions-gen-mode`,
            initialValue: controller.getGenMode(),
            items: controller.getGenerationConfig(),
            onChange: controller.setGenMode
        });

        this.sliders.bias = new SliderComponent(pane.querySelector(`#ruleset-actions-bias-slider-mount`), {
            ...controller.getBiasSliderConfig(),
            label: '',
            id: `ruleset-actions-bias-slider`,
            value: controller.getBias(),
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-gen-scope-mount`), {
            ...controller.getGenScopeSwitchConfig(),
            label: '',
            name: `ruleset-actions-gen-scope`,
            initialValue: controller.getGenScope(),
        });

        const biasField = pane.querySelector('#ruleset-actions-bias-field');
        const syncBias = (useCustom) => {
            biasField.classList.toggle('hidden', !useCustom);
        };

        new ToggleSwitch(pane.querySelector(`#ruleset-actions-use-custom-bias-mount`), {
            id: 'ruleset-actions-use-custom-bias',
            label: 'Custom density bias',
            description: 'Set the share of live cells in new rulesets (off = random).',
            initialValue: controller.getUseCustomBias(),
            onChange: (checked) => {
                controller.setUseCustomBias(checked);
                syncBias(checked);
            }
        });
        syncBias(controller.getUseCustomBias());

        new ToggleSwitch(pane.querySelector(`#ruleset-actions-gen-reset-mount`), {
            id: 'ruleset-actions-gen-reset',
            label: 'Auto-reset worlds',
            description: 'Re-seed affected worlds after generating.',
            initialValue: controller.getGenAutoReset(),
            onChange: controller.setGenAutoReset
        });
    }

    _renderMutatePane() {
        const pane = this.panes.mutate;
        const controller = this.appContext.rulesetActionController;

        pane.innerHTML = `
            <div class="ruleset-field">
                <span class="ruleset-field-label">Mutation rate</span>
                <div id="ruleset-actions-mutate-rate-mount"></div>
            </div>
            <div class="ruleset-field">
                <span class="ruleset-field-label">Mutation method</span>
                <div id="ruleset-actions-mutate-mode-mount"></div>
            </div>
            <div class="ruleset-field">
                <span class="ruleset-field-label">Apply to</span>
                <div id="ruleset-actions-mutate-scope-mount"></div>
            </div>
            <div id="ruleset-actions-ensure-mutation-mount"></div>
            <button class="button ruleset-primary-action" data-action="mutate">Mutate Ruleset</button>
            <div class="ruleset-secondary-actions">
                <button class="button" data-action="clone" title="Copy the selected world's ruleset to the others">Clone</button>
                <button class="button" data-action="clone-mutate" title="Copy the ruleset to the others, then mutate each copy">Clone &amp; Mutate</button>
            </div>
        `;

        new SliderComponent(pane.querySelector(`#ruleset-actions-mutate-rate-mount`), {
            ...controller.getMutationRateSliderConfig(),
            label: '',
            id: `ruleset-actions-mutate-rate`,
            value: controller.getMutateRate(),
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-mutate-mode-mount`), {
            label: '',
            type: 'radio',
            name: `ruleset-actions-mutate-mode`,
            initialValue: controller.getMutateMode(),
            items: controller.getMutationModeConfig(),
            onChange: controller.setMutateMode
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-mutate-scope-mount`), {
            label: '',
            type: 'radio',
            name: `ruleset-actions-mutate-scope`,
            initialValue: controller.getMutateScope(),
            items: controller.getMutationScopeConfig(),
            onChange: controller.setMutateScope
        });

        new ToggleSwitch(pane.querySelector(`#ruleset-actions-ensure-mutation-mount`), {
            id: 'ruleset-actions-ensure-mutation',
            label: 'Ensure at least one change',
            description: 'Guarantee a mutation even at low rates.',
            initialValue: controller.getEnsureMutation(),
            onChange: controller.setEnsureMutation
        });
    }

    _renderBreedPane() {
        const pane = this.panes.breed;
        const controller = this.appContext.rulesetActionController;

        const grid = Array.from({ length: 9 }, (_, i) =>
            `<button type="button" class="breed-parent-cell" data-world="${i}" title="Toggle World ${i + 1} as a breeding parent">${i + 1}</button>`
        ).join('');

        pane.innerHTML = `
            <p class="ruleset-hint">Mark worlds as <strong>parents</strong> below (or press <kbd>B</kbd> on a
            world). The remaining worlds become offspring recombined from the parents' genepool — one
            parent ≈ clone&nbsp;&amp; mutate, two or more cross-breed.</p>
            <div class="ruleset-field">
                <span class="ruleset-field-label">Parent worlds</span>
                <div class="breed-parent-grid">${grid}</div>
                <div class="breed-parent-readout" id="ruleset-actions-breed-readout"></div>
            </div>
            <div class="ruleset-field">
                <span class="ruleset-field-label">Inheritance</span>
                <div id="ruleset-actions-breed-mode-mount"></div>
            </div>
            <div class="ruleset-field">
                <span class="ruleset-field-label">Offspring mutation</span>
                <div id="ruleset-actions-breed-rate-mount"></div>
            </div>
            <button class="button ruleset-primary-action" data-action="breed" title="Recombine the parent genepool into the offspring worlds">Breed Offspring</button>
            <button class="button ruleset-secondary-full" data-action="breed-clear" title="Clear all parent flags">Clear Parents</button>
        `;

        new SwitchComponent(pane.querySelector('#ruleset-actions-breed-mode-mount'), {
            label: '',
            type: 'radio',
            name: 'ruleset-actions-breed-mode',
            initialValue: controller.getBreedMode(),
            items: controller.getBreedModeConfig(),
            onChange: controller.setBreedMode
        });

        new SliderComponent(pane.querySelector('#ruleset-actions-breed-rate-mount'), {
            ...controller.getBreedMutationRateSliderConfig(),
            label: '',
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
        if (this.blurb) this.blurb.textContent = PANE_BLURBS[paneName] || '';
    }
}
