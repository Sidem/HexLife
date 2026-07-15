/**
 * Shared webview bootstrap for HexLife Live Specimen posts (#26).
 *
 * Both entrypoints mount the same `<hexlife-world>` from `src/embed/` — no second engine.
 * World codes (`HXW1.…`) are the post payload; transport chrome + identity + Explorer deep-link
 * live outside the element.
 *
 * **Autoplay policy:** start running when scrolled into view *only* if the palette is
 * flicker-proof (`isFlickerProofPalette`). Otherwise always paused until the viewer presses play.
 * Reduced-motion is still honored by the element (poster until explicit play).
 */

import {navigateTo} from '@devvit/web/client'
import '../../../src/embed/index.js'
import {rulesetName} from '../../../src/core/rulesetName.js'
import {
  decodeWorldCode,
  explorerUrlForRuleset,
  isFlickerProofPalette,
} from '../../../src/core/WorldCodec.js'
import {fetchWorldCode} from './fetch.ts'

/** Feed (splash) vs expanded lab (game) — same sim, different chrome density. */
export type ChromeMode = 'feed' | 'lab'

/**
 * Fallback specimen for install-demo posts with no Redis code. Attribute-driven, no palette
 * settings → not flicker-proof → always starts paused.
 */
const DEMO = {
  ruleset: 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6',
  seed: '12345',
  rows: '64',
  speed: '20',
} as const

const DEFAULT_EMBED_ROWS = 64

/** Bits of `<hexlife-world>` this page reads. */
type HexWorld = HTMLElement & {
  readonly tickCount: number
  readonly playing: boolean
  readonly userPaused: boolean
  readonly error?: string | null
  readonly sim?: {speed: number; rows: number; cols: number} | null
  play(): void
  pause(): void
  reset(): void
}

type WorldMeta = {
  rulesetHex: string
  rows: number
  cols: number | null
  speed: number | null
  flickerSafe: boolean
}

/**
 * @param mount Where the world goes.
 * @param status Boot/failure line (hidden on success).
 * @param opts.mode `feed` = quiet in-post chrome; `lab` = full transport + Explorer CTA.
 */
export async function mountHexLife(
  mount: HTMLElement,
  status: HTMLElement,
  opts: {mode: ChromeMode} = {mode: 'lab'},
): Promise<void> {
  status.textContent = 'Loading…'
  status.hidden = false

  const code = await fetchWorldCode()
  const meta = await resolveMeta(code)

  const world = document.createElement('hexlife-world') as HexWorld
  if (code) world.setAttribute('code', code)
  else for (const [k, v] of Object.entries(DEMO)) world.setAttribute(k, v)

  // Always-paused when not flicker-safe. Flicker-safe: no `paused` → element autoplays when
  // on-screen (IntersectionObserver) and stops when scrolled away.
  if (!meta.flickerSafe) world.setAttribute('paused', '')

  // No in-element attribution — we own the Explorer CTA outside the element.
  world.setAttribute('link', 'off')
  // Click/drag invert-draw (pause while painting). Brush size comes from the world code (default 2).
  world.setAttribute('draw', '')

  mount.append(world)

  paintIdentity(meta)
  wireExplorerLink(meta)
  wireCopyHex(meta.rulesetHex)
  wireTransport(world)
  applyChromeMode(opts.mode)

  const settle = (): void => {
    const speedInput = document.getElementById(
      'speed',
    ) as HTMLInputElement | null
    if (speedInput && world.sim) speedInput.value = String(world.sim.speed)

    // Prefer live sim dims once booted (demo path has no cols until then).
    if (world.sim) {
      paintIdentity({
        ...meta,
        rows: world.sim.rows,
        cols: world.sim.cols,
      })
    }

    syncPlayPauseLabel(world)
    status.textContent = world.error ?? ''
    status.hidden = !world.error
  }
  world.addEventListener('hexlife-ready', settle)
  setTimeout(settle, 2000)
}

