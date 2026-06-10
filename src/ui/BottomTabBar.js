import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';
import { ICONS } from './icons.js';

const TAB_ICONS = {
    simulate: ICONS.hexagon,
    rules: ICONS.sparkles,
    editor: ICONS.pencil,
    worlds: ICONS.globe,
    analyze: ICONS.chartBars,
    learning: ICONS.graduationCap,
    more: ICONS.ellipsis,
};


export class BottomTabBar extends BaseComponent {
    constructor(mountPoint, panelManager) {
        super(mountPoint);
        this.panelManager = panelManager;
        this.buttons = {};

        this._initButtons();
        this._setupEventListeners();
        this.updateActiveButton('simulate');
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
            this.updateActiveButton(data.activeView);
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