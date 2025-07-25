import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class LearningComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options); 

        this.appContext = appContext;
        if (!this.appContext) {
            console.error('LearningComponent: appContext was not provided.');
            return;
        }
        
        this.availableTours = [
            { id: 'core', name: 'Core Orientation' },
            { id: 'appliedEvolution', name: 'Mission: Applied Evolution' },
            { id: 'controls', name: 'Tutorial: Simulation Controls' },
            { id: 'ruleset_actions', name: 'Tutorial: Ruleset Actions' },
            { id: 'editor', name: 'Tutorial: The Ruleset Editor' },
            { id: 'reset-clear', name: 'Tutorial: Reset & Clear' },
            { id: 'save-load', name: 'Tutorial: Save, Load & Share' },
        ];
        
        this.tourItemCache = {};

        this.render(); 
        this.refreshTourList(); 
    }

    getElement() {
        return this.element;
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'learning-component-content';
        this.element.innerHTML = `
            <p class="editor-text info-text" style="text-align: left;">Replay any tutorial to learn more about the explorer's features. Your progress is saved automatically.</p>
            <ul class="learning-center-list"></ul>
        `;

        this.tourListElement = this.element.querySelector('.learning-center-list');
        
        this.availableTours.forEach(tour => {
            const li = document.createElement('li');
            li.className = 'learning-center-item';
            li.innerHTML = `
                <span class="status-icon">🎓</span>
                <span class="tour-name">${tour.name}</span>
                <button class="button tour-start-button" data-tour-name="${tour.id}">Start</button>
            `;
            
            this.tourItemCache[tour.id] = {
                statusIcon: li.querySelector('.status-icon'),
                startButton: li.querySelector('.tour-start-button')
            };
            this.tourListElement.appendChild(li);
        });

        this._setupEventListeners();
    }

    _setupEventListeners() {
        this.element.addEventListener('click', (e) => {
            if (e.target.matches('.tour-start-button')) {
                const tourName = e.target.dataset.tourName;
                EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
                if (this.appContext.onboardingManager) {
                    this.appContext.onboardingManager.startTour(tourName, true);
                }
            }
        });
        
        this._subscribeToEvent(EVENTS.ONBOARDING_TOUR_ENDED, () => this.refreshTourList());
    }

    refreshTourList() {
        if (!this.tourListElement || !this.appContext.uiManager) return;

        const completedTours = PersistenceService.loadOnboardingStates();

        this.availableTours.forEach(tour => {
            const isCompleted = completedTours[tour.id];
            const cache = this.tourItemCache[tour.id];
            if (cache) {
                cache.statusIcon.textContent = isCompleted ? '✅' : '🎓';
                cache.startButton.textContent = isCompleted ? 'Replay' : 'Start';
            }
        });
    }

    refresh() {
        this.refreshTourList();
    }
}