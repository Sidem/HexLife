import assert from 'node:assert/strict'
import {beforeEach, test} from 'node:test'
import {redis} from '@devvit/web/server'
import type {T3} from '@devvit/web/shared'
import {
  buildMetricsReport,
  buildPostReport,
  buildSessionTrails,
  dbDeletePostMetrics,
  dbSetPostMeta,
  dbTrack,
} from './metrics.ts'

/**
 * The distinction the whole reporting layer rests on: `ev:` counts occurrences and `u:` counts
 * sessions that did a thing at least once. A funnel read off the wrong one is dominated by whoever
 * clicked the most, which is the reader these numbers are least meant to describe.
 */

/** In-memory stand-in for the hash subset metrics.ts uses. */
const store = new Map<string, Map<string, string>>()
const hash = (key: string): Map<string, string> => {
  const existing = store.get(key)
  if (existing) return existing
  const fresh = new Map<string, string>()
  store.set(key, fresh)
  return fresh
}

redis.hGetAll = (async (key: string) =>
  Object.fromEntries(store.get(key) ?? [])) as typeof redis.hGetAll
redis.hIncrBy = (async (key: string, field: string, by: number) => {
  const h = hash(key)
  const next = Number(h.get(field) ?? 0) + by
  h.set(field, String(next))
  return next
}) as typeof redis.hIncrBy
redis.hSet = (async (key: string, values: Record<string, string>) => {
  const h = hash(key)
  for (const [k, v] of Object.entries(values)) h.set(k, v)
  return Object.keys(values).length
}) as typeof redis.hSet
redis.del = (async (...keys: string[]) => {
  for (const key of keys) store.delete(key)
}) as typeof redis.del
redis.hDel = (async (key: string, fields: string[]) => {
  const h = hash(key)
  let n = 0
  for (const f of fields) if (h.delete(f)) n++
  return n
}) as typeof redis.hDel

/** Last TTL applied per key — the sampled/unsampled split is a retention promise, so it is tested. */
const ttls = new Map<string, number>()
redis.expire = (async (key: string, seconds: number) => {
  ttls.set(key, seconds)
}) as typeof redis.expire

const NOW = Date.UTC(2026, 6, 18, 12, 0)
const POST = 't3_abc' as T3

beforeEach(() => {
  store.clear()
  ttls.clear()
})

const day = (): Map<string, string> => hash('m:d:2026-07-18')

test('repeat events add to occurrences but not to unique reach', async () => {
  // Same session, two flushes, `play` in both — one session that played, three plays.
  await dbTrack({
    sessionId: 'sess-one-0000',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'play', n: 2},
    ],
    postId: POST,
    nowMs: NOW,
  })
  await dbTrack({
    sessionId: 'sess-one-0000',
    surface: 'lab',
    events: [{name: 'play', n: 1}],
    postId: POST,
    nowMs: NOW + 5_000,
  })

  assert.equal(day().get('ev:lab:play'), '3')
  assert.equal(day().get('u:lab:play'), '1')
  assert.equal(day().get('u:lab:_sessions'), '1')
})

test('two sessions doing the same thing count as two', async () => {
  for (const sid of ['sess-aaa-0000', 'sess-bbb-0000']) {
    await dbTrack({
      sessionId: sid,
      surface: 'feed',
      events: [
        {name: 'boot', n: 1},
        {name: 'play', n: 1},
      ],
      nowMs: NOW,
    })
  }
  assert.equal(day().get('u:feed:play'), '2')
  assert.equal(day().get('u:feed:_sessions'), '2')
})

test('surfaces are counted apart, so feed and lab funnels never blend', async () => {
  await dbTrack({
    sessionId: 'sess-feed-000',
    surface: 'feed',
    events: [{name: 'boot', n: 1}],
    nowMs: NOW,
  })
  await dbTrack({
    sessionId: 'sess-lab-0000',
    surface: 'lab',
    events: [{name: 'boot', n: 1}],
    nowMs: NOW,
  })
  assert.equal(day().get('u:feed:boot'), '1')
  assert.equal(day().get('u:lab:boot'), '1')
})

