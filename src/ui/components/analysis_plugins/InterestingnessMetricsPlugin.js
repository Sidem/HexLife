import { IAnalysisPlugin } from './IAnalysisPlugin.js';
import { EVENTS } from '../../../services/EventBus.js';
import * as PersistenceService from '../../../services/PersistenceService.js';
import { COMPONENT_META, UNIFORM_FACTOR_META, renderTermExplainer } from '../scoringTermMeta.js';

/**
 * On-demand "interestingness" metrics for the selected world. The component values are the same
 * ones Auto-Explore scores a candidate on (shared {@link COMPONENT_META}), but they're only
 * produced by an evaluation burst — so rather than computing them live on the hot tick path, this
 * plugin runs ONE burst on demand (the Measure button) via WorldManager.measureSelectedWorld
 * (non-destructive: it snapshots and restores the world) and renders the breakdown. The σ damage
 * probe is the expensive part, so it's behind a toggle. Scored under the user's current Scoring
 * settings (v3.1), so this panel always agrees with what Auto-Explore would compute right now.
 *
 * Educational surface (v3.1): every bar row is clickable — it expands the term's explainer with
 * the actual score curve and a marker at THIS measurement's raw value.
 *
 * Mirrors the gallery's per-component bars (same labels + CSS classes) so the two surfaces read alike.
 */

const SETTING_PROBE = 'analysisMeasureProbe';
const SETTING_TICKS = 'analysisMeasureTicks';

export class InterestingnessMetricsPlugin extends IAnalysisPlugin {
    constructor() {
        super('interestingnessMetrics', 'Interestingness Metrics');
        this.isMeasuring = false;
        this.lastResult = null;
        this.uiElements = {};
    }

    init(mountPoint, simulationInterface) {
        super.init(mountPoint, simulationInterface);

        const probeOn = PersistenceService.loadUISetting(SETTING_PROBE, true);
        const ticks = PersistenceService.loadUISetting(SETTING_TICKS, 160);

        this.mountPoint.innerHTML = `
            <div class="interestingness-metrics-plugin">
                <p class="im-blurb">Measure the selected world's dynamics — the same terms Auto-Explore ranks rulesets on, scored under your current Scoring settings. Runs one short evaluation burst; the world is restored afterwards. Click a result row to see how that term's score is computed.</p>
                <div class="im-controls">
                    <label class="im-ticks-field">Ticks:
                        <input type="number" id="im-ticks" min="40" max="5000" step="20" value="${ticks}">
                    </label>
                    <label class="im-probe-field" title="The σ damage probe runs a second shadow simulation — the slow part. Off = faster, no σ.">
                        <input type="checkbox" id="im-probe" ${probeOn ? 'checked' : ''}> Damage probe (σ)
                    </label>
                    <button type="button" id="im-measure" class="im-measure-btn">Measure Selected World</button>
                </div>
                <div class="im-status" id="im-status">No measurement yet.</div>
                <div class="im-results" id="im-results"></div>
            </div>
        `;

        this.uiElements.ticksInput = this.mountPoint.querySelector('#im-ticks');
        this.uiElements.probeInput = this.mountPoint.querySelector('#im-probe');
        this.uiElements.measureBtn = this.mountPoint.querySelector('#im-measure');
        this.uiElements.status = this.mountPoint.querySelector('#im-status');
        this.uiElements.results = this.mountPoint.querySelector('#im-results');

        this._onMeasureClick = () => this._measure();
        this.uiElements.measureBtn.addEventListener('click', this._onMeasureClick);
        // Expandable per-term explainers (v3.1): click a bar row to see what the term measures and
        // where this measurement landed on its score curve.
        this._onResultsClick = (e) => {
            const row = e.target.closest('.explore-bar-row[data-term]');
            if (!row || !this.uiElements.results.contains(row)) return;
            this._toggleExplainer(row);
        };
        this.uiElements.results.addEventListener('click', this._onResultsClick);
        this._onProbeChange = () => PersistenceService.saveUISetting(SETTING_PROBE, this.uiElements.probeInput.checked);
        this.uiElements.probeInput.addEventListener('change', this._onProbeChange);
        this._onTicksChange = () => PersistenceService.saveUISetting(SETTING_TICKS, this._readTicks());
        this.uiElements.ticksInput.addEventListener('change', this._onTicksChange);

        // A measurement is stale once the world it described is gone — clear on world switch / reset.
        this._subscribeToEvent(EVENTS.SELECTED_WORLD_CHANGED, () => this._clearResult());
        this._subscribeToEvent(EVENTS.ALL_WORLDS_RESET, () => this._clearResult());
    }

    _readTicks() {
        const v = Math.floor(Number(this.uiElements.ticksInput?.value) || 160);
        return Math.max(40, Math.min(5000, v));
    }

