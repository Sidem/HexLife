import { loadOnboardingStates, saveOnboardingStates } from '../services/PersistenceService.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

export class OnboardingManager {
    constructor(uiElements, appContext) {
        this.tourIsActive = false;
        this.currentTourName = null;
        this.activeTourSteps = [];
        this.currentStepIndex = -1;
        this.currentStepUnsubscribe = null;
        this.highlightedElement = null;
        this.highlightedElementParentPanel = null;
        this.allTours = new Map();
        this.appContext = appContext;
    
        this.ui = {
            overlay: uiElements.overlay,
            tooltip: uiElements.tooltip,
            title: uiElements.title,
            content: uiElements.content,
            primaryBtn: uiElements.primaryBtn,
            secondaryBtn: uiElements.secondaryBtn,
            progressBar: uiElements.progressBar,
        };
    
        if (Object.values(this.ui).some(el => !el) || !this.appContext) {
            console.error("OnboardingManager: One or more required UI elements or the AppContext were not provided.");
            return;
        }
    
        this._setupEventListeners();
    }

    _setupEventListeners() {
        
        this.ui.secondaryBtn.addEventListener('click', () => this.endTour());
    }

    /**
     * Registers a collection of tours.
     * @param {object} tourCollection - An object where keys are tour names and values are tour step arrays.
     */
    defineTours(tourCollection) {
        for (const [name, steps] of Object.entries(tourCollection)) {
            if (this.allTours.has(name)) {
                console.warn(`Onboarding tour "${name}" is being overwritten.`);
            }
            this.allTours.set(name, steps);
        }
    }

    /**
     * Starts a registered tour by name.
     * @param {string} tourName - The name of the tour to start.
     * @param {boolean} [force=false] - If true, the tour will start even if it was previously completed.
     */
    startTour(tourName, force = false) {
        if (this.tourIsActive || !this.allTours.has(tourName)) {
            return;
        }

        const onboardingStates = loadOnboardingStates();
        if (!force && onboardingStates[tourName]) {
            return; 
        }

        this.currentTourName = tourName;
        this.activeTourSteps = this.allTours.get(tourName);
        this.tourIsActive = true;
        this._showStep(0);
    }

    /**
     * Ends the currently active tour and persists its completion status.
     */
    endTour() {
        if (!this.tourIsActive) return;

        if (this.currentTourName) {
            const onboardingStates = loadOnboardingStates();
            onboardingStates[this.currentTourName] = true;
            saveOnboardingStates(onboardingStates);
        }

        this._cleanupCurrentStep();
        this.tourIsActive = false;
        
        // Dispatch tour ended event for the Learning Hub to refresh
        EventBus.dispatch(EVENTS.TOUR_ENDED, { tourName: this.currentTourName });
        
        this.currentTourName = null;
    }

    /**
     * Checks if a tour is currently active.
     * @returns {boolean}
     */
    isActive() {
        return this.tourIsActive;
    }

    

    _showStep(stepIndex) {
        this._cleanupCurrentStep();
        if (stepIndex < 0 || stepIndex >= this.activeTourSteps.length) {
            this.endTour();
            return;
        }
    
        this.currentStepIndex = stepIndex;
        const step = this.activeTourSteps[stepIndex];
        if (step.condition && typeof step.condition === 'function') {
            if (!step.condition(this.appContext)) {
                this._showStep(stepIndex + 1);
                return;
            }
        }
    
        if (step.onBeforeShow && typeof step.onBeforeShow === 'function') {
            step.onBeforeShow();
        }
    
        setTimeout(() => {
            const targetElement = document.querySelector(step.element);
            if (!targetElement) {
                console.warn(`Onboarding element not found: ${step.element}. Skipping step.`);
                this._showStep(stepIndex + 1);
                return;
            }
    
            this._highlightElement(targetElement);
    
            this.ui.overlay.classList.remove('hidden');
            this.ui.tooltip.classList.remove('hidden');
    
            this.ui.title.innerHTML = step.title || '';
            this.ui.content.innerHTML = step.content || '';
            
            const progress = ((this.currentStepIndex + 1) / this.activeTourSteps.length) * 100;
            this.ui.progressBar.style.width = `${progress}%`;
    
            if (step.primaryAction && step.primaryAction.text) {
                this.ui.primaryBtn.textContent = step.primaryAction.text;
                this.ui.primaryBtn.style.display = 'inline-block';
            } else {
                this.ui.primaryBtn.style.display = 'none';
            }
    
            this._positionTooltip(targetElement);
            this._attachStepAdvanceListener(step, targetElement);
    
        }, 100);
    }

