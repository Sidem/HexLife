import {Endpoint, type GetWorldRsp} from '../shared/api.ts'

/** The world code this post was created with, or undefined (no code stored, or the call failed). */
export async function fetchWorldCode(): Promise<string | undefined> {
  let rsp
  try {
    rsp = await fetch(Endpoint.GetWorld, {
      headers: {Accept: 'application/json'},
    })
  } catch (err) {
    console.error(`HTTP error: ${err instanceof Error ? err.message : err}`)
    return
  }

  if (!rsp.ok) {
    const text = await rsp.text().catch(() => '')
    console.error(`HTTP status ${rsp.status}: ${rsp.statusText}; ${text}`)
    return
  }

  return ((await rsp.json()) as GetWorldRsp).code
}
