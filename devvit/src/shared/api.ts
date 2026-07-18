/** Generic error detail for all responses. */
export type ErrorRsp = {error: string; status: number}

/**
 * The world this post renders, as a world code (`HXW1.…`, see src/core/WorldCodec.js): grid +
 * ruleset + the exact tick-0 cells + the exact color LUT. `undefined` means the post was created
 * without one (e.g. the app-install trigger's demo post) and the webview should fall back to its
 * built-in specimen.
 */
export type GetWorldRsp = {code?: string}

/** Values the "new HexLife post" form submits. `code` is the export from the explorer. */
export type NewPostFormValues = {code?: string; title?: string}

/**
 * Boot payload attached to every post we create (`submitCustomPost({postData})`). The webview reads
 * it from `context.postData` and skips the `api/world` round-trip when `code` is present.
 *
 * Redis stays the source of truth: `code` is only included when the serialized payload fits under
 * the platform's 2 KB cap, so big worlds simply fall back to fetching. The ruleset meta always fits
 * and lets the client paint identity chrome before any network call resolves.
 */
export type WorldPostData = {
  rulesetHex: string
  rows: number
  cols: number
  code?: string
}

/** Response from {@link Endpoint.CreatePost}: where the new specimen lives. */
export type CreatePostRsp = {url: string}

/**
 * Copy shared by the paste-code create paths — the subreddit menu form (server-rendered) and the
 * lab-only "Create your own" form (client `showForm`). Same act, so they must not describe
 * themselves differently depending on which door the user came through. (Feed no longer offers
 * this; onboarding is Open lab → Post my remix.)
 */
export const NEW_POST_COPY = {
  title: 'New HexLife post',
  description:
    'In HexLife Explorer (sidem.github.io/HexLife), use Share → "Copy post kit & open r/hexlife" (or Copy World Code). Paste a world code or a full post kit below. From a kit we take the HXW1. line, and — if you leave Title blank — the kit’s Title, description, and Tags enrich the post.',
  acceptLabel: 'Create Live Specimen',
  codeLabel: 'World code / post kit',
  codeHelp:
    'Paste HXW1.… or a full Explorer post kit (code + Title / description / Tags).',
  titleLabel: 'Post title',
  titleHelp:
    'Optional. Leave blank to use the kit’s Title: line (or the ruleset name if there is no kit title).',
  /**
   * The paste *looked* like a code (right prefix) but would not decode. Naming the two things
   * that actually cause this beats "that is not a valid world code", which told a user who just
   * pasted something starting with HXW1. only that we disagreed.
   */
  invalid:
    'That world code didn’t decode. Usually the paste was cut short, or extra text came along with it — a code is one unbroken line starting with HXW1. and nothing after it. Copy it again from HexLife Explorer (Share → Copy World Code, or the HXW1. line from a post kit).',
  /** No `HXW1.` token at all — a different mistake, and worth saying so. */
  notACode:
    'No HXW1. world code found in that paste. In HexLife Explorer, use Share → Copy World Code, or paste a post kit that includes an HXW1. line.',

  /**
   * "Post my remix" — the same act as the paste path, reached without ever leaving the post. The
   * viewer isn't handling a code here (the element snapshots it), so this form asks for a title
   * and nothing else. Say plainly that their drawing comes along: that is the whole point, and a
   * surprise either way would be a bad one.
   */
  remixTitle: 'Post my remix',
  remixDescription:
    'Posts this world exactly as it looks right now — including anything you’ve drawn.',
  remixAcceptLabel: 'Post it',
  /** The element had no world to encode — a boot failure, so there is nothing on screen to post. */
  remixNothingToPost: 'Nothing to post — this world hasn’t loaded.',
  /**
   * Webview create paths must call `canRunAsUser` before `api/post`. If the viewer declines
   * (or later revokes) the asUser scopes, `runAs: 'USER'` would fall back to the app account —
   * refuse rather than post as u/hexlifeapp.
   */
  userPostPermissionDenied:
    'Reddit needs permission to post as you. Allow it when prompted, then try again.',
} as const

