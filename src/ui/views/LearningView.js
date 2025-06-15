import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class LearningView extends BaseComponent {
    constructor(mountPoint) {
        super(mountPoint);
        this.element = null;
        this.tourListElement = null;
        this.availableTours = [
            { id: 'coreMobile', name: 'Main Orientation' },
            { id: 'appliedEvolution', name: 'Mission: Applied Evolution' },
            //{ id: 'commandDeck', name: 'Tutorial: Command Deck' },
            { id: 'editorTour', name: 'Tutorial: Ruleset Editor' },
            { id: 'analysisTour', name: 'Tutorial: Analysis Tools' },
            { id: 'worldsTour', name: 'Tutorial: World Setup' }
        ];
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'learning-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
            <div class="mobile-view-header">
                <h2 class="mobile-view-title">Learning Hub</h2>
                <button class="mobile-view-close-button" data-action="close">&times;</button>
            </div>
            <div class="mobile-view-content-area" style="padding: 10px;">
                 <p class="editor-text info-text" style="text-align: left;">Replay any tutorial to learn more about the explorer's features. Your progress is saved automatically.</p>
                <ul id="mobile-tour-list" class="learning-center-list"></ul>
            </div>
        `;
        this.mountPoint.appendChild(this.element);
        this.tourListElement = this.element.querySelector('#mobile-tour-list');
        
        this.refreshTourList();
        this.attachEventListeners();
        
        this._subscribeToEvent(EVENTS.TOUR_ENDED, () => this.refreshTourList());
    }

    refreshTourList() {
        if (!this.tourListElement) return;
        this.tourListElement.innerHTML = '';
        const completedTours = PersistenceService.loadOnboardingStates();

        this.availableTours.forEach(tour => {
            const isCompleted = completedTours[tour.id];
            const li = document.createElement('li');
            li.className = 'learning-center-item';
            li.innerHTML = `
                <span class="status-icon">${isCompleted ? '✅' : '🎓'}</span>
                <span class="tour-name">${tour.name}</span>
                <button class="button tour-start-button" data-tour-name="${tour.id}">
                    ${isCompleted ? 'Replay' : 'Start'}
                </button>
            `;
            this.tourListElement.appendChild(li);
        });
    }

    attachEventListeners() {
        this.element.addEventListener('click', (e) => {
            const target = e.target;
            if (target.matches('.tour-start-button')) {
                const tourName = target.dataset.tourName;
                // Access onboardingManager through the global window object
                if (window.OnboardingManager) {
                    window.OnboardingManager.startTour(tourName, true);
                }
            } else if (target.matches('[data-action="close"]')) {
                EventBus.dispatch(EVENTS.COMMAND_SHOW_VIEW, { targetView: 'simulate' });
            }
        });
    }

    show() {
        this.element.classList.remove('hidden');
        this.refreshTourList();
    }

    hide() {
        this.element.classList.add('hidden');
    }
} 