test('per-post counters are kept alongside the global ones', async () => {
  await dbTrack({
    sessionId: 'sess-post-000',
    surface: 'lab',
    events: [{name: 'draw', n: 4}],
    postId: POST,
    nowMs: NOW,
  })
  const post = hash('m:p:t3_abc:2026-07-18')
  assert.equal(post.get('ev:draw'), '4')
  assert.equal(post.get('u:draw'), '1')
})

test('a session with no post id still counts globally', async () => {
  // The install-demo path has no postId; dropping those events would silently undercount.
  await dbTrack({
    sessionId: 'sess-nopost-00',
    surface: 'lab',
    events: [{name: 'boot', n: 1}],
    nowMs: NOW,
  })
  assert.equal(day().get('u:lab:boot'), '1')
})

test('the trail records first occurrences in order, across flushes', async () => {
  await dbTrack({
    sessionId: 'sess-trail-000',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'play', n: 1},
    ],
    nowMs: NOW,
  })
  await dbTrack({
    sessionId: 'sess-trail-000',
    surface: 'lab',
    // `play` again — already in the trail, so it must not repeat.
    events: [
      {name: 'play', n: 1},
      {name: 'draw', n: 1},
    ],
    nowMs: NOW + 1_000,
  })
  assert.equal(hash('m:s:sess-trail-000').get('trail'), 'boot>play>draw')
})

test('the report reads its funnel off unique sessions, not clicks', async () => {
  // One very busy session and one that only booted. A click-weighted funnel would read 100%
  // engagement; the honest answer is one of two.
  await dbTrack({
    sessionId: 'sess-busy-0000',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'engaged', n: 1},
      {name: 'play', n: 40},
    ],
    nowMs: NOW,
  })
  await dbTrack({
    sessionId: 'sess-idle-0000',
    surface: 'lab',
    events: [{name: 'boot', n: 1}],
    nowMs: NOW,
  })

  const report = await buildMetricsReport(NOW, 7)
  assert.match(report, /Sessions: 2/)
  // "any interaction  1  50%" — not 40, and not 100%.
  assert.match(report, /any interaction\s+1\s+50%/)
  assert.match(report, /world rendered\s+2\s+100%/)
  // Small-n honesty note, so nobody reads a UX verdict off two sessions.
  assert.match(report, /too few to draw conclusions/)
})

test('an empty install reports nothing rather than a wall of zeroes', async () => {
  const report = await buildMetricsReport(NOW, 7)
  assert.match(report, /No sessions recorded yet/)
})

/** Enough sessions to clear the k-anonymity floor, plus whatever the test cares about. */
async function padSessions(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await dbTrack({
      sessionId: `pad-${String(i).padStart(9, '0')}`,
      surface: 'feed',
      events: [{name: 'boot', n: 1}],
      nowMs: NOW,
    })
  }
}

test('trails show multi-step sessions and omit pure bounces', async () => {
  await padSessions(12)
  await dbTrack({
    sessionId: 'sess-story-000',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'draw', n: 1},
    ],
    nowMs: NOW,
  })
  await dbTrack({
    sessionId: 'sess-bounce-00',
    surface: 'feed',
    events: [{name: 'boot', n: 1}],
    nowMs: NOW,
  })

  const trails = await buildSessionTrails(NOW, 12)
  assert.match(trails, /boot → draw/)
  assert.doesNotMatch(trails, /sess-bounce/)
  // Exactly one line of story, so the bounces really were dropped rather than rendered empty.
  assert.equal(trails.split('\n').filter(l => l.includes('→')).length, 1)
})

test('individual trails stay hidden on a day too small to hide anyone in', async () => {
  // The re-identification case: two sessions, one of which drew and posted. On a small sub a
  // moderator could match that to the post that appeared moments later.
  await dbTrack({
    sessionId: 'sess-lonely-00',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'draw', n: 1},
      {name: 'remix_posted', n: 1},
    ],
    nowMs: NOW,
  })

  const trails = await buildSessionTrails(NOW, 12)
  assert.match(trails, /Hidden — only 1 session/)
  // The behavior itself must not leak while the explanation is rendered.
  assert.doesNotMatch(trails, /remix_posted/)
  assert.doesNotMatch(trails, /→/)
})

