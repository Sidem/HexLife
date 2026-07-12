import { describe, it, expect } from 'vitest';
import {
    ARCHIVE_CONFIG,
    descriptorFor,
    BehaviorArchive,
} from '../src/core/analysis/BehaviorArchive.js';
import { hammingDistanceHex } from '../src/utils/utils.js';

// Helper: build a BehaviorMetrics-shaped object.
function metrics(finalRatio, blockEntropyMean, sigma) {
    return { finalRatio, blockEntropy: { mean: blockEntropyMean }, sigma };
}

// Helper: a full archive entry (hex + score + metrics).
function entry(hex, score, m) {
    return { hex, score, metrics: m };
}

describe('descriptorFor', () => {
    it('quantizes ratio and entropy into 0.1-wide bins', () => {
        const d = descriptorFor(metrics(0.34, 0.57, 1.0));
        expect(d.ratioBin).toBe(3);
        expect(d.entropyBin).toBe(5);
    });

    it('clamps ratio/entropy of exactly 1 into the last bin (no overflow)', () => {
        const d = descriptorFor(metrics(1.0, 1.0, 1.0));
        expect(d.ratioBin).toBe(9);
        expect(d.entropyBin).toBe(9);
    });

    it('clamps out-of-range / non-finite values to bin 0', () => {
        const d = descriptorFor(metrics(-0.5, NaN, 1.0));
        expect(d.ratioBin).toBe(0);
        expect(d.entropyBin).toBe(0);
    });

    it('bands sigma: 0 healed, null no-probe, ∞ high, and the numbered interior bands', () => {
        expect(descriptorFor(metrics(0.3, 0.4, 0)).sigmaBand).toBe('0');
        expect(descriptorFor(metrics(0.3, 0.4, null)).sigmaBand).toBe('n');
        expect(descriptorFor(metrics(0.3, 0.4, Infinity)).sigmaBand).toBe('hi');
        // sigmaBands = [0.5, 0.8, 1.25, 2.0]
        expect(descriptorFor(metrics(0.3, 0.4, 0.3)).sigmaBand).toBe('b0'); // < 0.5
        expect(descriptorFor(metrics(0.3, 0.4, 0.7)).sigmaBand).toBe('b1'); // < 0.8
        expect(descriptorFor(metrics(0.3, 0.4, 1.0)).sigmaBand).toBe('b2'); // < 1.25 (near-critical)
        expect(descriptorFor(metrics(0.3, 0.4, 1.6)).sigmaBand).toBe('b3'); // < 2.0
        expect(descriptorFor(metrics(0.3, 0.4, 3.0)).sigmaBand).toBe('hi'); // >= 2.0
    });

    it('produces a stable composite cellKey', () => {
        const d = descriptorFor(metrics(0.34, 0.57, 1.0));
        expect(d.cellKey).toBe('3|5|b2');
    });
});

describe('BehaviorArchive insertion', () => {
    it('fills an empty cell (added)', () => {
        const a = new BehaviorArchive();
        const res = a.tryInsert(entry('aa', 0.5, metrics(0.3, 0.4, 1.0)));
        expect(res.added).toBe(true);
        expect(res.improved).toBe(false);
        expect(a.size).toBe(1);
    });

    it('replaces an occupied cell only with a higher score (improved)', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('lo', 0.5, metrics(0.3, 0.4, 1.0)));
        const better = a.tryInsert(entry('hi', 0.7, metrics(0.31, 0.41, 1.0))); // same cell
        expect(better.improved).toBe(true);
        expect(a.size).toBe(1);
        expect(a.getEntries()[0].hex).toBe('hi');
    });

    it('rejects a lower-or-equal score in an occupied cell', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('keep', 0.7, metrics(0.3, 0.4, 1.0)));
        const worse = a.tryInsert(entry('drop', 0.6, metrics(0.32, 0.42, 1.0)));
        expect(worse.added).toBe(false);
        expect(worse.improved).toBe(false);
        expect(a.getEntries()[0].hex).toBe('keep');
    });

    it('keeps distinct behaviors in distinct cells', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('x', 0.5, metrics(0.1, 0.2, 1.0)));
        a.tryInsert(entry('y', 0.5, metrics(0.8, 0.6, 0.3)));
        expect(a.size).toBe(2);
    });

    it('stamps the resolved cellKey onto the stored entry', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('x', 0.5, metrics(0.34, 0.57, 1.0)));
        expect(a.getEntries()[0].cellKey).toBe('3|5|b2');
    });
});

