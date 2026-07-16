import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import type {AddressInfo, Server} from 'node:net'
import {after, before, beforeEach, test} from 'node:test'
import {type Context, reddit, redis, runWithContext} from '@devvit/web/server'
import {encodeWorldCode} from '../../../src/core/WorldCodec.js'
import {
  Endpoint,
  type ErrorRsp,
  type GetWorldRsp,
  NEW_POST_FORM,
  type WorldPostData,
} from '../shared/api.ts'
import {onReq} from './server.ts'

let server: Server
let serverURL: string
const redisValues = new Map<string, string>()
const redisGet = redis.get.bind(redis)
const redisSet = redis.set.bind(redis)

/** Options captured from every `submitCustomPost` / `submitComment` the routes make. */
type SubmitOpts = {
  title?: string
  runAs?: string
  styles?: {backgroundColor?: string; backgroundColorDark?: string}
  postData?: WorldPostData
  userGeneratedContent?: {text?: string}
}
let submitted: SubmitOpts[] = []
let comments: {id?: string; text?: string}[] = []
const realSubmitCustomPost = reddit.submitCustomPost.bind(reddit)
const realSubmitComment = reddit.submitComment.bind(reddit)

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

  // Record what we'd send to Reddit; the real client needs a platform to talk to.
  reddit.submitCustomPost = (async (opts: SubmitOpts) => {
    submitted.push(opts)
    const n = submitted.length
    return {id: `t3_new${n}`, url: `https://reddit.com/r/hexlife/t3_new${n}`}
  }) as unknown as typeof reddit.submitCustomPost
  reddit.submitComment = (async (opts: {id?: string; text?: string}) => {
    comments.push(opts)
    return {id: 't1_new'}
  }) as unknown as typeof reddit.submitComment

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
  reddit.submitCustomPost = realSubmitCustomPost
  reddit.submitComment = realSubmitComment
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
})

beforeEach(() => {
  redisValues.clear()
  submitted = []
  comments = []
})

/** POST the create form with the given values and return the UI response. */
async function submitForm(values: {code?: string; title?: string}): Promise<{
  showToast?: {text: string}
  navigateTo?: string
  showForm?: {
    form: {
      description?: string
      fields: {name: string; defaultValue?: string}[]
    }
  }
}> {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnFormNewPost}`, {
    body: JSON.stringify(values),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  })
  assert.equal(rsp.status, 200)
  return await rsp.json()
}

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

test('form submit rejects a code that is not one, keeping what was typed', async () => {
  const body = await submitForm({code: 'HXW1.truncated', title: 'nope'})

  // No post created, no navigation. The form comes back so a truncated paste can be fixed in
  // place instead of being retyped from the explorer.
  assert.equal(body.navigateTo, undefined)
  assert.equal(submitted.length, 0)
  assert.equal(redisValues.size, 0)

  const fields = body.showForm?.form.fields ?? []
  assert.match(body.showForm?.form.description ?? '', /not a valid world code/)
  assert.equal(
    fields.find(f => f.name === 'code')?.defaultValue,
    'HXW1.truncated',
  )
  assert.equal(fields.find(f => f.name === 'title')?.defaultValue, 'nope')
})

test('form submit creates the post as the user, with styles and postData', async () => {
  const code = await worldCode()
  const body = await submitForm({code, title: 'My world'})

  assert.equal(submitted.length, 1)
  const opts = submitted[0]
  assert.equal(opts?.title, 'My world')

  // Authored by the creator, not the app account — karma goes to whoever made the world.
  assert.equal(opts?.runAs, 'USER')
  // The SDK throws without this whenever runAs is USER.
  assert.equal(opts?.userGeneratedContent?.text, code)

  assert.equal(opts?.styles?.backgroundColor, '#0C0E10FF')
  assert.equal(opts?.styles?.backgroundColorDark, '#0C0E10FF')

  assert.equal(opts?.postData?.rulesetHex, 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6')
  assert.equal(opts?.postData?.rows, 16)
  assert.equal(opts?.postData?.cols, 18)

  // Redis stays the source of truth regardless of what postData carried.
  assert.equal(redisValues.get('world:t3_new1'), code)
  assert.equal(body.navigateTo, 'https://reddit.com/r/hexlife/t3_new1')
})

test('a small code rides along in postData; an oversized one does not', async () => {
  const small = await worldCode()
  await submitForm({code: small, title: 't'})
  assert.equal(
    submitted[0]?.postData?.code,
    small,
    'a code this small should ride in postData',
  )

  // A big grid encodes past the 1800-byte budget: meta still ships, the code is dropped and the
  // webview falls back to fetching it from Redis. The cells must be genuinely noisy — the codec
  // compresses, so a regular pattern this size still fits comfortably under the cap. Seeded LCG
  // rather than Math.random so the encoded length can't drift between runs.
  const rows = 200
  const cols = 200
  let seed = 1
  const big = await encodeWorldCode({
    rows,
    cols,
    rulesetHex: 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6',
    cells: Uint8Array.from({length: rows * cols}, () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return (seed >>> 16) & 1
    }),
    colorSettings: {mode: 'preset', activePreset: 'default'},
    speed: 20,
  })
  assert.ok(big)
  await submitForm({code: big, title: 't'})

  const opts = submitted[1]
  assert.equal(opts?.postData?.code, undefined)
  assert.equal(opts?.postData?.rows, rows)
  assert.ok(
    Buffer.byteLength(JSON.stringify(opts?.postData)) <= 1800,
    'postData must stay under the cap',
  )
  assert.equal(redisValues.get('world:t3_new2'), big)
})

test('a blank title is named after the ruleset', async () => {
  const code = await worldCode()
  await submitForm({code, title: '   '})
  assert.match(submitted[0]?.title ?? '', /^\w+ \w+ — live HexLife specimen$/)
})

test('install demo post is app-authored and styled', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnAppInstall}`, {
    method: 'POST',
  })
  assert.equal(rsp.status, 200)
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0]?.runAs, 'APP')
  assert.equal(submitted[0]?.styles?.backgroundColor, '#0C0E10FF')
})

test('onPostSubmit comments on the text post instead of deleting it', async () => {
  const code = await worldCode()
  const rsp = await fetch(`${serverURL}/${Endpoint.OnPostSubmit}`, {
    body: JSON.stringify({post: {id: 't3_orig', title: '', body: ` ${code} `}}),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  })
  assert.equal(rsp.status, 200)

  // The specimen is app-authored (a trigger has no user to attribute it to)...
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0]?.runAs, 'APP')
  assert.equal(redisValues.get('world:t3_new1'), code)

  // ...and the author's original post survives, with a pointer to the specimen.
  assert.equal(comments.length, 1)
  assert.equal(comments[0]?.id, 't3_orig')
  assert.match(
    comments[0]?.text ?? '',
    /https:\/\/reddit\.com\/r\/hexlife\/t3_new1/,
  )
})

test('onPostSubmit ignores a post that is not a bare world code', async () => {
  const rsp = await fetch(`${serverURL}/${Endpoint.OnPostSubmit}`, {
    body: JSON.stringify({post: {id: 't3_orig', body: 'just chatting'}}),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  })
  assert.equal(rsp.status, 200)
  assert.equal(submitted.length, 0)
  assert.equal(comments.length, 0)
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
