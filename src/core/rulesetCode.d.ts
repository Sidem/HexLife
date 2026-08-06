/**
 * Type declarations for `rulesetCode.js` — constraint-aware short ruleset codes.
 *
 * The app type-checks that module's JSDoc in place; this file exists for hosts that build with
 * `allowJs: false` and reach these through `@hexlife/embed/api`. Keep it in step with the JSDoc next
 * door; `tests/rulesetCode.test.js` pins the behavior.
 */

import type {ConstraintClass} from './rulesetDescriptor.js'

/** Per-tag wire format. `slots` maps each of the 128 rule indices to a payload bit, MSB-first. */
export const RULESET_CODE_SPEC: Readonly<
  Record<string, {constraintClass: ConstraintClass; bits: number; chars: number; slots: Uint8Array}>
>

/** Matches any well-formed ruleset code (shape only — {@link isRulesetCode} is the real validator). */
export const RULESET_CODE_PATTERN: RegExp

/** Normalize an exact 128-bit ruleset hex, or return null. Short codes are not accepted. */
export function normalizeRulesetHex(value: unknown): string | null

/**
 * The canonical shortest code for a ruleset — always the strictest class its table satisfies, so a
 * ruleset has exactly one code. Rules with no structure keep the 32-char hex.
 * @returns The code, or null when `source` is not a valid ruleset.
 */
export function rulesetToCode(source: string | Uint8Array): string | null

/**
 * Decode any ruleset code — tagged short code (`T21`, `N080C`, `M…`, `R…`) or 32-char hex — into a
 * 128-entry rule table. Null when the code is not well-formed.
 */
export function codeToRuleset(code: string): Uint8Array | null

/** Decode a ruleset code to the canonical 32-char hex — the identity format. */
export function codeToHex(code: string): string | null

/** Whether a string is a well-formed ruleset code (short or full hex), payload range included. */
export function isRulesetCode(code: string): boolean

export type RulesetInputFormat = 'hex' | 'code' | 'notation'

/**
 * Parse anything a user might paste into a ruleset field: 32-char hex, a tagged short code, or
 * `B…/S…` notation. Null when none of the three grammars match.
 */
export function parseRulesetInput(
  text: string,
): {hex: string; rules: Uint8Array; format: RulesetInputFormat} | null
