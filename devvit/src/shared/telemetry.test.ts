import assert from 'node:assert/strict'
import {test} from 'node:test'
import {
  isSessionId,
  parseTrackReq,
  TRACK_LIMITS,
  telemetryDay,
} from './telemetry.ts'

/**
 * `parseTrackReq` is the only thing standing between an untrusted webview body and a set of Redis
 * key/field names. These tests are about that boundary, not about counting.
 */

const ok = {sessionId: 'a1b2c3d4-0000-4000-8000-000000000000', surface: 'lab'}

test('a well-formed batch survives intact', () => {
  const req = parseTrackReq({
    ...ok,
    events: [
      {name: 'boot', n: 1},
      {name: 'play', n: 3},
    ],
  })
  assert.deepEqual(req, {
    sessionId: ok.sessionId,
    surface: 'lab',
    events: [
      {name: 'boot', n: 1},
      {name: 'play', n: 3},
    ],
  })
})

test('unknown event names are dropped, not stored', () => {
  // The whole reason the whitelist exists: these would otherwise become hash fields.
  const req = parseTrackReq({
    ...ok,
    events: [
      {name: 'boot', n: 1},
      {name: 'e:injected', n: 1},
      {name: '../../escape', n: 1},
      {name: '__proto__', n: 1},
    ],
  })
  assert.deepEqual(req?.events, [{name: 'boot', n: 1}])
})

test('a batch of only unknown names is rejected outright', () => {
  assert.equal(parseTrackReq({...ok, events: [{name: 'nope', n: 1}]}), null)
})

test('session ids are validated by shape, since they become key fragments', () => {
  assert.ok(isSessionId(ok.sessionId))
  assert.ok(!isSessionId('has:colon'))
  assert.ok(!isSessionId('has spaces'))
  assert.ok(!isSessionId('short'))
  assert.ok(!isSessionId('x'.repeat(65)))
  assert.equal(
    parseTrackReq({...ok, sessionId: 'a:b', events: [{name: 'boot', n: 1}]}),
    null,
  )
})

test('an unknown surface is rejected', () => {
  assert.equal(
    parseTrackReq({...ok, surface: 'admin', events: [{name: 'boot', n: 1}]}),
    null,
  )
})

test('counts are clamped and junk counts default sanely', () => {
  const req = parseTrackReq({
    ...ok,
    events: [
      {name: 'play', n: 1e9},
      {name: 'pause', n: 'lots'},
      {name: 'restart', n: -5},
      {name: 'speed', n: 2.7},
    ],
  })
  assert.deepEqual(req?.events, [
    {name: 'play', n: TRACK_LIMITS.maxCountPerEvent},
    {name: 'pause', n: 1},
    // n < 1 is dropped entirely rather than coerced up.
    {name: 'speed', n: 2},
  ])
})

test('oversized batches are truncated', () => {
  const events = Array.from({length: 200}, () => ({name: 'play', n: 1}))
  const req = parseTrackReq({...ok, events})
  assert.ok((req?.events.length ?? 0) <= TRACK_LIMITS.maxEvents)
})

test('malformed bodies are null, never a throw', () => {
  for (const body of [
    undefined,
    null,
    0,
    'x',
    [],
    {},
    {...ok},
    {...ok, events: 'no'},
  ]) {
    assert.equal(parseTrackReq(body), null)
  }
})

test('days bucket in UTC', () => {
  assert.equal(telemetryDay(Date.UTC(2026, 6, 18, 23, 59)), '2026-07-18')
  assert.equal(telemetryDay(Date.UTC(2026, 6, 19, 0, 1)), '2026-07-19')
})
