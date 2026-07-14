/**
 * The project's canonical seeded PRNG.
 *
 * **Determinism-critical.** Every seeded path in the app — world resets (`WorldWorker`), the
 * auto-explore trajectory (`AutoExploreService`), the embedding archive's random projection, and
 * the initial-state preview — draws from this one generator. Identical `(seed, draw-order)` must
 * yield an identical sequence forever: share links, explore-search replays, the Daily Hex, and the
 * embeddable widget (`src/embed/`) all reproduce runs on other machines by re-seeding it. Changing
 * the arithmetic here silently invalidates every one of those.
 *
 * Previously copy-pasted into four modules; unified 2026-07-14 (all four copies were arithmetically
 * identical, so unification changed no output).
 *
 * @param {number} a Seed. Truncated to int32 internally, so any integer is acceptable.
 * @returns {() => number} next() → float in [0, 1)
 */
export function mulberry32(a) {
    return function next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
