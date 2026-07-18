import assert from 'node:assert/strict'
import {beforeEach, test} from 'node:test'
import {
  __resetTelemetryForTest,
  flushTelemetry,
  initTelemetry,
  track,
} from './telemetry.ts'

/**
 * These tests exist for one reason: the privacy properties of this module are claimed in a public
 * README and in the app's data disclosure, and a claim nobody checks is a claim that quietly stops
 * being true. Each test below pins a sentence someone else is relying on.
 */

let touched: {read: string[]; wrote: string[]}
let posted: {url: string; body: Record<string, unknown>}[]

beforeEach(() => {
  __resetTelemetryForTest()
  touched = {read: [], wrote: []}
  posted = []

  // A storage API that records every touch. If telemetry ever reads or writes the viewer's device,
  // these arrays are how we find out.
  const spy = {
    getItem: (k: string) => {
      touched.read.push(k)
      return null
    },
    setItem: (k: string) => void touched.wrote.push(k),
    removeItem: () => {},
  }
  for (const name of ['sessionStorage', 'localStorage']) {
    Object.defineProperty(globalThis, name, {value: spy, configurable: true})
  }
  Object.defineProperty(globalThis, 'document', {
    value: {visibilityState: 'visible', cookie: ''},
    configurable: true,
  })

  globalThis.fetch = (async (url: string, init: RequestInit) => {
    posted.push({url: String(url), body: JSON.parse(String(init.body))})
    return new Response('{}')
  }) as unknown as typeof fetch
})

test('nothing is ever stored on, or read from, the viewer’s device', () => {
  // The ePrivacy Art. 5(3) guarantee, and the reason this app needs no consent banner. If this
  // fails, the README's privacy section has become false.
  initTelemetry('lab')
  track('boot')
  track('play')
  track('draw', {once: true})
  flushTelemetry()

  assert.deepEqual(touched.read, [], 'read from device storage')
  assert.deepEqual(touched.wrote, [], 'wrote to device storage')
  assert.equal(document.cookie, '', 'set a cookie')
})

test('the session id is fresh per document and never reused', () => {
  const ids = new Set<string>()
  for (let i = 0; i < 5; i++) {
    __resetTelemetryForTest()
    initTelemetry('lab')
    track('boot')
    flushTelemetry()
    ids.add(String(posted.at(-1)?.body.sessionId))
  }
  // Five separate documents, five unrelated ids — this is what makes visits unlinkable.
  assert.equal(ids.size, 5)
})

test('the payload carries no identifier beyond the random session id', () => {
  initTelemetry('feed')
  track('boot')
  flushTelemetry()

  const body = posted.at(-1)?.body ?? {}
  // An allow-list, not a deny-list: a field added upstream should fail this test and make someone
  // justify it, rather than sail through because nobody thought to forbid it by name.
  assert.deepEqual(Object.keys(body).sort(), ['events', 'sessionId', 'surface'])
  assert.equal(body.surface, 'feed')
})

test('repeat events batch into one request rather than one request per click', () => {
  initTelemetry('lab')
  for (let i = 0; i < 30; i++) track('play')
  assert.equal(posted.length, 0, 'flushed before the timer')

  flushTelemetry()
  assert.equal(posted.length, 1)
  const events = posted[0]?.body.events as {name: string; n: number}[]
  assert.deepEqual(
    events.find(e => e.name === 'play'),
    {name: 'play', n: 30},
  )
})

test('an interaction implies engagement without each call site remembering to say so', () => {
  initTelemetry('lab')
  track('draw', {once: true})
  flushTelemetry()

  const events = posted.at(-1)?.body.events as {name: string}[]
  assert.ok(events.some(e => e.name === 'engaged'))
})

test('a boot with no interaction reports no engagement', () => {
  // The bounce case. If `engaged` leaked in here, the funnel would read 100% forever.
  initTelemetry('feed')
  track('boot')
  flushTelemetry()

  const events = posted.at(-1)?.body.events as {name: string}[]
  assert.deepEqual(
    events.map(e => e.name),
    ['boot'],
  )
})

test('a failing beacon is swallowed, never surfaced to the viewer', () => {
  globalThis.fetch = (() => {
    throw new Error('network down')
  }) as unknown as typeof fetch
  initTelemetry('lab')
  // The contract the whole module rests on: telemetry cannot break the post.
  assert.doesNotThrow(() => {
    track('boot')
    flushTelemetry()
  })
})

test('events before init are dropped rather than queued against an empty session', () => {
  track('play')
  flushTelemetry()
  assert.equal(posted.length, 0)
})
