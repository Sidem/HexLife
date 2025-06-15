import { DraggablePanel } from './DraggablePanel.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

export class LearningPanel extends DraggablePanel {
    constructor(panelElement, worldManagerInterface, options = {}) {
        super(panelElement, 'h3', { ...options, persistence: { identifier: 'learning' } });

        this.tourListElement = this.panelElement.querySelector('#desktop-tour-list');
        this.availableTours = [
            { id: 'core', name: 'Main Orientation' },
            { id: 'speedAndBrush', name: 'Tutorial: Speed & Brush' },
            { id: 'rulesetGeneration', name: 'Tutorial: Generating Rules' },
            { id: 'mutation', name: 'Tutorial: Mutation & Cloning' },
            { id: 'editor', name: 'Tutorial: Ruleset Editor' },
            { id: 'analysis', name: 'Tutorial: Analysis Tools' },
            { id: 'ruleRank', name: 'Tutorial: Rule Ranking' },
            { id: 'setup', name: 'Tutorial: World Setup' },
            { id: 'directInput', name: 'Tutorial: Direct Ruleset Input' },
            { id: 'library', name: 'Tutorial: Content Library' },
            { id: 'history', name: 'Tutorial: Ruleset History' },
            { id: 'saveLoad', name: 'Tutorial: Save & Load' },
            { id: 'resetClear', name: 'Tutorial: Reset & Clear' },
        ];

        this.closeButton = this.panelElement.querySelector('.close-panel-button'); // <-- ADD THIS LINE
        this._setupEventListeners();
        this.refreshTourList();
    }

    _setupEventListeners() {
        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.hide());
        }
        this.panelElement.addEventListener('click', (e) => {
            if (e.target.matches('.tour-start-button')) {
                const tourName = e.target.dataset.tourName;
                this.hide();
                if (window.OnboardingManager) {
                    window.OnboardingManager.startTour(tourName, true);
                }
            }
        });

        // Refresh list when a tour ends to update checkmarks
        EventBus.subscribe(EVENTS.TOUR_ENDED, () => {
            if (!this.isHidden()) {
                this.refreshTourList();
            }
        });
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
    
    show() {
        super.show();
        this.refreshTourList();
    }

    toggle() {
        return super.toggle();
    }

} 