// @ts-check

/**
 * Reddit post-kit helpers for r/hexlife Live Specimens.
 *
 * Platform limit: Devvit custom posts cannot be created from github.io. The supported path is
 * copy a world code → open r/hexlife → ⋯ → New HexLife post → paste code + title. This module
 * packages name / description / tags / IC / explorer link around that code so the handoff is less
 * painful than "code only + tribal knowledge".
 *
 * Pure encode + string builders (no DOM) so vitest can cover them without a browser.
 */

import { encodeWorldCode, explorerUrlForRuleset } from '../core/WorldCodec.js';
import { tagLabel } from '../core/tags.js';

/**
 * @typedef {{ mode?: string, params?: Record<string, unknown> }} InitialStateShape
 * @typedef {{
 *   hex?: string,
 *   name?: string,
 *   description?: string,
 *   tags?: string[],
 *   initialState?: InitialStateShape|null,
 * }} LibraryEntryLike
 */

/** Canonical subreddit URL (trailing slash matches existing app open calls). */
export const REDDIT_SUB_URL = 'https://www.reddit.com/r/hexlife/';

/** Display name for toasts and labels. */
export const REDDIT_SUB_NAME = 'r/hexlife';

/** Default IC when a library entry has no density/clusters generator to ship. */
export const DEFAULT_SHOWCASE_GENERATOR = Object.freeze({
    mode: 'density',
    params: Object.freeze({ density: 0.12 }),
});

const TITLE_MAX = 300;

/**
 * Short IC badge text (mirrors {@link icBadgeLabel} in RulesetDisplayFactory — kept here so this
 * service stays free of UI imports).
 * @param {InitialStateShape|null|undefined} initialState
 * @returns {string}
 */
function icLabelForState(initialState) {
    const mode = initialState?.mode;
    if (mode === 'clusters') return 'IC · clumps';
    if (mode === 'density') {
        const d = /** @type {number|undefined} */ (initialState?.params?.density);
        if (Number.isFinite(d)) return `IC · ${Math.round(/** @type {number} */ (d) * 100)}% fill`;
        return 'IC · random fill';
    }
    return mode ? `IC · ${mode}` : 'IC';
}

/**
 * Human title for a Reddit post: name, optionally with a short tag suffix.
 * @param {{ name?: string|null, tags?: string[]|null }} opts
 * @returns {string}
 */
export function buildPostTitle({ name, tags = [] } = {}) {
    const base = (typeof name === 'string' && name.trim() ? name.trim() : 'HexLife');
    const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (tagList.length === 0) return base.slice(0, TITLE_MAX);

    const tagPart = tagList.slice(0, 3).map((t) => tagLabel(t)).join(', ');
    const combined = `${base} · ${tagPart}`;
    return (combined.length <= TITLE_MAX ? combined : base).slice(0, TITLE_MAX);
}

/**
 * Multi-line clipboard kit: title + description + tags + explorer + IC + world code.
 * The Devvit form wants **only** the HXW1.… line in the code field — the kit is for the human.
 *
 * @param {{
 *   title: string,
 *   description?: string|null,
 *   tags?: string[]|null,
 *   explorerUrl?: string|null,
 *   icLabel?: string|null,
 *   worldCode: string,
 * }} opts
 * @returns {string}
 */
export function buildPostKit({
    title,
    description = '',
    tags = [],
    explorerUrl = '',
    icLabel = '',
    worldCode,
}) {
    if (typeof worldCode !== 'string' || !worldCode.startsWith('HXW1.')) {
        throw new Error('buildPostKit requires a HXW1. world code');
    }
    const lines = [
        '── HexLife post kit ──',
        `Title: ${(title || 'HexLife').trim() || 'HexLife'}`,
        '',
    ];
    const desc = typeof description === 'string' ? description.trim() : '';
    if (desc) {
        lines.push(desc, '');
    }
    const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
    if (tagList.length > 0) {
        lines.push(`Tags: ${tagList.map((t) => tagLabel(t)).join(', ')}`);
    }
    if (explorerUrl) {
        lines.push(`Explorer: ${explorerUrl}`);
    }
    if (icLabel) {
        lines.push(`IC: ${icLabel}`);
    }
    lines.push(
        '',
        '── World code (paste ONLY this line into New HexLife post) ──',
        worldCode.trim(),
    );
    return lines.join('\n');
}