describe('BehaviorArchive updateEntry (v2.7 re-test)', () => {
    it('patches an existing entry in place and re-sorts by the new score', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('aa', 0.8, metrics(0.1, 0.2, 1.0)));
        a.tryInsert(entry('bb', 0.5, metrics(0.8, 0.6, 0.3)));
        expect(a.getEntries()[0].hex).toBe('aa');

        const ok = a.updateEntry('aa', { score: 0.2, cyclic: 84 });
        expect(ok).toBe(true);
        // re-sorted: bb (0.5) now outranks the re-scored aa (0.2)
        expect(a.getEntries().map(e => e.hex)).toEqual(['bb', 'aa']);
        const aa = a.getEntries().find(e => e.hex === 'aa');
        expect(aa.score).toBe(0.2);
        expect(aa.cyclic).toBe(84);
    });

    it('returns false when no entry matches the hex', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('aa', 0.8, metrics(0.1, 0.2, 1.0)));
        expect(a.updateEntry('zz', { score: 0.1 })).toBe(false);
    });
});

describe('BehaviorArchive novelty pressure', () => {
    it('returns 1 for an empty cell and the penalty for an occupied-better cell', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        expect(a.noveltyMultiplier(m, 0.5)).toBe(1); // empty
        a.tryInsert(entry('occupy', 0.7, m));
        expect(a.noveltyMultiplier(m, 0.5)).toBe(ARCHIVE_CONFIG.occupiedNoveltyMultiplier); // occupied by better
    });

    it('does NOT penalize a candidate that would beat the incumbent', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        a.tryInsert(entry('weak', 0.4, m));
        // A stronger candidate in the same cell should still be considered novel (it'll improve the cell).
        expect(a.noveltyMultiplier(m, 0.9)).toBe(1);
    });
});

describe('BehaviorArchive novelty self-exemption (F3)', () => {
    const H1 = '00000000000000000000000000000000';
    const H2 = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
    it('does NOT penalize a candidate against its own archived entry (same hex)', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        a.tryInsert(entry(H1, 0.7, m));
        // Same hex, noisier lower re-score: the incumbent IS this candidate → no penalty.
        expect(a.noveltyMultiplier(m, 0.5, H1)).toBe(1);
    });
    it('still penalizes a DIFFERENT hex landing in the same occupied-better cell', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        a.tryInsert(entry(H1, 0.7, m));
        expect(a.noveltyMultiplier(m, 0.5, H2)).toBe(ARCHIVE_CONFIG.occupiedNoveltyMultiplier);
    });
    it('without a hex argument keeps the legacy (always-penalize) behavior', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        a.tryInsert(entry(H1, 0.7, m));
        expect(a.noveltyMultiplier(m, 0.5)).toBe(ARCHIVE_CONFIG.occupiedNoveltyMultiplier);
    });
});

describe('BehaviorArchive family dedupe (F5)', () => {
    const BASE = '0000000000000000000000000000000F'; // last nibble 1111
    const SIB = '00000000000000000000000000000007'; // 0111 → 1 bit from BASE (< familyMinHamming 6)
    const FAR = '00000000000000000000000000000030'; // BASE^FAR over last two nibbles = 0x3,0xF → 6 bits

    it('rejects a near-identical sibling that does not out-score the family incumbent', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry(BASE, 0.7, metrics(0.3, 0.4, 1.0)));
        const res = a.tryInsert(entry(SIB, 0.5, metrics(0.8, 0.6, 0.3))); // different cell, same family
        expect(res.rejectedBy).toBe('family');
        expect(res.added).toBe(false);
        expect(a.size).toBe(1);
        expect(a.getEntries()[0].hex).toBe(BASE);
    });

    it('a better sibling REPLACES the incumbent: old cell vacated, new entry in its own cell', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry(BASE, 0.5, metrics(0.3, 0.4, 1.0))); // cell A
        const res = a.tryInsert(entry(SIB, 0.8, metrics(0.8, 0.6, 0.3))); // family, higher, cell B
        expect(res.added).toBe(true);
        expect(a.size).toBe(1); // family stays a single entry
        expect(a.getEntries()[0].hex).toBe(SIB);
    });

    it('does NOT dedupe a candidate exactly at the family threshold distance', () => {
        const a = new BehaviorArchive();
        expect(hammingDistanceHex(BASE, FAR)).toBe(ARCHIVE_CONFIG.familyMinHamming); // == 6, not < 6
        a.tryInsert(entry(BASE, 0.5, metrics(0.1, 0.2, 1.0)));
        const res = a.tryInsert(entry(FAR, 0.5, metrics(0.8, 0.6, 0.3))); // distinct cell, not a family
        expect(res.added).toBe(true);
        expect(a.size).toBe(2);
    });
});

