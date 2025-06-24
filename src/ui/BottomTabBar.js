import { BaseComponent } from './components/BaseComponent.js';
import { EventBus, EVENTS } from '../services/EventBus.js';


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