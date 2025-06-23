import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { SliderComponent } from './SliderComponent.js';
import { SwitchComponent } from './SwitchComponent.js';
import { RulesetDirectInput } from './RulesetDirectInput.js';

export class RulesetActionsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options); // No mountPoint
        this.appContext = appContext;
        // No more this.context
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
                <button id="ruleset-actions-generate-tab" class="ruleset-actions-segment active" data-pane="generate">Generate</button>
                <button id="ruleset-actions-mutate-tab" class="ruleset-actions-segment" data-pane="mutate">Mutate</button>
                <button id="ruleset-actions-library-tab" class="ruleset-actions-segment" data-pane="library">Library</button>
                <button id="ruleset-actions-direct-tab" class="ruleset-actions-segment" data-pane="direct">Direct</button>
            </div>
            <div class="ruleset-actions-content">
                <div id="ruleset-actions-generate-pane" class="ruleset-pane"></div>
                <div id="ruleset-actions-mutate-pane" class="ruleset-pane hidden"></div>
                <div id="ruleset-actions-library-pane" class="ruleset-pane hidden"></div>
                <div id="ruleset-actions-direct-pane" class="ruleset-pane hidden"></div>
            </div>
        `;

        this.panes = {
            generate: this.element.querySelector(`#ruleset-actions-generate-pane`),
            mutate: this.element.querySelector(`#ruleset-actions-mutate-pane`),
            library: this.element.querySelector(`#ruleset-actions-library-pane`),
            direct: this.element.querySelector(`#ruleset-actions-direct-pane`),
        };

        this.segments = {
            generate: this.element.querySelector('[data-pane="generate"]'),
            mutate: this.element.querySelector('[data-pane="mutate"]'),
            library: this.element.querySelector('[data-pane="library"]'),
            direct: this.element.querySelector('[data-pane="direct"]'),
        };
        this.actionsPopover = this.appContext.uiManager.actionsPopover; // Get reference from UIManager
        this.factory = this.appContext.rulesetDisplayFactory;

        this._renderGeneratePane();
        this._renderMutatePane();
        this._renderLibraryPane();
        this._renderDirectPane();
    }

    _renderGeneratePane() {
        const pane = this.panes.generate;
        const controllerState = this.appContext.rulesetActionController.getState();
        
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
            name: `ruleset-actions-gen-mode`, // Static name
            initialValue: controllerState.genMode,
            items: this.appContext.rulesetActionController.getGenerationConfig(),
            onChange: this.appContext.rulesetActionController.setGenMode
        });
        
        this.sliders.bias = new SliderComponent(pane.querySelector(`#ruleset-actions-bias-slider-mount`), {
            ...this.appContext.rulesetActionController.getBiasSliderConfig(),
            id: `ruleset-actions-bias-slider`, // Static ID
            value: controllerState.bias,
            disabled: !controllerState.useCustomBias
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-gen-scope-mount`), {
            ...this.appContext.rulesetActionController.getGenScopeSwitchConfig(),
            name: `ruleset-actions-gen-scope`, // Static name
            initialValue: controllerState.genScope,
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-gen-reset-mount`), {
            ...this.appContext.rulesetActionController.getGenAutoResetSwitchConfig(),
            name: `ruleset-actions-gen-reset`, // Static name
            initialValue: controllerState.genAutoReset,
        });

        
        const biasCheckbox = pane.querySelector(`#ruleset-actions-use-custom-bias`);
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
            <div class="form-group" id="ruleset-actions-mutate-rate-mount"></div>
            <div class="form-group" id="ruleset-actions-mutate-mode-mount"></div>
            <div class="form-group" id="ruleset-actions-mutate-scope-mount"></div>
            <div class="form-group-buttons">
                <button class="button" data-action="mutate">Mutate</button>
                <button class="button" data-action="clone">Clone</button>
                <button class="button" data-action="clone-mutate">Clone & Mutate</button>
            </div>
        `;
        
        new SliderComponent(pane.querySelector(`#ruleset-actions-mutate-rate-mount`), {
            ...this.appContext.rulesetActionController.getMutationRateSliderConfig(),
            id: `ruleset-actions-mutate-rate`, // Static ID
            value: controllerState.mutateRate,
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-mutate-mode-mount`), {
            label: 'Mutation Mode:', 
            type: 'radio', 
            name: `ruleset-actions-mutate-mode`, // Static name
            initialValue: controllerState.mutateMode,
            items: this.appContext.rulesetActionController.getMutationModeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateMode
        });

        new SwitchComponent(pane.querySelector(`#ruleset-actions-mutate-scope-mount`), {
            label: 'Apply to:',
            type: 'radio',
            name: `ruleset-actions-mutate-scope`, // Static name
            initialValue: controllerState.mutateScope,
            items: this.appContext.rulesetActionController.getMutationScopeConfig(),
            onChange: this.appContext.rulesetActionController.setMutateScope
        });
    }

    _renderLibraryPane() {
        const pane = this.panes.library;
        pane.innerHTML = `
            <div class="library-filter-tabs">
                <button class="sub-tab-button active" data-library-filter="public">Public</button>
                <button class="sub-tab-button" data-library-filter="personal">My Rulesets</button>
            </div>
            <div id="ruleset-actions-library-public-content" class="library-list"></div>
            <div id="ruleset-actions-library-personal-content" class="library-list hidden"></div>
        `;
        
        this._renderPublicLibrary();
        this._renderPersonalLibrary();
    }

    _renderPublicLibrary() {
        const rulesetsList = this.element.querySelector('#ruleset-actions-library-public-content');
        rulesetsList.innerHTML = ''; // Clear previous content
        if (!this.libraryData || !this.libraryData.rulesets) return;

        this.libraryData.rulesets.forEach(rule => {
            const item = this.factory.createLibraryListItem(rule, false);
            rulesetsList.appendChild(item);
        });
    }

    _renderPersonalLibrary() {
        const personalList = this.element.querySelector('#ruleset-actions-library-personal-content');
        personalList.innerHTML = ''; // Clear previous content
        const userRulesets = this.appContext.libraryController.getUserLibrary();

        if (userRulesets.length === 0) {
            personalList.innerHTML = `<p class="empty-state-text">You haven't saved any rulesets yet. Click the ⭐ icon to save the current ruleset!</p>`;
            return;
        }

        userRulesets.forEach(rule => {
            const item = this.factory.createLibraryListItem(rule, true);
            personalList.appendChild(item);
        });
    }

    _renderDirectPane() {
        const mountPoint = this.panes.direct;
        mountPoint.innerHTML = '';
        new RulesetDirectInput(mountPoint, this.appContext, { context: `ruleset-actions-direct` });
    }

    attachEventListeners() {
        this.element.querySelector('.ruleset-actions-header').addEventListener('click', e => {
            if (e.target.matches('.ruleset-actions-segment')) {
                this.setActivePane(e.target.dataset.pane);
            }
        });

        const libraryPane = this.element.querySelector(`#ruleset-actions-library-pane`);
        libraryPane.addEventListener('click', e => {
            const target = e.target;
            const action = target.dataset.action;
            const id = target.dataset.id;
            const controllerState = this.appContext.rulesetActionController.getState();

            // Handle sub-tab filtering
            if (target.matches('[data-library-filter]')) {
                const filter = target.dataset.libraryFilter;
                libraryPane.querySelectorAll('.sub-tab-button').forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                
                const publicPane = libraryPane.querySelector('#ruleset-actions-library-public-content');
                const personalPane = libraryPane.querySelector('#ruleset-actions-library-personal-content');
                
                publicPane.classList.toggle('hidden', filter !== 'public');
                personalPane.classList.toggle('hidden', filter !== 'personal');
                return;
            }

            if (action === 'load-rule' || action === 'load-personal') {
                this.appContext.libraryController.loadRuleset(
                    target.parentNode.dataset.hex,
                    controllerState.genScope,
                    controllerState.genAutoReset
                );
                EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
            }
            
            // Handle showing the management popover for personal rules
            if (target.closest('[data-action="manage-personal"]')) {
                const manageButton = target.closest('[data-action="manage-personal"]');
                const actionsContainer = manageButton.parentElement;
                const id = actionsContainer.dataset.id;
                const rule = this.appContext.libraryController.getUserLibrary().find(r => r.id === id);
                if (!rule) return;

                const popoverActions = [
                    {
                        label: 'Rename',
                        callback: () => EventBus.dispatch(EVENTS.COMMAND_SHOW_SAVE_RULESET_MODAL, rule)
                    },
                    {
                        label: 'Share',
                        callback: () => {
                            const url = new URL(window.location.href);
                            url.search = `?r=${rule.hex}`;
                            navigator.clipboard.writeText(url.toString()).then(() => {
                                EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: 'Share link copied!', type: 'success' });
                            });
                        }
                    },
                    {
                        label: 'Delete',
                        callback: () => {
                            EventBus.dispatch(EVENTS.COMMAND_SHOW_CONFIRMATION, {
                                title: 'Delete Ruleset',
                                message: `Are you sure you want to permanently delete "${rule.name}"?`,
                                confirmLabel: 'Delete',
                                onConfirm: () => {
                                    this.appContext.libraryController.deleteUserRuleset(rule.id);
                                    EventBus.dispatch(EVENTS.COMMAND_SHOW_TOAST, { message: `Deleted "${rule.name}".`, type: 'info' });
                                }
                            });
                        }
                    }
                ];
                
                this.actionsPopover.show(popoverActions, manageButton);
            }
        });

        this.element.querySelector('[data-action="generate"]').addEventListener('click', () => {
             EventBus.dispatch(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET);
             EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
        });
        
        const mutatePane = this.element.querySelector(`#ruleset-actions-mutate-pane`);
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

        // Add this new subscription
        this._subscribeToEvent(EVENTS.USER_LIBRARY_CHANGED, this._renderPersonalLibrary);
    }

    setActivePane(paneName) {
        for (const key in this.panes) {
            this.panes[key].classList.add('hidden');
            this.segments[key].classList.remove('active');
        }
        this.panes[paneName].classList.remove('hidden');
        this.segments[paneName].classList.add('active');
    }

    // The populateLibraryData method is no longer needed and has been deleted.
} 