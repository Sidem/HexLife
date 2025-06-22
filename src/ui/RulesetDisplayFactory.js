import { rulesetVisualizer } from '../utils/rulesetVisualizer.js';
import { formatHexCode } from '../utils/utils.js';

export class RulesetDisplayFactory {
    constructor() {
        this.observer = null;
        this.observedElements = new WeakMap();
        this._initObserver();
    }

    _initObserver() {
        const options = {
            root: null, // observes intersections relative to the viewport
            rootMargin: '100px', // start loading when item is 100px away from viewport
            threshold: 0.01
        };

        this.observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    const vizPlaceholder = element.querySelector('.viz-placeholder');
                    if (vizPlaceholder) {
                        const { hex } = this.observedElements.get(element);
                        const svg = rulesetVisualizer.createRulesetSVG(hex, { width: '100%', height: '100%' });
                        svg.classList.add('ruleset-viz-svg');
                        vizPlaceholder.replaceWith(svg);
                        observer.unobserve(element); // Stop observing once loaded
                        this.observedElements.delete(element);
                    }
                }
            });
        }, options);
    }

    /**
     * Creates a list item for the Ruleset Library (Public or Personal).
     * @param {object} ruleData - The full ruleset object.
     * @param {boolean} isPersonal - True if it's from the user's library.
     * @returns {HTMLElement} The created list item element.
     */
    createLibraryListItem(ruleData, isPersonal = false) {
        const item = document.createElement('div');
        item.className = 'library-item' + (isPersonal ? ' personal' : '');

        item.innerHTML = `
            <div class="viz-placeholder"></div>
            <div class="library-item-info">
                <div class="name">${ruleData.name}</div>
                <div class="description">${ruleData.description || 'No description.'}</div>
            </div>
            <div class="library-item-actions" data-id="${ruleData.id || ''}" data-hex="${ruleData.hex}">
            </div>
        `;

        const actionsContainer = item.querySelector('.library-item-actions');
        if (isPersonal) {
            actionsContainer.innerHTML = `
                <button class="button" data-action="load-personal">Load</button>
                <button class="button-icon" data-action="manage-personal" title="More options">...</button>
            `;
        } else {
            actionsContainer.innerHTML = `<button class="button" data-action="load-rule">Load</button>`;
        }

        this.observedElements.set(item, { hex: ruleData.hex });
        this.observer.observe(item);
        return item;
    }

    /**
     * Creates a list item for the Ruleset History popout.
     * @param {string} hex - The ruleset hex string.
     * @param {boolean} isCurrent - If this is the current active ruleset in the history.
     * @returns {HTMLElement} The created list item element.
     */
    createHistoryListItem(hex, isCurrent = false) {
        const item = document.createElement('div');
        item.className = 'history-item' + (isCurrent ? ' is-current' : '');
        item.innerHTML = `
            <div class="viz-placeholder"></div>
            <div class="history-item-hex">${formatHexCode(hex)}</div>
        `;
        if (isCurrent) {
            item.innerHTML += `<span class="tag">Current</span>`;
        }
        
        this.observedElements.set(item, { hex });
        this.observer.observe(item);
        return item;
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }
} 