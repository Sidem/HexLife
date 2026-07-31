/**
 * Type declarations for `colorPalettes.js` (Devvit `allowJs: false` boundary).
 * Keep in step with the JSDoc next door.
 *
 * Only the host-facing projection is declared. `PRESET_PALETTES` itself stays undeclared on
 * purpose: external hosts get keys and labels, not the gradient stops.
 */

/** One preset a host may offer; `key` is what the `palette` attribute accepts. */
export interface PresetPaletteInfo {
  key: string
  name: string
  /** Present when the preset colors by rule structure ('neighbor_count' | 'symmetry'). */
  logic?: string
  /** Present when the ramp is perceptually uniform and colorblind-safe. */
  cvdSafe?: boolean
}

/** Every preset the `palette` attribute accepts, in declaration order. */
export function listPresetPalettes(): PresetPaletteInfo[]
