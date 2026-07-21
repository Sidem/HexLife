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
 *
 * **When the world can't be resolved** the card says so and offers Retry, rather than quietly
 * running the built-in demo under someone else's post title — see {@link WorldCodeResult}.
 */

import {canRunAsUser, context, navigateTo, showForm} from '@devvit/web/client'
import '../../../src/embed/index.js'
// Everything this app borrows from the HexLife source tree comes through `src/embed/api.js` — the
// declared host boundary (`tests/devvitBoundary.test.js` fails the build if anything reaches past
// it). `HexLifeElement` is the embed's own declaration of the element registered by the
// side-effecting import above, so drift between what the element does and what this page expects
// of it is a compile error rather than a runtime surprise.
import {
  createGpuHelpPanel,
  decodeWorldCode,
  describeRuleset,
  detectGraphicsPath,
  explorerUrlForRuleset,
  type GraphicsStatus,
  type HexLifeElement,
  rulesetName,
} from '../../../src/embed/api.js'
import {
  type CreatePostRsp,
  Endpoint,
  type ErrorRsp,
  NEW_POST_COPY,
  newPostFields,
  remixPostFields,
  type WorldPostData,
} from '../shared/api.ts'
import {speedBucket} from '../shared/telemetry.ts'
import {fetchWorldCode} from './fetch.ts'
import {paintRuleCard} from './ruleCard.ts'
import {flushTelemetry, initTelemetry, track} from './telemetry.ts'

/** Feed (splash) vs expanded lab (game) — same sim, different chrome density. */
export type ChromeMode = 'feed' | 'lab'

/**
 * `getElementById` + a complaint. Every wire-up here is optional by design (the feed card and the
 * lab share this code but not their markup), which means a *typo* in an id is indistinguishable
 * from "this page doesn't have that control" — it just silently does nothing. Warning costs one
 * line and turns that into something the local webview surfaces.
 *
 * Only for controls *both* pages carry. Where absence is a deliberate design choice (the quiet
 * Explorer link is feed-only), use `document.getElementById` directly — a warning that fires on
 * every correct boot teaches everyone to ignore warnings.
 */
function el<T extends HTMLElement>(id: string): T | null {
  const found = document.getElementById(id) as T | null
  if (!found) console.warn(`hexlife: no #${id} on this page`)
  return found
}

/** Fallback specimen for install-demo posts with no Redis code. */
const DEMO = {
  ruleset: 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6',
  seed: '12345',
  rows: '64',
  speed: '20',
} as const

const DEFAULT_EMBED_ROWS = 64

/** How long the speed slider must sit still before we count where it landed. */
const SPEED_SETTLE_MS = 800

/** Shown when we can't tell what world this post is — never alongside a mounted world. */
const FETCH_FAILED_MSG = 'Couldn’t load this specimen.'

/**
 * `?demo=1` — mount the built-in demo even when `api/world` fails.
 *
 * Strictly a local-harness affordance. There is no Devvit server in the vite harness, so every
 * boot there hits `{ok: false}` and would otherwise show the error state, leaving nothing to test
 * the element against. Inside Reddit the fetch either works or the viewer deserves the truth, so
 * nothing sets this flag in production.
 */
function demoFallbackAllowed(): boolean {
  return new URLSearchParams(location.search).has('demo')
}

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
  applyChromeMode(opts.mode)
  // Before the first event can fire, and before the dwell clock should start.
  initTelemetry(opts.mode)

  // Before anything else: a device that can't draw WebGL2 will never render this post, and the
  // element's own failure message ("This browser can't run WebGL2.") is true but useless. Bail
  // here with instructions instead of fetching a world nothing can show.
  const gpu = detectGraphicsPath()
  if (gpu.status === 'no-webgl2') {
    console.warn('hexlife: no WebGL2 —', gpu.info)
    showGpuHelp(mount, status, 'no-webgl2')
    track('gpu_blocked', {once: true})
    return
  }
  // Wired once, here rather than in `boot`: a retry re-runs the boot, and re-wiring a button that
  // survived the failure would leave it with two handlers.
  wireCreateOwn(status)
  const retryBtn = el<HTMLButtonElement>('retry')

  /**
   * Resolve the world and mount it. Safe to re-run *only* because it bails before wiring anything
   * when it fails, and never runs again once it has succeeded.
   */
  const boot = async (): Promise<void> => {
    setStatus(status, 'Loading…', 'loading')
    if (retryBtn) retryBtn.hidden = true

    // Identity is known from postData before any network call — paint it now so the card reads as
    // a named specimen while the world itself is still resolving.
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
    let code = post?.code
    if (code === undefined) {
      const rsp = await fetchWorldCode()
      if (rsp.ok) {
        // `{ok: true, code: undefined}` is the install demo: the post really has no world, and
        // the built-in specimen is the right answer to that.
        code = rsp.code
      } else if (!demoFallbackAllowed()) {
        // We don't know what this post is. Say so and offer a way out — showing the demo here
        // would put a stranger's title on our world and tell the viewer nothing went wrong.
        setStatus(status, FETCH_FAILED_MSG, 'error')
        track('boot_error', {once: true})
        if (retryBtn) retryBtn.hidden = false
        // No world means play/pause/restart/remix have nothing to act on. They are only wired in
        // `mountWorld`, so leaving them on screen would offer buttons that silently do nothing.
        document.body.dataset.boot = 'error'
        return
      }
    }
    await mountWorld(mount, status, code, opts, gpu.status)
  }

  retryBtn?.addEventListener('click', () => {
    track('retry')
    void boot()
  })
  await boot()
}

