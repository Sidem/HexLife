/**
 * Type declarations for `WorldCodec.js`.
 *
 * The app itself needs none of this — it type-checks the JSDoc in place via `// @ts-check`. This file
 * exists for the **Devvit app** (`devvit/`), whose TypeScript build imports the codec across the repo
 * boundary (server-side validation of the pasted world code) and, unlike the root, does not enable
 * `allowJs`. Keep it in step with the JSDoc next door; `tests/worldCodec.test.js` pins the behavior.
 */

export type DecodedWorld = {
  /** Grid rows. */
  rows: number
  /** Grid columns (as captured — the codec does not re-derive them from `rows`). */
  cols: number
  /** 32-char uppercase hex. */
  rulesetHex: string
  /** `rows * cols` entries, one byte per cell (0 or 1) — the exact tick-0 state. */
  cells: Uint8Array
  /** Ticks per second. */
  speed: number
  /** Color settings to feed `generateColorLUT`. Null iff `lut` is set. */
  colorSettings: object | null
  /** A ready 128×2 RGBA LUT (1024 bytes). Null iff `colorSettings` is set. */
  lut: Uint8Array | null
}

export type WorldCodeInput = {
  rows: number
  cols: number
  rulesetHex: string
  cells: Uint8Array | number[]
  /** Preferred palette form: compact, and the decoder rebuilds the identical LUT. */
  colorSettings?: object
  /** Fallback palette form: a baked 128×2 **RGBA** LUT (1024 bytes). */
  lut?: Uint8Array
  speed?: number
}

/** Encode a world into a `HXW1.` code, or null if the inputs don't describe a world. */
export function encodeWorldCode(world: WorldCodeInput): Promise<string | null>

/** Decode a `HXW1.` code. Never throws; resolves to null for anything malformed. */
export function decodeWorldCode(code: string): Promise<DecodedWorld | null>

/** Cheap synchronous shape check: does this string even claim to be a world code? */
export function isWorldCode(code: string): boolean

export const PALETTE_SETTINGS: 0
export const PALETTE_LUT: 1
