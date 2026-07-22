import { loadOnboardingStates, saveOnboardingStates } from '../services/PersistenceService.js';
import { EventBus, EVENTS } from '../services/EventBus.js';

/**
 * Drives the interactive product tours ("guided experiments / tutorials").
 *
 * Design contract (rewritten 2026-06-26):
 *  - A step is only shown once its target is *actually visible* — never a blind
 *    `querySelector` against a fixed timeout. `_waitForTarget` rAF-polls for
 *    existence + visibility (offsetParent, non-zero box, not display/visibility
 *    hidden) within a budget, so slow panel opens and animations are tolerated
 *    and an off-screen / not-yet-rendered element never gets a highlight ring.
 *  - The spotlight is a single, stacking-context-proof model: four dim panels
 *    frame a transparent hole over the target, with a glow ring on top. The dim
 *    panels swallow clicks (modal), while the hole leaves the real control
 *    interactive — no z-index escape hatch that breaks inside transformed /
 *    clipped ancestors. Centred ("body") steps dim the whole screen.
 *  - The hole + ring + tooltip track the target every frame (rAF follow loop),
 *    so smooth-scroll, layout shifts and resizes never desync the highlight.
 *  - Full Back / Next / counter navigation, Esc + arrow keys, and an error
 *    boundary that ends the tour cleanly instead of stranding a dim overlay.
 *  - Action-gated steps (`advanceOn.type === 'event'`, no Next button) may
 *    declare a `showMe` escape hatch — see `_scheduleShowMe`.
 */
export class OnboardingManager {
    constructor(uiElements, appContext) {
        this.tourIsActive = false;
        this.currentTourName = null;
        this.activeTourSteps = [];
        this.currentStepIndex = -1;
        this.currentStepUnsubscribe = null;
        this.appContext = appContext;

        // Per-show token: any async work (waitForTarget) checks identity against
        // this so a superseded step bails out instead of clobbering the new one.
        this._showToken = null;
        this._followRaf = null;
        this._anchorTarget = null;
        this._highlightedParentPanel = null;
        this._padding = 6;
        this._showMeTimer = null;
        this._showMeWatchdog = null;

        this.ui = {
            overlay: uiElements.overlay,
            tooltip: uiElements.tooltip,
            title: uiElements.title,
            content: uiElements.content,
            primaryBtn: uiElements.primaryBtn,
            secondaryBtn: uiElements.secondaryBtn,
            backBtn: uiElements.backBtn,
            showMeBtn: uiElements.showMeBtn,
            counter: uiElements.counter,
            progressBar: uiElements.progressBar,
        };

        // backBtn / counter / showMeBtn are additive — tolerate their absence rather
        // than hard-fail (keeps the manager usable if index.html lags the rewrite).
        const required = ['overlay', 'tooltip', 'title', 'content', 'primaryBtn', 'secondaryBtn', 'progressBar'];
        if (required.some(k => !this.ui[k]) || !this.appContext) {
            console.error('OnboardingManager: One or more required UI elements or the AppContext were not provided.');
            return;
        }

        this.allTours = new Map();
        this._buildSpotlight();
        this._setupEventListeners();
    }

