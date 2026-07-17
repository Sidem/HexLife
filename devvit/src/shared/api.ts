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
 * Copy shared by the two create paths — the subreddit menu form (server-rendered) and the in-post
 * "Create your own" form (client `showForm`). Same act, so they must not describe themselves
 * differently depending on which door the user came through.
 */
export const NEW_POST_COPY = {
  title: 'New HexLife post',
  description:
    'In HexLife Explorer (sidem.github.io/HexLife), open Share → "Copy World Code", then paste it below. The code is the exact world you were looking at — grid, ruleset, cells, and colors.',
  acceptLabel: 'Create Live Specimen',
  codeLabel: 'World code',
  codeHelp: 'Starts with HXW1. — paste the whole thing.',
  titleLabel: 'Post title',
  titleHelp: 'Leave blank to name the post after its ruleset.',
  /**
   * The paste *looked* like a code (right prefix) but would not decode. Naming the two things
   * that actually cause this beats "that is not a valid world code", which told a user who just
   * pasted something starting with HXW1. only that we disagreed.
   */
  invalid:
    'That world code didn’t decode. Usually the paste was cut short, or extra text came along with it — a code is one unbroken line starting with HXW1. and nothing after it. Copy it again from HexLife Explorer (Share → Copy World Code).',
  /** No `HXW1.` prefix at all — a different mistake, and worth saying so. */
  notACode:
    'That doesn’t start with HXW1., so it isn’t a world code. In HexLife Explorer, open Share → "Copy World Code" and paste the whole line.',

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
} as const

/** The prefix every world code carries (see src/core/WorldCodec.js). */
export const WORLD_CODE_PREFIX = 'HXW1.'

/**
 * Which "that didn't work" to show. The two failures are genuinely different mistakes — a
 * truncated code and a paste of the wrong thing entirely — and a decoder that says the same
 * sentence to both makes the user guess which one they made.
 */
export function invalidCodeMessage(code: string): string {
  return code.trim().startsWith(WORLD_CODE_PREFIX)
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
  /** Create a Live Specimen from inside a post (the in-post "Create your own" button). */
  CreatePost: 'api/post',
  OnAppInstall: 'internal/on/app/install',
  OnMenuNewPost: 'internal/on/menu/new-post',
  OnFormNewPost: 'internal/on/form/new-post',
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
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnFormNewPost]: 'POST',
  [Endpoint.OnPostSubmit]: 'POST',
  [Endpoint.OnPostDelete]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}

/** Must match the form name registered in devvit.json → `forms`. */
export const NEW_POST_FORM = 'newWorldPost'