async function resolveMeta(code: string | undefined): Promise<WorldMeta> {
  if (!code) {
    return {
      rulesetHex: DEMO.ruleset,
      rows: Number(DEMO.rows),
      cols: null,
      speed: Number(DEMO.speed),
      flickerSafe: false,
    }
  }
  const world = await decodeWorldCode(code)
  if (!world) {
    return {
      rulesetHex: DEMO.ruleset,
      rows: DEFAULT_EMBED_ROWS,
      cols: null,
      speed: null,
      flickerSafe: false,
    }
  }
  return {
    rulesetHex: world.rulesetHex,
    rows: world.rows,
    cols: world.cols,
    speed: world.speed,
    flickerSafe: isFlickerProofPalette(world.colorSettings, world.lut),
  }
}

function paintIdentity(meta: WorldMeta): void {
  const root = document.getElementById('identity')
  if (!root) return

  const nameEl = document.getElementById('specimen-name')
  const hexEl = document.getElementById('specimen-hex')
  const metaEl = document.getElementById('specimen-meta')

  const name = rulesetName(meta.rulesetHex)
  if (nameEl) nameEl.textContent = name

  if (hexEl) {
    const short =
      meta.rulesetHex.length >= 8
        ? `${meta.rulesetHex.slice(0, 8)}…`
        : meta.rulesetHex
    hexEl.textContent = short
    hexEl.setAttribute('title', meta.rulesetHex)
    hexEl.dataset.hex = meta.rulesetHex
  }

  if (metaEl) {
    const grid =
      meta.cols != null ? `${meta.rows}×${meta.cols}` : `${meta.rows} rows`
    metaEl.textContent = grid
  }

  root.hidden = false
}

function wireExplorerLink(meta: WorldMeta): void {
  const href = explorerUrlForRuleset(meta.rulesetHex, {rows: meta.rows})
  for (const id of ['open-explorer', 'open-explorer-quiet'] as const) {
    const a = document.getElementById(id) as HTMLAnchorElement | null
    if (!a) continue
    a.href = href
    a.title =
      'Open this ruleset in HexLife Explorer (full lab — fresh start with the same rule)'
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    // Reddit webviews swallow plain <a> navigations (right-click "open in new tab" still works
    // because it bypasses the click handler). Use Devvit's navigateTo effect so left-click works.
    a.addEventListener('click', ev => {
      ev.preventDefault()
      navigateTo(href)
    })
  }
}

function wireCopyHex(rulesetHex: string): void {
  const btn = document.getElementById('copy-hex') as HTMLButtonElement | null
  if (!btn) return
  btn.addEventListener('click', () => {
    void copyText(rulesetHex).then(ok => {
      const prev = btn.textContent
      btn.textContent = ok ? 'Copied' : 'Copy failed'
      setTimeout(() => {
        btn.textContent = prev
      }, 1200)
    })
  })
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function applyChromeMode(mode: ChromeMode): void {
  document.body.dataset.chrome = mode
  // Feed: hide speed row label clutter — CSS also gates .lab-only / .feed-only
}

/** Play/pause + restart + speed — shared by splash and game. */
function wireTransport(world: HexWorld): void {
  const speedInput = document.getElementById('speed') as HTMLInputElement | null
  const playPauseBtn = document.getElementById(
    'play-pause',
  ) as HTMLButtonElement | null
  const restartBtn = document.getElementById(
    'restart',
  ) as HTMLButtonElement | null

  if (speedInput) {
    speedInput.addEventListener('input', () =>
      world.setAttribute('speed', speedInput.value),
    )
  }

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      if (world.userPaused || !world.playing) {
        world.removeAttribute('paused')
        world.play()
      } else {
        world.pause()
        world.setAttribute('paused', '')
      }
      syncPlayPauseLabel(world)
    })
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      world.reset()
      if (!world.playing && !world.userPaused) world.play()
      syncPlayPauseLabel(world)
    })
  }

  world.addEventListener('hexlife-ready', () => syncPlayPauseLabel(world))
  setInterval(() => syncPlayPauseLabel(world), 400)
}

function syncPlayPauseLabel(world: HexWorld): void {
  const btn = document.getElementById('play-pause') as HTMLButtonElement | null
  if (!btn) return
  const showPlay = world.userPaused || !world.playing
  btn.textContent = showPlay ? '▶' : '❚❚'
  btn.setAttribute('aria-label', showPlay ? 'Play' : 'Pause')
  btn.title = showPlay ? 'Play' : 'Pause'
}
