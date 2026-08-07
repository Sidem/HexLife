/**
 * Ruleset ⇄ hex serialization, split out of `utils.js`.
 *
 * A ruleset is 128 rules (center state + 6-neighbor mask) serialized as a 32-char hex string — the
 * app's primary identity/interchange format (share links, the library, the embeddable widget).
 * Extracted so consumers that need *only* this codec — notably `src/embed/`, which must not pull
 * `utils.js` (34 KB, and it imports `config.js`) into its bundle — can import it standalone.
 * `utils.js` re-exports both functions, so app call sites are unaffected.
 */

/**
 * Converts a 128-element Uint8Array ruleset into a 32-character hex string.
 * @param {Uint8Array} rulesetArray The 128-element array of 0s and 1s.
 * @returns {string} The 32-character uppercase hex string, or "Error".
 */
export function rulesetToHex(rulesetArray) {
    if (!rulesetArray || rulesetArray.length !== 128) return "Error";
    let bin = "";
    for (let i = 0; i < 128; i++) {
        bin += rulesetArray[i];
    }
    try {
        return BigInt('0b' + bin).toString(16).toUpperCase().padStart(32, '0');
    }
    catch {
        return "Error";
    }
}

/**
 * The rule index of the **empty neighbourhood**: a dead centre cell with zero live neighbours.
 *
 * The engine indexes its table as `(centerState << 6) | neighbourMask`, so dead centre + empty mask
 * is index 0 — and because {@link hexToRuleset} lays the 128-bit big-endian hex out MSB-first, index
 * 0 is the **most significant bit of the first hex character**. That coincidence is load-bearing for
 * {@link isVacuumStable}, so it is named here rather than left as a literal at the call site.
 */
export const VACUUM_RULE_INDEX = 0;

/**
 * Whether empty space stays empty — the rule for `VACUUM_RULE_INDEX` outputs a dead cell.
 *
 * A rule that turns the empty neighbourhood live has no stable vacuum: every dead cell in a dead
 * region ignites on the same tick, so the world saturates from any starting state and nothing about
 * it is sparse. Exactly half of the 2^128 rulesets are vacuum-stable — those whose first hex
 * character is `0`–`7`.
 *
 * Hosts use this to decide whether a world can be *inhabited* rather than merely simulated: only a
 * vacuum-stable rule lets a placed structure read as an object in empty space instead of one more
 * perturbation of a churning soup. It is also the precondition for evaluating a world sparsely,
 * since a dead cell with six dead neighbours is then provably unchanged.
 *
 * @param {string|Uint8Array} source 32-char ruleset hex, or the 128-entry rule table.
 * @returns {boolean} false for anything that is not a well-formed ruleset — an unparseable input is
 *   not a world anyone should admit, so the safe answer and the honest one agree here.
 */
export function isVacuumStable(source) {
    if (typeof source === 'string') {
        // The first hex character carries rule indices 0-3; index 0 is its high bit, so `0`-`7`
        // (values below 8) are exactly the vacuum-stable half without parsing the other 31 chars.
        return /^[0-9a-fA-F]{32}$/.test(source) && parseInt(source[0], 16) < 8;
    }
    return source instanceof Uint8Array && source.length === 128 && source[VACUUM_RULE_INDEX] === 0;
}

/**
 * Converts a 32-character hex string into a 128-element Uint8Array ruleset.
 * @param {string} hexString The 32-character hex string.
 * @returns {Uint8Array} The 128-element Uint8Array. Returns a zeroed array on error.
 */
export function hexToRuleset(hexString) {
    const ruleset = new Uint8Array(128).fill(0);
    if (!hexString || !/^[0-9a-fA-F]{32}$/.test(hexString)) {
        return ruleset;
    }
    try {
        let bin = BigInt('0x' + hexString).toString(2).padStart(128, '0');
        for (let i = 0; i < 128; i++) {
            ruleset[i] = bin[i] === '1' ? 1 : 0;
        }
    } catch (e) {
        console.error("Error converting hex to ruleset:", hexString, e);
    }
    return ruleset;
}
