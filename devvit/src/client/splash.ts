import {requestExpandedMode} from '@devvit/web/client'
import {mountHexLife} from './hexlife.ts'
import {flushTelemetry, track} from './telemetry.ts'

const mount = document.getElementById('world') as HTMLElement
const status = document.getElementById('status') as HTMLElement

/**
 * How long to wait for the IntersectionObserver to say *anything* before deciding it never will.
 * A working observer reports its initial state within a frame or two of `observe()`.
 */
const IO_GRACE_MS = 1500

/**
 * Boot the world only once the card is actually on screen.
 *
 * A feed holds many of these, and every one that scrolls past unseen otherwise pays for a wasm
 * compile, a WebGL context, and the whole embed runtime to render a poster nobody looked at. The
 * element already pauses itself offscreen — this is about the boot it does before that gate ever
 * applies.
 *
 * Host-side on purpose: 3.6 deferred this as an embed change, but `src/embed/` is frozen and
 * moving *every* existing embed's boot timing to first-intersection is not a change this app gets
 * to make on their behalf. Out here it is this page's own policy and nothing else can notice.
 *
 * **Deferring must never be able to mean "never".** IntersectionObserver only delivers when the
 * document gets a rendering opportunity, and a document that reports `visibilityState: 'hidden'`
 * gets none — our own preview pane does exactly that while still laying the page out, so a naive
 * gate leaves the card blank forever with the status stuck on "Loading…". That is far worse than
 * the boot it saves.
 *
 * So the observer has to *prove it works* rather than be assumed to. Any report — including "not
 * intersecting" — proves delivery, and from then on the gate is trusted. Silence for
 * {@link IO_GRACE_MS} means there is no gate to trust, and we boot. Note which way each branch
 * fails: this matches `<hexlife-world>`'s own IO, which assumes on-screen until told otherwise.
 * A viewport gate should degrade to "show the thing", never to "show nothing".
 */
function mountWhenSeen(): void {
  let done = false
  const mountOnce = (why: string): void => {
    if (done) return
    done = true
    clearTimeout(fallback)
    io?.disconnect()
    // Timestamped so a playtest can answer what this WP is really asking: does Devvit even load
    // webviews for offscreen posts? If it doesn't, this is a cheap no-op safety net; if it does,
    // this is where the saving is. `why` says which path we took.
    console.log(
      `hexlife: mounting (${why}) at +${Math.round(performance.now() - t0)}ms after script start`,
    )
    void mountHexLife(mount, status, {mode: 'feed'})
  }

  const t0 = performance.now()
  if (!('IntersectionObserver' in globalThis)) {
    mountOnce('no IntersectionObserver')
    return
  }

  const fallback = setTimeout(
    () => mountOnce('observer never reported'),
    IO_GRACE_MS,
  )

  // rootMargin starts the boot a quarter-viewport early, so the world is up by the time the card
  // is genuinely in view rather than booting under the reader's eyes.
  const io: IntersectionObserver = new IntersectionObserver(
    entries => {
      // It reported, so it works — the grace net is no longer needed either way.
      clearTimeout(fallback)
      if (entries.some(e => e.isIntersecting)) mountOnce('scrolled into view')
    },
    {threshold: 0, rootMargin: '25%'},
  )
  io.observe(mount)
}

mountWhenSeen()

const expandBtn = document.getElementById('expand-btn') as HTMLButtonElement
expandBtn.addEventListener('click', ev => {
  // The feed funnel's whole point. Flushed on the spot because the expanded view may replace this
  // document outright, and a queued `expand` would be lost exactly when it converted.
  track('expand')
  flushTelemetry()
  requestExpandedMode(ev, 'game')
})