/** Build, wire, and connect the element. Called once per page — only after the world is known. */
async function mountWorld(
  mount: HTMLElement,
  status: HTMLElement,
  code: string | undefined,
  opts: {mode: ChromeMode},
  gpuStatus: GraphicsStatus,
): Promise<void> {
  const meta = await resolveMeta(code)

  const world = document.createElement('hexlife-world')
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
  // Feed only: let the poster breathe a few generations as the card scrolls into view. A CA's
  // appeal is motion, and a still grid at scroll speed is indistinguishable from a broken image.
  // The lab needs no such theatrics — you are already looking at it, with a play button right there.
  else world.setAttribute('preview', '12')

  paintIdentity(meta)
  wireExplorerLink(meta)
  wireRuleCard(meta)
  wireCopyHex(meta.rulesetHex)
  wireTransport(world)
  wirePostRemix(world, status)
  // Drawing has no element event of its own, and a pointer landing on a drawable world is what
  // painting *is*. Feed cards aren't drawable (no `draw` attribute), so this stays lab-only or it
  // would count every scroll-stopping tap as a stroke.
  if (opts.mode === 'lab') {
    world.addEventListener('pointerdown', () => track('draw', {once: true}))
  }
  // Transport and remix only mean anything with a world behind them; this is what un-hides them.
  document.body.dataset.boot = 'ok'

  // Software rendering: the world *will* run, just badly. Say so rather than letting a 3fps
  // specimen read as a broken post — but never withhold the world over it (see gpuSupport.js on
  // why blocking on a masked renderer string is the more expensive mistake in a feed).
  if (gpuStatus === 'software') {
    showSoftwareNotice()
    track('gpu_slow', {once: true})
  }

  const settle = (): void => {
    const speedInput = el<HTMLInputElement>('speed')
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
    else {
      setStatus(status, '')
      // The denominator: a world that actually reached the viewer. `once` because settle runs on
      // hexlife-ready *and* on the 2s safety timer.
      track('boot', {once: true})
    }
  }

  // Listeners go on before the element is connected: connecting is what starts the boot, and the
  // boot emits hexlife-playstate before hexlife-ready.
  world.addEventListener('hexlife-ready', settle)
  world.addEventListener('hexlife-error', ev => {
    const {message, detail} = ev.detail ?? {}
    setStatus(status, message ?? 'Simulation failed to load.', 'error')
    track('boot_error', {once: true})
    if (detail) console.error(`<hexlife-world>: ${message} ${detail}`)
  })

  mount.append(world)

  // Last-resort settle: the element reports success (hexlife-ready) and failure (hexlife-error), so
  // this only covers a boot that somehow announces neither.
  setTimeout(settle, 2000)
}

/**
 * Fatal GPU state: the help panel *replaces* the world, and the transport bar never appears.
 *
 * Reuses `data-boot="error"` because that is exactly what this is — a boot that failed — and the
 * stylesheet already hides the controls, the remix button and the feed's play-glyph placeholder
 * for it. `#retry` stays hidden: unlike a failed fetch, retrying changes nothing until the viewer
 * has actually gone and changed a browser setting, and a button that is guaranteed to fail is
 * worse than no button.
 */
function showGpuHelp(
  mount: HTMLElement,
  status: HTMLElement,
  kind: 'no-webgl2' | 'software',
): void {
  mount.replaceChildren(
    createGpuHelpPanel({
      status: kind,
      // Not "reload the page" — inside a Reddit webview there is no address bar to reload from.
      reloadHint: 'Then reopen this post.',
      extraNote:
        'In the Reddit app? Opening this post in your phone’s own browser often works too.',
    }),
  )
  setStatus(status, '')
  document.body.dataset.boot = 'error'
}

