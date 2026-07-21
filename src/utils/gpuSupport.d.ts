/**
 * Type declarations for `gpuSupport.js` (Devvit `allowJs: false` boundary).
 * Keep in step with the JSDoc next door.
 */

export type GraphicsStatus = 'no-webgl2' | 'software' | 'likely-hardware'

export type GraphicsPath = {
  status: GraphicsStatus
  /** Vendor / renderer as reported, for logs. */
  info: string
  /** True when `WEBGL_debug_renderer_info` was unavailable — the verdict is then a guess. */
  masked: boolean
}

/** Probe for a hardware-backed WebGL2 context. Never throws. */
export function detectGraphicsPath(): GraphicsPath

/** Does this vendor/renderer string describe a CPU rasterizer? */
export function isSoftwareRenderer(info: string): boolean

export function detectBrowserFamily(
  ua?: string,
): 'chromium' | 'firefox' | 'safari' | 'unknown'

export const GPU_HELP_BY_BROWSER: Readonly<
  Record<string, {label: string; steps: readonly string[]}>
>

export const GPU_HELP_CAVEATS: readonly string[]

/** Build the remediation panel as detached DOM. */
export function createGpuHelpPanel(opts: {
  status: 'no-webgl2' | 'software'
  reloadHint?: string
  extraNote?: string
}): HTMLElement
