import { SCORE_CONFIG } from '../../core/analysis/InterestingnessScore.js';

/**
 * Single source of truth for how the auto-explore scoring terms are PRESENTED (v3.1): labels,
 * gating flags, tooltips, educational explainer copy, and each term's shape function for the
 * inline explainer curves. Consumed by the Explore gallery bars, the Scoring panel's sliders,
 * and the Analysis panel's Interestingness plugin — previously two drifting copies.
 *
 * Shape functions mirror scoreSingleIC exactly (targets/half-sats read from SCORE_CONFIG, never
 * duplicated), so the plotted curve IS the code that scores.
 *
 * @typedef {object} TermMeta
 * @property {string} key       Component key in a ComponentBreakdown.
 * @property {string} label     Short bar label.
 * @property {string} [usedFlag] ComponentBreakdown flag gating the term ("n/a" when falsy).
 * @property {string} hint      One-line tooltip.
 * @property {string} description Explainer paragraph (plain language, 1–2 sentences).
 * @property {string} zeroMeans What a weight of 0 means for the search.
 * @property {string} maxMeans  What a maxed weight means for the search.
 * @property {'gaussian'|'halfsat'|'linear'} shape Shape of value→term-score mapping.
 * @property {{center?: number, tau?: number, halfSat?: number}} shapeParams
 * @property {[number, number]} domain X-range the explainer curve plots over.
 * @property {string} axisLabel  X-axis caption (the raw measured quantity).
 * @property {string} rawKey     Key into an ICScore.raw object for the marker value.
 * @property {(raw: number) => number} [rawToX] Optional transform from raw value to curve X
 *   (e.g. ln for σ, |x| for spatial order). Identity when absent.
 */

