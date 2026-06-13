// @ts-check
/**
 * A fixed-capacity ring of recent simulation-state snapshots, used for the "scrub-back" transport
 * (step backward a few hundred ticks to see "what just happened?"). It is the state-side counterpart
 * to the existing ruleset history.
 *
 * The ring stores opaque frame objects (the worker packs binary state + rule indices + tick +
 * active-count into them — see {@link module:WorldWorker captureHistoryFrame}); this class is pure
 * index/capacity math and holds no engine references, so it is unit-testable in isolation.
 *
 * Frames are ordered oldest → newest; the NEWEST frame (the "tip") is at the end. Scrub positions are
 * expressed as an OFFSET from the tip: offset 0 is the tip (live present), larger offsets reach
 * further into the past.
 *
 * @template T
 */
export class StateHistoryRing {
    /** @param {number} capacity Max frames retained; older frames are evicted on overflow. */
    constructor(capacity) {
        this.capacity = Math.max(1, Math.floor(capacity) || 1);
        /** @type {T[]} */
        this.frames = [];
    }

    /** Number of frames currently retained. */
    get length() {
        return this.frames.length;
    }

    /** Drop all frames. */
    clear() {
        this.frames.length = 0;
    }

    /**
     * Append a frame as the new tip, evicting the oldest frame once over capacity.
     * @param {T} frame
     */
    push(frame) {
        this.frames.push(frame);
        if (this.frames.length > this.capacity) {
            this.frames.shift();
        }
    }

    /**
     * Frame at `offset` ticks back from the tip (0 = newest), or null when out of range / empty.
     * @param {number} offset
     * @returns {T|null}
     */
    at(offset) {
        const idx = this.frames.length - 1 - offset;
        return (idx >= 0 && idx < this.frames.length) ? this.frames[idx] : null;
    }

    /**
     * Clamp an arbitrary (possibly fractional/out-of-range) offset to a valid tip-relative index.
     * Empty ring clamps to 0.
     * @param {number} offset
     * @returns {number}
     */
    clampOffset(offset) {
        if (this.frames.length === 0) return 0;
        const rounded = Math.round(offset) || 0;
        return Math.max(0, Math.min(this.frames.length - 1, rounded));
    }

    /**
     * Drop every frame newer than the one at `offset`, making it the new tip. Used when the user
     * scrubs back and then resumes/edits: the "future" beyond the scrub point is discarded so the
     * ring stays consistent with the live state the simulation will continue from. offset 0 is a
     * no-op (already at the tip); an out-of-range offset is clamped first.
     * @param {number} offset
     */
    truncateToOffset(offset) {
        const o = this.clampOffset(offset);
        if (o <= 0) return;
        this.frames.length = this.frames.length - o;
    }
}
