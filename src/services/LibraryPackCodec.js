/**
 * Community-library "pack" codec: a versioned, portable JSON envelope for sharing personal-library
 * rulesets and Auto-Explore gallery finds between devices (and as the payload for the PR-based
 * public-library submission path). One format carries either or both kinds:
 *
 *     {
 *       "format": "hexlife-pack",
 *       "version": 1,
 *       "exportedAt": "2026-07-12T…Z",
 *       "app": "<build sha, optional>",
 *       "rulesets": [ { name, description?, tags[], hex, initialState, seed, thumb? } ],
 *       "finds":    [ …BehaviorArchive entry, thumb optional… ]
 *     }
 *
 * PURE, like {@link module:services/InitialStateCodec} and {@link module:core/analysis/BehaviorArchive}
 * — no EventBus, no localStorage, no DOM — so it round-trips in node and unit-tests directly.
 *
 * A pack is UNTRUSTED input (a downloaded file, same posture as a shared search link), so
 * {@link decodePack} sanitizes every field: bad `hex` drops the entry, over-long text is clamped,
 * non-image or oversized thumbs are dropped, and — critically — an embedding-keyed find has its
 * OPAQUE SimHash `cellKey` stripped and `descriptorKind` reset to `'stats'` (that cell belongs to the
 * exporter's CLIP model/projection instance and must never be trusted cross-device; the archive
 * re-derives the statistical descriptor from `metrics` on insert). Every drop/clamp emits a
 * human-readable warning string so the import confirmation can surface exactly what changed.
 */

import { rulesetName } from '../utils/utils.js';

/** Envelope discriminator + version. A future incompatible layout bumps {@link PACK_VERSION}. */
export const PACK_FORMAT = 'hexlife-pack';
export const PACK_VERSION = 1;

/** Thumbnails ride along by default but are size-capped at encode AND decode (baked JPEGs are small). */
export const THUMB_MAX_BYTES = 64 * 1024;
const NAME_MAX = 80;
const DESC_MAX = 500;
const TAGS_MAX = 10;
const TAG_LEN_MAX = 24;
/** Re-assigned on import, so they never travel in a pack. */
const VOLATILE_RULESET_FIELDS = ['id', 'createdAt', 'schemaVersion'];

const HEX_RE = /^[0-9a-fA-F]{32}$/;

// --- encode -------------------------------------------------------------------------------------

/**
 * Encode personal-library rulesets and/or gallery finds into a pack JSON string. Strips volatile
 * ruleset fields ({@link VOLATILE_RULESET_FIELDS}) and drops any `thumb` larger than
 * {@link THUMB_MAX_BYTES}. Everything else rides along verbatim (scores stay honest).
 * @param {{rulesets?: object[], finds?: object[]}} [data]
 * @param {{exportedAt?: string, app?: string|null}} [meta] `exportedAt` defaults to now (injectable
 *   so unit tests stay deterministic); `app` is an optional build-sha provenance tag.
 * @returns {string}
 */
export function encodePack({ rulesets = [], finds = [] } = {}, { exportedAt, app = null } = {}) {
    /** @type {Record<string, any>} */
    const pack = {
        format: PACK_FORMAT,
        version: PACK_VERSION,
        exportedAt: exportedAt || new Date().toISOString(),
        rulesets: (rulesets || []).map(encodeRuleset),
        finds: (finds || []).map(dropOversizedThumb),
    };
    if (app) pack.app = app;
    return JSON.stringify(pack);
}

/** Strip volatile ruleset fields, then drop an oversized thumb. */
function encodeRuleset(entry) {
    const rest = { ...entry };
    for (const f of VOLATILE_RULESET_FIELDS) delete rest[f];
    return dropOversizedThumb(rest);
}

/** Return a shallow copy with `thumb` removed when it exceeds the size cap; otherwise the entry. */
function dropOversizedThumb(entry) {
    if (entry && typeof entry.thumb === 'string' && entry.thumb.length > THUMB_MAX_BYTES) {
        const { thumb: _drop, ...rest } = entry;
        return rest;
    }
    return entry;
}

// --- decode -------------------------------------------------------------------------------------

