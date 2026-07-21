/**
 * Telemetry storage and reporting. See ../shared/telemetry.ts for the privacy stance and the
 * event whitelist; this file is the Redis half.
 *
 * Three rollups, because they answer three different questions and one shape can't serve all three:
 *
 * - `m:d:{day}`      — everything that happened that day, split by surface. "Is the funnel working?"
 * - `m:p:{t3}:{day}` — the same, for one post. "Is *this specimen* landing?"
 * - `m:s:{sid}`      — one session's counts plus an ordered trail. "What does a visit look like?"
 *
 * Two counter families live in the day/post hashes and the difference matters more than anything
 * else here:
 *
 * - `ev:…` counts **occurrences**. Ten speed nudges are ten.
 * - `u:…`  counts **sessions that did it at least once**. Ten speed nudges are one.
 *
 * Funnels must be read off `u:` — `ev:` ratios are dominated by whoever fiddled the most, which is
 * exactly the person a UX funnel should not be weighted toward.
 */

import {redis} from '@devvit/web/server'
import type {T3} from '@devvit/web/shared'
import {
  speedBucket,
  type TelemetryEntry,
  type TelemetrySurface,
  telemetryDay,
} from '../shared/telemetry.ts'

/**
 * Retention. Long enough to see a trend, short enough that we are not sitting on a pile of
 * behavioral data nobody is going to read. Session trails are the most granular thing we keep, so
 * they expire first and by a wide margin.
 */
const TTL_SECONDS = {
  day: 90 * 24 * 60 * 60,
  post: 30 * 24 * 60 * 60,
  /** A sampled session, kept because its trail is readable in the report. */
  session: 7 * 24 * 60 * 60,
  /**
   * An unsampled session. Its record exists for exactly one job — deciding whether an event is
   * this session's *first*, which is what makes the `u:` counters unique — and that question is
   * only ever asked within the same UTC day. 26h covers the day plus slack for a visit that
   * straddles midnight; a 7-day TTL here was storing six days of data nothing could ever read.
   */
  sessionCounted: 26 * 60 * 60,
} as const

/**
 * Cap on the ordered trail. A trail is for reading a session's *shape* ("booted, played, opened the
 * lab, drew, left") and forty steps is well past where that stays legible.
 */
const MAX_TRAIL = 40

/**
 * How many sessions per day get a *detailed* record — an ordered trail, kept for 7 days.
 *
 * Past this, sessions are still counted in every aggregate; they just don't get a trail and their
 * record expires in a day instead of a week. Trails are a qualitative tool — you read five of them
 * to understand a funnel drop — so the marginal value of the 2001st is zero while its storage cost
 * is not.
 *
 * This is a real cap and the report says so out loud (see `_sampled`/`_seen`), because a silent
 * cap reads as "we saw everything" when we didn't.
 */
const MAX_DETAILED_SESSIONS_PER_DAY = 2000

/**
 * Individual session trails stay hidden until a day has at least this many sessions.
 *
 * A k-anonymity floor, and it exists because of who reads this report. Trails carry no identifier —
 * but on a small subreddit with three viewers in a day, a moderator reading "one lab session drew
 * and then posted a remix" can often work out whose it was from the post that appeared a minute
 * later. That is re-identification by context, and the fact that we did not *intend* to enable it
 * is not much of a defense. Reddit's Responsible Builder Policy is explicit that developers must
 * never attempt to re-identify or de-anonymize Redditors; a tool that makes it easy by accident is
 * the wrong side of that line.
 *
 * The aggregate funnel is unaffected — it is counts, and counts do not single anyone out.
 */
const MIN_SESSIONS_FOR_TRAILS = 10

const dayKey = (day: string): string => `m:d:${day}`
const postKey = (t3: T3, day: string): string => `m:p:${t3}:${day}`
const sessionKey = (sid: string): string => `m:s:${sid}`
const sessionIndexKey = (day: string): string => `m:si:${day}`
const postMetaKey = (t3: T3): string => `m:pm:${t3}`
/** Posts that have meta, so the report can walk them without a key scan (Devvit has no KEYS). */
const POST_INDEX_KEY = 'm:posts'

/** Cap on the post index, oldest evicted. Reporting reads all of these on every render. */
const MAX_INDEXED_POSTS = 500

