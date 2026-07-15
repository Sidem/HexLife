import {once} from 'node:events'
import type {IncomingMessage, ServerResponse} from 'node:http'
import {context, reddit} from '@devvit/web/server'
import type {
  PartialJsonValue,
  TriggerResponse,
  UiResponse,
} from '@devvit/web/shared'
// The SAME codec the explorer exports with and the webview renders from — imported straight from the
// HexLife source tree (this is why the Devvit app lives in-repo). Validating here means a bad paste
// fails at the form, with a message, instead of becoming a permanently broken post.
import {decodeWorldCode} from '../../../src/core/WorldCodec.js'
import {
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  type GetWorldRsp,
  NEW_POST_FORM,
  type NewPostFormValues,
} from '../shared/api.ts'
import {dbDeleteWorldCode, dbGetWorldCode, dbSetWorldCode} from './db.ts'

type AnyRsp = GetWorldRsp | UiResponse | TriggerResponse | ErrorRsp

/** A text post body that is *only* a world code (optional surrounding whitespace). */
const PURE_WORLD_CODE_RE = /^\s*(HXW1\.[A-Za-z0-9_-]+)\s*$/

export async function onReq(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  try {
    await route(reqMsg, rspMsg)
  } catch (err) {
    const msg = `server error; ${err instanceof Error ? err.stack : err}`
    console.error(msg)
    writeJson<ErrorRsp>(500, {error: msg, status: 500}, rspMsg)
  }
}

async function route(
  reqMsg: IncomingMessage,
  rspMsg: ServerResponse,
): Promise<void> {
  const endpoint = reqMsg.url?.slice(1) as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.GetWorld:
        rsp = await routeGetWorld()
        break
      case Endpoint.OnMenuNewPost:
        rsp = routeMenuNewPost()
        break
      case Endpoint.OnFormNewPost:
        rsp = await routeFormNewPost(reqMsg)
        break
      case Endpoint.OnAppInstall:
        rsp = await routeAppInstall()
        break
      case Endpoint.OnPostSubmit:
        rsp = await routePostSubmit(reqMsg)
        break
      case Endpoint.OnPostDelete:
        rsp = await routePostDelete(reqMsg)
        break
      default:
        endpoint satisfies never
        rsp = {error: 'not found', status: 404}
        break
    }
  }

  writeJson<PartialJsonValue>('status' in rsp ? rsp.status : 200, rsp, rspMsg)
}

/** The webview asks for its post's world on boot. A post with no code renders the demo specimen. */
async function routeGetWorld(): Promise<GetWorldRsp> {
  const t3 = context.postId
  if (!t3) throw Error('no t3')
  return {code: await dbGetWorldCode(t3)}
}

/**
 * User picked "New HexLife post" (subreddit menu; available to all users). Post params are NOT
 * configured on Reddit: a world is authored in the explorer and exported as one world code.
 */
function routeMenuNewPost(): UiResponse {
  return {
    showForm: {
      name: NEW_POST_FORM,
      form: {
        title: 'New HexLife post',
        description:
          'In HexLife Explorer (sidem.github.io/HexLife), open Share → "Copy World Code", then paste it below. The code is the exact world you were looking at — grid, ruleset, cells, and colors.',
        acceptLabel: 'Create Live Specimen',
        fields: [
          {
            type: 'paragraph',
            name: 'code',
            label: 'World code',
            helpText: 'Starts with HXW1. — paste the whole thing.',
            required: true,
          },
          {
            type: 'string',
            name: 'title',
            label: 'Post title',
            defaultValue: 'HexLife',
            required: false,
          },
        ],
      },
    },
  }
}

/** The form came back: validate the code, create the post, and pin the code to the new post's ID. */
async function routeFormNewPost(reqMsg: IncomingMessage): Promise<UiResponse> {
  const values = await readFormValues(reqMsg)
  const code = (values.code ?? '').trim()

  const world = await decodeWorldCode(code)
  if (!world) {
    return {
      showToast: {
        text: 'That is not a valid world code. Copy it again from HexLife Explorer (Share → Copy World Code) and paste the whole thing.',
      },
    }
  }

  const title = (values.title ?? '').trim() || 'HexLife'
  const post = await reddit.submitCustomPost({
    title,
    // Shown when the interactive webview cannot load (old clients, errors). Required-ish for
    // review polish; never contains the full code (too long / not human-readable).
    textFallback: {
      text: `HexLife Live Specimen — open this post on a modern Reddit client to play the simulation.\n\nRuleset: ${world.rulesetHex}\nGrid: ${world.rows}×${world.cols}`,
    },
  })
  await dbSetWorldCode(post.id, code)

  return {
    showToast: {
      text: `Post created — ${world.rows}×${world.cols}, ruleset ${world.rulesetHex}.`,
      appearance: 'success',
    },
    navigateTo: post.url,
  }
}

