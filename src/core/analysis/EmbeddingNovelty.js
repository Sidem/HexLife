// @ts-check

/**
 * Perceptual interestingness — vector math + trajectory-novelty signal (ASAL-style).
 *
 * Kumar et al. (2024, "Automating the Search for Artificial Life with Foundation Models") measure
 * interestingness as temporal **novelty in a vision-model embedding space**: a simulation is
 * interesting when the foundation-model embedding of its rendered frames keeps moving into new
 * territory over time, rather than freezing (ordered) or thrashing in place (noise). HexLife embeds a
 * short trajectory of a find's rendered frames (a CLIP/MobileCLIP image embedding per frame, produced
 * off-thread by {@link module:services/EmbeddingService}) and reduces that trajectory to a single
 * open-endedness scalar with {@link historicalNovelty}.
 *
 * Two reductions live here and the difference between them is the whole point (#37 Stage 1):
 * {@link trajectoryNovelty} measures perceptual **velocity** (mean distance between *consecutive*
 * frames) and {@link historicalNovelty} measures perceptual **novelty** (mean distance from each
 * frame to the nearest state already visited). Velocity is maximized by noise — churn moves fast
 * forever without ever arriving anywhere new — which is exactly the pro-chaos bias #37 exists to
 * remove. Novelty scores a period-2 oscillator at ~0 while velocity scores it near its ceiling.
 *
 * This module is PURE: no workers, no model, no globals — just typed-array math over embedding
 * vectors. It is fully unit-testable with tiny synthetic vectors and never imports the (optional,
 * default-off) model machinery, so the statistical objective is unaffected when embeddings are off.
 */

/** @typedef {Float32Array|number[]} Vec */

/** Tunable knobs for the trajectory-novelty reduction. */
export const NOVELTY_CONFIG = {
    /**
     * Minimum L2 norm for an embedding to count as a usable direction. A (near-)zero vector has no
     * meaningful angle, so it is skipped rather than contributing a spurious 90° step.
     */
    minNorm: 1e-6,
};

/**
 * In-place-free L2 norm of a vector.
 * @param {Vec} v
 * @returns {number}
 */
export function norm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return Math.sqrt(s);
}

/**
 * Return a unit-length copy of `v` (Float32Array), or null when `v` is shorter than 1 element or its
 * norm is below `minNorm` (an unusable direction).
 * @param {Vec} v
 * @param {number} [minNorm]
 * @returns {Float32Array|null}
 */
export function l2normalize(v, minNorm = NOVELTY_CONFIG.minNorm) {
    if (!v || v.length === 0) return null;
    const n = norm(v);
    if (!(n > minNorm)) return null;
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
}

/**
 * Dot product of two equal-length vectors (shorter length wins if they differ — defensive).
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number}
 */
export function dot(a, b) {
    const n = Math.min(a.length, b.length);
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
}

/**
 * Cosine similarity in [-1, 1]; 0 when either vector is an unusable (near-zero) direction.
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
    const na = norm(a);
    const nb = norm(b);
    if (!(na > NOVELTY_CONFIG.minNorm) || !(nb > NOVELTY_CONFIG.minNorm)) return 0;
    return Math.max(-1, Math.min(1, dot(a, b) / (na * nb)));
}

/**
 * Cosine distance in [0, 2]: 0 = identical direction, 1 = orthogonal, 2 = opposite.
 * @param {Vec} a
 * @param {Vec} b
 * @returns {number}
 */
export function cosineDistance(a, b) {
    return 1 - cosineSimilarity(a, b);
}

/**
 * Componentwise mean of a list of equal-length vectors → a single representative embedding (used as
 * the key for the perceptual illumination archive). Skips unusable (near-zero) vectors; returns null
 * if nothing usable remains. The result is NOT normalized (the archive's sign-hash is scale-invariant).
 * @param {Vec[]} vectors
 * @returns {Float32Array|null}
 */
export function meanVector(vectors) {
    if (!Array.isArray(vectors) || vectors.length === 0) return null;
    let dim = 0;
    for (const v of vectors) if (v && v.length > dim) dim = v.length;
    if (dim === 0) return null;
    const acc = new Float64Array(dim);
    let count = 0;
    for (const v of vectors) {
        if (!v || v.length === 0) continue;
        if (!(norm(v) > NOVELTY_CONFIG.minNorm)) continue;
        for (let i = 0; i < dim; i++) acc[i] += v[i] || 0;
        count++;
    }
    if (count === 0) return null;
    const out = new Float32Array(dim);
    for (let i = 0; i < dim; i++) out[i] = acc[i] / count;
    return out;
}