    /** Creates the four dim panels + glow ring once, inside the overlay. */
    _buildSpotlight() {
        this.ui.overlay.innerHTML = '';
        this.dim = {};
        ['top', 'right', 'bottom', 'left'].forEach(side => {
            const el = document.createElement('div');
            el.className = `ob-dim ob-dim-${side}`;
            // Swallow clicks that land on the dimmed chrome — this is what makes
            // the tour modal. The hole (uncovered target) stays interactive.
            el.addEventListener('mousedown', e => e.stopPropagation());
            el.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); });
            this.ui.overlay.appendChild(el);
            this.dim[side] = el;
        });
        this.ring = document.createElement('div');
        this.ring.className = 'ob-ring';
        this.ui.overlay.appendChild(this.ring);
    }

    _setupEventListeners() {
        this._onSecondary = () => this.endTour();
        this.ui.secondaryBtn.addEventListener('click', this._onSecondary);

        if (this.ui.backBtn) {
            this._onBack = () => this._goToStep(this.currentStepIndex - 1, -1);
            this.ui.backBtn.addEventListener('click', this._onBack);
        }

        if (this.ui.showMeBtn) {
            this._onShowMe = () => this._runShowMe();
            this.ui.showMeBtn.addEventListener('click', this._onShowMe);
        }

        this._onKeyDown = (e) => {
            if (!this.tourIsActive) return;
            if (e.key === 'Escape') { e.preventDefault(); this.endTour(); }
            else if (e.key === 'ArrowLeft' && this.currentStepIndex > 0) { e.preventDefault(); this._goToStep(this.currentStepIndex - 1, -1); }
            else if (e.key === 'ArrowRight') {
                const step = this.activeTourSteps[this.currentStepIndex];
                if (step && step.primaryAction && step.primaryAction.text) { e.preventDefault(); this._advance(step); }
            }
        };
        document.addEventListener('keydown', this._onKeyDown);

        // Keep the spotlight glued to its target across scroll / resize even
        // outside the rAF loop (defensive — the loop usually covers it).
        this._onViewportChange = () => { if (this._anchorTarget) this._reposition(); };
        window.addEventListener('resize', this._onViewportChange);
        window.addEventListener('scroll', this._onViewportChange, true);
    }

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
     * @param {string} tourName
     * @param {boolean} [force=false] - start even if previously completed.
     */
    startTour(tourName, force = false) {
        if (this.tourIsActive || !this.allTours.has(tourName)) return;
        if (!force && loadOnboardingStates()[tourName]) return;

        this.currentTourName = tourName;
        this.activeTourSteps = this.allTours.get(tourName);
        this.tourIsActive = true;
        this._goToStep(0, 1);
    }

    /** Ends the active tour, marks it completed, and tears down the overlay. */
    endTour() {
        if (!this.tourIsActive) return;

        if (this.currentTourName) {
            const states = loadOnboardingStates();
            states[this.currentTourName] = true;
            saveOnboardingStates(states);
        }

        this._cleanupCurrentStep();
        this.tourIsActive = false;
        this.ui.overlay.classList.add('hidden');
        this.ui.tooltip.classList.add('hidden');

        EventBus.dispatch(EVENTS.ONBOARDING_TOUR_ENDED, { tourName: this.currentTourName });
        this.currentTourName = null;
    }

    isActive() {
        return this.tourIsActive;
    }

    // ---- Step lifecycle -----------------------------------------------------

    /**
     * Resolve, await-visibility, and render the step at `index`. `dir` (+1/-1)
     * is the travel direction, used so a condition-skipped step continues the
     * same way (forward skips forward, Back skips backward).
     */
    async _goToStep(index, dir = 1) {
        if (index < 0) { return; /* already at first step — Back is a no-op */ }
        this._cleanupCurrentStep();
        if (index >= this.activeTourSteps.length) { this.endTour(); return; }

        const token = {};
        this._showToken = token;
        this.currentStepIndex = index;
        const step = this.activeTourSteps[index];

        try {
            if (typeof step.condition === 'function' && !step.condition(this.appContext)) {
                this._goToStep(index + dir, dir);
                return;
            }

            if (typeof step.onBeforeShow === 'function') {
                step.onBeforeShow(step);
            }

            const selector = typeof step.element === 'function' ? step.element() : step.element;
            const isCentered = !selector || selector === 'body';

            let target = null;
            if (!isCentered) {
                target = await this._waitForTarget(() => (typeof step.element === 'function' ? step.element() : step.element));
                if (this._showToken !== token) return; // superseded mid-wait
                if (!target) {
                    console.warn(`Onboarding: target "${selector}" never became visible. Skipping "${step.title}".`);
                    this._goToStep(index + dir, dir);
                    return;
                }
            }

            this._renderStep(step, target);
        } catch (err) {
            console.error('Onboarding: step threw, ending tour to avoid a stranded overlay.', err);
            this.endTour();
        }
    }

    _renderStep(step, target) {
        this.ui.overlay.classList.remove('hidden');
        this.ui.tooltip.classList.remove('hidden');

        if (target && target !== document.body) {
            this._anchorTarget = target;
            const parentPanel = target.closest('.popout-panel, .draggable-panel-base');
            if (parentPanel) {
                parentPanel.style.zIndex = '2002';
                this._highlightedParentPanel = parentPanel;
            }
            const r = target.getBoundingClientRect();
            const fullyVisible = r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
            if (!fullyVisible) target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            this.ring.style.display = 'block';
        } else {
            this._anchorTarget = null;
            this.ring.style.display = 'none';
        }

        // Content
        this.ui.title.innerHTML = step.title || '';
        this.ui.content.innerHTML = typeof step.content === 'function' ? step.content() : (step.content || '');

        const total = this.activeTourSteps.length;
        const stepNo = this.currentStepIndex + 1;
        this.ui.progressBar.style.width = `${(stepNo / total) * 100}%`;
        if (this.ui.counter) this.ui.counter.textContent = `${stepNo} / ${total}`;
        if (this.ui.backBtn) this.ui.backBtn.style.visibility = this.currentStepIndex > 0 ? 'visible' : 'hidden';

        if (step.primaryAction && step.primaryAction.text) {
            this.ui.primaryBtn.textContent = step.primaryAction.text;
            this.ui.primaryBtn.style.display = 'inline-block';
        } else {
            this.ui.primaryBtn.style.display = 'none';
        }

        this._reposition();
        this._startFollow();
        this._attachStepAdvanceListener(step, target);
        this._scheduleShowMe(step);

        // a11y: surface the tooltip to assistive tech and give it focus.
        const focusEl = (step.primaryAction && step.primaryAction.text) ? this.ui.primaryBtn : this.ui.tooltip;
        try { focusEl.focus({ preventScroll: true }); } catch { /* noop */ }
    }

    /** rAF-poll until the selector resolves to a visible element, or budget runs out. */
    _waitForTarget(getSelector, timeout = 3000) {
        return new Promise(resolve => {
            const start = performance.now();
            const tick = () => {
                if (!this.tourIsActive) return resolve(null);
                let sel; try { sel = getSelector(); } catch { sel = null; }
                const el = sel ? document.querySelector(sel) : null;
                if (el && this._isVisible(el)) return resolve(el);
                if (performance.now() - start > timeout) return resolve(null);
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    _isVisible(el) {
        if (!el || !el.isConnected) return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
        if (el.offsetParent === null && cs.position !== 'fixed') return false;
        const r = el.getBoundingClientRect();
        return r.width >= 1 && r.height >= 1;
    }

    /** Recompute the four dim panels, the ring, and the tooltip from the target. */
    _reposition() {
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!this._anchorTarget) {
            // Centred / modal: one full-screen dim panel, the rest collapsed.
            this._setRect(this.dim.top, 0, 0, vw, vh);
            this._setRect(this.dim.bottom, 0, 0, 0, 0);
            this._setRect(this.dim.left, 0, 0, 0, 0);
            this._setRect(this.dim.right, 0, 0, 0, 0);
            this._centerTooltip();
            return;
        }

        const t = this._anchorTarget.getBoundingClientRect();
        const p = this._padding;
        const hx = Math.max(0, t.left - p), hy = Math.max(0, t.top - p);
        const hr = Math.min(vw, t.right + p), hb = Math.min(vh, t.bottom + p);
        const hw = hr - hx, hh = hb - hy;

        this._setRect(this.dim.top, 0, 0, vw, hy);
        this._setRect(this.dim.bottom, 0, hb, vw, Math.max(0, vh - hb));
        this._setRect(this.dim.left, 0, hy, hx, hh);
        this._setRect(this.dim.right, hr, hy, Math.max(0, vw - hr), hh);

        this.ring.style.left = `${hx}px`;
        this.ring.style.top = `${hy}px`;
        this.ring.style.width = `${hw}px`;
        this.ring.style.height = `${hh}px`;

        this._positionTooltip(t);
    }

    _setRect(el, x, y, w, h) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
    }

    _startFollow() {
        const loop = () => {
            if (!this.tourIsActive) return;
            this._reposition();
            this._followRaf = requestAnimationFrame(loop);
        };
        cancelAnimationFrame(this._followRaf);
        this._followRaf = requestAnimationFrame(loop);
    }

    _advance(step) {
        // Programmatic "Next" (primary button / ArrowRight). Mirrors the click path.
        this.currentStepUnsubscribe = null;
        this._doAdvance(step);
    }

    _doAdvance(step) {
        const delay = (step.delayAfter && typeof step.delayAfter === 'number') ? step.delayAfter : 150;
        this._cleanupCurrentStep();
        setTimeout(() => {
            if (this.tourIsActive) this._goToStep(this.currentStepIndex + 1, 1);
        }, delay);
    }

    _attachStepAdvanceListener(step, targetElement) {
        const advance = () => this._doAdvance(step);

        if (step.advanceOn.type === 'click') {
            const actionTarget = step.advanceOn.target === 'element'
                ? (targetElement || this.ui.primaryBtn)
                : this.ui.primaryBtn;
            const clickListener = () => { this.currentStepUnsubscribe = null; advance(); };
            actionTarget.addEventListener('click', clickListener, { once: true });
            this.currentStepUnsubscribe = () => actionTarget.removeEventListener('click', clickListener);

        } else if (step.advanceOn.type === 'event') {
            const unsubscribe = EventBus.subscribe(step.advanceOn.eventName, (data) => {
                if (step.advanceOn.condition && !step.advanceOn.condition(data)) return;
                this.currentStepUnsubscribe = null;
                unsubscribe();
                advance();
            });
            this.currentStepUnsubscribe = unsubscribe;
        }
    }

    // ---- "Show me" fallback -------------------------------------------------

    /**
     * Action-gated steps render no Next button on purpose — learn-by-doing only
     * advances when the user actually does the thing. The cost is that a user who
     * can't connect the prose to the control has exactly one visible way out, and
     * it's `Skip` (which abandons onboarding for good). So a gated step may
     * declare `showMe: { action, after?, watchdog? }`: after a grace period long
     * enough to try it themselves, a "Show me" button appears that performs the
     * real command. The gate then fires from the real event, exactly as if the
     * user had done it — the demonstration and the advance are the same code path.
     */
    _scheduleShowMe(step) {
        if (!this.ui.showMeBtn) return;
        this.ui.showMeBtn.classList.add('hidden');
        this.ui.showMeBtn.disabled = false;

        // Gated steps only. A step with its own Next needs no escape hatch, and a
        // second button there would just read as a duplicate.
        const isGated = !(step.primaryAction && step.primaryAction.text);
        if (!isGated || typeof step.showMe?.action !== 'function') return;

        this.ui.showMeBtn.textContent = step.showMe.text || 'Show me';
        this._showMeTimer = setTimeout(() => {
            if (this.tourIsActive) this.ui.showMeBtn.classList.remove('hidden');
        }, step.showMe.after ?? 7000);
    }

    _runShowMe() {
        const step = this.activeTourSteps[this.currentStepIndex];
        if (!this.tourIsActive || typeof step?.showMe?.action !== 'function') return;

        this.ui.showMeBtn.disabled = true;
        try {
            step.showMe.action(this.appContext);
        } catch (err) {
            console.warn('Onboarding: "Show me" action threw; advancing anyway.', err);
        }
        // The action is expected to fire this step's own `advanceOn` event. If it
        // doesn't (state already satisfied, event renamed, handler missing), the
        // button would be a dead end — the very trap this fix exists to remove —
        // so a watchdog moves the tour on regardless.
        // `_doAdvance`, not `_advance`: it cleans up first, so the step's EventBus
        // subscription is dropped instead of leaking into the next step.
        this._showMeWatchdog = setTimeout(() => {
            if (this.tourIsActive) this._doAdvance(step);
        }, step.showMe.watchdog ?? 900);
    }

    _cleanupCurrentStep() {
        clearTimeout(this._showMeTimer);
        clearTimeout(this._showMeWatchdog);
        this._showMeTimer = null;
        this._showMeWatchdog = null;
        if (this.ui.showMeBtn) this.ui.showMeBtn.classList.add('hidden');

        cancelAnimationFrame(this._followRaf);
        this._followRaf = null;
        this._anchorTarget = null;

        if (this._highlightedParentPanel) {
            this._highlightedParentPanel.style.zIndex = '';
            this._highlightedParentPanel = null;
        }
        if (this.ring) this.ring.style.display = 'none';

        if (this.currentStepUnsubscribe) {
            this.currentStepUnsubscribe();
            this.currentStepUnsubscribe = null;
        }
    }

    // ---- Tooltip placement --------------------------------------------------

    _centerTooltip() {
        this.ui.tooltip.style.transform = 'translate(-50%, -50%)';
        this.ui.tooltip.style.top = '50%';
        this.ui.tooltip.style.left = '50%';
    }

    _positionTooltip(targetRect) {
        this.ui.tooltip.style.transform = 'none';
        const tip = this.ui.tooltip.getBoundingClientRect();
        const margin = 15;
        const place = {
            bottom: { top: targetRect.bottom + margin, left: targetRect.left + targetRect.width / 2 - tip.width / 2, fits() { return this.top + tip.height < window.innerHeight; } },
            top: { top: targetRect.top - tip.height - margin, left: targetRect.left + targetRect.width / 2 - tip.width / 2, fits() { return this.top > 0; } },
            right: { top: targetRect.top + targetRect.height / 2 - tip.height / 2, left: targetRect.right + margin, fits() { return this.left + tip.width < window.innerWidth; } },
            left: { top: targetRect.top + targetRect.height / 2 - tip.height / 2, left: targetRect.left - tip.width - margin, fits() { return this.left > 0; } },
        };
        const best = Object.values(place).find(p => p.fits()) || place.bottom;
        let { top, left } = best;
        left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - tip.height - margin));
        this.ui.tooltip.style.top = `${top}px`;
        this.ui.tooltip.style.left = `${left}px`;
    }

    destroy() {
        this._cleanupCurrentStep();
        document.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('resize', this._onViewportChange);
        window.removeEventListener('scroll', this._onViewportChange, true);
    }
}