/** @type {TermMeta[]} */
export const COMPONENT_META = [
    {
        key: 'criticality', label: 'σ', usedFlag: 'criticalityUsed',
        hint: 'Edge-of-chaos: how a one-cell perturbation spreads (peaks at σ≈1).',
        description: 'A damage probe flips one cell in a shadow copy of the world and measures the growth rate σ of the resulting difference. σ≈1 is the "edge of chaos": perturbations neither die out (frozen order, σ<1) nor explode (chaos, σ>1).',
        zeroMeans: 'Ignore how perturbations spread.',
        maxMeans: 'Hunt near-critical rules above everything else.',
        shape: 'gaussian', shapeParams: { center: 0, tau: SCORE_CONFIG.criticalityTau },
        domain: [-2.4, 2.4], axisLabel: 'ln σ (0 = critical)', rawKey: 'sigma',
        rawToX: (raw) => Math.log(raw),
    },
    {
        key: 'entropyBand', label: 'Entropy',
        hint: 'Mid-band block entropy — structured, not uniform, not noise.',
        description: 'The average local (block) entropy of the grid. Very low = blank/frozen, very high = featureless noise; the reward peaks in the middle band where visible structure lives.',
        zeroMeans: 'Any density of activity is fine.',
        maxMeans: 'Strongly prefer worlds sitting in the structured middle band.',
        shape: 'gaussian', shapeParams: { center: SCORE_CONFIG.entropyTarget, tau: SCORE_CONFIG.entropyTau },
        domain: [0, 1], axisLabel: 'mean block entropy', rawKey: 'blockEntropyMean',
    },
    {
        key: 'fluctuation', label: 'Flux',
        hint: 'Burstiness of how many cells change per tick (susceptibility proxy).',
        description: 'The coefficient of variation of the per-tick changed-cell count. Steady activity scores low; bursty, avalanche-like activity (a hallmark of critical systems) scores high.',
        zeroMeans: 'Steady and bursty activity are equally welcome.',
        maxMeans: 'Chase bursty, avalanching dynamics (careful: oscillators also score here).',
        shape: 'halfsat', shapeParams: { halfSat: SCORE_CONFIG.fluctuationHalfSat },
        domain: [0, SCORE_CONFIG.fluctuationHalfSat * 4], axisLabel: 'changed-count CV', rawKey: 'cv',
    },
    {
        key: 'ruleDiversity', label: 'Diversity',
        hint: 'Shannon spread of which of the 128 rules actually fire.',
        description: 'How evenly the burst exercised the ruleset\'s 128 rules (Shannon entropy of rule usage). A world stuck firing two rules is degenerate; rich dynamics use many.',
        zeroMeans: 'A rule may win with just a handful of active rules.',
        maxMeans: 'Demand rulesets whose whole rule table participates.',
        shape: 'linear', shapeParams: {},
        domain: [0, 1], axisLabel: 'normalized rule-usage entropy', rawKey: 'ruleDiversityNorm',
    },
    {
        key: 'spatialStructure', label: 'Structure', usedFlag: 'spatialUsed',
        hint: 'Join-count spatial order — domains/gliders vs salt-and-pepper.',
        description: 'How far neighboring cells deviate from random mixing (join-count statistic). Salt-and-pepper churn sits near 0; domains, fronts and gliders push it away in either direction. This is the main anti-chaos signal.',
        zeroMeans: 'Structureless churn is not penalized here (the chaos penalty still applies).',
        maxMeans: 'Only spatially organized worlds rank.',
        shape: 'halfsat', shapeParams: { halfSat: SCORE_CONFIG.spatialOrderHalfSat },
        domain: [0, SCORE_CONFIG.spatialOrderHalfSat * 4], axisLabel: '|spatial order|', rawKey: 'spatialOrderMean',
        rawToX: (raw) => Math.abs(raw),
    },
    {
        key: 'spatialHeterogeneity', label: 'Heterog.', usedFlag: 'spatialUsed',
        hint: 'Order and disorder coexisting in different regions.',
        description: 'The variance of local entropy ACROSS regions of the grid: high when calm domains and active zones coexist (complexity), low when everywhere looks the same.',
        zeroMeans: 'Uniform-looking worlds are fine.',
        maxMeans: 'Favor worlds with distinct calm and active regions.',
        shape: 'halfsat', shapeParams: { halfSat: SCORE_CONFIG.spatialVarHalfSat },
        domain: [0, SCORE_CONFIG.spatialVarHalfSat * 4], axisLabel: 'across-block entropy variance', rawKey: 'spatialVariance',
    },
    {
        key: 'temporalEntropyVariance', label: 'Temporal', usedFlag: 'temporalVarUsed',
        hint: 'Entropy swinging over time (Wuensche) — complex rules, not steady order or chaos.',
        description: 'The variance of block entropy OVER TIME. Ordered rules settle low, chaotic rules sit high — both steady. Only complex rules keep swinging between order and disorder (Wuensche\'s classifier signal).',
        zeroMeans: 'Steady-entropy worlds are not penalized.',
        maxMeans: 'Demand entropy that keeps swinging (complex, transient-rich rules).',
        shape: 'halfsat', shapeParams: { halfSat: SCORE_CONFIG.temporalVarHalfSat },
        domain: [0, SCORE_CONFIG.temporalVarHalfSat * 4], axisLabel: 'temporal entropy variance', rawKey: 'temporalVariance',
    },
    {
        key: 'transport', label: 'Transport', usedFlag: 'transportUsed',
        hint: 'Active-cell centroid drift — coherent motion (gliders/spaceships) vs a pinned churn.',
        description: 'The mean per-tick drift speed of the active-cell centroid. Translating structures (gliders, spaceships, fronts) move it steadily; dense churn keeps it pinned at the center.',
        zeroMeans: 'Motionless worlds are as good as travelling ones.',
        maxMeans: 'Hunt travelling structures above all.',
        shape: 'halfsat', shapeParams: { halfSat: SCORE_CONFIG.transportHalfSat },
        domain: [0, SCORE_CONFIG.transportHalfSat * 4], axisLabel: 'centroid drift (cells/tick)', rawKey: 'transportSpeed',
    },
    {
        key: 'openEndedness', label: 'Novelty', usedFlag: 'openEndednessUsed',
        hint: 'Perceptual (CLIP) novelty — how often the LOOK reaches a state it has not been in.',
        description: 'Frames of the find are embedded with a vision model (CLIP); this term rewards how far each frame lands from the nearest look the world has ALREADY passed through. Revisiting old states — including noise that just looks like more noise, or an oscillator flipping between two frames — does not count, no matter how fast it moves. Only measured when the perceptual objective is enabled.',
        zeroMeans: 'Perceptual novelty is ignored (also effectively 0 when embeddings are off).',
        maxMeans: 'Chase worlds that keep reaching genuinely new looks (needs the CLIP objective enabled).',
        shape: 'halfsat', shapeParams: { halfSat: SCORE_CONFIG.openEndednessHalfSat },
        domain: [0, SCORE_CONFIG.openEndednessHalfSat * 4], axisLabel: 'distance to nearest earlier frame', rawKey: 'openEndedness',
    },
];

/**
 * Display-only meta for the multiplicative uniform-chaos factor (v3.1). Not a weighted term —
 * it multiplies the whole score — so it renders as a `×N.NN` factor row/chip, not a 0–1 bar.
 */
export const UNIFORM_FACTOR_META = {
    key: 'uniformFactor', usedFlag: 'uniformUsed', label: 'Uniform',
    hint: 'Uniform-chaos factor — multiplies the whole score. 1.00 = no penalty; lower = the world blankets the grid with structureless chaos.',
    description: 'A multiplicative penalty on the final score, ramping in when the world covers most of the grid (coverage above 50%) WITHOUT spatial structure. Structured dense worlds are rescued by their Structure term; blanket chaos is not.',
    zeroMeans: 'Blanket chaos is never penalized.',
    maxMeans: 'Blanket chaos is (almost) disqualified.',
};

/**
 * Render a term's shape function as a small inline SVG: the curve over `meta.domain`, a dashed
 * guide at the peak/half-saturation point, and — when `rawValue` is finite — a marker dot at the
 * measured value with a caption. Pure string-returning (shared by the Scoring panel, the gallery,
 * and the Analysis plugin). Colors ride on currentColor + CSS classes (theme-safe).
 * @param {TermMeta} meta
 * @param {number|null|undefined} [rawValue] Raw measured input (untransformed; meta.rawToX applies).
 * @returns {string} SVG markup.
 */
