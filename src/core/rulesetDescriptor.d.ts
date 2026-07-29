/**
 * Type declarations for `rulesetDescriptor.js`.
 *
 * The app itself type-checks the JSDoc in place via `// @ts-check`; this file exists for the
 * **Devvit app**, whose TypeScript build imports the classifier across the package
 * boundary (ruleset identity comment + in-post rule card) and does not enable `allowJs`.
 * Keep it in step with the JSDoc next door; `tests/rulesetDescriptor.test.js` pins the behavior.
 */

/** Canonical orbit representative (6-bit mask) → notation label ('2o', "3m'", …), display order. */
export const ORBIT_LABELS: Map<number, string>

export type ConstraintClass = 'totalistic' | 'n_count' | 'd_sym' | 'r_sym' | 'free'

export const CONSTRAINT_CLASSES: ConstraintClass[]

export const CONSTRAINT_CLASS_META: Record<
  ConstraintClass,
  { label: string; description: string }
>

export type RulesetDescription = {
  /** 32-char uppercase hex. */
  hex: string
  /**
   * `n-count`: uniform per neighbor count (plain B/S digits). `r-sym`: uniform per rotation
   * orbit (o/m/p arrangement suffixes). `raw`: at least one orbit mixed — no compact notation.
   */
  type: 'n-count' | 'r-sym' | 'raw'
  /** Strictest structural constraint satisfied by the rule table. */
  constraintClass: ConstraintClass
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

/** Name the strictest structural constraint satisfied by a valid ruleset. */
export function classifyRulesetConstraint(
  source: string | Uint8Array,
): ConstraintClass | null

/** Whether a ruleset satisfies a requested constraint, including any stricter nested class. */
export function satisfiesRulesetConstraint(
  source: string | Uint8Array,
  requested: ConstraintClass,
): boolean

/** Classify a ruleset hex; null when `hex` is not a 32-char hex string. */
export function describeRuleset(hex: string): RulesetDescription | null