/** The prefix every world code carries (see src/core/WorldCodec.js). */
export const WORLD_CODE_PREFIX = 'HXW1.'

/**
 * Match a world code token anywhere in a paste (Explorer post kits put meta around the HXW1. line).
 * Base64url alphabet only — same charset encodeWorldCode emits.
 */
const WORLD_CODE_TOKEN_RE = /HXW1\.[A-Za-z0-9_-]+/

/**
 * Pull a world code out of a form paste. Accepts a pure `HXW1.…` line **or** a multi-line Explorer
 * post kit (title/tags/description + the code). Returns null when no token is present.
 *
 * Prefer a pure single-line body when the whole paste is just the code; otherwise take the first
 * HXW1. token so "paste the whole kit" still creates a Live Specimen.
 */
export function extractWorldCodeFromPaste(text: string): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null
  const pure = /^\s*(HXW1\.[A-Za-z0-9_-]+)\s*$/.exec(trimmed)
  if (pure) return pure[1] ?? null
  const embedded = WORLD_CODE_TOKEN_RE.exec(trimmed)
  return embedded ? embedded[0] : null
}

/**
 * Meta scraped from an Explorer post kit paste (title / description / tags / code). Pure lines that
 * are only a world code yield `code` and empty meta. Never throws.
 */
export type PostKitFields = {
  code: string | null
  /** From a `Title: …` line, if present. */
  title: string | null
  /** Free-text block under Title, before Tags/Explorer/IC. */
  description: string | null
  /** From a `Tags: a, b` line (split on comma / middle-dot / pipe). */
  tags: string[]
}

/** Lines that end the description block in a kit. */
const KIT_META_LINE_RE = /^(Tags|Explorer|IC|Tip)\s*:/i
const KIT_SEPARATOR_RE = /^[─\-═]{2,}/

/**
 * Parse an Explorer post kit (or a bare world code) into structured fields.
 * The form title field still wins when the user typed one; callers merge with
 * `formTitle.trim() || kit.title`.
 */
export function parsePostKit(text: string): PostKitFields {
  if (typeof text !== 'string' || !text.trim()) {
    return {code: null, title: null, description: null, tags: []}
  }
  const code = extractWorldCodeFromPaste(text)
  const titleM = /^Title:\s*(.+)\s*$/im.exec(text)
  const title = titleM?.[1]?.trim() || null

  const tagsM = /^Tags:\s*(.+)\s*$/im.exec(text)
  const tags = tagsM?.[1]
    ? tagsM[1]
        .split(/[,·|]/)
        .map(s => s.trim())
        .filter(Boolean)
    : []

  return {
    code,
    title,
    description: extractKitDescription(text),
    tags,
  }
}

/**
 * Description = non-empty lines after `Title: …` until Tags/Explorer/IC/Tip, a box-drawing
 * separator, or another HXW1. token. Pure code pastes have no Title line → null.
 */
function extractKitDescription(text: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length && !/^Title:\s*/i.test(lines[i] ?? '')) i++
  if (i >= lines.length) return null
  i += 1
  while (i < lines.length && !(lines[i] ?? '').trim()) i++

  const descLines: string[] = []
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    if (
      KIT_META_LINE_RE.test(line) ||
      KIT_SEPARATOR_RE.test(trimmed) ||
      WORLD_CODE_TOKEN_RE.test(trimmed)
    ) {
      break
    }
    descLines.push(line)
    i += 1
  }
  while (descLines.length > 0 && !descLines[descLines.length - 1]?.trim()) {
    descLines.pop()
  }
  const desc = descLines.join('\n').trim()
  return desc || null
}

/**
 * Which "that didn't work" to show. The two failures are genuinely different mistakes — a
 * truncated code and a paste of the wrong thing entirely — and a decoder that says the same
 * sentence to both makes the user guess which one they made.
 */
export function invalidCodeMessage(code: string): string {
  return extractWorldCodeFromPaste(code)
    ? NEW_POST_COPY.invalid
    : NEW_POST_COPY.notACode
}

