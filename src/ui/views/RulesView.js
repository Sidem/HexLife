import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import { RulesetActionsComponent } from '../components/RulesetActionsComponent.js';

export class RulesView extends BaseComponent {
    constructor(mountPoint, appContext, libraryData) {
        super(mountPoint);
        this.appContext = appContext;
        this.libraryData = libraryData;
        this.element = null;
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'rules-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
            <div class="mobile-view-header">
                <h2 class="mobile-view-title">Rulesets</h2>
                <button class="mobile-view-close-button" data-action="close">&times;</button>
            </div>
            <div class="mobile-view-content-area">
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        // Instantiate the unified RulesetActionsComponent for mobile
        const contentArea = this.element.querySelector('.mobile-view-content-area');
        new RulesetActionsComponent(contentArea, { context: 'mobile', libraryData: this.libraryData, appContext: this.appContext });
        
        this.attachEventListeners();
    }

    attachEventListeners() {
        this._addDOMListener(this.element.querySelector('.mobile-view-close-button'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'simulate' });
        });
    }

    show() {
        this.element.classList.remove('hidden');
    }

    hide() {
        this.element.classList.add('hidden');
    }
} 