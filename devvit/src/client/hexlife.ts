/**
 * Shared webview bootstrap for HexLife Live Specimen posts (#26).
 *
 * Both entrypoints mount the same `<hexlife-world>` from `src/embed/` — no second engine.
 * World codes (`HXW1.…`) are the post payload; transport chrome + identity + Explorer deep-link
 * live outside the element.
 *
 * **Start policy:** always `paused` until the viewer presses play. Large grids in-feed can lag
 * phones that only scroll past; explicit play keeps the feed cheap. Reduced-motion is still
 * honored by the element (poster until explicit play).
 *
 * **Boot:** posts created since Phase 3.6 carry their world in `postData`, so the common path
 * renders with no `api/world` round-trip at all. Older posts and the install demo still fetch.
 */

import {context, navigateTo} from '@devvit/web/client'
import '../../../src/embed/index.js'
import {rulesetName} from '../../../src/core/rulesetName.js'
import {
  decodeWorldCode,
  explorerUrlForRuleset,
} from '../../../src/core/WorldCodec.js'
import type {WorldPostData} from '../shared/api.ts'
import {fetchWorldCode} from './fetch.ts'

/** Feed (splash) vs expanded lab (game) — same sim, different chrome density. */
export type ChromeMode = 'feed' | 'lab'

/** Fallback specimen for install-demo posts with no Redis code. */
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

/** `hexlife-error` detail (see docs/EMBED-PLAN.md). */
type HexErrorDetail = {message: string; detail: string}

type WorldMeta = {
  rulesetHex: string
  rows: number
  cols: number | null
  speed: number | null
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
  setStatus(status, 'Loading…', 'loading')
  applyChromeMode(opts.mode)

  // Identity is known from postData before any network call — paint it now so the card reads as a
  // named specimen while the world itself is still resolving.
  const post = readPostData()
  if (post) {
    paintIdentity({
      rulesetHex: post.rulesetHex,
      rows: post.rows,
      cols: post.cols,
      speed: null,
    })
  }

  // The fast path: the code rode along in postData, so there is nothing to fetch.
  const code = post?.code ?? (await fetchWorldCode())
  const meta = await resolveMeta(code)

  const world = document.createElement('hexlife-world') as HexWorld
  if (code) world.setAttribute('code', code)
  else for (const [k, v] of Object.entries(DEMO)) world.setAttribute(k, v)

  // Always start paused — avoid ticking large worlds for feed scroll-by on phones.
  world.setAttribute('paused', '')

  // No in-element attribution — we own the Explorer CTA outside the element.
  world.setAttribute('link', 'off')
  // Never hijack the wheel: in the feed a scroll means "move on", and on desktop the expanded view
  // sits in a scrollable page too. Ctrl/meta+wheel (and trackpad pinch) still zoom.
  world.setAttribute('wheel-zoom', 'ctrl')
  // Draw is a lab affordance only. In the feed, leaving `draw` off is what restores the element's
  // poster play overlay, so the viewer's first tap runs the world instead of silently painting on it.
  if (opts.mode === 'lab') world.setAttribute('draw', '')

  paintIdentity(meta)
  wireExplorerLink(meta)
  wireCopyHex(meta.rulesetHex)
  wireTransport(world)

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
    if (world.error) setStatus(status, world.error, 'error')
    else setStatus(status, '')
  }

  // Listeners go on before the element is connected: connecting is what starts the boot, and the
  // boot emits hexlife-playstate before hexlife-ready.
  world.addEventListener('hexlife-ready', settle)
  world.addEventListener('hexlife-error', ev => {
    const {message, detail} = (ev as CustomEvent<HexErrorDetail>).detail ?? {}
    setStatus(status, message ?? 'Simulation failed to load.', 'error')
    if (detail) console.error(`<hexlife-world>: ${message} ${detail}`)
  })

  mount.append(world)

  // Last-resort settle: the element reports success (hexlife-ready) and failure (hexlife-error), so
  // this only covers a boot that somehow announces neither.
  setTimeout(settle, 2000)
}

/**
 * The boot payload attached at post creation (WP1), or undefined for posts created before it
 * existed, the install demo, and any local harness.
 *
 * Everything is re-checked rather than trusted: `postData` is arbitrary JSON that an *older* version
 * of this app wrote, and a bad read here would break the post rather than just slow it down.
 */
function readPostData(): WorldPostData | undefined {
  // `context` is `globalThis.devvit?.context` — undefined outside Reddit, despite its non-optional
  // type. Reading `.postData` off it directly would throw in the local vite harness.
  const ctx = context as {postData?: unknown} | undefined
  const raw = ctx?.postData as Partial<WorldPostData> | undefined
  if (
    !raw ||
    typeof raw.rulesetHex !== 'string' ||
    typeof raw.rows !== 'number' ||
    typeof raw.cols !== 'number'
  ) {
    return undefined
  }
  return {
    rulesetHex: raw.rulesetHex,
    rows: raw.rows,
    cols: raw.cols,
    // Absent whenever the code was too big to ride along; we fall back to fetching it.
    code: typeof raw.code === 'string' ? raw.code : undefined,
  }
}

/** The one place the status line is written, so `data-state` can't drift from the text. */
function setStatus(
  status: HTMLElement,
  text: string,
  state?: 'loading' | 'error',
): void {
  status.textContent = text
  status.hidden = !text
  if (state) status.dataset.state = state
  else delete status.dataset.state
}

async function resolveMeta(code: string | undefined): Promise<WorldMeta> {
  if (!code) {
    return {
      rulesetHex: DEMO.ruleset,
      rows: Number(DEMO.rows),
      cols: null,
      speed: Number(DEMO.speed),
    }
  }
  const world = await decodeWorldCode(code)
  if (!world) {
    return {
      rulesetHex: DEMO.ruleset,
      rows: DEFAULT_EMBED_ROWS,
      cols: null,
      speed: null,
    }
  }
  return {
    rulesetHex: world.rulesetHex,
    rows: world.rows,
    cols: world.cols,
    speed: world.speed,
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

  // The element announces every play-state change (including ones we didn't cause: scrolled
  // offscreen, tab hidden, a stroke pausing the world), so the label tracks it without a timer.
  world.addEventListener('hexlife-playstate', () => syncPlayPauseLabel(world))
  world.addEventListener('hexlife-ready', () => syncPlayPauseLabel(world))
}

function syncPlayPauseLabel(world: HexWorld): void {
  const btn = document.getElementById('play-pause') as HTMLButtonElement | null
  if (!btn) return
  const showPlay = world.userPaused || !world.playing
  btn.textContent = showPlay ? '▶' : '❚❚'
  btn.setAttribute('aria-label', showPlay ? 'Play' : 'Pause')
  btn.title = showPlay ? 'Play' : 'Pause'
}
