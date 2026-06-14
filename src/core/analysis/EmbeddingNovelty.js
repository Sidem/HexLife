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
 * open-endedness scalar with {@link trajectoryNovelty}.
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
 * A still life or a settled fixed point barely moves in embedding space (≈0); a glider/spaceship soup
 * or an ever-evolving structure keeps stepping into visually-new territory (higher). Unusable
 * (near-zero) embeddings are skipped, and a step is only counted between two usable consecutive
 * embeddings. Returns 0 for fewer than two usable embeddings (no degradation: the caller drops the
 * term and renormalizes — see InterestingnessScore). The raw mean distance is returned (in [0, 2]);
 * the score module applies the half-saturation reward, mirroring the transport/spatial terms.
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
