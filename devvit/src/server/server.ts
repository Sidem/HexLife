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
import {describeRuleset} from '../../../src/core/rulesetDescriptor.js'
import {rulesetName} from '../../../src/core/rulesetName.js'
import {
  decodeWorldCode,
  explorerUrlForRuleset,
} from '../../../src/core/WorldCodec.js'
import {
  type CreatePostRsp,
  Endpoint,
  EndpointMethod,
  type ErrorRsp,
  extractWorldCodeFromPaste,
  type GetWorldRsp,
  invalidCodeMessage,
  NEW_POST_COPY,
  NEW_POST_FORM,
  type NewPostFormValues,
  newPostFields,
  type PostKitFields,
  parsePostKit,
  type WorldPostData,
} from '../shared/api.ts'
import {dbDeleteWorldCode, dbGetWorldCode, dbSetWorldCode} from './db.ts'

type AnyRsp =
  | GetWorldRsp
  | CreatePostRsp
  | UiResponse
  | TriggerResponse
  | ErrorRsp

/** What a successfully decoded `HXW1.` code describes. */
type DecodedWorld = NonNullable<Awaited<ReturnType<typeof decodeWorldCode>>>

/** A text post body that is *only* a world code (optional surrounding whitespace). */
const PURE_WORLD_CODE_RE = /^\s*(HXW1\.[A-Za-z0-9_-]+)\s*$/

/**
 * Painted by Reddit *before* the iframe loads. Matches the webview's own background so the card
 * doesn't flash white on light-mode clients while the wasm engine boots.
 */
const POST_STYLES = {
  backgroundColor: '#0C0E10FF',
  backgroundColorDark: '#0C0E10FF',
} as const