/**
 * Parse + sanitize a pack. Throws a single-line {@link Error} for input that isn't a readable pack
 * (not JSON, wrong `format`, unsupported `version`) — callers toast the message. Otherwise returns
 * the sanitized arrays plus a list of human-readable warnings for every entry/field dropped or
 * clamped.
 * @param {string} jsonString
 * @returns {{rulesets: object[], finds: object[], warnings: string[]}}
 */
export function decodePack(jsonString) {
    let raw;
    try {
        raw = JSON.parse(jsonString);
    } catch {
        throw new Error('Not a valid JSON file.');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Not a HexLife pack (expected a JSON object).');
    }
    if (raw.format !== PACK_FORMAT) {
        throw new Error(`Not a HexLife pack (format is ${JSON.stringify(raw.format)}).`);
    }
    if (raw.version !== PACK_VERSION) {
        throw new Error(`Unsupported pack version ${raw.version} (this build reads version ${PACK_VERSION}).`);
    }

    /** @type {string[]} */
    const warnings = [];
    const rulesets = sanitizeArray(raw.rulesets, (e, label) => sanitizeRulesetEntry(e, warnings, label), 'Ruleset');
    const finds = sanitizeArray(raw.finds, (e, label) => sanitizeFindEntry(e, warnings, label), 'Find');
    return { rulesets, finds, warnings };
}

/** Map a maybe-array through a per-entry sanitizer, dropping nulls; a non-array source yields []. */
function sanitizeArray(arr, fn, kind) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    arr.forEach((entry, i) => {
        const clean = fn(entry, `${kind} #${i + 1}`);
        if (clean) out.push(clean);
    });
    return out;
}

/**
 * Sanitize one personal-library ruleset entry. Returns a normalized `{name, description?, tags,
 * hex, initialState, seed, thumb?}` or `null` (dropped, with a warning).
 */
function sanitizeRulesetEntry(entry, warnings, label) {
    if (!entry || typeof entry !== 'object') {
        warnings.push(`${label} skipped (not an object).`);
        return null;
    }
    const hex = sanitizeHex(entry.hex);
    if (!hex) {
        warnings.push(`${label} dropped (invalid ruleset hex).`);
        return null;
    }
    const out = { name: sanitizeName(entry.name, hex), hex, tags: sanitizeTags(entry.tags, warnings, label) };
    const desc = clampString(entry.description, DESC_MAX, 'description', warnings, label);
    if (desc) out.description = desc;
    out.initialState = sanitizeInitialState(entry.initialState, warnings, label);
    out.seed = sanitizeSeed(entry.seed);
    const thumb = sanitizeThumb(entry.thumb, warnings, label);
    if (thumb) out.thumb = thumb;
    return out;
}

/**
 * Sanitize one gallery find. Preserves `metrics`/`rawMetrics` and any unknown fields verbatim, but
 * requires a valid `hex` + finite `score`, strips the opaque embedding `cellKey`, and forces
 * `descriptorKind: 'stats'` so the archive re-derives the statistical descriptor on insert. Returns
 * the cleaned entry or `null` (dropped, with a warning).
 */
function sanitizeFindEntry(entry, warnings, label) {
    if (!entry || typeof entry !== 'object') {
        warnings.push(`${label} skipped (not an object).`);
        return null;
    }
    const hex = sanitizeHex(entry.hex);
    if (!hex) {
        warnings.push(`${label} dropped (invalid ruleset hex).`);
        return null;
    }
    if (!Number.isFinite(entry.score)) {
        warnings.push(`${label} dropped (missing or non-numeric score).`);
        return null;
    }
    // Drop the cross-device-invalid embedding cell + kind; keep everything else (metrics stay honest).
    const { cellKey: _cell, descriptorKind: _kind, thumb, initialState, seed, ...rest } = entry;
    const out = { ...rest, hex, descriptorKind: 'stats' };
    const cleanThumb = sanitizeThumb(thumb, warnings, label);
    if (cleanThumb) out.thumb = cleanThumb;
    const is = sanitizeInitialState(initialState, warnings, label);
    if (is) out.initialState = is;
    const s = sanitizeSeed(seed);
    if (s != null) out.seed = s;
    return out;
}

// --- field sanitizers ---------------------------------------------------------------------------

/** Valid 32-hex-char ruleset string, verbatim (case preserved), else null. */
function sanitizeHex(hex) {
    return typeof hex === 'string' && HEX_RE.test(hex) ? hex : null;
}