/** The install trigger's demo post carries no code; the webview falls back to its built-in world. */
async function routeAppInstall(): Promise<TriggerResponse> {
  await reddit.submitCustomPost({
    title: 'HexLife',
    textFallback: {
      text: 'HexLife — a live hexagonal cellular automaton. Open this post on a modern Reddit client to play.',
    },
  })
  return {}
}

/**
 * Best-effort converter: if someone posts a *pure* world-code text body, upgrade it to a Live
 * Specimen. Primary create path remains the subreddit menu form — Reddit's `/submit` page cannot
 * open that form, and this trigger is intentionally conservative (only pure HXW1 bodies).
 */
async function routePostSubmit(
  reqMsg: IncomingMessage,
): Promise<TriggerResponse> {
  const body = await readJson<{
    post?: {id?: string; title?: string; body?: string; selftext?: string}
  }>(reqMsg)

  const post = body?.post
  if (!post?.id) return {}

  // Devvit payloads have used both `body` and `selftext` across versions — accept either.
  const text = (post.body ?? post.selftext ?? '').trim()
  const match = PURE_WORLD_CODE_RE.exec(text)
  const code = match?.[1]
  if (!code) return {}

  const postId = post.id
  const world = await decodeWorldCode(code)
  if (!world) {
    console.warn(
      `onPostSubmit: body looked like a world code but failed to decode (${postId})`,
    )
    return {}
  }

  try {
    const title = (post.title ?? '').trim() || 'HexLife'
    const custom = await reddit.submitCustomPost({
      title,
      textFallback: {
        text: `HexLife Live Specimen — ruleset ${world.rulesetHex} (${world.rows}×${world.cols}).`,
      },
    })
    await dbSetWorldCode(custom.id, code)

    // Best-effort cleanup of the intermediate text post. The Reddit client surface varies by
    // @devvit/web version — probe for getPostById without an `any` cast. Permission failures are
    // non-fatal: the Live Specimen already exists.
    try {
      type PostHandle = {
        delete?: () => Promise<unknown>
        remove?: (spam?: boolean) => Promise<unknown>
      }
      type RedditWithPosts = {
        getPostById?: (id: string) => Promise<PostHandle | undefined>
      }
      const api = reddit as unknown as RedditWithPosts
      const p = api.getPostById ? await api.getPostById(postId) : undefined
      if (p?.delete) await p.delete()
      else if (p?.remove) await p.remove(false)
      else
        console.warn(
          `onPostSubmit: no delete/remove API for ${postId}; left text post in place`,
        )
    } catch (cleanupErr) {
      console.warn(
        `onPostSubmit: created ${custom.id} but could not remove ${postId}:`,
        cleanupErr,
      )
    }

    console.log(
      `onPostSubmit: upgraded ${postId} → ${custom.id} (${world.rows}×${world.cols}, ${world.rulesetHex})`,
    )
  } catch (err) {
    console.error(`onPostSubmit: failed to upgrade ${postId}:`, err)
  }

  return {}
}

/** Honor post deletion: drop the world code from Redis so we don't retain deleted content. */
async function routePostDelete(
  reqMsg: IncomingMessage,
): Promise<TriggerResponse> {
  const body = await readJson<{post?: {id?: string}}>(reqMsg)
  const postId = body?.post?.id
  if (postId) {
    try {
      await dbDeleteWorldCode(postId as import('@devvit/web/shared').T3)
    } catch (err) {
      console.warn(`onPostDelete: failed to clear world for ${postId}:`, err)
    }
  }
  return {}
}

/**
 * Form submissions arrive as JSON. Devvit has spelled the envelope differently across versions
 * (bare values vs. a `values` wrapper), so accept both rather than betting the post-creation path on
 * one shape.
 */
async function readFormValues(
  reqMsg: IncomingMessage,
): Promise<NewPostFormValues> {
  const body = await readJson<NewPostFormValues & {values?: NewPostFormValues}>(
    reqMsg,
  )
  return body?.values ?? body ?? {}
}

async function readJson<T>(reqMsg: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  reqMsg.on('data', chunk => chunks.push(chunk))
  await once(reqMsg, 'end')
  return JSON.parse(`${Buffer.concat(chunks)}`)
}

function writeJson<T extends PartialJsonValue>(
  status: number,
  json: Readonly<T>,
  rsp: ServerResponse,
): void {
  const body = JSON.stringify(json)
  const len = Buffer.byteLength(body)
  rsp.writeHead(status, {
    'Content-Length': len,
    'Content-Type': 'application/json',
  })
  rsp.end(body)
}