describe('BehaviorArchive embedding-first descriptor (v3.2, roadmap #3)', () => {
    it('cellKeyOverride banks look-different-but-stats-alike finds in DISTINCT cells', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0); // identical stats ⇒ same statistical cell
        a.tryInsert({ hex: 'aa', score: 0.5, metrics: m, descriptorKind: 'embedding' }, { cellKeyOverride: 'e:1010' });
        a.tryInsert({ hex: 'bb', score: 0.6, metrics: m, descriptorKind: 'embedding' }, { cellKeyOverride: 'e:0101' });
        // Without the override these two would collide onto one statistical cell; the perceptual keys split them.
        expect(a.size).toBe(2);
        expect(a.getEntries().map(e => e.cellKey).sort()).toEqual(['e:0101', 'e:1010']);
    });

    it('stamps the override cellKey and keeps best-per-cell within an override cell', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        a.tryInsert({ hex: 'lo', score: 0.4, metrics: m, descriptorKind: 'embedding' }, { cellKeyOverride: 'e:1111' });
        const better = a.tryInsert({ hex: 'hi', score: 0.9, metrics: metrics(0.9, 0.9, 0.3), descriptorKind: 'embedding' }, { cellKeyOverride: 'e:1111' });
        expect(better.improved).toBe(true);
        expect(a.size).toBe(1);
        expect(a.getEntries()[0].hex).toBe('hi');
        expect(a.getEntries()[0].cellKey).toBe('e:1111');
    });

    it('noveltyMultiplier honours the perceptual cell override', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        a.tryInsert({ hex: 'occupy', score: 0.7, metrics: m, descriptorKind: 'embedding' }, { cellKeyOverride: 'e:1010' });
        // Same perceptual cell, weaker score ⇒ penalized; a DIFFERENT perceptual cell ⇒ novel (1).
        expect(a.noveltyMultiplier(m, 0.5, 'x', 'e:1010')).toBe(ARCHIVE_CONFIG.occupiedNoveltyMultiplier);
        expect(a.noveltyMultiplier(m, 0.5, 'x', 'e:0101')).toBe(1);
    });

    it('embeddings-OFF path (no override) is unchanged: statistical cell is used', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.34, 0.57, 1.0);
        a.tryInsert({ hex: 'x', score: 0.5, metrics: m });
        expect(a.getEntries()[0].cellKey).toBe('3|5|b2'); // the statistical descriptor, exactly as before
    });

    it('round-trips embedding-keyed entries: the opaque cellKey is preserved on reload', () => {
        const a = new BehaviorArchive();
        a.loadEntries([
            { hex: 'aa', score: 0.5, cellKey: 'e:1010', descriptorKind: 'embedding', metrics: metrics(0.3, 0.4, 1.0) },
            { hex: 'bb', score: 0.6, cellKey: 'e:0101', descriptorKind: 'embedding', metrics: metrics(0.3, 0.4, 1.0) },
            // A legacy (stats) entry alongside them re-derives its key normally.
            { hex: 'cc', score: 0.7, metrics: metrics(0.34, 0.57, 1.0) },
        ]);
        expect(a.size).toBe(3);
        const byHex = Object.fromEntries(a.getEntries().map(e => [e.hex, e.cellKey]));
        expect(byHex.aa).toBe('e:1010'); // preserved verbatim (not recomputed from stats)
        expect(byHex.bb).toBe('e:0101');
        expect(byHex.cc).toBe('3|5|b2'); // stats entry re-derived
    });

    it('reload keeps the best per embedding cell (self-heals a duplicated dump)', () => {
        const a = new BehaviorArchive();
        a.loadEntries([
            { hex: 'lo', score: 0.4, cellKey: 'e:1111', descriptorKind: 'embedding', metrics: metrics(0.3, 0.4, 1.0) },
            { hex: 'hi', score: 0.8, cellKey: 'e:1111', descriptorKind: 'embedding', metrics: metrics(0.3, 0.4, 1.0) },
        ]);
        expect(a.size).toBe(1);
        expect(a.getEntries()[0].hex).toBe('hi');
    });
});

describe('BehaviorArchive persistence round-trip', () => {
    it('loadEntries rebuilds cells and self-heals duplicates (best per cell wins)', () => {
        const a = new BehaviorArchive();
        const m = metrics(0.3, 0.4, 1.0);
        a.loadEntries([
            entry('lo', 0.4, m),
            entry('hi', 0.8, { ...m, finalRatio: 0.31 }), // same cell, higher score
            entry('other', 0.5, metrics(0.9, 0.1, 0)),
        ]);
        expect(a.size).toBe(2);
        const hexes = a.getEntries().map(e => e.hex);
        expect(hexes).toContain('hi');
        expect(hexes).toContain('other');
        expect(hexes).not.toContain('lo');
    });

    it('getEntries is sorted best-score-first', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('mid', 0.5, metrics(0.1, 0.1, 1.0)));
        a.tryInsert(entry('top', 0.9, metrics(0.5, 0.5, 1.0)));
        a.tryInsert(entry('low', 0.2, metrics(0.9, 0.9, 1.0)));
        expect(a.getEntries().map(e => e.hex)).toEqual(['top', 'mid', 'low']);
    });

    it('clear empties the archive', () => {
        const a = new BehaviorArchive();
        a.tryInsert(entry('x', 0.5, metrics(0.3, 0.4, 1.0)));
        a.clear();
        expect(a.size).toBe(0);
    });

    it('ignores malformed entries on load', () => {
        const a = new BehaviorArchive();
        a.loadEntries([null, {}, { hex: 'ok', score: 0.5, metrics: metrics(0.3, 0.4, 1.0) }, { hex: 5 }]);
        expect(a.size).toBe(1);
    });
});