/**
 * Software rendering: one collapsed line above the chrome, expandable into the same help panel.
 *
 * Collapsed by default and dismissible because this is an *aside* on someone else's post — the
 * specimen is what the viewer came for, and a permanent banner about their graphics settings would
 * be the loudest thing on a feed card.
 */
function showSoftwareNotice(): void {
  const chrome = document.getElementById('chrome')
  if (!chrome) return

  const box = document.createElement('div')
  box.className = 'gpu-notice'

  const details = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = 'Running slowly — GPU acceleration is off'
  details.append(summary)
  details.append(
    createGpuHelpPanel({
      status: 'software',
      reloadHint: 'Then reopen this post.',
      extraNote:
        'In the Reddit app? Opening this post in your phone’s own browser often works too.',
    }),
  )
  box.append(details)

  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'gpu-notice-dismiss'
  dismiss.setAttribute('aria-label', 'Dismiss')
  dismiss.textContent = '✕'
  dismiss.addEventListener('click', () => box.remove())
  box.append(dismiss)

  chrome.prepend(box)
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
  const root = el('identity')
  if (!root) return

  const nameEl = el('specimen-name')
  const hexEl = el('specimen-hex')
  const metaEl = el('specimen-meta')

  const name = rulesetName(meta.rulesetHex)
  if (nameEl) nameEl.textContent = name

  // The notation badge — B/S for neighbor-count rules, orbit-suffixed for r-sym ones. Raw rules
  // get nothing here (CSS collapses the empty span): a 32-char hex is not a badge.
  const ruleEl = el('specimen-rule')
  if (ruleEl) {
    const desc = describeRuleset(meta.rulesetHex)
    ruleEl.textContent = desc?.notation ?? ''
    ruleEl.title = desc?.summary ?? ''
  }

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
  // Not `el()`: the quiet variant is feed-only and the loud one lab-only in practice, so a miss
  // here is the design, not a typo.
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
      track('explorer_open')
      navigateTo(href)
    })
  }
}

/**
 * Lab-only "Ruleset" button → read-only rule card (see ruleCard.ts). The most-asked question
 * under these posts is "what ruleset is this?" — this answers it in-post, without sending the
 * viewer into the Explorer's editor (whose 128-cell grid is a poor fit for phones).
 */
function wireRuleCard(meta: WorldMeta): void {
  // Not `el()`: the feed card has no ruleset button by design — its chrome stays minimal.
  const btn = document.getElementById(
    'show-ruleset',
  ) as HTMLButtonElement | null
  const card = document.getElementById('rule-card')
  if (!btn || !card) return

  paintRuleCard(meta.rulesetHex, rulesetName(meta.rulesetHex))

  // The card's CTA opens the Explorer with the editor already up, in the mode fitting the rule.
  const link = document.getElementById(
    'rule-card-explorer',
  ) as HTMLAnchorElement | null
  if (link) {
    const href = explorerUrlForRuleset(meta.rulesetHex, {
      rows: meta.rows,
      edit: true,
    })
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    // Same webview quirk as wireExplorerLink: plain <a> left-clicks are swallowed by Reddit.
    link.addEventListener('click', ev => {
      ev.preventDefault()
      track('rulecard_explorer')
      navigateTo(href)
    })
  }

  const close = (): void => {
    card.hidden = true
  }
  btn.addEventListener('click', () => {
    track('ruleset_open')
    card.hidden = false
  })
  document.getElementById('rule-card-close')?.addEventListener('click', close)
  // Backdrop click closes; clicks inside the panel bubble up from children of .rule-card-panel.
  card.addEventListener('click', ev => {
    if (ev.target === card) close()
  })
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !card.hidden) close()
  })
}

function wireCopyHex(rulesetHex: string): void {
  const btn = el<HTMLButtonElement>('copy-hex')
  if (!btn) return
  btn.addEventListener('click', () => {
    track('copy_hex')
    void copyText(rulesetHex).then(ok => {
      const prev = btn.textContent
      btn.textContent = ok ? 'Copied' : 'Copy failed'
      setTimeout(() => {
        btn.textContent = prev
      }, 1200)
    })
  })
}