    _attachStepAdvanceListener(step, targetElement) {
        const advance = () => {
            if (step.delayAfter && typeof step.delayAfter === 'number') {
                this._cleanupCurrentStep();
                setTimeout(() => {
                    if (this.tourIsActive) {
                        this._showStep(this.currentStepIndex + 1);
                    }
                }, step.delayAfter);
            } else {
                setTimeout(() => {
                    if (this.tourIsActive) {
                        this._showStep(this.currentStepIndex + 1);
                    }
                }, 150);
            }
        };
    
        if (step.advanceOn.type === 'click') {
            const actionTarget = step.advanceOn.target === 'element' ? targetElement : this.ui.primaryBtn;
            const clickListener = () => {
                this.currentStepUnsubscribe = null;
                advance();
            };
            actionTarget.addEventListener('click', clickListener, { once: true });
            this.currentStepUnsubscribe = () => {
                actionTarget.removeEventListener('click', clickListener);
            };
    
        } else if (step.advanceOn.type === 'event') {
            const unsubscribe = EventBus.subscribe(step.advanceOn.eventName, (data) => {
                console.log('advanceOn event received', step.advanceOn.eventName);
                console.log('event data received', data);
                if (step.advanceOn.condition && !step.advanceOn.condition(data)) {
                    return;
                }
                this.currentStepUnsubscribe = null;
                unsubscribe();
                advance();
            });
            this.currentStepUnsubscribe = unsubscribe;
        }
    }
    
    _cleanupCurrentStep() {
        if (this.highlightedElement) {
            this.highlightedElement.classList.remove('onboarding-highlight', 'onboarding-highlight-canvas-area', 'onboarding-canvas-highlight');
            this.highlightedElement = null;
        }
        if (this.highlightedElementParentPanel) {
            this.highlightedElementParentPanel.style.zIndex = '';
            this.highlightedElementParentPanel = null;
        }

        if (this.currentStepUnsubscribe) {
            this.currentStepUnsubscribe();
            this.currentStepUnsubscribe = null;
        }
        
        this.ui.overlay.classList.add('hidden');
        this.ui.tooltip.classList.add('hidden');
    
        this.ui.overlay.style.backgroundColor = '';
        this.ui.overlay.style.backdropFilter = '';
    
        const newPrimaryBtn = this.ui.primaryBtn.cloneNode(true);
        this.ui.primaryBtn.parentNode.replaceChild(newPrimaryBtn, this.ui.primaryBtn);
        this.ui.primaryBtn = newPrimaryBtn;
    }

    _highlightElement(targetElement) {
        const step = this.activeTourSteps[this.currentStepIndex];
        const highlightType = step.highlightType || 'default';
    
        const parentPanel = targetElement.closest('.popout-panel, .draggable-panel-base');
        if (parentPanel) {
            parentPanel.style.zIndex = '2001';
            this.highlightedElementParentPanel = parentPanel;
        }
    
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        this.highlightedElement = targetElement;
    
        if (targetElement !== document.body) {
            if (highlightType === 'canvas') {
                this.highlightedElement.classList.add('onboarding-canvas-highlight');
                this.ui.overlay.style.backgroundColor = 'transparent';
                this.ui.overlay.style.backdropFilter = 'none';
            } else {
                this.highlightedElement.classList.add('onboarding-highlight');
            }
        }
    }

    _positionTooltip(targetElement) {
        if (!targetElement || targetElement === document.body) {
            this.ui.tooltip.style.top = '50%';
            this.ui.tooltip.style.left = '50%';
            this.ui.tooltip.style.transform = 'translate(-50%, -50%)';
            return;
        }
        this.ui.tooltip.style.transform = 'none';
        const targetRect = targetElement.getBoundingClientRect();
        const tooltipRect = this.ui.tooltip.getBoundingClientRect();
        const margin = 15;
        const placements = {
            bottom: { top: targetRect.bottom + margin, left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2), fits: function () { return this.top + tooltipRect.height < window.innerHeight; } },
            top: { top: targetRect.top - tooltipRect.height - margin, left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2), fits: function () { return this.top > 0; } },
            right: { top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2), left: targetRect.right + margin, fits: function () { return this.left + tooltipRect.width < window.innerWidth; } },
            left: { top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2), left: targetRect.left - tooltipRect.width - margin, fits: function () { return this.left > 0; } }
        };

        let bestPlacement = Object.values(placements).find(p => p.fits()) || placements.bottom;
        let { top: tooltipTop, left: tooltipLeft } = bestPlacement;
        if (tooltipLeft < margin) tooltipLeft = margin;
        if (tooltipLeft + tooltipRect.width > window.innerWidth - margin) tooltipLeft = window.innerWidth - tooltipRect.width - margin;
        if (tooltipTop < margin) tooltipTop = margin;
        if (tooltipTop + tooltipRect.height > window.innerHeight - margin) tooltipTop = window.innerHeight - tooltipRect.height - margin;
        
        this.ui.tooltip.style.top = `${tooltipTop}px`;
        this.ui.tooltip.style.left = `${tooltipLeft}px`;
    }
}