    async _measure() {
        if (this.isMeasuring) return;
        if (typeof this.simulationInterface.measureSelectedWorld !== 'function') return;

        this.isMeasuring = true;
        this.uiElements.measureBtn.disabled = true;
        this.uiElements.status.textContent = 'Measuring…';
        this.uiElements.results.innerHTML = '';

        try {
            const result = await this.simulationInterface.measureSelectedWorld({
                ticks: this._readTicks(),
                probe: !!this.uiElements.probeInput.checked,
            });
            if (!result) {
                this.uiElements.status.textContent = 'Measurement unavailable.';
                return;
            }
            this.lastResult = result;
            this.lastFitnessValue = result.score;
            this._renderResult(result);
        } catch (err) {
            this.uiElements.status.textContent = 'Measurement failed.';
            console.error('InterestingnessMetricsPlugin: measure failed', err);
        } finally {
            this.isMeasuring = false;
            if (this.uiElements.measureBtn) this.uiElements.measureBtn.disabled = false;
        }
    }

    _clearResult() {
        this.lastResult = null;
        this.lastFitnessValue = null;
        if (this.uiElements.status) this.uiElements.status.textContent = 'No measurement yet.';
        if (this.uiElements.results) this.uiElements.results.innerHTML = '';
    }

    _renderResult(result) {
        const scorePct = Math.round(Math.max(0, Math.min(1, result.score)) * 100);
        if (result.killed) {
            this.uiElements.status.innerHTML = `<span class="im-kill">Killed: ${result.killReason || 'degenerate'}</span> — score 0.00`;
        } else {
            this.uiElements.status.innerHTML = `Interestingness: <strong>${result.score.toFixed(3)}</strong> <span class="im-score-bar"><span class="im-score-fill" style="width:${scorePct}%"></span></span>`;
        }
        this.uiElements.results.innerHTML = this._renderComponentBars(result.components);
    }

    // Reuse the gallery's bar markup (explore-* classes) so both surfaces look identical.
    _renderComponentBars(components) {
        if (!components) return '';
        let rows = COMPONENT_META.map(({ key, label, usedFlag, hint }) => {
            const used = !usedFlag || !!components[usedFlag];
            const val = used ? Math.max(0, Math.min(1, components[key] || 0)) : 0;
            const pct = Math.round(val * 100);
            const valText = used ? val.toFixed(2) : 'n/a';
            return `
                <div class="explore-bar-row explore-bar-row--expandable" data-term="${key}" title="${label} — ${hint} (click to explain)">
                    <span class="explore-bar-label">${label}</span>
                    <span class="explore-bar-track"><span class="explore-bar-fill" style="width:${pct}%"></span></span>
                    <span class="explore-bar-val">${valText}</span>
                </div>
                <div class="im-term-explainer" data-term-explainer="${key}" hidden></div>`;
        }).join('');
        // Uniform-chaos factor (v3.1): multiplies the whole score; amber when it bit.
        if (components.uniformUsed && typeof components.uniformFactor === 'number') {
            const uf = Math.max(0, Math.min(1, components.uniformFactor));
            const penalized = uf < 0.995;
            rows += `
                <div class="explore-bar-row explore-bar-row--expandable" data-term="uniformFactor" title="${UNIFORM_FACTOR_META.label} — ${UNIFORM_FACTOR_META.hint} (click to explain)">
                    <span class="explore-bar-label">${UNIFORM_FACTOR_META.label}</span>
                    <span class="explore-bar-track"><span class="explore-bar-fill${penalized ? ' explore-bar-fill--penalty' : ''}" style="width:${Math.round(uf * 100)}%"></span></span>
                    <span class="explore-bar-val">×${uf.toFixed(2)}</span>
                </div>
                <div class="im-term-explainer" data-term-explainer="uniformFactor" hidden></div>`;
        }
        return `<div class="explore-find-bars">${rows}</div>`;
    }

    _toggleExplainer(row) {
        const term = row.dataset.term;
        const box = this.uiElements.results.querySelector(`[data-term-explainer="${term}"]`);
        if (!box) return;
        const open = box.hidden;
        if (open && !box.innerHTML) {
            if (term === 'uniformFactor') {
                box.innerHTML = renderTermExplainer(UNIFORM_FACTOR_META, null, { showWeightSemantics: false });
            } else {
                const meta = COMPONENT_META.find((m) => m.key === term);
                const raw = this.lastResult?.raw?.[meta?.rawKey];
                if (meta) box.innerHTML = renderTermExplainer(meta, raw ?? null, { showWeightSemantics: false });
            }
        }
        box.hidden = !open;
        row.classList.toggle('explainer-open', open);
    }

    onDataUpdate() { /* on-demand only — no live stream consumed */ }

    getFitnessValue() {
        return this.lastResult ? this.lastResult.score : null;
    }

    getPluginConfig() {
        return { requiredDataTypes: [] };
    }

    destroy() {
        if (this.uiElements.measureBtn) this.uiElements.measureBtn.removeEventListener('click', this._onMeasureClick);
        if (this.uiElements.probeInput) this.uiElements.probeInput.removeEventListener('change', this._onProbeChange);
        if (this.uiElements.ticksInput) this.uiElements.ticksInput.removeEventListener('change', this._onTicksChange);
        if (this.uiElements.results) this.uiElements.results.removeEventListener('click', this._onResultsClick);
        this.uiElements = {};
        this.lastResult = null;
        super.destroy();
    }
}
