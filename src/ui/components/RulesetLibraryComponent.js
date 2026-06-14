import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { SwitchComponent } from './SwitchComponent.js';
import { RulesetDirectInput } from './RulesetDirectInput.js';
import { ICONS } from '../icons.js';

/**
 * The Ruleset Library menu: load saved rulesets (public + personal) or set one
 * directly from a hex code. Split out of RulesetActionsComponent so the library
 * lives behind its own toolbar button. A single "Apply to:" scope selector at the
 * top governs both the Library loads and the Direct hex set (shared, persisted
 * `globalRulesetScopeAll` setting via RulesetActionController).
 */
export class RulesetLibraryComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;

        this.libraryData = options.libraryData;
        this.element = document.createElement('div');
        this.element.className = 'ruleset-actions-container';

        this.render();
        this.attachEventListeners();
        this.setActivePane('library');
    }

    getElement() {
        return this.element;
    }

    render() {
        this.element.innerHTML = `
            <div class="form-group ruleset-library-scope" id="ruleset-library-scope-mount"></div>
            <div class="ruleset-actions-header">
                <button class="ruleset-actions-segment active" data-pane="library">Library</button>
                <button class="ruleset-actions-segment" data-pane="direct">Direct</button>
            </div>
            <div class="ruleset-actions-content">
                <div id="ruleset-library-library-pane" class="ruleset-pane"></div>
                <div id="ruleset-library-direct-pane" class="ruleset-pane hidden"></div>
            </div>
        `;

        this.panes = {
            library: this.element.querySelector('#ruleset-library-library-pane'),
            direct: this.element.querySelector('#ruleset-library-direct-pane'),
        };

        this.segments = {
            library: this.element.querySelector('[data-pane="library"]'),
            direct: this.element.querySelector('[data-pane="direct"]'),
        };

        this.actionsPopover = this.appContext.uiManager.actionsPopover;
        this.factory = this.appContext.rulesetDisplayFactory;

        new SwitchComponent(this.element.querySelector('#ruleset-library-scope-mount'), {
            ...this.appContext.rulesetActionController.getGenScopeSwitchConfig(),
            name: 'ruleset-library-scope',
            initialValue: this.appContext.rulesetActionController.getGenScope(),
        });

        this._renderLibraryPane();
        this._renderDirectPane();
    }

    _renderLibraryPane() {
        const pane = this.panes.library;
        pane.innerHTML = `
            <div class="library-filter-tabs">
                <button class="sub-tab-button active" data-library-filter="public">Public</button>
                <button class="sub-tab-button" data-library-filter="personal">My Rulesets</button>
            </div>
            <div id="ruleset-library-public-content" class="library-list"></div>
            <div id="ruleset-library-personal-content" class="library-list hidden"></div>
        `;

        this._renderPublicLibrary();
        this._renderPersonalLibrary();
    }

    _renderPublicLibrary() {
        const rulesetsList = this.element.querySelector('#ruleset-library-public-content');
        rulesetsList.innerHTML = '';
        if (!this.libraryData || !this.libraryData.rulesets) return;

        this.libraryData.rulesets.forEach(rule => {
            const item = this.factory.createLibraryListItem(rule, false);
            rulesetsList.appendChild(item);
        });
    }

    _renderPersonalLibrary() {
        const personalList = this.element.querySelector('#ruleset-library-personal-content');
        personalList.innerHTML = '';
        const userRulesets = this.appContext.libraryController.getUserLibrary();

        if (userRulesets.length === 0) {
            personalList.innerHTML = `<p class="empty-state-text">You haven't saved any rulesets yet. Click the <span class="inline-icon">${ICONS.star}</span> icon to save the current ruleset!</p>`;
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
        new RulesetDirectInput(mountPoint, this.appContext, { context: 'ruleset-library-direct' });
    }

    attachEventListeners() {
        this.element.querySelector('.ruleset-actions-header').addEventListener('click', e => {
            if (e.target.matches('.ruleset-actions-segment')) {
                this.setActivePane(e.target.dataset.pane);
            }
        });

        const libraryPane = this.panes.library;
        libraryPane.addEventListener('click', e => {
            const target = e.target;
            const action = target.dataset.action;
            const rulesetActionController = this.appContext.rulesetActionController;

            if (target.matches('[data-library-filter]')) {
                const filter = target.dataset.libraryFilter;
                libraryPane.querySelectorAll('.sub-tab-button').forEach(b => b.classList.remove('active'));
                target.classList.add('active');

                const publicPane = libraryPane.querySelector('#ruleset-library-public-content');
                const personalPane = libraryPane.querySelector('#ruleset-library-personal-content');

                publicPane.classList.toggle('hidden', filter !== 'public');
                personalPane.classList.toggle('hidden', filter !== 'personal');
                return;
            }

            if (action === 'load-rule' || action === 'load-personal') {
                this.appContext.libraryController.loadRuleset(
                    target.parentNode.dataset.hex,
                    rulesetActionController.getGenScope(),
                    rulesetActionController.getGenAutoReset()
                );
            }

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
}
