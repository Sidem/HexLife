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

export type Endpoint = (typeof Endpoint)[keyof typeof Endpoint]
export const Endpoint = {
  GetWorld: 'api/world',
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
  [Endpoint.OnAppInstall]: 'POST',
  [Endpoint.OnMenuNewPost]: 'POST',
  [Endpoint.OnFormNewPost]: 'POST',
  [Endpoint.OnPostSubmit]: 'POST',
  [Endpoint.OnPostDelete]: 'POST',
} as const satisfies {[endpoint: string]: 'GET' | 'POST'}

/** Must match the form name registered in devvit.json → `forms`. */
export const NEW_POST_FORM = 'newWorldPost'