/**
 * Byte size of a code for toast copy.
 * @param {string} code
 * @returns {string}
 */
export function formatCodeSize(code) {
    return `${((code?.length || 0) / 1024).toFixed(1)} KB`;
}

/**
 * Pick a generator for a library entry: paired density/clusters IC, else default sparse fill.
 * @param {LibraryEntryLike|null|undefined} entry
 * @returns {{ generator: { mode: string, params: Record<string, unknown> }, icLabel: string, usedDefaultIc: boolean }}
 */
export function generatorFromLibraryEntry(entry) {
    const is = entry?.initialState;
    if (is && (is.mode === 'density' || is.mode === 'clusters')) {
        return {
            generator: {
                mode: is.mode,
                params: is.params && typeof is.params === 'object' ? { ...is.params } : {},
            },
            icLabel: icLabelForState(is),
            usedDefaultIc: false,
        };
    }
    return {
        generator: {
            mode: DEFAULT_SHOWCASE_GENERATOR.mode,
            params: { ...DEFAULT_SHOWCASE_GENERATOR.params },
        },
        icLabel: is?.mode
            ? `${icLabelForState(is)} → default sparse fill`
            : 'default sparse fill (12%)',
        usedDefaultIc: true,
    };
}

/**
 * Encode a Live Specimen world code from a personal-library entry (ruleset + IC recipe).
 *
 * @param {LibraryEntryLike|null|undefined} entry Library ruleset (`hex`, optional `initialState`)
 * @param {{
 *   rows: number,
 *   cols: number,
 *   colorSettings: object,
 *   speed?: number,
 *   brushSize?: number,
 * }} opts
 * @returns {Promise<{ code: string, icLabel: string, usedDefaultIc: boolean }|null>}
 */
export async function encodeWorldCodeFromLibraryEntry(entry, {
    rows, cols, colorSettings, speed = 40, brushSize = 2,
}) {
    if (!entry?.hex || !colorSettings) return null;
    const { generator, icLabel, usedDefaultIc } = generatorFromLibraryEntry(entry);
    const code = await encodeWorldCode({
        rows,
        cols,
        rulesetHex: entry.hex,
        generator,
        colorSettings,
        speed,
        brushSize,
    });
    if (!code) return null;
    return { code, icLabel, usedDefaultIc };
}

/**
 * Full post kit for a library entry once a world code is known.
 * @param {LibraryEntryLike|null|undefined} entry
 * @param {string} worldCode
 * @param {{ rows?: number, origin?: string }} [urlOpts]
 * @returns {{ title: string, kit: string, explorerUrl: string, icLabel: string }}
 */
export function postKitFromLibraryEntry(entry, worldCode, urlOpts = {}) {
    const tags = Array.isArray(entry?.tags) ? entry.tags : [];
    const title = buildPostTitle({ name: entry?.name, tags });
    const { icLabel } = generatorFromLibraryEntry(entry);
    const explorerUrl = entry?.hex
        ? explorerUrlForRuleset(entry.hex, {
            rows: urlOpts.rows,
            origin: urlOpts.origin,
        })
        : '';
    const kit = buildPostKit({
        title,
        description: entry?.description || '',
        tags,
        explorerUrl,
        icLabel,
        worldCode,
    });
    return { title, kit, explorerUrl, icLabel };
}

/**
 * Toast lines after opening r/hexlife (success path).
 * @param {{ size: string, title: string, popupBlocked?: boolean }} opts
 * @returns {{ message: string, type: 'success'|'error' }}
 */
export function redditHandoffToast({ size, title, popupBlocked = false }) {
    const shortTitle = (title || 'HexLife').slice(0, 60);
    if (popupBlocked) {
        return {
            message: `Post kit ready (${size}) — open ${REDDIT_SUB_NAME}, then ⋯ → New HexLife post. Paste only the HXW1. line. Title: “${shortTitle}”`,
            type: 'error',
        };
    }
    return {
        message: `Post kit copied (${size}). On ${REDDIT_SUB_NAME}: ⋯ → New HexLife post → paste only the HXW1. line. Title: “${shortTitle}”`,
        type: 'success',
    };
}
