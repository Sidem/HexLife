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
