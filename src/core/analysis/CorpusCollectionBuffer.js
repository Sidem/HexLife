// @ts-check

import {
    CORPUS_COVERAGE,
    CORPUS_PROTOCOL,
    countsTowardCoverage,
} from './corpusProtocol.js';

/**
 * Session-scoped accumulator for Corpus v1 collection (#37 Stage 4B.2).
 *
 * The in-panel collector captured clips off *live* worlds at export time, which structurally caps a
 * session at one grid of judgments: every world you wanted in the ZIP had to still be running. This
 * buffer inverts that — the collector encodes clips the moment a world is judged and hands them here,
 * freeing the world for immediate recycling. A session can then run to hundreds of clips.
 *
 * Deliberately pure: it holds encoded bytes and headers, accounts for size, and builds the session
 * index and proposed family registry. ZIP writing and downloading stay with the capture service.
 *
 * **Coverage is cumulative, payloads are not.** A flush drops the buffered bytes so they can be
 * downloaded and forgotten, but the coverage tallies are running counters that survive it — and
 * {@link coverageSnapshot} serializes them so they also survive the page reload a grid-preset change
 * requires. Recomputing coverage from resident clips would make the readout and the scheduler forget
 * everything at the first auto-flush, which is exactly when a long session needs them most.
 *
 * **Splits are proposed, never decided.** `familyRegistry()` emits a suggestion that satisfies the
 * protocol's 6/2/2 family minimums; the owner registers families in `families-v1.json`, and a family
 * already registered there keeps its existing split. Trajectory headers never choose their own.
 */

/**
 * Split assignment cycle. Ten families fill the protocol's minimum 6 train / 2 validation / 2 test
 * exactly, and the ratio holds as more families arrive.
 */
const SPLIT_CYCLE = [
    'train', 'train', 'train', 'train', 'train', 'train',
    'validation', 'validation',
    'test', 'test',
];

export const DEFAULT_FLUSH_BYTES = 48 * 1024 * 1024;

/**
 * @typedef {object} BufferedClip
 * @property {string} filename
 * @property {Uint8Array} bytes
 * @property {Record<string, any>} header
 */

/**
 * @typedef {object} RulesetCoverage
 * @property {string} ruleset
 * @property {string} family
 * @property {number} clips
 * @property {number} seeds
 * @property {number} initialConditions
 * @property {string[]} seedIds
 * @property {string[]} initialConditionIds
 */

/** @param {Record<string, number>} counts @param {string} key @param {number} delta */
function bump(counts, key, delta) {
    const next = (counts[key] || 0) + delta;
    if (next > 0) counts[key] = next;
    else delete counts[key];
}

/** @param {Map<string, number>} counts @param {string} key @param {number} delta */
function bumpMap(counts, key, delta) {
    const next = (counts.get(key) || 0) + delta;
    if (next > 0) counts.set(key, next);
    else counts.delete(key);
}

/** @param {Record<string, number>|undefined} source */
function cloneCounts(source) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const [key, value] of Object.entries(source || {})) {
        if (Number(value) > 0) counts[key] = Number(value);
    }
    return counts;
}

/** @param {Map<string, number>} counts */
function countsToObject(counts) {
    /** @type {Record<string, number>} */
    const object = {};
    for (const [key, value] of counts) object[key] = value;
    return object;
}

export class CorpusCollectionBuffer {
    /**
     * @param {{
     *   sessionId: string,
     *   createdAt: string,
     *   appVersion?: string,
     *   priorCoverage?: ReturnType<CorpusCollectionBuffer['coverageSnapshot']>|null,
     * }} meta
     */
    constructor(meta) {
        if (!meta?.sessionId) throw new Error('CorpusCollectionBuffer requires a sessionId.');
        this.sessionId = String(meta.sessionId);
        this.createdAt = String(meta.createdAt || '');
        this.appVersion = String(meta.appVersion || '');
        /** @type {BufferedClip[]} */
        this.clips = [];
        /** Insertion-ordered family metadata; order determines the proposed split cycle. */
        /** @type {Map<string, {anchorRuleset: string, relationship: string}>} */
        this.families = new Map();
        this.totalBytes = 0;
        /** Clips dropped by a flush, so the index can never silently understate what was collected. */
        this.flushedClipCount = 0;
        /** Headers per `add` call, so one misjudgment can be taken back tally-for-tally. */
        /** @type {Array<Record<string, any>[]>} */
        this.groups = [];

        /**
         * Running, flush-surviving tallies.
         * @type {Record<string, Record<string, number>>}
         */
        this.tallies = {
            labels: {},
            scenarios: {},
            symmetryClasses: {},
            gridPresets: {},
            // `${symmetryClass}|${label}` — the cell the auditor's requireBothLabelsPerSymmetryClass
            // check actually reads. A per-class total can look healthy with one label missing.
            symmetryLabels: {},
        };
        this.countedClips = 0;
        this.eligibleClips = 0;
        /** @type {Map<string, {family: string, clips: number, seeds: Map<string, number>, ics: Map<string, number>}>} */
        this.rulesets = new Map();

        this._restore(meta.priorCoverage);
    }

