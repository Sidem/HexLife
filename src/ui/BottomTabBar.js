import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { ICONS } from './icons.js';

const TAB_ICONS = {
    watch: ICONS.hexagon,
    discover: ICONS.sparkles,
    build: ICONS.pencil,
    library: ICONS.library,
};


export class BottomTabBar extends BaseComponent {
    constructor(mountPoint, panelManager) {
        super(mountPoint);
        this.panelManager = panelManager;
        this.buttons = {};

        this._initButtons();
        this._setupEventListeners();
        this.updateActiveButton('watch');
    }

    _initButtons() {
        this.mountPoint.querySelectorAll('.tab-bar-button').forEach(button => {
            const view = button.dataset.view;
            this.buttons[view] = button;
            const iconEl = button.querySelector('.icon');
            if (iconEl && TAB_ICONS[view]) iconEl.innerHTML = TAB_ICONS[view];
        });
    }

    _setupEventListeners() {
        Object.entries(this.buttons).forEach(([view, button]) => {
            this._addDOMListener(button, 'click', () => this.handleViewChange(view));
        });
        this._subscribeToEvent(EVENTS.MOBILE_VIEW_CHANGED, (data) => {
            // `activeTab` is the top-level tab to highlight (watch/discover/build/library);
            // it is '' for gear-only views (More/Settings/Analysis) so no tab lights up.
            this.updateActiveButton(data.activeTab ?? data.activeView);
        });
    }

    handleViewChange(view) {
        EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: view });
    }

    updateActiveButton(activeView) {
        Object.entries(this.buttons).forEach(([view, button]) => {
            if (view === activeView) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }
}