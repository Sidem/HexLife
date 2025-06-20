import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class LearningComponent extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options);

        this.appContext = options.appContext;
        if (!this.appContext) {
            console.error('LearningComponent: appContext was not provided.');
            return;
        }

        this.element = document.createElement('div');
        this.element.className = 'learning-component-content';
        this.element.innerHTML = `
            <p class="editor-text info-text" style="text-align: left;">Replay any tutorial to learn more about the explorer's features. Your progress is saved automatically.</p>
            <ul class="learning-center-list"></ul>
        `;

        this.tourListElement = this.element.querySelector('.learning-center-list');

        // --- UPDATED: Unified tour list ---
        // This list no longer needs device-specific flags. Each tour is now adaptive.
        this.availableTours = [
            { id: 'core', name: 'Core Orientation' },
            { id: 'appliedEvolution', name: 'Mission: Applied Evolution' },
            { id: 'controls', name: 'Tutorial: Simulation Controls' },
            { id: 'ruleset_actions', name: 'Tutorial: Ruleset Actions' },
            { id: 'editor', name: 'Tutorial: The Ruleset Editor' },
            // { id: 'analysis', name: 'Tutorial: Analysis Tools' },
            // { id: 'worlds', name: 'Tutorial: World Setup' },
            // { id: 'file_management', name: 'Tutorial: Save, Load & Share' },
        ];

        this._setupEventListeners();
        this.refreshTourList();
    }

    getElement() {
        return this.element;
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
        
        this._subscribeToEvent(EVENTS.TOUR_ENDED, () => this.refreshTourList());
    }

    refreshTourList() {
        if (!this.tourListElement || !this.appContext.uiManager) return;

        this.tourListElement.innerHTML = '';
        const completedTours = PersistenceService.loadOnboardingStates();

        // --- UPDATED: Simplified rendering logic ---
        // No longer needs to filter by device, as tours are unified.
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

    refresh() {
        this.refreshTourList();
    }
}