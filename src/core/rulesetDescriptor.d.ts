/**
 * Type declarations for `rulesetDescriptor.js`.
 *
 * The app itself type-checks the JSDoc in place via `// @ts-check`; this file exists for the
 * **Devvit app** (`devvit/`), whose TypeScript build imports the classifier across the repo
 * boundary (ruleset identity comment + in-post rule card) and does not enable `allowJs`.
 * Keep it in step with the JSDoc next door; `tests/rulesetDescriptor.test.js` pins the behavior.
 */

/** Canonical orbit representative (6-bit mask) → notation label ('2o', "3m'", …), display order. */
export const ORBIT_LABELS: Map<number, string>

export type RulesetDescription = {
  /** 32-char uppercase hex. */
  hex: string
  /**
   * `n-count`: uniform per neighbor count (plain B/S digits). `r-sym`: uniform per rotation
   * orbit (o/m/p arrangement suffixes). `raw`: at least one orbit mixed — no compact notation.
   */
  type: 'n-count' | 'r-sym' | 'raw'
  /** `B2/S35`, `B2o3p/S2`, … — null for `raw` rules. */
  notation: string | null
  /** Active birth labels (dead center), count-collapsed; empty for `raw`. */
  birth: string[]
  /** Active survival labels (live center), count-collapsed; empty for `raw`. */
  survival: string[]
  /** Whether the chiral 3m/3m' pair agrees for both center states (false for `raw`). */
  reflectionSymmetric: boolean
  /** How many of the 128 table entries output alive. */
  aliveOutputs: number
  /** One plain-English sentence describing the rule for humans. */
  summary: string
}

/** Classify a ruleset hex; null when `hex` is not a 32-char hex string. */
export function describeRuleset(hex: string): RulesetDescription | null