/**
 * Reduce a trajectory of frame embeddings to a single **open-endedness** scalar: the mean cosine
 * distance between *consecutive* frame embeddings — how fast the perceptual representation keeps
 * changing as the automaton runs.
 *
 * This is perceptual **velocity**, not novelty: it is maximized by a trajectory that never stops
 * moving, including one that thrashes between two looks forever. It is kept as a raw stat (and as the
 * upper bound `historicalNovelty` is measured against), but it is NOT the scored term — see
 * {@link historicalNovelty} and the module header for why.
 *
 * Unusable (near-zero) embeddings are skipped, and a step is only counted between two usable
 * consecutive embeddings. Returns 0 for fewer than two usable embeddings (no degradation: the caller
 * drops the term and renormalizes — see InterestingnessScore). The raw mean distance is returned (in
 * [0, 2]); the score module applies the half-saturation reward, mirroring the transport/spatial terms.
 *
 * @param {Vec[]} embeddings  Per-frame embeddings, in temporal order.
 * @param {typeof NOVELTY_CONFIG} [config]
 * @returns {number} Mean consecutive cosine distance (raw, ≥ 0), or 0 if not computable.
 */
export function trajectoryNovelty(embeddings, config = NOVELTY_CONFIG) {
    if (!Array.isArray(embeddings) || embeddings.length < 2) return 0;
    const units = embeddings.map((e) => l2normalize(e, config.minNorm));
    let sum = 0;
    let steps = 0;
    let prev = null;
    for (const u of units) {
        if (!u) { prev = null; continue; } // an unusable frame breaks the consecutive chain
        if (prev) {
            sum += 1 - dot(prev, u); // both unit-length ⇒ dot is the cosine similarity
            steps++;
        }
        prev = u;
    }
    return steps > 0 ? sum / steps : 0;
}

/**
 * Reduce a trajectory of frame embeddings to a single **open-endedness** scalar the way ASAL actually
 * defines it: for each frame, the cosine distance to the *nearest perceptual state already visited*,
 * averaged over every frame that has at least one predecessor. This is the scored `openEndedness`
 * input since v3.3 (#37 Stage 1).
 *
 * Why not {@link trajectoryNovelty} (mean *consecutive* distance): that measures how fast the look
 * changes, and noise changes fastest. A dense churn steps a long way every frame while revisiting the
 * same perceptual neighbourhood forever, and a period-2 oscillator scores near the ceiling — so the
 * one perception-aligned term in the objective was rewarding exactly the chaos #37 exists to
 * de-rank. Distance-to-nearest-visited-state instead asks "did this frame arrive somewhere new?":
 *   - frozen / still life        → 0 (every frame is its own predecessor's twin)
 *   - period-2 oscillator A,B,A… → ≈0 (from frame 3 on, an identical state is already in the history)
 *   - thrash inside a subspace   → low (the history covers the subspace after a few frames)
 *   - developing structure       → high (each frame is genuinely unlike anything seen so far)
 *
 * By construction `historicalNovelty ≤ trajectoryNovelty` — the minimum over all earlier frames is at
 * most the distance to the immediately-previous one — so the term's scale is strictly smaller and
 * `SCORE_CONFIG.openEndednessHalfSat` is tuned lower to match.
 *
 * Unusable (near-zero) embeddings are skipped. Unlike the consecutive reduction they do NOT break a
 * chain: the history set simply does not grow, and the next usable frame is still compared against
 * everything before the gap. Returns 0 for fewer than two usable embeddings (the caller drops the
 * term and renormalizes). O(n²) over trajectory length (n ≈ 8–16 frames) — negligible.
 *
 * @param {Vec[]} embeddings  Per-frame embeddings, in temporal order.
 * @param {typeof NOVELTY_CONFIG} [config]
 * @returns {number} Mean distance-to-nearest-earlier-frame (raw, ≥ 0), or 0 if not computable.
 */
export function historicalNovelty(embeddings, config = NOVELTY_CONFIG) {
    if (!Array.isArray(embeddings) || embeddings.length < 2) return 0;
    /** @type {Float32Array[]} */
    const history = [];
    let sum = 0;
    let counted = 0;
    for (const e of embeddings) {
        const u = l2normalize(e, config.minNorm);
        if (!u) continue; // unusable frame: contributes nothing and does not enter the history
        if (history.length > 0) {
            let best = Infinity;
            for (const h of history) {
                const d = 1 - dot(h, u); // both unit-length ⇒ dot is the cosine similarity
                if (d < best) best = d;
            }
            sum += best;
            counted++;
        }
        history.push(u);
    }
    return counted > 0 ? sum / counted : 0;
}
