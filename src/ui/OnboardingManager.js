import * as PersistenceService from '../services/PersistenceService.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

let tourSteps = [];
let currentStepIndex = -1;
let highlightedElement = null;
let highlightedElementParentPanel = null; // Track parent panel for z-index management
let tourIsActive = false;

const ui = {
    overlay: document.getElementById('onboarding-overlay'),
    tooltip: document.getElementById('onboarding-tooltip'),
    content: document.getElementById('onboarding-tooltip-content'),
    primaryBtn: document.getElementById('onboarding-action-primary'),
    secondaryBtn: document.getElementById('onboarding-action-secondary'),
};

/**
 * [FIXED] Positions the tooltip intelligently to ensure it stays within the viewport.
 */
function positionTooltip(targetElement) {
    // Fallback for steps that don't highlight a specific element (e.g., final message)
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

    // Define potential placements and a test to see if they fit
    const placements = {
        bottom: {
            top: targetRect.bottom + margin,
            left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2),
            fits: function() { return this.top + tooltipRect.height < window.innerHeight; }
        },
        top: {
            top: targetRect.top - tooltipRect.height - margin,
            left: targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2),
            fits: function() { return this.top > 0; }
        },
        right: {
            top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2),
            left: targetRect.right + margin,
            fits: function() { return this.left + tooltipRect.width < window.innerWidth; }
        },
        left: {
            top: targetRect.top + (targetRect.height / 2) - (tooltipRect.height / 2),
            left: targetRect.left - tooltipRect.width - margin,
            fits: function() { return this.left > 0; }
        }
    };

    // Find the first placement that fits, in preferred order
    let bestPlacement = null;
    for (const pos of ['bottom', 'top', 'right', 'left']) {
        if (placements[pos].fits()) {
            bestPlacement = placements[pos];
            break;
        }
    }

    if (bestPlacement) {
        let { top, left } = bestPlacement;

        // Final boundary checks to prevent minor overflows
        if (left < margin) left = margin;
        if (left + tooltipRect.width > window.innerWidth - margin) {
            left = window.innerWidth - tooltipRect.width - margin;
        }
        if (top < margin) top = margin;
        if (top + tooltipRect.height > window.innerHeight - margin) {
            top = window.innerHeight - tooltipRect.height - margin;
        }

        ui.tooltip.style.top = `${top}px`;
        ui.tooltip.style.left = `${left}px`;
    } else {
        // Ultimate fallback: center of the screen
        ui.tooltip.style.top = '50%';
        ui.tooltip.style.left = '50%';
        ui.tooltip.style.transform = 'translate(-50%, -50%)';
    }
}


function cleanupCurrentStep() {
    if (highlightedElement) {
        highlightedElement.classList.remove('onboarding-highlight');
        highlightedElement = null;
    }
    // Reset z-index of parent panel if it was modified
    if (highlightedElementParentPanel) {
        highlightedElementParentPanel.style.zIndex = ''; // Reset z-index to its default
        highlightedElementParentPanel = null;
    }
    ui.overlay.classList.add('hidden');
    ui.tooltip.classList.add('hidden');
    // Important: remove old listeners to prevent memory leaks
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

    // Execute any pre-step actions, like opening a panel
    if (step.onBeforeShow && typeof step.onBeforeShow === 'function') {
        step.onBeforeShow();
    }

    const targetElement = document.querySelector(step.element);
    if (!targetElement) {
        console.warn(`Onboarding element not found: ${step.element}`);
        showStep(stepIndex + 1); // Skip to next step
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
    }
    
    ui.overlay.classList.remove('hidden');
    ui.tooltip.classList.remove('hidden');

    ui.content.innerHTML = step.content;

    const copyButton = document.getElementById('onboarding-copy-ruleset');
    if (copyButton) {
        copyButton.addEventListener('click', () => {
            const rulesetToCopy = "12482080480080006880800180010117"; // The glider ruleset
            navigator.clipboard.writeText(rulesetToCopy).then(() => {
                copyButton.textContent = "Copied!";
                copyButton.disabled = true; // Prevent multiple clicks
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

    ui.primaryBtn.textContent = step.primaryAction.text;

    positionTooltip(targetElement);

    // Block background clicks unless the step is just pointing something out
    if (step.advanceOn.type === 'click' && step.advanceOn.target === 'element') {
        ui.overlay.classList.remove('interactive');
    } else {
        ui.overlay.classList.add('interactive');
    }

    // Set up the trigger for the next step
    if (step.advanceOn.type === 'click') {
        const actionTarget = step.advanceOn.target === 'element' ? highlightedElement : ui.primaryBtn;
        actionTarget.addEventListener('click', () => showStep(currentStepIndex + 1), { once: true });
    } else if (step.advanceOn.type === 'event') {
        const unsubscribe = EventBus.subscribe(step.advanceOn.eventName, () => {
            unsubscribe(); // Clean up listener
            setTimeout(() => showStep(currentStepIndex + 1), 500); // Small delay for effect
        });
    }
}

function defineTour(steps) {
    tourSteps = steps;
}

function startTour() {
    // Don't start if already completed
    if (PersistenceService.loadUISetting('onboarding_complete', false)) {
        return;
    }
    tourIsActive = true; // Set state
    showStep(0);
}

function endTour() {
    cleanupCurrentStep();
    PersistenceService.saveUISetting('onboarding_complete', true);
    tourIsActive = false; // Reset state
}

// Attach listeners for secondary actions
ui.secondaryBtn.addEventListener('click', endTour);

export const OnboardingManager = {
    defineTour,
    startTour,
    endTour,
    isActive: () => tourIsActive, // Expose getter
};