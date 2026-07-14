import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {type Context, redis, runWithContext} from '@devvit/web/server'
import {encodeWorldCode} from '../../../src/core/WorldCodec.js'
import {
  Endpoint,
  type ErrorRsp,
  type GetWorldRsp,
  NEW_POST_FORM,
} from '../shared/api.ts'
import {onReq} from './server.ts'

let server: Server
let serverURL: string
const redisValues = new Map<string, string>()
const redisGet = redis.get.bind(redis)
const redisSet = redis.set.bind(redis)

/** A tiny but real world code — the same encoder the explorer's export button uses. */
async function worldCode(): Promise<string> {
  const rows = 16
  const cols = 18
  const code = await encodeWorldCode({
    rows,
    cols,
    rulesetHex: 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6',
    cells: new Uint8Array(rows * cols).fill(1),
    colorSettings: {mode: 'preset', activePreset: 'default'},
    speed: 20,
  })
  assert.ok(code)
  return code
}

before(async () => {
  redis.get = async key => redisValues.get(key)
  redis.set = async (key, value) => {
    redisValues.set(key, value)
    return 'OK'
  }

  server = createServer(async (req, rsp) => {
    await runWithContext(
      {
        appName: 'hexlifeapp',
        postId: 't3_123',
        userId: 't2_123',
        username: 'username',
      } as unknown as Context,
      () => onReq(req, rsp),
    )
  })
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const info = server.address() as AddressInfo
  serverURL = `http://127.0.0.1:${info.port}`
})

after(async () => {
  redis.get = redisGet
  redis.set = redisSet
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => redisValues.clear())

test('get world: none stored', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.GetWorld}`)
  assert.equal(rsp.status, 200)
  assert.deepEqual<GetWorldRsp>(await rsp.json(), {})
})

test('get world: the code stored for this post', async () => {
  const code = await worldCode()
  redisValues.set('world:t3_123', code)
  const rsp = await fetch(`${serverURL}/${Endpoint.GetWorld}`)
  assert.deepEqual<GetWorldRsp>(await rsp.json(), {code})
})

test('menu action shows the world-code form', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnMenuNewPost}`, {
    method: 'POST',
  })
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as {
    showForm: {name: string; form: {fields: {name: string}[]}}
  }
  assert.equal(body.showForm.name, NEW_POST_FORM)
  assert.deepEqual(
    body.showForm.form.fields.map(f => f.name),
    ['code', 'title'],
  )
})

test('form submit rejects a code that is not one', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnFormNewPost}`, {
    body: JSON.stringify({code: 'HXW1.truncated', title: 'nope'}),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  })
  assert.equal(rsp.status, 200)
  const body = (await rsp.json()) as {
    showToast?: {text: string}
    navigateTo?: string
  }
  // No post created, no navigation — just a toast explaining the paste failed.
  assert.equal(body.navigateTo, undefined)
  assert.match(body.showToast?.text ?? '', /not a valid world code/)
  assert.equal(redisValues.size, 0)
})

test('wrong method', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnFormNewPost}`)
  assert.equal(rsp.status, 404)
  assert.deepEqual<ErrorRsp>(await rsp.json(), {
    error: 'not found',
    status: 404,
  })
})

test('404', async () => {
  const rsp = await fetch(serverURL)
  assert.equal(rsp.status, 404)
  assert.deepEqual<ErrorRsp>(await rsp.json(), {
    error: 'not found',
    status: 404,
  })
})