    /**
     * Adopt tallies carried over from an earlier page load of the same session.
     *
     * Families are restored in their original order because the proposed split cycle is positional:
     * renumbering them after a reload would hand part 2 a different split proposal than part 1.
     *
     * @param {ReturnType<CorpusCollectionBuffer['coverageSnapshot']>|null|undefined} snapshot
     */
    _restore(snapshot) {
        if (!snapshot) return;
        // Driven from the snapshot's own keys, and filtered against the ones this version knows, so a
        // snapshot written by an older build restores what it can instead of throwing.
        for (const [key, counts] of Object.entries(snapshot.tallies || {})) {
            if (key in this.tallies) this.tallies[key] = cloneCounts(counts);
        }
        this.countedClips = Math.max(0, Math.trunc(Number(snapshot.countedClips) || 0));
        this.eligibleClips = Math.max(0, Math.trunc(Number(snapshot.eligibleClips) || 0));
        this.flushedClipCount = this.countedClips;
        for (const entry of snapshot.families || []) {
            if (!entry?.id) continue;
            this.families.set(String(entry.id), {
                anchorRuleset: String(entry.anchorRuleset || ''),
                relationship: String(entry.relationship || 'exact-ruleset'),
            });
        }
        for (const [ruleset, entry] of Object.entries(snapshot.rulesets || {})) {
            this.rulesets.set(ruleset, {
                family: String(entry?.family || ''),
                clips: Math.max(0, Math.trunc(Number(entry?.clips) || 0)),
                seeds: new Map(Object.entries(cloneCounts(entry?.seeds))),
                ics: new Map(Object.entries(cloneCounts(entry?.ics))),
            });
        }
    }

    /**
     * Add one judged world's clips.
     * @param {BufferedClip[]} clips
     * @param {{familyId: string, anchorRuleset: string, relationship: string}} lineage
     */
    add(clips, lineage) {
        if (!lineage?.familyId) throw new Error('Buffered clips need a familyId.');
        if (!this.families.has(lineage.familyId)) {
            this.families.set(lineage.familyId, {
                anchorRuleset: String(lineage.anchorRuleset || ''),
                relationship: String(lineage.relationship || 'exact-ruleset'),
            });
        }
        /** @type {Record<string, any>[]} */
        const added = [];
        for (const clip of clips || []) {
            if (!clip?.bytes?.length) continue;
            this.clips.push(clip);
            this.totalBytes += clip.bytes.length;
            this._tally(clip.header, 1);
            added.push(clip.header || {});
        }
        this.groups.push(added);
        return this.clips.length;
    }

    /**
     * Fold one clip header into (delta 1) or out of (delta -1) the running tallies.
     * @param {Record<string, any>|undefined} header
     * @param {1|-1} delta
     */
    _tally(header, delta) {
        const label = String(header?.label ?? 'unknown');
        const symmetryClass = String(header?.symmetryClass ?? 'unknown');
        bump(this.tallies.labels, label, delta);
        bump(this.tallies.scenarios, String(header?.scenario ?? 'unknown'), delta);
        bump(this.tallies.symmetryClasses, symmetryClass, delta);
        bump(this.tallies.gridPresets, String(header?.gridPreset ?? 'unknown'), delta);
        bump(this.tallies.symmetryLabels, `${symmetryClass}|${label}`, delta);
        this.countedClips += delta;
        if (countsTowardCoverage(header?.scenario)) this.eligibleClips += delta;

        const ruleset = String(header?.ruleset || '');
        let entry = this.rulesets.get(ruleset);
        if (!entry) {
            if (delta < 0) return;
            entry = { family: String(header?.family || ''), clips: 0, seeds: new Map(), ics: new Map() };
            this.rulesets.set(ruleset, entry);
        }
        entry.clips += delta;
        bumpMap(entry.seeds, String(header?.seedId ?? 'unknown'), delta);
        bumpMap(entry.ics, String(header?.initialConditionId ?? 'unknown'), delta);
        // A ruleset with no clips left is not in the corpus, so the auditor never checks it — and the
        // scheduler must not keep proposing revisits to pay off debt that no longer exists.
        if (entry.clips <= 0) this.rulesets.delete(ruleset);
    }