/**
 * Lab-only "Create your own": paste a world code from the explorer (power-user path). The feed
 * deliberately omits this — paste-a-code is not onboarding; the feed leads people to **Open lab**
 * → draw → **Post my remix** instead.
 *
 * `showForm` is a client effect, so it can't reach the server's registered form callback — the
 * values come back here and go to `api/post`, which is that callback minus the UI envelope.
 * Unlike the menu form (native Reddit UI → form callback, consent built in), this path is a
 * webview fetch, so it must call {@link ensureUserPostPermission} first or the post lands as
 * the app account.
 * `showForm`/`navigateTo` only do anything inside Reddit; locally the button wires up and no-ops.
 */
function wireCreateOwn(status: HTMLElement): void {
  // Not `el()`: feed has no create-own by design; only the lab page mounts this button.
  const btn = document.getElementById('create-own') as HTMLButtonElement | null
  if (!btn) return
  btn.addEventListener('click', ev => void createOwn(ev, btn, status))
}

async function createOwn(
  event: Event,
  btn: HTMLButtonElement,
  status: HTMLElement,
): Promise<void> {
  track('create_start')
  // Consent first, on the trusted click — after `await showForm` the gesture is spent on some
  // clients and a late canRunAsUser either no-ops or never prompts.
  if (!(await ensureUserPostPermission(event, status))) return
  const rsp = await showForm({
    title: NEW_POST_COPY.title,
    description: NEW_POST_COPY.description,
    acceptLabel: NEW_POST_COPY.acceptLabel,
    fields: [...newPostFields()],
  })
  if (rsp.action !== 'SUBMITTED') {
    track('create_cancel')
    return
  }
  await submitNewPost(
    {code: rsp.values.code ?? '', title: rsp.values.title ?? ''},
    btn,
    status,
    'create',
  )
}

/**
 * "Post my remix": snapshot the world as it looks *right now* and post that. No explorer, no
 * copy, no paste — the loop the lab always implied but never closed, since a viewer's drawing was
 * ephemeral and the only postable thing was a code from somewhere else.
 */
function wirePostRemix(world: HexLifeElement, status: HTMLElement): void {
  // Not `el()`: splash.html has no remix button — the feed card never mounts a drawable world.
  const btn = document.getElementById('post-remix') as HTMLButtonElement | null
  if (!btn) return
  btn.addEventListener('click', ev => void postRemix(ev, world, btn, status))
}

async function postRemix(
  event: Event,
  world: HexLifeElement,
  btn: HTMLButtonElement,
  status: HTMLElement,
): Promise<void> {
  track('remix_start')
  // Consent first, on the trusted click — after `await showForm` the gesture is spent on some
  // clients and a late canRunAsUser either no-ops or never prompts.
  if (!(await ensureUserPostPermission(event, status))) return

  // What you see is what posts: a world that keeps ticking between the tap and the confirm would
  // post a generation the viewer never chose.
  world.pause()

  const code = await world.worldCode()
  if (!code) {
    setStatus(status, NEW_POST_COPY.remixNothingToPost, 'error')
    track('remix_failed')
    return
  }

  const rsp = await showForm({
    title: NEW_POST_COPY.remixTitle,
    description: NEW_POST_COPY.remixDescription,
    acceptLabel: NEW_POST_COPY.remixAcceptLabel,
    fields: [...remixPostFields()],
  })
  if (rsp.action !== 'SUBMITTED') {
    track('remix_cancel')
    return
  }
  await submitNewPost(
    {code, title: rsp.values.title ?? ''},
    btn,
    status,
    'remix',
  )
}

/**
 * Client-side consent for webview → `api/post` → `runAs: 'USER'`.
 *
 * The menu "New HexLife post" form never needs this: Reddit collects permission when the form
 * callback runs. In-post create uses `fetch`, and without {@link canRunAsUser} the platform
 * attributes the specimen to u/hexlifeapp even though the server passes `runAs: 'USER'`.
 *
 * Outside Reddit (local harness) the bridge is absent — treat as allowed so the rest of the
 * path still no-ops cleanly on `navigateTo`.
 */
async function ensureUserPostPermission(
  event: Event,
  status: HTMLElement,
): Promise<boolean> {
  try {
    const allowed = await canRunAsUser(event)
    if (!allowed) {
      setStatus(status, NEW_POST_COPY.userPostPermissionDenied, 'error')
      return false
    }
    return true
  } catch (err) {
    // No bridge / untrusted synthetic event — local harness and unit shells.
    console.warn(
      'canRunAsUser unavailable; proceeding without consent gate',
      err,
    )
    return true
  }
}