/** Platform caps postData at 2 KB; stop well short so platform-added keys can't push us over. */
const POST_DATA_MAX_BYTES = 1800

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
  // Match on the path alone: a query string is not part of the route, and matching the raw URL
  // verbatim turned `api/world?x=1` into a 404 for no reason a caller could see.
  const endpoint = reqMsg.url?.slice(1).split('?')[0] as Endpoint
  const method = EndpointMethod[endpoint]

  let rsp: AnyRsp
  if (method !== reqMsg.method) {
    rsp = {error: 'not found', status: 404}
  } else {
    switch (endpoint) {
      case Endpoint.GetWorld:
        rsp = await routeGetWorld()
        break
      case Endpoint.CreatePost:
        rsp = await routeCreatePost(reqMsg)
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
  return newPostForm()
}

/**
 * The create form. Re-shown with the submitted values when a paste fails to decode: a world code is
 * long and hand-pasted, so discarding it on error (the old toast-only response) meant re-copying
 * from the explorer to fix a truncated selection.
 */
function newPostForm(
  values: {code?: string; title?: string} = {},
  error?: string,
): UiResponse {
  return {
    showForm: {
      name: NEW_POST_FORM,
      form: {
        title: NEW_POST_COPY.title,
        description: error
          ? `⚠ ${error}\n\n${NEW_POST_COPY.description}`
          : NEW_POST_COPY.description,
        acceptLabel: NEW_POST_COPY.acceptLabel,
        fields: [...newPostFields(values)],
      },
    },
  }
}

/**
 * A post's boot payload. `code` rides along only when the whole thing stays under the cap — the
 * webview treats postData as an accelerator and falls back to `api/world` (Redis) without it.
 */
function buildPostData(world: DecodedWorld, code: string): WorldPostData {
  const meta: WorldPostData = {
    rulesetHex: world.rulesetHex,
    rows: world.rows,
    cols: world.cols,
  }
  const withCode: WorldPostData = {...meta, code}
  return Buffer.byteLength(JSON.stringify(withCode)) <= POST_DATA_MAX_BYTES
    ? withCode
    : meta
}

/**
 * Post title priority: form field → kit `Title:` line → ruleset mnemonic.
 * ("Cobalt Lattice — live HexLife specimen" is the last-resort default.)
 */
function specimenTitle(
  formTitle: string | undefined,
  world: DecodedWorld,
  kitTitle?: string | null,
): string {
  return (
    (formTitle ?? '').trim() ||
    (kitTitle ?? '').trim() ||
    `${rulesetName(world.rulesetHex)} — live HexLife specimen`
  )
}

/** Optional kit enrichment (description / tags) attached to a Live Specimen. */
type SpecimenMeta = Pick<PostKitFields, 'description' | 'tags'>

/**
 * Create a Live Specimen post and pin its code to the new post's ID.
 *
 * `runAs: 'USER'` makes menu-created specimens belong to their creator (karma, post history)
 * instead of the app account. It requires `userGeneratedContent` (the SDK throws without it) and
 * `permissions.reddit.asUser: ["SUBMIT_POST"]` in devvit.json. App-authored callers (install demo,
 * onPostSubmit) pass `runAs: 'APP'` — there is no user to attribute those to.
 *
 * Every specimen gets a first comment identifying its ruleset (name, B/S-style notation when one
 * exists, hex, Explorer deep link) — "what ruleset is this?" is the most common question under
 * these posts, and the comment answers it where it gets asked, for viewers who never expand the
 * webview. Kit description/tags (from an Explorer post kit) ride in the same comment and in
 * `textFallback` (old.reddit / crawlers). Custom posts have no free-form body field we control
 * beyond title + webview.
 */
async function createSpecimenPost(
  world: DecodedWorld,
  code: string,
  title: string,
  runAs: 'USER' | 'APP',
  meta: SpecimenMeta = {description: null, tags: []},
): Promise<{id: import('@devvit/web/shared').T3; url: string}> {
  const post = await reddit.submitCustomPost({
    title,
    styles: POST_STYLES,
    postData: buildPostData(world, code),
    ...(runAs === 'USER'
      ? {runAs, userGeneratedContent: {text: code}}
      : {runAs}),
    textFallback: {text: specimenTextFallback(world, meta)},
  })
  await dbSetWorldCode(post.id, code)

  try {
    await reddit.submitComment({
      id: post.id,
      text: specimenIdentityComment(world, meta),
      // APP: we only hold asUser SUBMIT_POST; a comment-as-user would need another scope.
      runAs: 'APP',
    })
  } catch (commentErr) {
    console.warn(
      `createSpecimenPost: created ${post.id} but could not add ruleset comment:`,
      commentErr,
    )
  }
  return {id: post.id, url: post.url}
}

/**
 * Shown where the interactive webview can't load — old.reddit, crawlers, ancient clients. It never
 * carries the world code (too long, not human-readable), so without a link it's a dead end that
 * names a ruleset the reader has no way to see. The Explorer deep-link is the escape hatch: same
 * ruleset, fresh start (a recipe, not the dish — the exact cells only exist in the post).
 *
 * Kit description/tags are appended when present so a paste from Explorer still documents itself.
 */
function specimenTextFallback(
  world: DecodedWorld,
  meta: SpecimenMeta = {description: null, tags: []},
): string {
  const url = explorerUrlForRuleset(world.rulesetHex, {rows: world.rows})
  const notation = describeRuleset(world.rulesetHex)?.notation
  const lines = [
    'HexLife Live Specimen — open this post on a modern Reddit client to play the simulation.',
    '',
    `Ruleset: ${rulesetName(world.rulesetHex)}${notation ? ` — ${notation}` : ''} (${world.rulesetHex})`,
    `Grid: ${world.rows}×${world.cols}`,
  ]
  if (meta.description?.trim()) {
    lines.push('', meta.description.trim())
  }
  if (meta.tags.length > 0) {
    lines.push('', `Tags: ${meta.tags.join(', ')}`)
  }
  lines.push('', `Run this ruleset in HexLife Explorer: ${url}`)
  return lines.join('\n')
}

/**
 * First-comment body: kit description/tags (author's words first) followed by the ruleset
 * identity block. The identity block always exists — it is the standing answer to "what ruleset
 * is this?", posted where that question gets asked. Notation comes from {@link describeRuleset}:
 * `B2/S35` for neighbor-count rules, orbit-suffixed `B2o3p/S2` for rotationally symmetric ones,
 * and none for raw 128-entry rules (the hex is the rule; the summary says so).
 */
function specimenIdentityComment(
  world: DecodedWorld,
  meta: SpecimenMeta = {description: null, tags: []},
): string {
  const parts: string[] = []
  if (meta.description?.trim()) parts.push(meta.description.trim())
  if (meta.tags.length > 0) {
    parts.push(`**Tags:** ${meta.tags.join(' · ')}`)
  }

  const desc = describeRuleset(world.rulesetHex)
  const notation = desc?.notation ? ` — \`${desc.notation}\`` : ''
  const identity = [`**Ruleset:** ${rulesetName(world.rulesetHex)}${notation}`]
  if (desc) identity.push(desc.summary)
  identity.push(
    `Hex: \`${world.rulesetHex}\` — paste into the Explorer's ruleset editor, or`,
    `▶ [run & inspect this ruleset in HexLife Explorer](${explorerUrlForRuleset(
      world.rulesetHex,
      {rows: world.rows, edit: true},
    )})`,
  )
  parts.push(identity.join('\n\n'))
  return parts.join('\n\n')
}

/** The form came back: validate the code, create the post, and pin the code to the new post's ID. */
async function routeFormNewPost(reqMsg: IncomingMessage): Promise<UiResponse> {
  const values = await readFormValues(reqMsg)
  const raw = (values.code ?? '').trim()
  const kit = parsePostKit(raw)
  // Explorer post kits wrap meta around the code — accept a pure line or extract HXW1. from a kit.
  const code = kit.code ?? extractWorldCodeFromPaste(raw) ?? raw

  const world = await decodeWorldCode(code)
  if (!world) return newPostForm(values, invalidCodeMessage(raw))

  const post = await createSpecimenPost(
    world,
    code,
    specimenTitle(values.title, world, kit.title),
    'USER',
    {description: kit.description, tags: kit.tags},
  )

  return {
    showToast: {
      text: `Post created — ${world.rows}×${world.cols}, ruleset ${world.rulesetHex}.`,
      appearance: 'success',
    },
    navigateTo: post.url,
  }
}

/**
 * Paste-code / remix create (lab "Create your own" + "Post my remix"). The client collects values
 * via its own `showForm` (a client-side effect can't call the server's form callback), so this
 * route is the menu form's callback minus the UI envelope.
 *
 * Authorship: `runAs: 'USER'` is necessary but not sufficient for webview-originated creates —
 * the client must also call `canRunAsUser` on the click before fetching here, or Reddit attributes
 * the post to the app account. The menu form path does not need that call (native form consent).
 */
async function routeCreatePost(
  reqMsg: IncomingMessage,
): Promise<CreatePostRsp | ErrorRsp> {
  const values = await readJson<NewPostFormValues>(reqMsg)
  const raw = (values?.code ?? '').trim()
  const kit = parsePostKit(raw)
  const code = kit.code ?? extractWorldCodeFromPaste(raw) ?? raw

  const world = await decodeWorldCode(code)
  if (!world) return {error: invalidCodeMessage(raw), status: 400}

  const post = await createSpecimenPost(
    world,
    code,
    specimenTitle(values?.title, world, kit.title),
    // A viewer pressed a button: their post, their karma.
    'USER',
    {description: kit.description, tags: kit.tags},
  )
  return {url: post.url}
}

/** The install trigger's demo post carries no code; the webview falls back to its built-in world. */
async function routeAppInstall(): Promise<TriggerResponse> {
  // No code → no postData worth sending (the webview's built-in demo needs no boot payload), but
  // the background styles still matter: this post flashes white in the feed like any other.
  await reddit.submitCustomPost({
    title: 'HexLife',
    runAs: 'APP',
    styles: POST_STYLES,
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
  // Pure HXW1 bodies only for this trigger (not a full post kit — that would auto-convert
  // accidental text posts too aggressively). The menu form uses extractWorldCodeFromPaste.
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
    const custom = await createSpecimenPost(
      world,
      code,
      specimenTitle(post.title, world),
      'APP',
    )

    // Point the author at their specimen rather than deleting their post. Deleting someone's
    // submission to "upgrade" it destroys content they wrote and any replies it already has; a
    // comment is additive and leaves the choice to them. Failures here are non-fatal — the
    // specimen already exists.
    try {
      await reddit.submitComment({
        id: postId as import('@devvit/web/shared').T3,
        text: `That's a HexLife world code — here it is running as a Live Specimen: ${custom.url}`,
        runAs: 'APP',
      })
    } catch (commentErr) {
      console.warn(
        `onPostSubmit: created ${custom.id} but could not comment on ${postId}:`,
        commentErr,
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
