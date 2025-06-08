import * as PersistenceService from '../services/PersistenceService.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

let tourSteps = [];
let currentStepIndex = -1;
let highlightedElement = null;
let highlightedElementParentPanel = null;
let tourIsActive = false;

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
        bottom: { top: targetRect.bottom + margin, left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2), fits: function() { return this.top + tooltipRect.height < window.innerHeight; } },
        top: { top: targetRect.top - tooltipRect.height - margin, left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2), fits: function() { return this.top > 0; } },
        right: { top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2), left: targetRect.right + margin, fits: function() { return this.left + tooltipRect.width < window.innerWidth; } },
        left: { top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2), left: targetRect.left - tooltipRect.width - margin, fits: function() { return this.left > 0; } }
    };
    let bestPlacement = null;
    for (const pos of ['bottom', 'top', 'right', 'left']) {
        if (placements[pos].fits()) {
            bestPlacement = placements[pos];
            break;
        }
    }
    if (bestPlacement) {
        let { top, left } = bestPlacement;
        if (left < margin) left = margin;
        if (left + tooltipRect.width > window.innerWidth - margin) left = window.innerWidth - tooltipRect.width - margin;
        if (top < margin) top = margin;
        if (top + tooltipRect.height > window.innerHeight - margin) top = window.innerHeight - tooltipRect.height - margin;
        ui.tooltip.style.top = `${top}px`;
        ui.tooltip.style.left = `${left}px`;
    } else {
        ui.tooltip.style.top = '50%';
        ui.tooltip.style.left = '50%';
        ui.tooltip.style.transform = 'translate(-50%, -50%)';
    }
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
    const newPrimaryBtn = ui.primaryBtn.cloneNode(true);
    ui.primaryBtn.parentNode.replaceChild(newPrimaryBtn, ui.primaryBtn);
    ui.primaryBtn = newPrimaryBtn;
}

function showStep(stepIndex) {
    if (stepIndex < 0 || stepIndex >= tourSteps.length) {
        endTour();
        return;
    }
    cleanupCurrentStep();
    currentStepIndex = stepIndex;
    const step = tourSteps[stepIndex];
    if (step.onBeforeShow && typeof step.onBeforeShow === 'function') {
        step.onBeforeShow();
    }
    setTimeout(() => {
        const targetElement = document.querySelector(step.element);
        if (!targetElement) {
            console.warn(`Onboarding element not found: ${step.element}`);
            showStep(stepIndex + 1);
            return;
        }
        const parentPanel = targetElement.closest('.popout-panel, .draggable-panel-base');
        if (parentPanel) {
            parentPanel.style.zIndex = '2001';
            highlightedElementParentPanel = parentPanel;
        }
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        
        highlightedElement = targetElement;
        if (targetElement !== document.body) {
            highlightedElement.classList.add('onboarding-highlight');
            if (['rulesetDisplay', 'rulesetDisplayContainer', 'statsDisplayContainer'].includes(targetElement.dataset.tourId)) { // Use dataset for check
                 highlightedElement.classList.add('onboarding-highlight-no-filter');
            }
        }

        ui.overlay.classList.remove('hidden');
        ui.tooltip.classList.remove('hidden');
        
        ui.title.innerHTML = step.title || '';
        ui.content.innerHTML = step.content;
        const progress = ((currentStepIndex + 1) / tourSteps.length) * 100;
        ui.progressBar.style.width = `${progress}%`;

        const copyButton = document.getElementById('onboarding-copy-ruleset');
        if (copyButton && step.onboardingCopyText) { // Check for the new property
            copyButton.addEventListener('click', () => {
                navigator.clipboard.writeText(step.onboardingCopyText).then(() => { // Use the property
                    copyButton.textContent = "Copied!";
                    copyButton.disabled = true;
                    setTimeout(() => {
                        copyButton.textContent = "Copy Ruleset";
                        copyButton.disabled = false;
                    }, 2000);
                }).catch(err => {
                    console.error("Onboarding copy failed:", err);
                    copyButton.textContent = "Copy Failed";
                });
            });
        }
        if (step.primaryAction && step.primaryAction.text) {
            ui.primaryBtn.textContent = step.primaryAction.text;
            ui.primaryBtn.style.display = 'inline-block';
        } else {
            ui.primaryBtn.style.display = 'none';
        }
        positionTooltip(targetElement);
        if (step.advanceOn.type === 'click' && step.advanceOn.target === 'element') {
            ui.overlay.classList.remove('interactive');
        } else {
            ui.overlay.classList.add('interactive');
        }
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

function defineTour(steps) {
    tourSteps = steps;
}

function startTour() {
    if (PersistenceService.loadUISetting('onboarding_complete', false)) {
        return;
    }
    tourIsActive = true;
    showStep(0);
}

function endTour() {
    cleanupCurrentStep();
    PersistenceService.saveUISetting('onboarding_complete', true);
    tourIsActive = false;
}

ui.secondaryBtn.addEventListener('click', endTour);

export const OnboardingManager = {
    defineTour,
    startTour,
    endTour,
    isActive: () => tourIsActive,
};