/**
 * What a Live Specimen *is*, recorded once at creation so engagement can be sliced by it.
 *
 * Every field here is derived from the world code the author already posted — it is a property of
 * the artwork, not of anyone looking at it. That is the whole reason this is safe to keep: no
 * amount of joining it against the counters says anything about a person.
 */
export type PostMeta = {
  rulesetHex: string
  /** Mnemonic name, so the report is readable without decoding hex. */
  name: string
  /** `B2/S35` etc., or '' for raw 128-entry rules. */
  notation: string
  rows: number
  cols: number
  /** Ticks/second the author published it at. */
  speed: number
  /** Palette label — preset name where there is one, else the color mode, else 'custom'. */
  palette: string
}

/**
 * Record what a post is. Called once, at creation.
 *
 * Failures are swallowed: a specimen that exists but is missing from the analytics index is a
 * reporting gap, while a create path that throws because a counter failed is a broken product.
 */
export async function dbSetPostMeta(
  t3: T3,
  meta: PostMeta,
  nowMs: number,
): Promise<void> {
  try {
    await redis.hSet(postMetaKey(t3), {
      rulesetHex: meta.rulesetHex,
      name: meta.name,
      notation: meta.notation,
      rows: String(meta.rows),
      cols: String(meta.cols),
      speed: String(meta.speed),
      palette: meta.palette,
    })
    await redis.hSet(POST_INDEX_KEY, {[t3]: String(nowMs)})

    // Devvit's Redis has no key scan, so this index is the only way to enumerate posts — which
    // means it must be trimmed here or it grows forever. Oldest out.
    const idx = (await redis.hGetAll(POST_INDEX_KEY)) ?? {}
    const overflow = Object.entries(idx)
      .sort(([, a], [, b]) => Number(a) - Number(b))
      .slice(0, Math.max(0, Object.keys(idx).length - MAX_INDEXED_POSTS))
    for (const [old] of overflow) {
      await redis.hDel(POST_INDEX_KEY, [old])
      await redis.del(postMetaKey(old as T3))
    }
  } catch (err) {
    console.warn(`dbSetPostMeta: could not record meta for ${t3}:`, err)
  }
}

/** Drop a deleted post's identity alongside its counters. */
async function dropPostMeta(t3: T3): Promise<void> {
  try {
    await redis.del(postMetaKey(t3))
    await redis.hDel(POST_INDEX_KEY, [t3])
  } catch {
    /* best effort */
  }
}

/**
 * Record a validated batch.
 *
 * Never throws: telemetry that can break a post is worse than no telemetry. The caller answers 200
 * regardless, so a Redis hiccup costs some counters and nothing else.
 *
 * `postId` comes from the server's own `context`, never from the request body — otherwise any
 * client could attribute its events to someone else's post.
 */
export async function dbTrack(input: {
  sessionId: string
  surface: TelemetrySurface
  events: readonly TelemetryEntry[]
  postId?: T3
  nowMs: number
}): Promise<void> {
  const {sessionId, surface, events, postId, nowMs} = input
  const day = telemetryDay(nowMs)
  const sKey = sessionKey(sessionId)
  const dKey = dayKey(day)

  try {
    // What this session has already reported, so repeat events don't re-count as unique reach and
    // don't re-appear in the trail. A flush is not the unit of anything — a session is.
    const prior = (await redis.hGetAll(sKey)) ?? {}
    const isNewSession = !prior.t0

    // Sampling is decided once, on the session's first batch, and remembered — otherwise a session
    // could be detailed on one flush and not the next, and its trail would come out with holes.
    const detailed = isNewSession
      ? await claimDetailSlot(day, sessionId, nowMs)
      : prior.d === '1'

    const trailAdds: string[] = []
    for (const {name, n} of events) {
      const field = `e:${name}`
      const firstTime = !(Number(prior[field] ?? 0) > 0)

      await redis.hIncrBy(sKey, field, n)
      await redis.hIncrBy(dKey, `ev:${surface}:${name}`, n)
      if (postId) await redis.hIncrBy(postKey(postId, day), `ev:${name}`, n)

      if (firstTime) {
        await redis.hIncrBy(dKey, `u:${surface}:${name}`, 1)
        if (postId) await redis.hIncrBy(postKey(postId, day), `u:${name}`, 1)
        // Mark it locally too: the same name can appear twice in one batch.
        prior[field] = String(n)
        trailAdds.push(name)
      }
    }

    await redis.hSet(sKey, {
      ...(isNewSession
        ? {
            t0: String(nowMs),
            surface,
            d: detailed ? '1' : '0',
            ...(postId ? {post: postId} : {}),
          }
        : {}),
      tn: String(nowMs),
      // Unsampled sessions carry no trail at all — it is the only field here that grows with use,
      // and nothing will ever read it.
      ...(detailed ? {trail: appendTrail(prior.trail ?? '', trailAdds)} : {}),
    })
    await redis.expire(
      sKey,
      detailed ? TTL_SECONDS.session : TTL_SECONDS.sessionCounted,
    )

    if (isNewSession) {
      await redis.hIncrBy(dKey, `u:${surface}:_sessions`, 1)
    }

    await redis.expire(dKey, TTL_SECONDS.day)
    if (postId) await redis.expire(postKey(postId, day), TTL_SECONDS.post)
  } catch (err) {
    console.warn('dbTrack: dropping telemetry batch:', err)
  }
}