/**
 * The fields both create paths collect, in the order they're shown.
 *
 * The two paths render this form through different machinery — the menu path returns a
 * `showForm` UiResponse from the server, the in-post path calls the client's `showForm` effect —
 * so the *array* was hand-built in both places and had already started to drift. {@link
 * NEW_POST_COPY} closed the wording half of that; this closes the structural half.
 *
 * `as const` keeps the field names and `required` flags as literals. Note this does *not* buy
 * typed form values: `showForm`'s `FormToFormValues` only walks a **mutable** tuple, so a readonly
 * one (which is what any `as const` field list is) silently lands in its `{[key: string]: any}`
 * fallback. That was already true of the inline `as const` arrays this replaced — `rsp.values.code`
 * has always been `any`, which is why both callers null-coalesce it and the server re-validates
 * every code with `decodeWorldCode` rather than trusting the envelope.
 *
 * @param defaults Pre-filled values — the menu form re-shows itself with the submitted values
 *   when a paste fails to decode, rather than making the user re-copy a long code.
 */
export function newPostFields(defaults: {code?: string; title?: string} = {}) {
  return [
    {
      type: 'paragraph',
      name: 'code',
      label: NEW_POST_COPY.codeLabel,
      helpText: NEW_POST_COPY.codeHelp,
      defaultValue: defaults.code,
      required: true,
    },
    {
      type: 'string',
      name: 'title',
      label: NEW_POST_COPY.titleLabel,
      helpText: NEW_POST_COPY.titleHelp,
      defaultValue: defaults.title,
      required: false,
    },
  ] as const
}

/**
 * The remix form's fields: a title, and that is all.
 *
 * There is deliberately no `code` field. The code is machine data the element produced by
 * snapshotting itself — showing a viewer a 1.5 KB base64 blob to confirm would be asking them to
 * proofread something they never wrote.
 */
export function remixPostFields(defaults: {title?: string} = {}) {
  return [
    {
      type: 'string',
      name: 'title',
      label: NEW_POST_COPY.titleLabel,
      helpText: NEW_POST_COPY.titleHelp,
      defaultValue: defaults.title,
      required: false,
    },
  ] as const
}

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  GetWorld: 'api/world',
  /** Create a Live Specimen from a pasted code (lab "Create your own" / menu form). */
  CreatePost: 'api/post',
  /** Anonymous usage counters from the webview (see shared/telemetry.ts). */
  Track: 'api/track',
  OnAppInstall: 'internal/on/app/install',
  OnMenuNewPost: 'internal/on/menu/new-post',
  /** Moderator-only: show the usage report (see server/metrics.ts). */
  OnMenuStats: 'internal/on/menu/stats',
  OnFormNewPost: 'internal/on/form/new-post',
  /**
   * The stats form's callback. It does nothing — the form is a read-only viewport onto a text
   * report — but Devvit resolves `showForm` by registered name, so the name needs a home.
   */
  OnFormStats: 'internal/on/form/stats',
  /**
   * Best-effort: pure-HXW1 text posts → Live Specimen. Not the primary create path (that is the
   * menu form); kept for accidental text dumps of a world code.
   */
  OnPostSubmit: 'internal/on/post/submit',
  /** Clear Redis when a Live Specimen post is deleted. */
  OnPostDelete: 'internal/on/post/delete',
} as const

export const EndpointMethod = {
  [Endpoint.GetWorld]: 'GET',
  [Endpoint.CreatePost]: 'POST',
  [Endpoint.Track]: 'POST',
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnMenuStats]: 'POST',
  [Endpoint.OnFormNewPost]: 'POST',
  [Endpoint.OnFormStats]: 'POST',
  [Endpoint.OnPostSubmit]: 'POST',
  [Endpoint.OnPostDelete]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}

/** Must match the form name registered in devvit.json → `forms`. */
export const NEW_POST_FORM = 'newWorldPost'

/** Ditto, for the moderator-only usage report. */
export const STATS_FORM = 'hexlifeStats'