test('the aggregate funnel is unaffected by the trail floor', async () => {
  // Counts don't single anyone out, so suppressing trails must not suppress the numbers.
  await dbTrack({
    sessionId: 'sess-lonely-00',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'draw', n: 1},
    ],
    nowMs: NOW,
  })
  const report = await buildMetricsReport(NOW, 7)
  assert.match(report, /drew cells\s+1\s+100%/)
})

test('trail dwell is read off the markers, not the gap between flushes', async () => {
  await padSessions(12)
  // One flush only. A tn−t0 duration would render this as "0s" however long the visit really was,
  // which is exactly what the first live run showed for every short lab session.
  await dbTrack({
    sessionId: 'sess-onefls-00',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'draw', n: 1},
      {name: 'dwell_30s', n: 1},
    ],
    nowMs: NOW,
  })
  const trails = await buildSessionTrails(NOW, 12)
  assert.match(trails, /\[lab 30s\+\]/)
  assert.doesNotMatch(trails, /\[lab 0s\]/)
})

test('sessions past the detail cap are still counted, but keep no trail', async () => {
  // Force the cap low by filling the index, then prove the overflow session is fully counted.
  const CAP = 2000
  const idx = hash('m:si:2026-07-18')
  for (let i = 0; i < CAP; i++) idx.set(`filler-${i}`, String(NOW))

  await dbTrack({
    sessionId: 'sess-overflow0',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'draw', n: 1},
    ],
    nowMs: NOW,
  })

  // Counted in every aggregate — this is the part that must not degrade.
  assert.equal(day().get('u:lab:boot'), '1')
  assert.equal(day().get('u:lab:draw'), '1')
  assert.equal(day().get('u:lab:_sessions'), '1')

  // But no trail, and a one-day TTL instead of a week.
  const sess = hash('m:s:sess-overflow0')
  assert.equal(sess.get('trail'), undefined)
  assert.equal(sess.get('d'), '0')
  assert.equal(ttls.get('m:s:sess-overflow0'), 26 * 60 * 60)
})

test('a sampled session keeps its trail and the longer retention', async () => {
  await dbTrack({
    sessionId: 'sess-sampled-0',
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'draw', n: 1},
    ],
    nowMs: NOW,
  })
  assert.equal(hash('m:s:sess-sampled-0').get('trail'), 'boot>draw')
  assert.equal(ttls.get('m:s:sess-sampled-0'), 7 * 24 * 60 * 60)
})

test('the report names the sampling shortfall instead of hiding it', async () => {
  const idx = hash('m:si:2026-07-18')
  for (let i = 0; i < 2000; i++) idx.set(`filler-${i}`, String(NOW))
  await dbTrack({
    sessionId: 'sess-overflow0',
    surface: 'lab',
    events: [{name: 'boot', n: 1}],
    nowMs: NOW,
  })
  const report = await buildMetricsReport(NOW, 7)
  assert.match(report, /exceeded the daily detail cap/)
})

test('posts are ranked by engagement rate, not by how much reach they got', async () => {
  // A popular-but-ignored post against a small-but-sticky one. Ranking by raw views would put the
  // first on top and teach exactly the wrong lesson about what makes a good specimen.
  await dbSetPostMeta(
    't3_popular' as T3,
    {
      rulesetHex: 'A'.repeat(32),
      name: 'Dull Drift',
      notation: 'B2/S3',
      rows: 64,
      cols: 74,
      speed: 20,
      palette: 'ember',
    },
    NOW,
  )
  await dbSetPostMeta(
    't3_sticky' as T3,
    {
      rulesetHex: 'B'.repeat(32),
      name: 'Cobalt Lattice',
      notation: 'B2o3p/S2',
      rows: 64,
      cols: 74,
      speed: 50,
      palette: 'cobalt',
    },
    NOW,
  )

  const seed = async (t3: string, boots: number, engaged: number) => {
    const h = hash(`m:p:${t3}:2026-07-18`)
    h.set('u:boot', String(boots))
    h.set('u:engaged', String(engaged))
  }
  await seed('t3_popular', 100, 5)
  await seed('t3_sticky', 20, 14)

  const report = await buildPostReport(NOW, 7, 12)
  const sticky = report.indexOf('Cobalt Lattice')
  const popular = report.indexOf('Dull Drift')
  assert.ok(sticky >= 0 && popular >= 0, 'both posts listed')
  assert.ok(sticky < popular, 'the higher-rate post ranks first')
  assert.match(report, /70%/)
  assert.match(report, /BY PALETTE/)
  assert.match(report, /cobalt/)
})