/**
 * How long a session stayed, read off its own dwell markers.
 *
 * The obvious implementation — last report time minus first — is wrong, and visibly so: a session
 * that flushed exactly once renders as `0s` no matter how long it actually lasted, which is what
 * every short lab visit did in the first live run. The timestamps bound *reporting*, not presence.
 * The dwell markers are the real measurement, and quoting them keeps this consistent with the rest
 * of the design: buckets, never a precise duration.
 */
function dwellBucket(trail: string): string {
  if (trail.includes('dwell_120s')) return '2m+'
  if (trail.includes('dwell_30s')) return '30s+'
  if (trail.includes('dwell_5s')) return '5s+'
  return '<5s'
}

function appendTrail(existing: string, adds: readonly string[]): string {
  if (adds.length === 0) return existing
  const parts = existing ? existing.split('>') : []
  parts.push(...adds)
  // Keep the *head*: how a session starts is the part that explains where it went wrong. A tail
  // window would throw away the boot every time and leave a trail that starts mid-story.
  return parts.slice(0, MAX_TRAIL).join('>')
}

/**
 * Try to claim one of the day's detailed-session slots. Returns whether this session got one.
 *
 * Also records how many sessions were *seen* versus sampled, so the report can state the shortfall
 * instead of quietly presenting a sample as the whole picture.
 */
async function claimDetailSlot(
  day: string,
  sessionId: string,
  nowMs: number,
): Promise<boolean> {
  const key = sessionIndexKey(day)
  await redis.hIncrBy(dayKey(day), '_seen', 1)

  const idx = (await redis.hGetAll(key)) ?? {}
  if (Object.keys(idx).length >= MAX_DETAILED_SESSIONS_PER_DAY) return false

  await redis.hSet(key, {[sessionId]: String(nowMs)})
  await redis.expire(key, TTL_SECONDS.session)
  await redis.hIncrBy(dayKey(day), '_sampled', 1)
  return true
}