export function renderTermCurve(meta, rawValue = null) {
    const W = 220, H = 64, PAD_X = 8, PAD_TOP = 6, PAD_BOT = 16;
    const [x0, x1] = meta.domain;
    const span = x1 - x0 || 1;
    const plotW = W - PAD_X * 2;
    const plotH = H - PAD_TOP - PAD_BOT;
    const fn = termShapeFn(meta);

    const toPx = (x, y) => [
        PAD_X + ((x - x0) / span) * plotW,
        PAD_TOP + (1 - Math.max(0, Math.min(1, y))) * plotH,
    ];

    const N = 48;
    const pts = [];
    for (let i = 0; i <= N; i++) {
        const x = x0 + (span * i) / N;
        const [px, py] = toPx(x, fn(x));
        pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }

    // Dashed guide at the "landmark" x: gaussian center, or the half-saturation point (score 0.5).
    let guide = '';
    const landmark = meta.shape === 'gaussian' ? meta.shapeParams.center
        : meta.shape === 'halfsat' ? meta.shapeParams.halfSat
        : null;
    if (landmark != null && landmark >= x0 && landmark <= x1) {
        const [gx] = toPx(landmark, 0);
        guide = `<line class="term-curve-guide" x1="${gx.toFixed(1)}" y1="${PAD_TOP}" x2="${gx.toFixed(1)}" y2="${PAD_TOP + plotH}" stroke-dasharray="3 3" />`;
    }

    // Marker at the measured raw value (clamped into the plotted domain; caption shows the true value).
    let marker = '';
    if (rawValue != null && Number.isFinite(rawValue)) {
        const xRaw = meta.rawToX ? meta.rawToX(rawValue) : rawValue;
        if (Number.isFinite(xRaw)) {
            const xClamped = Math.max(x0, Math.min(x1, xRaw));
            const [mx, my] = toPx(xClamped, fn(xClamped));
            const capText = `measured: ${formatRaw(rawValue)}${xClamped !== xRaw ? ' (off-scale)' : ''}`;
            const anchor = mx > W * 0.66 ? 'end' : (mx < W * 0.33 ? 'start' : 'middle');
            marker = `
                <circle class="term-curve-marker" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="3.5" />
                <text class="term-curve-marker-label" x="${mx.toFixed(1)}" y="${(PAD_TOP + plotH + 11).toFixed(1)}" text-anchor="${anchor}">${capText}</text>`;
        }
    }
    const axis = marker ? '' : `<text class="term-curve-axis" x="${W / 2}" y="${H - 4}" text-anchor="middle">${escapeHtml(meta.axisLabel)}</text>`;

    return `
        <svg class="term-curve" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Score curve for ${escapeHtml(meta.label)}">
            <line class="term-curve-base" x1="${PAD_X}" y1="${PAD_TOP + plotH}" x2="${W - PAD_X}" y2="${PAD_TOP + plotH}" />
            ${guide}
            <polyline class="term-curve-line" fill="none" points="${pts.join(' ')}" />
            ${marker}
            ${axis}
        </svg>`;
}

/**
 * Render a full explainer block for a term (description, slider semantics, curve). Shared markup
 * for the Scoring panel rows and the Analysis plugin's expandable rows.
 * @param {TermMeta} meta
 * @param {number|null|undefined} [rawValue]
 * @param {{showWeightSemantics?: boolean}} [opts]
 * @returns {string}
 */
export function renderTermExplainer(meta, rawValue = null, opts = {}) {
    const semantics = opts.showWeightSemantics === false ? '' : `
        <div class="term-explainer-minmax">
            <span><strong>0</strong> — ${escapeHtml(meta.zeroMeans)}</span>
            <span><strong>100</strong> — ${escapeHtml(meta.maxMeans)}</span>
        </div>`;
    const curve = meta.shape ? renderTermCurve(meta, rawValue) : '';
    return `
        <div class="term-explainer">
            <p class="term-explainer-desc">${escapeHtml(meta.description)}</p>
            ${semantics}
            ${curve}
        </div>`;
}

/** @param {TermMeta} meta @returns {(x: number) => number} */
function termShapeFn(meta) {
    const p = meta.shapeParams || {};
    switch (meta.shape) {
        case 'gaussian': {
            const c = p.center || 0;
            const tau = p.tau || 1;
            return (x) => Math.exp(-((x - c) * (x - c)) / (2 * tau * tau));
        }
        case 'halfsat': {
            const h = p.halfSat || 1;
            return (x) => (x > 0 ? x / (x + h) : 0);
        }
        default:
            return (x) => Math.max(0, Math.min(1, x));
    }
}

/** Compact number formatting for marker captions across the wildly different raw scales. */
function formatRaw(v) {
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    if (a === 0) return '0';
    return v.toExponential(1);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