    /**
     * Take back the most recent {@link add} — a mis-keyed judgment during a fast pass.
     *
     * Only undoes groups still resident in the buffer: once a flush has written clips into a
     * downloaded ZIP they are out of reach, and pretending otherwise would desynchronize the index
     * parts. A family stays registered, because its split proposal may already have been emitted.
     *
     * @returns {number} Clips removed (0 when there is nothing undoable).
     */
    undoLast() {
        const group = this.groups.pop();
        if (!group?.length) return 0;
        if (group.length > this.clips.length) {
            // The group straddled a flush; its clips are already written out.
            this.groups.push(group);
            return 0;
        }
        const removed = this.clips.splice(this.clips.length - group.length, group.length);
        for (const clip of removed) this.totalBytes -= clip.bytes.length;
        for (const header of group) this._tally(header, -1);
        return removed.length;
    }

    /** Whether {@link undoLast} would remove anything. */
    get canUndo() {
        const last = this.groups[this.groups.length - 1];
        return !!last?.length && last.length <= this.clips.length;
    }

    get clipCount() {
        return this.clips.length;
    }

    /** Clips collected this session including ones already written out by an earlier flush. */
    get lifetimeClipCount() {
        return this.clips.length + this.flushedClipCount;
    }

    /** @param {number} [maxBytes] */
    shouldFlush(maxBytes = DEFAULT_FLUSH_BYTES) {
        return this.totalBytes >= maxBytes;
    }

    /**
     * Session-cumulative coverage: per-label, per-scenario, per-symmetry-class, per-grid-preset and
     * per-ruleset counts for the live readout and the round scheduler.
     *
     * Only coverage-eligible scenarios are counted as such — `unknown` clips are tracked separately so
     * the UI can show what the strict audit will ignore.
     */
    coverage() {
        /** @type {Record<string, Record<string, number>>} */
        const symmetryLabelCells = {};
        for (const [key, count] of Object.entries(this.tallies.symmetryLabels)) {
            const [symmetryClass, label] = key.split('|');
            symmetryLabelCells[symmetryClass] = symmetryLabelCells[symmetryClass] || {};
            symmetryLabelCells[symmetryClass][label] = count;
        }

        /** @type {RulesetCoverage[]} */
        const rulesets = [];
        /** @type {Record<string, string[]>} */
        const familyRulesets = {};
        for (const [ruleset, entry] of this.rulesets) {
            rulesets.push({
                ruleset,
                family: entry.family,
                clips: entry.clips,
                seeds: entry.seeds.size,
                initialConditions: entry.ics.size,
                // The scheduler excludes these when drawing a revisit's seed and initial condition:
                // a repeat draw writes a header that credits nothing toward either minimum.
                seedIds: [...entry.seeds.keys()],
                initialConditionIds: [...entry.ics.keys()],
            });
            (familyRulesets[entry.family] = familyRulesets[entry.family] || []).push(ruleset);
        }

        return {
            clips: this.countedClips,
            families: this.families.size,
            labels: { ...this.tallies.labels },
            scenarios: { ...this.tallies.scenarios },
            symmetryClasses: { ...this.tallies.symmetryClasses },
            gridPresets: { ...this.tallies.gridPresets },
            symmetryLabelCells,
            coverageEligibleClips: this.eligibleClips,
            rulesets,
            familyRulesets,
            distinctRulesets: this.rulesets.size,
            // The audit's per-ruleset minimums are 3 seeds and 2 initial conditions, applied to every
            // ruleset — these two are progress readouts, not quotas.
            rulesetsWithThreeSeeds: rulesets
                .filter((r) => r.seeds >= CORPUS_COVERAGE.minimumSeedsPerRuleset).length,
            rulesetsWithTwoInitialConditions: rulesets
                .filter((r) => r.initialConditions >= CORPUS_COVERAGE.minimumInitialConditionsPerRuleset).length,
        };
    }

