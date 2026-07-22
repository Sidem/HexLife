// Pure classification of a world's state from already-computed per-world stats.
// Shared by the 3×3 minimap status badges (terminal states only — null when a world
// is still evolving, so no badge shows) and the top-bar status chip (which also names
// the actively-evolving case in plain language).

/**
 * Classify a world's terminal state from its stats. Extinct/saturated take precedence
 * over cycling (a period-1 cycle at ratio 0/1 is really just dead/full). Returns null
 * for an actively-evolving world (so the minimap shows no badge).
 * @param {{ratio?:number, isInCycle?:boolean, cycleLength?:number}|null|undefined} stats
 * @returns {{type:string, label:string, title:string}|null}
 */
export function computeWorldStatus(stats) {
    if (!stats) return null;
    if (stats.ratio <= 0) {
        return { type: 'extinct', label: '✕', title: 'Extinct — all cells dead' };
    }
    if (stats.ratio >= 1) {
        return { type: 'saturated', label: '■', title: 'Saturated — all cells alive' };
    }
    if (stats.isInCycle) {
        const period = stats.cycleLength || 0;
        return { type: 'cycling', label: `↻${period}`, title: `Stable cycle — period ${period}` };
    }
    return null;
}

/**
 * Plain-language status word for the selected world's top-bar chip. Unlike
 * computeWorldStatus (which returns null for an evolving world), this always names a
 * state — including the active case — so the chip is never blank for a live world.
 *
 * `isPaused` gates ONLY the non-terminal case. The terminal words describe the world
 * itself ("Died out" / "Full" / "Cycling ↻N") and stay true with the clock stopped, but
 * "Active" is a claim about motion — asserting it at tick 0 contradicts the app's own
 * onboarding ("Time is currently frozen"), so a paused non-terminal world reads "Paused".
 * @param {{ratio?:number, isInCycle?:boolean, cycleLength?:number}|null|undefined} stats
 * @param {boolean} [isPaused=false] Whether the simulation clock is stopped.
 * @returns {{type:string, word:string, title:string}}
 */
export function computeStatusWord(stats, isPaused = false) {
    if (!stats || stats.ratio === undefined) {
        return { type: 'unknown', word: '—', title: 'No data yet' };
    }
    const terminal = computeWorldStatus(stats);
    if (terminal) {
        switch (terminal.type) {
            case 'extinct': return { type: 'extinct', word: 'Died out', title: terminal.title };
            case 'saturated': return { type: 'saturated', word: 'Full', title: terminal.title };
            case 'cycling': return { type: 'cycling', word: `Cycling ${terminal.label}`, title: terminal.title };
        }
    }
    if (isPaused) {
        return { type: 'paused', word: 'Paused', title: 'Time is frozen — press Play to run the simulation' };
    }
    return { type: 'active', word: 'Active', title: 'Evolving — cells are changing each tick' };
}
