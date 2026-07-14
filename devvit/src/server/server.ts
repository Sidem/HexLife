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
import {dbGetWorldCode, dbSetWorldCode} from './db.ts'

type AnyRsp = GetWorldRsp | UiResponse | TriggerResponse | ErrorRsp

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
 * The moderator picked "New HexLife post" — show the form. Post params are NOT configured on Reddit:
 * a world is authored in the explorer (where you can actually see it) and exported there as one
 * code, which is the only thing this form takes.
 */
function routeMenuNewPost(): UiResponse {
  return {
    showForm: {
      name: NEW_POST_FORM,
      form: {
        title: 'New HexLife post',
        description:
          'In HexLife Explorer, open Share → "Copy World Code" (or the command palette → "Copy world code"), then paste it here. The code carries the exact grid, ruleset, starting cells and colors of the world you were looking at.',
        acceptLabel: 'Create post',
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
  const post = await reddit.submitCustomPost({title})
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
  await reddit.submitCustomPost({title: 'HexLife'})
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
