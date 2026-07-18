/**
 * Client half of the anonymous usage telemetry (see ../shared/telemetry.ts for the privacy stance).
 *
 * Three rules this module exists to enforce, none of which survive being reimplemented at each
 * call site:
 *
 * 1. **It can never break the post.** Every path is wrapped and failures are swallowed. A viewer
 *    must never see a broken specimen because a counter did not increment.
 * 2. **It batches.** A request per click would burn the app's server quota and add jank to a page
 *    whose entire job is a smooth simulation. Events accumulate and flush on a timer, on hide, and
 *    on unload.
 * 3. **The session id is per-visit and unpersisted.** See {@link sessionId}.
 */

import {Endpoint} from '../shared/api.ts'
import {
  type TelemetryEntry,
  type TelemetryEvent,
  type TelemetrySurface,
  TRACK_LIMITS,
  type TrackReq,
} from '../shared/telemetry.ts'

const FLUSH_MS = 10_000

/**
 * The session id lives in this variable and **nowhere else** — not `localStorage`, not
 * `sessionStorage`, not a cookie. Nothing is ever written to or read from the viewer's device.
 *
 * That is a deliberate legal choice, not a stylistic one. ePrivacy Directive Art. 5(3) is triggered
 * by *storing information on, or accessing information stored in, a user's terminal equipment* —
 * and it applies to `localStorage` and `sessionStorage` exactly as it does to cookies. Analytics is
 * not "strictly necessary" for the service the viewer asked for, so device storage for this purpose
 * generally needs consent, and the national exemptions for first-party audience measurement are
 * conditional and vary by member state. A webview inside someone else's post is the worst possible
 * place to be litigating a consent banner.
 *
 * Keeping the id in memory sidesteps the question entirely: no storage, no access, no Art. 5(3).
 *
 * **What it costs:** the feed card and the expanded lab are separate documents, so they get separate
 * ids and count as two sessions. `expand` is still recorded (in the feed session) and the feed
 * funnel is still complete — what is lost is following one *visit* across that boundary. That is a
 * real analytics loss and a deliberate trade. Do not "fix" it by reaching for storage.
 */
let sessionId = ''
let surface: TelemetrySurface = 'lab'
let started = false

/** Pending events since the last flush, in occurrence order. */
let queue: TelemetryEntry[] = []
/** Names already sent or queued this session — for `once` events and for `engaged`. */
const seen = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined
/** Pending dwell markers, kept only so tests can cancel them. */
const dwellTimers: ReturnType<typeof setTimeout>[] = []

function mintSessionId(): string {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    /* fall through */
  }
  // No crypto (old webview shells): still needs to be unguessable enough not to collide, and it is
  // never a security token — only a bucket label.
  return `s-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
}

/**
 * Start telemetry for this document. Idempotent; safe to call before anything else exists.
 *
 * @param mode Which chrome this document is — the surface every event gets attributed to.
 */
export function initTelemetry(mode: TelemetrySurface): void {
  if (started) return
  started = true
  surface = mode
  // In memory for this document only, and gone the moment it unloads. See {@link sessionId}.
  sessionId = mintSessionId()

  try {
    // Two different signals because clients disagree about which one fires on the way out. Both are
    // idempotent — an empty queue flushes to nothing.
    globalThis.addEventListener?.('pagehide', () => flush(true))
    globalThis.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true)
    })
  } catch {
    /* no window in the unit shell */
  }

  startDwellTimers()
}

/**
 * Record an event.
 *
 * @param opts.once Report only the first occurrence this session. Use it for anything that would
 *   otherwise be dominated by one enthusiastic viewer — `draw` fires per stroke, and a session that
 *   drew four hundred cells is still one session that drew.
 */
export function track(name: TelemetryEvent, opts?: {once?: boolean}): void {
  try {
    if (!started) return
    const first = !seen.has(name)
    if (opts?.once && !first) return
    seen.add(name)

    // `engaged` is derived rather than reported by call sites: every interaction would otherwise
    // have to remember to also mark engagement, and the one that forgets skews the bounce rate.
    if (first && ENGAGING.has(name)) track('engaged', {once: true})

    const existing = queue.find(e => e.name === name)
    if (existing)
      existing.n = Math.min(existing.n + 1, TRACK_LIMITS.maxCountPerEvent)
    else if (queue.length < TRACK_LIMITS.maxEvents) queue.push({name, n: 1})

    scheduleFlush()
  } catch {
    /* telemetry must never surface to the viewer */
  }
}

/**
 * Send immediately instead of waiting for the timer.
 *
 * For the handful of events that are followed by leaving the page — posting a remix ends in
 * `navigateTo` — where the batch that records the *conversion* is exactly the one at risk of being
 * cancelled. Uses `keepalive` for the same reason.
 */
export function flushTelemetry(): void {
  flush(true)
}

/** Events that count as "this viewer did something", for the derived `engaged` marker. */
const ENGAGING: ReadonlySet<string> = new Set<TelemetryEvent>([
  'play',
  'pause',
  'restart',
  'speed',
  'draw',
  'expand',
  'ruleset_open',
  'copy_hex',
  'explorer_open',
  'remix_start',
  'create_start',
  'retry',
])

function scheduleFlush(): void {
  if (flushTimer !== undefined) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    flush(false)
  }, FLUSH_MS)
}

/**
 * Send whatever is queued.
 *
 * @param final On the way out. `keepalive` lets the request outlive the document — without it the
 *   most interesting flush of all (everything since the last tick, right as they leave) is the one
 *   guaranteed to be cancelled.
 */
function flush(final: boolean): void {
  try {
    if (queue.length === 0) return
    const body: TrackReq = {sessionId, surface, events: queue}
    queue = []
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }

    void fetch(Endpoint.Track, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      keepalive: final,
    }).catch(() => {
      /* dropped batch; not worth retrying and definitely not worth surfacing */
    })
  } catch {
    /* ditto */
  }
}

/**
 * Bucketed dwell markers.
 *
 * Buckets rather than a duration because "did they stay" is the question, and because a raw
 * millisecond dwell attached to a session is a far more identifying number than a bucket is. The
 * timers are cheap and self-cancelling — a viewer who leaves at 8s simply never fires the 30s one.
 */
function startDwellTimers(): void {
  const marks: [ms: number, event: TelemetryEvent][] = [
    [5_000, 'dwell_5s'],
    [30_000, 'dwell_30s'],
    [120_000, 'dwell_120s'],
  ]
  for (const [ms, event] of marks) {
    const timer = setTimeout(() => {
      // Only count time the post was actually on screen. A card left in a background tab for an
      // hour is not a two-minute dwell, and counting it as one would quietly inflate every
      // engagement number we have.
      try {
        if (document.visibilityState === 'visible') track(event, {once: true})
      } catch {
        /* no document */
      }
    }, ms)
    dwellTimers.push(timer)
    // Node only: a pending 120s timer would otherwise hold the unit-test runner open for two
    // minutes. In a browser `setTimeout` returns a number and this is a harmless no-op.
    ;(timer as {unref?: () => void}).unref?.()
  }
}

/** Test seam — resets module state between unit tests. */
export function __resetTelemetryForTest(): void {
  started = false
  sessionId = ''
  queue = []
  seen.clear()
  if (flushTimer !== undefined) clearTimeout(flushTimer)
  flushTimer = undefined
  for (const t of dwellTimers.splice(0)) clearTimeout(t)
}
