import { rulesetVisualizer } from '../utils/rulesetVisualizer.js';
import { formatHexCode } from '../utils/utils.js';

/**
 * Short, human-friendly label for a paired initial condition, shown as the "IC" badge on a library
 * card. Falls back to the raw mode name for forward-compat IC types this build doesn't label yet.
 * @param {{mode: string, params?: object}} initialState
 * @returns {string}
 */
export function icBadgeLabel(initialState) {
    const mode = initialState?.mode;
    if (mode === 'clusters') return 'IC · clumps';
    if (mode === 'density') {
        const d = initialState?.params?.density;
        if (Number.isFinite(d)) return `IC · ${Math.round(d * 100)}% fill`;
        return 'IC · random fill';
    }
    return mode ? `IC · ${mode}` : 'IC';
}

export class RulesetDisplayFactory {
    constructor(appContext) {
        this.appContext = appContext;
        this.observer = null;
        this.observedElements = new WeakMap();
        this._initObserver();
    }

    _initObserver() {
        const options = {
            root: null, 
            rootMargin: '100px', 
            threshold: 0.01
        };

        this.observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    const vizPlaceholder = element.querySelector('.viz-placeholder');
                    if (vizPlaceholder) {
                        const { hex } = this.observedElements.get(element);
                        const colorSettings = this.appContext.colorController.getSettings();
                        const symmetryData = this.appContext.worldManager.getSymmetryData();
                        const svg = rulesetVisualizer.createRulesetSVG(hex, { width: '100%', height: '100%' }, colorSettings, symmetryData);
                        svg.classList.add('ruleset-viz-svg');
                        vizPlaceholder.replaceWith(svg);
                        observer.unobserve(element); 
                        this.observedElements.delete(element);
                    }
                }
            });
        }, options);
    }

    /**
     * Creates a card for the Ruleset Library (Public or Personal). The hero is the evolved-world
     * thumbnail when the entry has one (schema v2); otherwise it falls back to the lazily-rendered
     * rule-viz glyph (the IntersectionObserver path). When the entry carries a paired initial
     * condition it shows an "IC" badge and a "Load + IC" action that replays ruleset + IC + seed.
     * @param {object} ruleData - The full ruleset object (may include `tags`, `initialState`, `thumb`).
     * @param {boolean} isPersonal - True if it's from the user's library.
     * @returns {HTMLElement} The created card element.
     */
    createLibraryListItem(ruleData, isPersonal = false) {
        const item = document.createElement('div');
        item.className = 'library-card' + (isPersonal ? ' personal' : '');
        item.dataset.hex = ruleData.hex;
        if (ruleData.id) item.dataset.id = ruleData.id;

        const hasIC = !!(ruleData.initialState && ruleData.initialState.mode);
        const tags = Array.isArray(ruleData.tags) ? ruleData.tags : [];

        const hero = ruleData.thumb
            ? `<img class="library-card-thumb-img" src="${this._escapeAttr(ruleData.thumb)}" alt="" loading="lazy" />`
            : `<div class="viz-placeholder"></div>`;
        const icBadge = hasIC
            ? `<span class="library-card-ic-badge" title="Paired initial condition">${this._escape(icBadgeLabel(ruleData.initialState))}</span>`
            : '';
        const tagChips = tags.length
            ? `<div class="library-card-tags">${tags.map(t => `<span class="tag-chip">${this._escape(t)}</span>`).join('')}</div>`
            : '';

        const actions = [`<button class="button" data-action="${isPersonal ? 'load-personal' : 'load-rule'}">Load</button>`];
        if (hasIC) actions.push(`<button class="button button-subtle" data-action="load-with-ic" title="Load this ruleset with its paired initial state">Load + IC</button>`);
        if (isPersonal) {
            actions.push(`<button class="button button-subtle" data-action="share-reddit" title="Copy a post kit (name, description, tags, world code) and open r/hexlife">Share on Reddit</button>`);
            actions.push(`<button class="button-icon" data-action="manage-personal" title="More options">${'⋯'}</button>`);
        }

        const descText = (ruleData.description || '').trim();
        const descHtml = descText
            ? this._escape(descText)
            : (isPersonal
                ? 'No description — <span class="description-hint">Edit</span> to add one'
                : 'No description.');

        item.innerHTML = `
            <div class="library-card-thumb">${hero}${icBadge}</div>
            <div class="library-card-body">
                <div class="library-card-title">
                    <span class="name">${this._escape(ruleData.name || '')}</span>
                </div>
                <div class="description${descText ? '' : ' is-empty'}">${descHtml}</div>
                ${tagChips}
            </div>
            <div class="library-card-actions">${actions.join('')}</div>
        `;

        // Only the glyph fallback needs the lazy rule-viz render; a real thumbnail is already drawn.
        if (!ruleData.thumb) {
            this.observedElements.set(item, { hex: ruleData.hex });
            this.observer.observe(item);
        }
        return item;
    }

    _escape(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    _escapeAttr(str) {
        return String(str).replace(/"/g, '&quot;');
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
        const { name, isDerived } = this.appContext.libraryController.getDisplayName(hex);
        item.innerHTML = `
            <div class="viz-placeholder"></div>
            <div class="history-item-label">
                <div class="history-item-name${isDerived ? ' is-derived' : ''}">${name}</div>
                <div class="history-item-hex">${formatHexCode(hex)}</div>
            </div>
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