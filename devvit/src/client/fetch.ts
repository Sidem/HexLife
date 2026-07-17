import {Endpoint, type GetWorldRsp} from '../shared/api.ts'

/**
 * What `api/world` said about this post's world.
 *
 * The two "no code" cases are **not** the same thing and the caller must not treat them alike:
 * `{ok: true, code: undefined}` is the server saying "this post genuinely has no code" (the install
 * demo), which the built-in demo specimen answers correctly. `{ok: false}` is "we don't know" — a
 * network error or a non-2xx. Rendering the demo for that second case shows a viewer a world that
 * isn't the one the post is about, under someone else's title, with nothing saying so.
 */
export type WorldCodeResult = {ok: true; code?: string} | {ok: false}

/** Fetch this post's world code. Never throws — the failure is a value the caller renders. */
export async function fetchWorldCode(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<WorldCodeResult> {
  let rsp
  try {
    rsp = await fetchImpl(Endpoint.GetWorld, {
      headers: {Accept: 'application/json'},
    })
  } catch (err) {
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return {ok: false}
  }

  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '')
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}; ${text}`)
    return {ok: false}
  }

  try {
    return {ok: true, code: ((await rsp.json()) as GetWorldRsp).code}
  } catch (err) {
    // A 2xx that isn't JSON is a broken server, not an empty post.
    console.error(
      `Bad api/world body: ${err instanceof Error ? err.message : err}`,
    )
    return {ok: false}
  }
}
