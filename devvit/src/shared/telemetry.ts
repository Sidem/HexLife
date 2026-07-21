/**
 * Anonymous usage telemetry for Live Specimen posts (#26).
 *
 * **What this is allowed to be.** Reddit's Developer Terms forbid exporting Reddit user data
 * off-platform, and a Devvit webview can't reach a third-party analytics SDK anyway (strict CSP;
 * server `fetch` is limited to domains declared in devvit.json). So this is entirely first-party:
 * counters in the app's own Redis, read back through a mod-only menu item.
 *
 * **What it deliberately is not.** No user id, no username, no IP, no device fingerprint, nothing
 * derived from any of those, ever — not in a key, not in a value. The only identifier is a random
 * per-visit session id minted in the browser (see client/telemetry.ts), which is not persisted past
 * the tab and therefore cannot link one visit to the next or one viewer to another. That is what
 * makes "what happened inside one session" answerable without the data being about a *person*.
 *
 * The event name list below is a **closed whitelist, and that is load-bearing**: names arrive from
 * the webview and become Redis hash fields. Accepting arbitrary strings would let a crafted client
 * write unbounded fields into our hashes (and bury the real signal). The server drops anything not
 * in {@link TELEMETRY_EVENTS} rather than trying to sanitize it.
 */

/**
 * Every event the client may report. Named for the *question* each one answers, not for the widget
 * that fired it — a counter called `button_7` ages into noise the moment the layout changes.
 */
export const TELEMETRY_EVENTS = [
  /** A world mounted and rendered. The denominator for everything else. */
  'boot',
  /** We could not resolve the post's world; the viewer saw the error card. */
  'boot_error',
  /** They pressed Retry after a boot_error — i.e. the error card did its job. */
  'retry',
  /**
   * The device can't do WebGL2 at all, so we showed the "turn on hardware acceleration" card
   * instead of a world. Counted because it is otherwise invisible: these sessions never fire
   * `boot`, so without this they simply vanish from the funnel rather than explaining themselves.
   */
  'gpu_blocked',
  /** WebGL2 present but software-rendered — the world ran, slowly, with a warning. */
  'gpu_slow',

  /** First meaningful interaction of any kind. `boot - engaged` is the bounce count. */
  'engaged',

  'play',
  'pause',
  'restart',
  /** Touched the speed slider at all. */
  'speed',
  /**
   * Where the speed slider came to rest, bucketed. Reported when a drag settles, not per tick, so
   * a single sweep from 1 to 60 reports where the viewer *stopped* rather than every value it
   * passed through. Buckets keep this on the closed whitelist — a raw number would mean accepting
   * arbitrary values from the client as counter names.
   */
  'speed_slow',
  'speed_mid',
  'speed_fast',
  /** A pointer went down on a drawable world — someone painted cells. */
  'draw',

  /** Feed card → expanded lab. The single most important step in the funnel. */
  'expand',

  'ruleset_open',
  'rulecard_explorer',
  'copy_hex',
  'explorer_open',

  'remix_start',
  'remix_cancel',
  'remix_posted',
  'remix_failed',

  'create_start',
  'create_cancel',
  'create_posted',
  'create_failed',

  /**
   * Bucketed dwell rather than raw timings. Buckets answer "did they stay?" — the question we
   * actually have — and can't be reassembled into a timing fingerprint of an individual.
   */
  'dwell_5s',
  'dwell_30s',
  'dwell_120s',
] as const

export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number]

/**
 * Speed slider value → the bucket it reports as. Thresholds are in ticks/second and chosen to match
 * how the worlds actually read: below 10 you can follow individual generations, above 40 it is a
 * shimmer.
 */
export function speedBucket(
  ticksPerSecond: number,
): 'speed_slow' | 'speed_mid' | 'speed_fast' {
  if (ticksPerSecond < 10) return 'speed_slow'
  if (ticksPerSecond <= 40) return 'speed_mid'
  return 'speed_fast'
}

const EVENT_SET: ReadonlySet<string> = new Set(TELEMETRY_EVENTS)

export function isTelemetryEvent(name: unknown): name is TelemetryEvent {
  return typeof name === 'string' && EVENT_SET.has(name)
}

/** Which chrome the session ran in. Kept separate from the event name so both stay countable. */
export type TelemetrySurface = 'feed' | 'lab'

export function isTelemetrySurface(v: unknown): v is TelemetrySurface {
  return v === 'feed' || v === 'lab'
}

/** One event and how many times it happened since the last flush. */
export type TelemetryEntry = {name: TelemetryEvent; n: number}

/** POST body for {@link Endpoint.Track}. `postId` is taken from server context, never from here. */
export type TrackReq = {
  /** Random per-visit id from `crypto.randomUUID()`. Not persisted beyond the tab. */
  sessionId: string
  surface: TelemetrySurface
  events: TelemetryEntry[]
}

/**
 * Hard caps, enforced on both ends. The client batches so it never approaches these; the server
 * enforces them anyway, because "the client is well behaved" is not a property the server has.
 */
export const TRACK_LIMITS = {
  /** Distinct entries accepted per request. */
  maxEvents: 24,
  /** Occurrences accepted for a single entry — `speed` fires per slider tick. */
  maxCountPerEvent: 500,
  /** A UUIDv4 is 36 chars; anything longer is not one of ours. */
  maxSessionIdLen: 64,
} as const

/**
 * A session id is only ever used as a Redis key fragment, so it is validated by *shape* and not
 * merely by length — `sessionId` is the one caller-controlled string that reaches a key name.
 */
const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/

export function isSessionId(v: unknown): v is string {
  return typeof v === 'string' && SESSION_ID_RE.test(v)
}

/** Validate an untrusted body into something safe to write. Returns null when unusable. */
export function parseTrackReq(body: unknown): TrackReq | null {
  const raw = body as Partial<TrackReq> | undefined
  if (!raw || !isSessionId(raw.sessionId) || !isTelemetrySurface(raw.surface)) {
    return null
  }
  if (!Array.isArray(raw.events)) return null

  const events: TelemetryEntry[] = []
  for (const entry of raw.events.slice(0, TRACK_LIMITS.maxEvents)) {
    const name = (entry as Partial<TelemetryEntry> | undefined)?.name
    if (!isTelemetryEvent(name)) continue // unknown name → dropped, not stored
    const rawN = Number((entry as TelemetryEntry).n)
    const n = Number.isFinite(rawN) ? Math.floor(rawN) : 1
    if (n < 1) continue
    events.push({name, n: Math.min(n, TRACK_LIMITS.maxCountPerEvent)})
  }
  if (events.length === 0) return null

  return {sessionId: raw.sessionId, surface: raw.surface, events}
}

/** UTC day bucket (`2026-07-18`) — the granularity every rollup is keyed at. */
export function telemetryDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}