/** Drop a deleted post's per-post counters and identity, alongside its world code. */
export async function dbDeletePostMetrics(
  t3: T3,
  nowMs: number,
): Promise<void> {
  // Only the recent windows are worth chasing; the rest age out on their own TTL.
  for (let back = 0; back < TTL_SECONDS.post / 86_400; back++) {
    const day = telemetryDay(nowMs - back * 86_400_000)
    try {
      await redis.del(postKey(t3, day))
    } catch {
      /* best effort — TTL will collect it */
    }
  }
  await dropPostMeta(t3)
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Funnel steps, in the order a viewer would go through them. */
const FEED_FUNNEL: readonly [label: string, event: string][] = [
  ['world rendered', 'boot'],
  ['any interaction', 'engaged'],
  ['pressed play', 'play'],
  ['stayed 30s+', 'dwell_30s'],
  ['opened the lab', 'expand'],
]

const LAB_FUNNEL: readonly [label: string, event: string][] = [
  ['world rendered', 'boot'],
  ['any interaction', 'engaged'],
  ['drew cells', 'draw'],
  ['stayed 30s+', 'dwell_30s'],
  ['opened remix form', 'remix_start'],
  ['posted a remix', 'remix_posted'],
]

/** Interesting-but-not-funnel counters, reported as unique sessions. */
const SIDE_EVENTS: readonly [label: string, event: string][] = [
  ['ruleset card opened', 'ruleset_open'],
  ['copied the hex', 'copy_hex'],
  ['opened Explorer', 'explorer_open'],
  ['rule card → Explorer', 'rulecard_explorer'],
  ['restarted', 'restart'],
  ['changed speed', 'speed'],
  ['  └ settled slow (<10/s)', 'speed_slow'],
  ['  └ settled mid (10–40/s)', 'speed_mid'],
  ['  └ settled fast (>40/s)', 'speed_fast'],
  ['remix cancelled at form', 'remix_cancel'],
  ['pasted-code create', 'create_posted'],
  ['boot failed', 'boot_error'],
  ['pressed retry', 'retry'],
  ['no WebGL2 (blocked)', 'gpu_blocked'],
  ['software-rendered', 'gpu_slow'],
]

/**
 * Human-readable report over the last `days` days.
 *
 * Rendered as text rather than a table because the only surface Devvit gives us for showing a blob
 * to a moderator is a form field. Kept narrow for phones.
 */
export async function buildMetricsReport(
  nowMs: number,
  days = 7,
): Promise<string> {
  const totals = new Map<string, number>()
  const dayLabels: string[] = []

  for (let back = 0; back < days; back++) {
    const day = telemetryDay(nowMs - back * 86_400_000)
    dayLabels.push(day)
    let hash: Record<string, string> = {}
    try {
      hash = (await redis.hGetAll(dayKey(day))) ?? {}
    } catch (err) {
      console.warn(`buildMetricsReport: no data for ${day}:`, err)
    }
    for (const [field, value] of Object.entries(hash)) {
      const n = Number(value)
      if (Number.isFinite(n)) totals.set(field, (totals.get(field) ?? 0) + n)
    }
  }

  const uniq = (surface: string, event: string): number =>
    totals.get(`u:${surface}:${event}`) ?? 0
  const occurrences = (surface: string, event: string): number =>
    totals.get(`ev:${surface}:${event}`) ?? 0

  const feedSessions = uniq('feed', '_sessions')
  const labSessions = uniq('lab', '_sessions')

  const lines: string[] = [
    `HexLife usage — last ${days} day(s)`,
    `${dayLabels[dayLabels.length - 1]} → ${dayLabels[0]} (UTC)`,
    '',
    `Sessions: ${feedSessions + labSessions}  (feed ${feedSessions}, lab ${labSessions})`,
    '',
  ]

  lines.push(...funnelBlock('FEED CARD', FEED_FUNNEL, 'feed', uniq))
  lines.push('')
  lines.push(...funnelBlock('EXPANDED LAB', LAB_FUNNEL, 'lab', uniq))

  lines.push('', 'OTHER (unique sessions, feed + lab)')
  for (const [label, event] of SIDE_EVENTS) {
    const n = uniq('feed', event) + uniq('lab', event)
    const raw = occurrences('feed', event) + occurrences('lab', event)
    if (n === 0 && raw === 0) continue
    lines.push(`  ${label.padEnd(26)} ${String(n).padStart(5)}  (${raw} total)`)
  }

  // No silent caps: if detailed sampling dropped sessions, the report has to say so rather than
  // present a sample as the whole picture.
  const seen = totals.get('_seen') ?? 0
  const sampled = totals.get('_sampled') ?? 0
  if (seen > sampled) {
    lines.push(
      '',
      `NOTE: ${seen - sampled} of ${seen} sessions exceeded the daily detail cap.`,
      'They are fully counted above; only their individual trails were not kept.',
    )
  }

  if (feedSessions + labSessions === 0) {
    lines.push(
      '',
      'No sessions recorded yet. Counters are written when someone opens a',
      'Live Specimen post; a fresh install has nothing to show.',
    )
  } else if (feedSessions + labSessions < 30) {
    // Said plainly, because the failure mode here is reading a UX conclusion off n=4.
    lines.push(
      '',
      `NOTE: ${feedSessions + labSessions} sessions is too few to draw conclusions from.`,
      'Treat these as directional only until the count is in the hundreds.',
    )
  }

  return lines.join('\n')
}

/**
 * Engagement per post, and rolled up by the two properties an author actually controls: the
 * ruleset and the palette.
 *
 * The metric is **engaged ÷ rendered** — of the people who saw this world, how many touched it.
 * Raw view counts would just rank posts by how well the Reddit feed happened to treat them, which
 * says nothing about the world itself. A rate is comparable across posts with wildly different
 * reach, which is the only way "is this palette landing?" becomes answerable.
 *
 * Posts below {@link MIN_VIEWS_FOR_RATE} renders are listed but not rated: one viewer who happened
 * to tap is not a 100% engagement rate, and printing it as one invites exactly the wrong call.
 */
export async function buildPostReport(
  nowMs: number,
  days = 7,
  limit = 12,
): Promise<string> {
  let idx: Record<string, string> = {}
  try {
    idx = (await redis.hGetAll(POST_INDEX_KEY)) ?? {}
  } catch (err) {
    console.warn('buildPostReport: no post index:', err)
  }

  const rows: {
    meta: PostMeta
    t3: string
    rendered: number
    engaged: number
  }[] = []

  for (const t3 of Object.keys(idx)) {
    const meta = await readPostMeta(t3 as T3)
    if (!meta) continue

    let rendered = 0
    let engaged = 0
    for (let back = 0; back < days; back++) {
      const day = telemetryDay(nowMs - back * 86_400_000)
      let hash: Record<string, string> = {}
      try {
        hash = (await redis.hGetAll(postKey(t3 as T3, day))) ?? {}
      } catch {
        continue
      }
      rendered += Number(hash['u:boot'] ?? 0)
      engaged += Number(hash['u:engaged'] ?? 0)
    }
    if (rendered > 0) rows.push({meta, t3, rendered, engaged})
  }

  const lines: string[] = [
    `POSTS — last ${days} day(s), by engagement rate`,
    '',
  ]
  if (rows.length === 0) {
    lines.push(
      '  No per-post data yet. Posts created before this build carry no',
      '  ruleset/palette record, so only newly created specimens appear here.',
    )
    return lines.join('\n')
  }

  const rate = (r: {rendered: number; engaged: number}): number =>
    r.rendered >= MIN_VIEWS_FOR_RATE ? r.engaged / r.rendered : -1

  for (const row of [...rows]
    .sort((a, b) => rate(b) - rate(a))
    .slice(0, limit)) {
    const pct =
      rate(row) < 0 ? '  n/a' : `${Math.round(rate(row) * 100)}%`.padStart(5)
    const label = `${row.meta.name}${row.meta.notation ? ` ${row.meta.notation}` : ''}`
    lines.push(
      `  ${pct}  ${String(row.engaged).padStart(3)}/${String(row.rendered).padEnd(4)} ${label.slice(0, 30).padEnd(30)} ${row.meta.palette}`,
    )
  }
  if (rows.some(r => rate(r) < 0)) {
    lines.push(
      '',
      `  n/a = under ${MIN_VIEWS_FOR_RATE} views; too few to rate.`,
    )
  }

  lines.push('', ...dimensionBlock('BY RULESET', rows, r => r.meta.name))
  lines.push('', ...dimensionBlock('BY PALETTE', rows, r => r.meta.palette))
  lines.push(
    '',
    ...dimensionBlock('BY AUTHORED SPEED', rows, r =>
      String(speedBucket(r.meta.speed)).replace('speed_', ''),
    ),
  )
  return lines.join('\n')
}

/** Below this many renders a post's engagement rate is noise, and is reported as such. */
const MIN_VIEWS_FOR_RATE = 8

async function readPostMeta(t3: T3): Promise<PostMeta | undefined> {
  let h: Record<string, string> = {}
  try {
    h = (await redis.hGetAll(postMetaKey(t3))) ?? {}
  } catch {
    return undefined
  }
  if (!h.rulesetHex) return undefined
  return {
    rulesetHex: h.rulesetHex,
    name: h.name ?? h.rulesetHex.slice(0, 8),
    notation: h.notation ?? '',
    rows: Number(h.rows ?? 0),
    cols: Number(h.cols ?? 0),
    speed: Number(h.speed ?? 0),
    palette: h.palette ?? '?',
  }
}

/** Group posts by some property and show the pooled engagement rate for each value. */
function dimensionBlock(
  title: string,
  rows: {meta: PostMeta; rendered: number; engaged: number}[],
  key: (row: {meta: PostMeta}) => string,
): string[] {
  const groups = new Map<
    string,
    {rendered: number; engaged: number; n: number}
  >()
  for (const row of rows) {
    const k = key(row) || '?'
    const g = groups.get(k) ?? {rendered: 0, engaged: 0, n: 0}
    g.rendered += row.rendered
    g.engaged += row.engaged
    g.n += 1
    groups.set(k, g)
  }

  const lines = [`${title} (pooled across posts)`]
  // Unrated groups sort last, not first. Ranking by the raw ratio while *displaying* n/a put a
  // 3-view post at the top of the table — the one place a reader's eye lands — showing off the one
  // group we had just said we could not measure.
  const rateOf = (g: {rendered: number; engaged: number}): number =>
    g.rendered >= MIN_VIEWS_FOR_RATE ? g.engaged / g.rendered : -1
  const sorted = [...groups.entries()].sort(
    ([, a], [, b]) => rateOf(b) - rateOf(a),
  )
  for (const [name, g] of sorted) {
    // Pooling helps — five posts sharing a palette clear the bar together — but not always enough.
    const pct =
      rateOf(g) < 0
        ? '  n/a'
        : `${Math.round((g.engaged / g.rendered) * 100)}%`.padStart(5)
    lines.push(
      `  ${pct}  ${String(g.rendered).padStart(4)} views  ${String(g.n).padStart(2)} post(s)  ${name.slice(0, 28)}`,
    )
  }
  return lines
}

function funnelBlock(
  title: string,
  steps: readonly (readonly [string, string])[],
  surface: string,
  uniq: (surface: string, event: string) => number,
): string[] {
  const lines = [`${title} (unique sessions)`]
  const top = uniq(surface, steps[0]?.[1] ?? 'boot')
  for (const [label, event] of steps) {
    const n = uniq(surface, event)
    const pct = top > 0 ? `${Math.round((n / top) * 100)}%` : '—'
    lines.push(`  ${label.padEnd(22)} ${String(n).padStart(5)}  ${pct}`)
  }
  return lines
}

/**
 * A sample of recent session trails — the "what happens in one visit" view, which no aggregate
 * can give you. Reading five of these tends to explain a funnel drop that the percentages only
 * flag. Sessions with a single `boot` step are omitted: they are the bounce count, already in the
 * funnel, and they crowd out the sessions that have a story.
 */
export async function buildSessionTrails(
  nowMs: number,
  limit = 12,
): Promise<string> {
  const day = telemetryDay(nowMs)
  let idx: Record<string, string> = {}
  try {
    idx = (await redis.hGetAll(sessionIndexKey(day))) ?? {}
  } catch (err) {
    console.warn('buildSessionTrails: no index:', err)
  }

  const lines: string[] = [`SESSION TRAILS — ${day} (UTC), newest first`, '']

  // The k-anonymity floor, checked before anything individual is read, let alone rendered.
  const sessionCount = Object.keys(idx).length
  if (sessionCount < MIN_SESSIONS_FOR_TRAILS) {
    lines.push(
      `  Hidden — only ${sessionCount} session(s) today.`,
      `  Individual trails appear once a day has ${MIN_SESSIONS_FOR_TRAILS}+, so that a single`,
      '  visit cannot be matched to the person who made it. The funnel above is unaffected.',
    )
    return lines.join('\n')
  }

  const recent = Object.entries(idx)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, limit * 4)
  let shown = 0
  for (const [sid] of recent) {
    if (shown >= limit) break
    let sess: Record<string, string> = {}
    try {
      sess = (await redis.hGetAll(sessionKey(sid))) ?? {}
    } catch {
      continue
    }
    const trail = sess.trail
    // Boot-only trails are the bounce count — already in the funnel, and they would crowd out
    // every session that actually has a story.
    if (!trail?.includes('>')) continue
    lines.push(
      `  [${sess.surface ?? '?'} ${dwellBucket(trail)}] ${trail.replaceAll('>', ' → ')}`,
    )
    shown++
  }

  if (shown === 0) {
    lines.push('  (no multi-step sessions recorded today)')
  }
  return lines.join('\n')
}
