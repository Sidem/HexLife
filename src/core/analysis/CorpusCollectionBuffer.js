// @ts-check

import { CORPUS_PROTOCOL, countsTowardCoverage } from './corpusProtocol.js';

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

export class CorpusCollectionBuffer {
    /** @param {{sessionId: string, createdAt: string, appVersion?: string}} meta */
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
        /** Clip counts per `add` call, so one misjudgment can be taken back. */
        /** @type {number[]} */
        this.groupSizes = [];
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
        let added = 0;
        for (const clip of clips || []) {
            if (!clip?.bytes?.length) continue;
            this.clips.push(clip);
            this.totalBytes += clip.bytes.length;
            added++;
        }
        this.groupSizes.push(added);
        return this.clips.length;
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
        const size = this.groupSizes.pop();
        if (!size) return 0;
        if (size > this.clips.length) {
            // The group straddled a flush; its clips are already written out.
            this.groupSizes.push(size);
            return 0;
        }
        const removed = this.clips.splice(this.clips.length - size, size);
        for (const clip of removed) this.totalBytes -= clip.bytes.length;
        return removed.length;
    }

    /** Whether {@link undoLast} would remove anything. */
    get canUndo() {
        const last = this.groupSizes[this.groupSizes.length - 1];
        return !!last && last <= this.clips.length;
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
     * Per-label, per-scenario, per-symmetry-class, and per-grid-preset counts for the live coverage
     * readout. Only coverage-eligible scenarios are counted as such — `unknown` clips are tracked
     * separately so the UI can show what the strict audit will ignore.
     */
    coverage() {
        /** @param {string} field */
        const tally = (field) => {
            /** @type {Record<string, number>} */
            const counts = {};
            for (const clip of this.clips) {
                const key = String(clip.header?.[field] ?? 'unknown');
                counts[key] = (counts[key] || 0) + 1;
            }
            return counts;
        };
        const seedsByRuleset = new Map();
        const icsByRuleset = new Map();
        for (const clip of this.clips) {
            const ruleset = String(clip.header?.ruleset || '');
            if (!seedsByRuleset.has(ruleset)) seedsByRuleset.set(ruleset, new Set());
            if (!icsByRuleset.has(ruleset)) icsByRuleset.set(ruleset, new Set());
            seedsByRuleset.get(ruleset).add(String(clip.header?.seedId ?? 'unknown'));
            icsByRuleset.get(ruleset).add(String(clip.header?.initialConditionId ?? 'unknown'));
        }
        return {
            clips: this.clips.length,
            families: this.families.size,
            labels: tally('label'),
            scenarios: tally('scenario'),
            symmetryClasses: tally('symmetryClass'),
            gridPresets: tally('gridPreset'),
            coverageEligibleClips: this.clips.filter((c) => countsTowardCoverage(c.header?.scenario)).length,
            // The audit's per-ruleset minimums are 3 seeds and 2 initial conditions.
            rulesetsWithThreeSeeds: [...seedsByRuleset.values()].filter((set) => set.size >= 3).length,
            rulesetsWithTwoInitialConditions: [...icsByRuleset.values()].filter((set) => set.size >= 2).length,
            distinctRulesets: seedsByRuleset.size,
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
            coverage: this.coverage(),
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
     * Drop the buffered clip payloads after they have been written out, keeping the family registry
     * and lifetime counts so later parts stay consistent with earlier ones.
     */
    markFlushed() {
        this.flushedClipCount += this.clips.length;
        this.clips = [];
        this.totalBytes = 0;
        this.groupSizes = [];
    }
}