/** Trimmed, capped display name; falls back to the deterministic mnemonic when absent/empty. */
function sanitizeName(name, hex) {
    if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed) return trimmed.slice(0, NAME_MAX);
    }
    return rulesetName(hex);
}

/** A string clamped to `max` (warns on truncation), or null when not a usable string. */
function clampString(value, max, field, warnings, label) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) {
        warnings.push(`${label}: ${field} truncated to ${max} characters.`);
        return trimmed.slice(0, max);
    }
    return trimmed;
}

/** Array of ≤ TAGS_MAX non-empty strings, each ≤ TAG_LEN_MAX chars (warns when the list is trimmed). */
function sanitizeTags(tags, warnings, label) {
    if (!Array.isArray(tags)) return [];
    let out = tags
        .filter(t => typeof t === 'string')
        .map(t => t.trim())
        .filter(Boolean)
        .map(t => (t.length > TAG_LEN_MAX ? t.slice(0, TAG_LEN_MAX) : t));
    if (out.length > TAGS_MAX) {
        warnings.push(`${label}: tag list trimmed to ${TAGS_MAX}.`);
        out = out.slice(0, TAGS_MAX);
    }
    return out;
}

/** `{mode: string, params: object}` (unknown modes pass through) or null; warns when malformed. */
function sanitizeInitialState(is, warnings, label) {
    if (is == null) return null;
    if (typeof is === 'object' && !Array.isArray(is) && typeof is.mode === 'string'
        && is.params && typeof is.params === 'object' && !Array.isArray(is.params)) {
        return { mode: is.mode, params: is.params };
    }
    warnings.push(`${label}: unusable initialState dropped.`);
    return null;
}

/** A finite seed number, or null. */
function sanitizeSeed(seed) {
    return Number.isFinite(seed) ? seed : null;
}

/** A valid `data:image/…` thumbnail within the size cap, or null (warns on the reason it's dropped). */
function sanitizeThumb(thumb, warnings, label) {
    if (thumb == null) return null;
    if (typeof thumb !== 'string' || !thumb.startsWith('data:image/')) {
        warnings.push(`${label}: thumbnail dropped (not an image data-URL).`);
        return null;
    }
    if (thumb.length > THUMB_MAX_BYTES) {
        warnings.push(`${label}: thumbnail dropped (over ${Math.round(THUMB_MAX_BYTES / 1024)} KB).`);
        return null;
    }
    return thumb;
}

// --- merge / public-shape helpers (pure) --------------------------------------------------------

/** Case-insensitive dedupe key for a ruleset hex, or null when the hex is unusable. */
function hexKey(hex) {
    return typeof hex === 'string' && HEX_RE.test(hex) ? hex.toLowerCase() : null;
}

/**
 * Dedupe incoming rulesets against an existing personal library BY HEX (ids are re-minted on import,
 * so they can't be the identity). Intra-batch duplicates are also collapsed. Pure: returns the
 * subset to add plus counts; the caller assigns fresh ids/timestamps and persists.
 * @param {object[]} existing
 * @param {object[]} incoming
 * @returns {{toAdd: object[], added: number, skipped: number}}
 */
export function mergeRulesets(existing = [], incoming = []) {
    const seen = new Set((existing || []).map(r => hexKey(r && r.hex)).filter(Boolean));
    const toAdd = [];
    let skipped = 0;
    for (const entry of incoming || []) {
        const key = hexKey(entry && entry.hex);
        if (!key || seen.has(key)) {
            skipped++;
            continue;
        }
        seen.add(key);
        toAdd.push(entry);
    }
    return { toAdd, added: toAdd.length, skipped };
}

/**
 * Project a personal-library entry down to the committed public-library shape
 * (`{name, description, tags, hex, initialState?, seed?}` — no thumb, no volatile fields). Used by
 * the "Copy as public-library JSON" per-card action so a personal find is one paste from a
 * `rulesets.json` PR entry.
 * @param {object} entry
 * @returns {object}
 */
export function toPublicLibraryEntry(entry) {
    const out = {
        name: entry.name || rulesetName(entry.hex),
        description: typeof entry.description === 'string' ? entry.description : '',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        hex: entry.hex,
    };
    if (entry.initialState) {
        out.initialState = entry.initialState;
        out.seed = Number.isFinite(entry.seed) ? entry.seed : null;
    }
    return out;
}
