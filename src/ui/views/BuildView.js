import { BaseComponent } from '../components/BaseComponent.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';
import * as PersistenceService from '../../services/PersistenceService.js';

/**
 * Full-screen mobile "Build" view. Consolidates the former Rules / Editor / Worlds
 * tabs behind a single segmented control (mobile redesign M1). Each segment mounts
 * one of the shared singleton components (RulesetActionsComponent /
 * RulesetEditorComponent / WorldSetupComponent) into the shared content container,
 * reusing UIManager's placement helper so context classes + refresh() stay identical
 * to the old per-view mounting. The last-selected segment persists as a UI setting.
 */
export class BuildView extends BaseComponent {
    /**
     * @param {HTMLElement} mountPoint
     * @param {object} appContext
     * @param {Array<{id: string, label: string, componentType: Function}>} segments
     */
    constructor(mountPoint, appContext, segments) {
        super(mountPoint);
        this.appContext = appContext;
        this.segments = segments;
        this.element = null;
        this.contentContainer = null;
        this.activeSegment = PersistenceService.loadUISetting('buildActiveSegment', segments[0].id);
        if (!segments.some(s => s.id === this.activeSegment)) {
            this.activeSegment = segments[0].id;
        }
        this._mountedSegment = null;
        this.render();
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'build-mobile-view';
        this.element.className = 'mobile-view hidden';
        this.element.innerHTML = `
            <div class="mobile-view-header build-view-header">
                <div class="build-segmented" role="tablist" aria-label="Build section">
                    ${this.segments.map(s => `
                        <button type="button" class="build-segment${s.id === this.activeSegment ? ' active' : ''}"
                            role="tab" data-segment="${s.id}"
                            aria-selected="${s.id === this.activeSegment ? 'true' : 'false'}">${s.label}</button>
                    `).join('')}
                </div>
                <button class="mobile-view-close-button" data-action="close" aria-label="Close">&times;</button>
            </div>
            <div class="mobile-view-content build-view-content"></div>
        `;
        this.mountPoint.appendChild(this.element);
        this.contentContainer = this.element.querySelector('.build-view-content');
        this.attachEventListeners();
    }

    attachEventListeners() {
        this.element.querySelectorAll('.build-segment').forEach(button => {
            this._addDOMListener(button, 'click', () => this.setSegment(button.dataset.segment));
        });
        this._addDOMListener(this.element.querySelector('[data-action="close"]'), 'click', () => {
            EventBus.dispatch(EVENTS.COMMAND_SHOW_MOBILE_VIEW, { targetView: 'watch' });
        });
    }

    /**
     * Switch the active segment. Persists the choice and re-mounts if the view is
     * currently visible (so a deep-link into a segment lands on the right component).
     */
    setSegment(id) {
        if (!this.segments.some(s => s.id === id)) return;
        this.activeSegment = id;
        PersistenceService.saveUISetting('buildActiveSegment', id);
        this.element.querySelectorAll('.build-segment').forEach(button => {
            const isActive = button.dataset.segment === id;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        if (!this.element.classList.contains('hidden')) {
            this._mountActiveSegment(true);
        } else {
            this._mountedSegment = null; // force remount on next show
        }
    }

    _mountActiveSegment(force = false) {
        if (!force && this._mountedSegment === this.activeSegment) return;
        const segment = this.segments.find(s => s.id === this.activeSegment);
        if (!segment) return;
        this.appContext.uiManager.mountSharedComponentInto(segment.componentType, this.contentContainer);
        this._mountedSegment = this.activeSegment;
    }

    show() {
        this.element.classList.remove('hidden');
        this._mountActiveSegment();
    }

    hide() {
        this.element.classList.add('hidden');
    }
}
