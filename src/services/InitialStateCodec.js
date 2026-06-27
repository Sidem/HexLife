/**
 * Initial-condition codec: turns a world initial state (`{ mode, params }`) plus its reset seed
 * into a compact, portable, **versioned** string code — and back. Used by the Ruleset Library to
 * pair a saved ruleset with the exact starting condition it was generated from, and to copy/share
 * that condition as a single token.
 *
 * Pure (no window / DOM access), like {@link ShareCodec}, so it round-trips in node and unit-tests
 * directly. Format:
 *
 *     IC1.<base64url( JSON.stringify({ m: mode, p: params, s: seed }) )>
 *
 * The `IC1.` prefix is the future-proofing seam: a later, more compact encoding becomes `IC2.` and
 * {@link decode} switches on the version. Because the payload is JSON, **any** new mode or param is
 * representable without touching this file — {@link KNOWN_MODES} only gates validation and lets a
 * decoder flag a mode it doesn't recognise (a future IC type) so callers can degrade gracefully
 * instead of throwing.
 */

/**
 * Registry of initial-state modes this build understands, with their tunable param keys. Adding a
 * new IC type is a one-line entry here (and the matching worker strategy). The codec itself does not
 * need this to encode/decode — it is the validation / forward-compat reference.
 * @type {Record<string, { params: string[] }>}
 */
export const KNOWN_MODES = {
    density: { params: ['density'] },
    clusters: {
        params: [
            'count', 'density', 'densityVariation', 'diameter', 'diameterVariation',
            'eccentricity', 'orientation', 'orientationVariation', 'distribution', 'gaussianStdDev',
        ],
    },
};

const PREFIX = 'IC1.';

/** Standard base64 → URL-safe base64 (drop `=` padding, `+`→`-`, `/`→`_`). */
function toBase64Url(b64) {
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe base64 → standard base64 (restore `+`,`/` and `=` padding). */
function fromBase64Url(s) {
    const restored = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = restored.length % 4;
    return pad ? restored + '='.repeat(4 - pad) : restored;
}

/** UTF-8-safe string → base64url. Uses the same `btoa` path as utils.cellsToBase64. */
function encodeBase64Url(str) {
    // encodeURIComponent → %XX escapes → bytes, so non-ASCII survives btoa's latin1 expectation.
    const bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return toBase64Url(btoa(bytes));
}

/** base64url → original UTF-8 string. Inverse of {@link encodeBase64Url}. */
function decodeBase64Url(s) {
    const bin = atob(fromBase64Url(s));
    let pct = '';
    for (let i = 0; i < bin.length; i++) {
        pct += '%' + bin.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return decodeURIComponent(pct);
}

/**
 * Encode an initial state + seed into a portable `IC1.` code.
 * @param {{ mode: string, params: object }|null|undefined} initialState
 * @param {number|null} [seed] The reset seed (so the exact RNG layout reproduces). `null`/omitted is
 *   allowed — the condition replays with a fresh random seed.
 * @returns {string|null} The code, or `null` when `initialState` is missing/shapeless.
 */
export function encode(initialState, seed = null) {
    if (!initialState || typeof initialState.mode !== 'string') return null;
    const payload = {
        m: initialState.mode,
        p: initialState.params && typeof initialState.params === 'object' ? initialState.params : {},
        s: Number.isFinite(seed) ? seed : null,
    };
    try {
        return PREFIX + encodeBase64Url(JSON.stringify(payload));
    } catch {
        return null;
    }
}

/**
 * Decode an `IC1.` code back into an initial state + seed.
 * @param {string} code
 * @returns {{ initialState: { mode: string, params: object }, seed: number|null, version: number,
 *   unknownMode: boolean }|null} `null` for a malformed / wrong-version code. `unknownMode` is `true`
 *   when the decoded `mode` isn't in {@link KNOWN_MODES} (a forward-compat IC type) — the raw
 *   `{ mode, params }` is still returned so callers can decide to use or fall back.
 */
export function decode(code) {
    if (typeof code !== 'string' || !code.startsWith(PREFIX)) return null;
    let payload;
    try {
        payload = JSON.parse(decodeBase64Url(code.slice(PREFIX.length)));
    } catch {
        return null;
    }
    if (!payload || typeof payload.m !== 'string') return null;

    const params = payload.p && typeof payload.p === 'object' ? payload.p : {};
    const seed = Number.isFinite(payload.s) ? payload.s : null;
    return {
        initialState: { mode: payload.m, params },
        seed,
        version: 1,
        unknownMode: !Object.prototype.hasOwnProperty.call(KNOWN_MODES, payload.m),
    };
}
