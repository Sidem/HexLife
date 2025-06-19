import { BaseComponent } from './BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class LearningComponent extends BaseComponent {
    constructor(mountPoint, options = {}) {
        super(mountPoint, options); // Call BaseComponent constructor

        this.appContext = options.appContext;
        if (!this.appContext) {
            console.error('LearningComponent: appContext was not provided.');
            return;
        }

        // Create the root element for this component's content
        this.element = document.createElement('div');
        this.element.className = 'learning-component-content';
        this.element.innerHTML = `
            <p class="editor-text info-text" style="text-align: left;">Replay any tutorial to learn more about the explorer's features. Your progress is saved automatically.</p>
            <ul class="learning-center-list"></ul>
        `;

        this.tourListElement = this.element.querySelector('.learning-center-list');
        
        // Define all available tours, flagging them for mobile if necessary
        this.availableTours = [
            { id: 'core', name: 'Desktop Orientation', desktopOnly: true },
            { id: 'coreMobile', name: 'Mobile Orientation', mobileOnly: true },
            { id: 'appliedEvolution', name: 'Mission: Applied Evolution', mobileOnly: true },
            { id: 'editorTour', name: 'Tutorial: Ruleset Editor', mobileOnly: true },
            { id: 'analysisTour', name: 'Tutorial: Analysis Tools', mobileOnly: true  },
            { id: 'worldsTour', name: 'Tutorial: World Setup', mobileOnly: true  },
            { id: 'speedAndBrush', name: 'Speed & Brush Controls', desktopOnly: true },
            { id: 'rulesetGeneration', name: 'Generating & Mutating Rules', desktopOnly: true },
            { id: 'mutation', name: 'Tutorial: Mutation & Cloning', desktopOnly: true },
            { id: 'editor', name: 'The Ruleset Editor', desktopOnly: true },
            { id: 'analysis', name: 'Analysis Tools', desktopOnly: true },
            { id: 'ruleRank', name: 'Rule Ranking Panel', desktopOnly: true },
            { id: 'setup', name: 'World Setup Panel', desktopOnly: true },
            { id: 'history', name: 'Ruleset History', desktopOnly: true },
            { id: 'saveLoad', name: 'Save & Load', desktopOnly: true },
            { id: 'directInput', name: 'Tutorial: Direct Ruleset Input', desktopOnly: true },
            { id: 'resetClear', name: 'Tutorial: Reset & Clear', desktopOnly: true },
            { id: 'library', name: 'Tutorial: Content Library', desktopOnly: true },
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
                // Hide the panel/view before starting the tour for a cleaner UX
                EventBus.dispatch(EVENTS.COMMAND_HIDE_ALL_OVERLAYS);
                if (this.appContext.onboardingManager) {
                    this.appContext.onboardingManager.startTour(tourName, true);
                }
            }
        });

        // Subscribe to event to refresh the list when a tour is completed
        this._subscribeToEvent(EVENTS.TOUR_ENDED, () => this.refreshTourList());
    }

    refreshTourList() {
        if (!this.tourListElement || !this.appContext.uiManager) return;
        
        this.tourListElement.innerHTML = '';
        const completedTours = PersistenceService.loadOnboardingStates();
        const isMobile = this.appContext.uiManager.isMobile();

        const toursToShow = this.availableTours.filter(tour => {
            if (isMobile) {
                return !tour.desktopOnly; // Show mobile-only and common tours
            } else {
                return !tour.mobileOnly; // Show desktop-only and common tours
            }
        });

        toursToShow.forEach(tour => {
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

    // Add refresh method that can be called by the DraggablePanel presenter
    refresh() {
        this.refreshTourList();
    }
} 