test('a post with barely any views is listed but not given a rate', async () => {
  // One viewer who happened to tap is not a 100% engagement rate.
  await dbSetPostMeta(
    't3_tiny' as T3,
    {
      rulesetHex: 'C'.repeat(32),
      name: 'Fresh Post',
      notation: '',
      rows: 64,
      cols: 74,
      speed: 20,
      palette: 'default',
    },
    NOW,
  )
  const h = hash('m:p:t3_tiny:2026-07-18')
  h.set('u:boot', '2')
  h.set('u:engaged', '2')

  const report = await buildPostReport(NOW, 7, 12)
  assert.match(report, /Fresh Post/)
  assert.match(report, /n\/a/)
  assert.doesNotMatch(report, /100%/)
})

test('unrated groups sort to the bottom of a dimension table, not the top', async () => {
  // A 3-view post scores 1.0 on the raw ratio. Sorting by that while displaying "n/a" put the one
  // group we cannot measure at the top of the table, where the eye lands first.
  const mk = async (
    t3: string,
    palette: string,
    boots: number,
    engaged: number,
  ) => {
    await dbSetPostMeta(
      t3 as T3,
      {
        rulesetHex: 'E'.repeat(32),
        name: t3,
        notation: '',
        rows: 64,
        cols: 74,
        speed: 20,
        palette,
      },
      NOW,
    )
    const h = hash(`m:p:${t3}:2026-07-18`)
    h.set('u:boot', String(boots))
    h.set('u:engaged', String(engaged))
  }
  await mk('t3_measured', 'cobalt', 50, 30)
  await mk('t3_unrated', 'moss', 3, 3)

  const report = await buildPostReport(NOW, 7, 12)
  const table = report.slice(report.indexOf('BY PALETTE'))
  assert.ok(
    table.indexOf('cobalt') < table.indexOf('moss'),
    'the measurable group must rank above the unrated one',
  )
})

test('deleting a post removes its identity, not just its counters', async () => {
  await dbSetPostMeta(
    't3_gone' as T3,
    {
      rulesetHex: 'D'.repeat(32),
      name: 'Doomed',
      notation: '',
      rows: 64,
      cols: 74,
      speed: 20,
      palette: 'default',
    },
    NOW,
  )
  hash('m:p:t3_gone:2026-07-18').set('u:boot', '9')

  await dbDeletePostMetrics('t3_gone' as T3, NOW)

  assert.equal(store.get('m:pm:t3_gone'), undefined)
  assert.equal(hash('m:posts').get('t3_gone'), undefined)
  const report = await buildPostReport(NOW, 7, 12)
  assert.doesNotMatch(report, /Doomed/)
})

test('a redis failure loses the batch and nothing else', async () => {
  const realIncr = redis.hIncrBy
  redis.hIncrBy = (async () => {
    throw new Error('redis down')
  }) as typeof redis.hIncrBy
  const warn = console.warn
  console.warn = () => {}
  try {
    // The contract the webview depends on: this resolves, it does not throw.
    await dbTrack({
      sessionId: 'sess-boom-0000',
      surface: 'lab',
      events: [{name: 'boot', n: 1}],
      nowMs: NOW,
    })
  } finally {
    redis.hIncrBy = realIncr
    console.warn = warn
  }
})
