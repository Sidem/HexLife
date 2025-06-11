import * as PersistenceService from '../services/PersistenceService.js';
import { EventBus } from '../services/EventBus.js';

let allTours = {};
let activeTourSteps = [];
let currentStepIndex = -1;
let currentTourName = null;
let tourIsActive = false;
let highlightedElement = null; 
let highlightedElementParentPanel = null; 


const ui = {
    overlay: document.getElementById('onboarding-overlay'),
    tooltip: document.getElementById('onboarding-tooltip'),
    title: document.getElementById('onboarding-tooltip-title'),
    content: document.getElementById('onboarding-tooltip-content'),
    primaryBtn: document.getElementById('onboarding-action-primary'),
    secondaryBtn: document.getElementById('onboarding-action-secondary'),
    progressContainer: document.getElementById('onboarding-progress-container'),
    progressBar: document.getElementById('onboarding-progress-bar'),
};

function positionTooltip(targetElement) {
    if (!targetElement || targetElement === document.body) {
        ui.tooltip.style.top = '50%';
        ui.tooltip.style.left = '50%';
        ui.tooltip.style.transform = 'translate(-50%, -50%)';
        return;
    }
    ui.tooltip.style.transform = 'none';
    const targetRect = targetElement.getBoundingClientRect();
    const tooltipRect = ui.tooltip.getBoundingClientRect();
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

    ui.tooltip.style.top = `${tooltipTop}px`;
    ui.tooltip.style.left = `${tooltipLeft}px`;
}

function cleanupCurrentStep() {
    if (highlightedElement) {
        highlightedElement.classList.remove('onboarding-highlight', 'onboarding-highlight-no-filter');
        highlightedElement = null;
    }
    if (highlightedElementParentPanel) {
        highlightedElementParentPanel.style.zIndex = '';
        highlightedElementParentPanel = null;
    }
    ui.overlay.classList.add('hidden');
    ui.tooltip.classList.add('hidden');
    
    //console.log('[DEBUG-Onboarding] cleanupCurrentStep: About to replace primary button.');
    const newPrimaryBtn = ui.primaryBtn.cloneNode(true);
    ui.primaryBtn.parentNode.replaceChild(newPrimaryBtn, ui.primaryBtn);
    ui.primaryBtn = newPrimaryBtn;
    //console.log('[DEBUG-Onboarding] cleanupCurrentStep: Primary button has been replaced.');

    currentTourName = null;
}

function showStep(stepIndex) {
    cleanupCurrentStep();
    if (stepIndex < 0 || stepIndex >= activeTourSteps.length) {
        endTour();
        return;
    }

    currentStepIndex = stepIndex;
    const step = activeTourSteps[stepIndex];

    if (step.onBeforeShow && typeof step.onBeforeShow === 'function') {
        step.onBeforeShow();
    }

    setTimeout(() => {
        const targetElement = document.querySelector(step.element);
        if (!targetElement) {
            console.warn(`Onboarding element not found: ${step.element}. Skipping step.`);
            showStep(stepIndex + 1);
            return;
        }

        if (highlightedElement) {
            highlightedElement.classList.remove('onboarding-highlight', 'onboarding-highlight-no-filter');
        }
        if (highlightedElementParentPanel) {
            highlightedElementParentPanel.style.zIndex = '';
        }

        const parentPanel = targetElement.closest('.popout-panel, .draggable-panel-base');
        if (parentPanel) {
            parentPanel.style.zIndex = '2001';
            highlightedElementParentPanel = parentPanel;
        }

        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        highlightedElement = targetElement;

        if (targetElement !== document.body) {
            highlightedElement.classList.add('onboarding-highlight');
            if (['rulesetDisplayContainer', 'statsDisplayContainer'].includes(targetElement.dataset.tourId)) {
                highlightedElement.classList.add('onboarding-highlight-no-filter');
            }
        }

        ui.overlay.classList.remove('hidden');
        ui.tooltip.classList.remove('hidden');

        ui.title.innerHTML = step.title || '';
        ui.content.innerHTML = step.content;
        const progress = ((currentStepIndex + 1) / activeTourSteps.length) * 100;
        ui.progressBar.style.width = `${progress}%`;

        if (step.primaryAction && step.primaryAction.text) {
            ui.primaryBtn.textContent = step.primaryAction.text;
            ui.primaryBtn.style.display = 'inline-block';
        } else {
            ui.primaryBtn.style.display = 'none';
        }

        positionTooltip(targetElement);

        if (step.advanceOn.type === 'click') {
            const actionTarget = step.advanceOn.target === 'element' ? highlightedElement : ui.primaryBtn;
            actionTarget.addEventListener('click', () => showStep(currentStepIndex + 1), { once: true });
        } else if (step.advanceOn.type === 'event') {
            const unsubscribe = EventBus.subscribe(step.advanceOn.eventName, () => {
                unsubscribe();
                setTimeout(() => showStep(currentStepIndex + 1), 500);
            });
        }
    }, 100);
}

function defineTours(tourCollection) {
    allTours = tourCollection;
}

function startTour(tourName, force = false) {
    if (tourIsActive || !allTours[tourName]) return;
    if (!force && PersistenceService.loadUISetting(`onboarding_complete_${tourName}`, false)) return;

    currentTourName = tourName;
    activeTourSteps = allTours[tourName];
    tourIsActive = true;
    showStep(0);
}

function endTour() {
    if (!tourIsActive) return;
    if (currentTourName) {
        PersistenceService.saveUISetting(`onboarding_complete_${currentTourName}`, true);
    }
    cleanupCurrentStep();
    tourIsActive = false;
}

ui.secondaryBtn.addEventListener('click', endTour);

export const OnboardingManager = {
    defineTours,
    startTour,
    endTour,
    isActive: () => tourIsActive,
};