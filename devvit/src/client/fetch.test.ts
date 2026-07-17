import assert from 'node:assert/strict'
import {afterEach, beforeEach, test} from 'node:test'
import {fetchWorldCode} from './fetch.ts'

/**
 * The distinction this module exists for: "this post has no world" and "we could not find out"
 * look identical to a caller that only gets `string | undefined` back, and the webview renders
 * them very differently — the built-in demo for the first, an honest error for the second.
 */

let errors: string[] = []
const realError = console.error

beforeEach(() => {
  errors = []
  console.error = (msg: unknown) => void errors.push(String(msg))
})

afterEach(() => {
  console.error = realError
})

/** A `fetch` that answers once with the given response. */
function stub(rsp: Response | Error): typeof fetch {
  return (async () => {
    if (rsp instanceof Error) throw rsp
    return rsp
  }) as unknown as typeof fetch
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  })
}

test('a stored code comes back as ok', async () => {
  const rsp = await fetchWorldCode(stub(json({code: 'HXW1.abc'})))
  assert.deepEqual(rsp, {ok: true, code: 'HXW1.abc'})
  assert.equal(errors.length, 0)
})

test('no code stored is ok-with-no-code, not a failure', async () => {
  // The install demo post. The webview answers this with its built-in specimen, correctly.
  const rsp = await fetchWorldCode(stub(json({})))
  assert.deepEqual(rsp, {ok: true, code: undefined})
  assert.equal(errors.length, 0)
})

test('a server error is not ok', async () => {
  const rsp = await fetchWorldCode(stub(json({error: 'boom'}, 500)))
  assert.deepEqual(rsp, {ok: false})
  assert.match(errors[0] ?? '', /HTTP status 500/)
})

test('a network failure is not ok', async () => {
  const rsp = await fetchWorldCode(stub(new Error('offline')))
  assert.deepEqual(rsp, {ok: false})
  assert.match(errors[0] ?? '', /offline/)
})

test('a 2xx that is not JSON is a broken server, not an empty post', async () => {
  const rsp = await fetchWorldCode(stub(new Response('<html>nope</html>')))
  assert.deepEqual(rsp, {ok: false})
  assert.match(errors[0] ?? '', /Bad api\/world body/)
})