    /**
     * The tallies in serializable form, so a grid-preset change — which the app can only apply through
     * a full page reload — does not restart coverage from zero. Payload bytes are deliberately absent:
     * they must be flushed to a ZIP before the reload, not carried through it.
     */
    coverageSnapshot() {
        /** @type {Record<string, {family: string, clips: number, seeds: Record<string, number>, ics: Record<string, number>}>} */
        const rulesets = {};
        for (const [ruleset, entry] of this.rulesets) {
            rulesets[ruleset] = {
                family: entry.family,
                clips: entry.clips,
                seeds: countsToObject(entry.seeds),
                ics: countsToObject(entry.ics),
            };
        }
        return {
            tallies: {
                labels: { ...this.tallies.labels },
                scenarios: { ...this.tallies.scenarios },
                symmetryClasses: { ...this.tallies.symmetryClasses },
                gridPresets: { ...this.tallies.gridPresets },
                symmetryLabels: { ...this.tallies.symmetryLabels },
            },
            countedClips: this.countedClips,
            eligibleClips: this.eligibleClips,
            families: [...this.families.entries()].map(([id, meta]) => ({ id, ...meta })),
            rulesets,
        };
    }

    /**
     * Proposed `families-v1.json` rows, in first-seen order.
     * @returns {Array<{id: string, split: string, anchorRuleset: string, relationship: string}>}
     */
    familyRegistry() {
        return [...this.families.entries()].map(([id, meta], index) => ({
            id,
            split: SPLIT_CYCLE[index % SPLIT_CYCLE.length],
            anchorRuleset: meta.anchorRuleset,
            relationship: meta.relationship,
        }));
    }

    /**
     * The session index written alongside the clips.
     * @param {{partIndex?: number, final?: boolean}} [options]
     */
    index(options = {}) {
        const coverage = this.coverage();
        return {
            schema: 'HXLT-CORPUS-SESSION-1',
            corpusProtocol: CORPUS_PROTOCOL,
            sessionId: this.sessionId,
            createdAt: this.createdAt,
            appVersion: this.appVersion,
            partIndex: Math.max(0, Math.trunc(Number(options.partIndex) || 0)),
            final: options.final !== false,
            clipCount: this.clips.length,
            sessionClipCount: this.lifetimeClipCount,
            totalPayloadBytes: this.totalBytes,
            // The per-ruleset seed/initial-condition *id lists* exist only to steer live scheduling;
            // the ZIP already carries every id in the clip rows below, so writing them twice would
            // only bloat the index.
            coverage: {
                ...coverage,
                rulesets: coverage.rulesets.map(
                    ({ seedIds: _seedIds, initialConditionIds: _icIds, ...rest }) => rest,
                ),
            },
            proposedFamilies: this.familyRegistry(),
            proposedFamiliesNote:
                'Proposed splits only. Register families in protocol/families-v1.json; a family already '
                + 'registered there keeps its existing split, which is immutable after the first training run.',
            clips: this.clips.map((clip) => ({
                filename: clip.filename,
                id: clip.header?.id,
                family: clip.header?.family,
                label: clip.header?.label,
                scenario: clip.header?.scenario,
                symmetryClass: clip.header?.symmetryClass,
                gridPreset: clip.header?.gridPreset,
                initialConditionId: clip.header?.initialConditionId,
                seed: clip.header?.seed,
                ruleset: clip.header?.ruleset,
                sourceTick: clip.header?.sourceTick,
                payloadCrc32: clip.header?.payloadCrc32,
            })),
        };
    }

    /**
     * Drop the buffered clip payloads after they have been written out, keeping the coverage tallies,
     * family registry and lifetime counts so later parts stay consistent with earlier ones.
     */
    markFlushed() {
        this.flushedClipCount += this.clips.length;
        this.clips = [];
        this.totalBytes = 0;
        this.groups = [];
    }
}
