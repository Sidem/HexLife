/**
 * Type declarations for `rulesetHex.js` — the ruleset ⇄ hex codec and the bit-order facts that
 * depend on it.
 *
 * The app type-checks that module's JSDoc in place; this file exists for hosts that build with
 * `allowJs: false` and reach these through `@hexlife/embed/api`. Keep it in step with the JSDoc next
 * door; `tests/rulesetVacuum.test.js` pins the vacuum predicate.
 */

/** Converts a 128-element ruleset table into a 32-character hex string, or `"Error"`. */
export function rulesetToHex(rulesetArray: Uint8Array): string

/** Converts a 32-character hex string into a 128-element rule table; zeroed on error. */
export function hexToRuleset(hexString: string): Uint8Array

/**
 * The rule index of the empty neighbourhood — dead centre, zero live neighbours. Index 0 under the
 * engine's `(centerState << 6) | neighbourMask` layout, which is the most significant bit of the
 * first hex character.
 */
export const VACUUM_RULE_INDEX: 0

/**
 * Whether empty space stays empty. False for anything that is not a well-formed ruleset.
 *
 * Vacuum-stable rulesets are exactly those whose first hex character is `0`–`7`.
 */
export function isVacuumStable(source: string | Uint8Array): boolean
