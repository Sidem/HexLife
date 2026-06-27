import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';
import { ICONS } from '../icons.js';
import { TOUR_CATALOG } from '../tourSteps.js';

export class LearningComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options); 

        this.appContext = appContext;
        if (!this.appContext) {
            console.error('LearningComponent: appContext was not provided.');
            return;
        }
        
        // Single source of truth lives in tourSteps.js (TOUR_CATALOG) so the Hub
        // list can't drift out of sync with the registered tours.
        this.availableTours = TOUR_CATALOG.map(t => ({
            id: t.id,
            name: t.name,
            section: t.section,
            desktopOnly: t.platform === 'desktopOnly',
        }));

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

        let currentSection = null;
        this.availableTours.forEach(tour => {
            if (tour.section !== currentSection) {
                currentSection = tour.section;
                const header = document.createElement('li');
                header.className = 'learning-section-header';
                header.textContent = currentSection;
                this.tourListElement.appendChild(header);
            }

            const li = document.createElement('li');
            li.className = 'learning-center-item';
            li.innerHTML = `
                <span class="status-icon">${ICONS.graduationCap}</span>
                <span class="tour-name">${tour.name}</span>
                <button class="button tour-start-button" data-tour-name="${tour.id}">Start</button>
            `;

            this.tourItemCache[tour.id] = {
                item: li,
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
        const isMobile = this.appContext.uiManager.isMobile();

        this.availableTours.forEach(tour => {
            const isCompleted = completedTours[tour.id];
            const cache = this.tourItemCache[tour.id];
            if (cache) {
                cache.statusIcon.innerHTML = isCompleted ? ICONS.check : ICONS.graduationCap;
                cache.startButton.textContent = isCompleted ? 'Replay' : 'Start';
                cache.item.classList.toggle('hidden', Boolean(tour.desktopOnly && isMobile));
            }
        });
    }

    refresh() {
        this.refreshTourList();
    }
}