/**
 * The tail both create paths share: hand a code to `api/post` and go to the new post. The two
 * differ only in where the code came from (a paste vs. a snapshot), so everything after the form
 * — validation, `runAs: 'USER'`, the Redis write — is one path on the server and one here.
 * Callers must already have {@link ensureUserPostPermission} for webview-originated creates.
 */
async function submitNewPost(
  values: {code: string; title: string},
  btn: HTMLButtonElement,
  status: HTMLElement,
  /** Which door this came through — the two have very different completion rates. */
  origin: 'remix' | 'create' = 'create',
): Promise<void> {
  const prev = btn.textContent
  btn.disabled = true
  btn.textContent = 'Creating…'
  try {
    const http = await fetch(Endpoint.CreatePost, {
      body: JSON.stringify(values),
      headers: {'Content-Type': 'application/json'},
      method: 'POST',
    })
    const body = (await http.json()) as CreatePostRsp | ErrorRsp
    if (!http.ok || 'error' in body) {
      setStatus(
        status,
        'error' in body ? body.error : NEW_POST_COPY.invalid,
        'error',
      )
      track(origin === 'remix' ? 'remix_failed' : 'create_failed')
      return
    }
    track(origin === 'remix' ? 'remix_posted' : 'create_posted')
    // We are about to leave; don't let the conversion sit in a queue that navigation discards.
    flushTelemetry()
    navigateTo(body.url)
  } catch (err) {
    setStatus(status, 'Could not create the post. Try again.', 'error')
    track(origin === 'remix' ? 'remix_failed' : 'create_failed')
    console.error(err)
  } finally {
    btn.disabled = false
    btn.textContent = prev
  }
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
function wireTransport(world: HexLifeElement): void {
  const speedInput = el<HTMLInputElement>('speed')
  const playPauseBtn = el<HTMLButtonElement>('play-pause')
  const restartBtn = el<HTMLButtonElement>('restart')

  if (speedInput) {
    // Debounced so a drag reports where it *landed*, not the forty values it swept through. Without
    // this the buckets would say more about how far the handle travelled than about what anyone
    // chose to watch.
    let settle: ReturnType<typeof setTimeout> | undefined
    speedInput.addEventListener('input', () => {
      world.setAttribute('speed', speedInput.value)
      // `once`: a drag is one decision. This marks "touched the slider"; the bucket below says
      // where they ended up.
      track('speed', {once: true})

      if (settle !== undefined) clearTimeout(settle)
      settle = setTimeout(() => {
        const value = Number(speedInput.value)
        if (Number.isFinite(value)) track(speedBucket(value))
      }, SPEED_SETTLE_MS)
    })
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
      track('restart')
      world.reset()
      if (!world.playing && !world.userPaused) world.play()
      syncPlayPauseLabel(world)
    })
  }

  /**
   * Play/pause counted from the **element's** state, not from our button's click handler.
   *
   * The button is not how most people start a world. In the feed the element shows its own poster
   * play overlay, and that is what a viewer taps — so instrumenting only `#play-pause` measured a
   * control the feed barely uses, and the first real run of this reported `pressed play 0 (0%)`
   * against 42% engaged and 33% expanded. The number was wrong, not the users.
   *
   * `userPaused` is the right signal because it is *intent*: the element documents it as "the user
   * has paused, ignoring the viewport/visibility gates". Counting `playing` instead would fire on
   * every scroll-offscreen auto-pause and every tab switch, and the feed would look wildly more
   * engaged than it is. We count only the edges, so a burst of gate changes reports nothing.
   */
  let lastUserPaused: boolean | undefined
  world.addEventListener('hexlife-playstate', ev => {
    const paused = ev.detail?.userPaused ?? world.userPaused
    if (lastUserPaused !== undefined && lastUserPaused !== paused) {
      track(paused ? 'pause' : 'play')
    }
    lastUserPaused = paused
    syncPlayPauseLabel(world)
  })
  world.addEventListener('hexlife-ready', () => {
    // Baseline once the element exists. Until this is set the listener above only records state,
    // so the initial paused→paused settle can't be mistaken for the viewer pressing something.
    lastUserPaused ??= world.userPaused
    syncPlayPauseLabel(world)
  })
}

function syncPlayPauseLabel(world: HexLifeElement): void {
  const btn = el<HTMLButtonElement>('play-pause')
  if (!btn) return
  const showPlay = world.userPaused || !world.playing
  btn.textContent = showPlay ? '▶' : '❚❚'
  btn.setAttribute('aria-label', showPlay ? 'Play' : 'Pause')
  btn.title = showPlay ? 'Play' : 'Pause'
}
