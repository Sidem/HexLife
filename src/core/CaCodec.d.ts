/**
 * Type declarations for `CaCodec.js` — the `HXK1.` k-state world code.
 *
 * A **distinct prefix**, not an `HXW1` version bump: an `HXW1` payload is binary everywhere (bitset
 * cells, a fixed 128-bit rule), so a deployed decoder must reject a k-state code outright rather than
 * half-read one. `decodeWorldCode` bails on the prefix, and `isWorldCode` is false for these.
 *
 * Keep in step with the JSDoc next door; `tests/caCodec.test.js` pins the behaviour.
 */

export type CaBackend = 'neighborhood' | 'block'

/** One `[r, g, b]` entry, each channel 0–255. */
export type CaPaletteEntry = [number, number, number]

export type DecodedCaWorld = {
  /** Grid rows. A multiple of 3 whenever `backend` is `'block'`. */
  rows: number
  /** Grid columns. Always even. */
  cols: number
  /** `k`. Within the chosen backend's cap (4 for `'neighborhood'`, 16 for `'block'`). */
  states: number
  backend: CaBackend
  /**
   * The rule table, already the exact type `HexCA#setRule` wants: a `k^7` `Uint8Array` for
   * `'neighborhood'`, a `k^3` `Uint16Array` of packed output triples for `'block'`.
   */
  rule: Uint8Array | Uint16Array
  /** `rows * cols` state values in `0..states` — the exact tick-0 grid. */
  cells: Uint8Array
  /** `states` colours, or null when the code carries none and the host chooses. */
  palette: CaPaletteEntry[] | null
  /** Ticks per second. */
  speed: number
}

export type CaCodeInput = {
  rows: number
  cols: number
  states: number
  /** Defaults to `'neighborhood'`. Accepts the numeric wire tag too. */
  backend?: CaBackend | number
  /** From `ruleFromTable` (`k^7` entries) or `blockRuleFromTable` (`k^3` entries). */
  rule: ArrayLike<number>
  /** `rows * cols` state values in `0..states`. */
  cells: ArrayLike<number>
  /** Exactly `states` colours, or omitted to leave the choice to the host. */
  palette?: ArrayLike<number>[]
  /** Ticks per second. Defaults to 10, matching `HexCA`. */
  speed?: number
}

/** Encode a k-state world into an `HXK1.` code, or null if the inputs don't describe a world. */
export function encodeCaCode(world: CaCodeInput): Promise<string | null>

/** Decode an `HXK1.` code. Never throws; resolves to null for anything malformed. */
export function decodeCaCode(code: string): Promise<DecodedCaWorld | null>

/** Cheap synchronous shape check: does this string even claim to be a k-state world code? */
export function isCaCode(code: string): boolean

/**
 * The rule table's shape for a `(states, backend)` pair — `k^7` single bytes, or `k^3` `u16`s.
 * Null for a pair no backend can build. The codec derives the blob's length from this rather than
 * storing it, so a truncated paste fails an exact byte count.
 */
export function caRuleShape(
  states: number,
  backend: number,
): {entries: number; bytesPerEntry: number; bytes: number} | null

/**
 * Whether the tuple describes a world the engine will actually build: even columns, `rows % 3 == 0`
 * in block mode, and `states` within the backend's cap. Checked here as well as in wasm so a decoded
 * code cannot throw the moment somebody constructs a `HexCA` from it.
 */
export function isValidCaGeometry(
  rows: number,
  cols: number,
  states: number,
  backend: number,
): boolean

/** Normalize a backend name or tag to its wire tag; null for anything that is not a backend. */
export function backendTag(backend: CaBackend | number): number | null

export const BACKEND_NEIGHBORHOOD: 0
export const BACKEND_BLOCK: 1

export const CA_PALETTE_NONE: 0
export const CA_PALETTE_RGB: 1
