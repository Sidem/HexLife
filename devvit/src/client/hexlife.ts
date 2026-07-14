/**
 * Shared webview bootstrap for the HexLife Devvit post (#26 Phase 1 — the wasm/WebGL2 go/no-go).
 *
 * Both entrypoints (`splash.html`, the in-feed post view; `game.html`, the expanded view) mount the
 * *same* `<hexlife-world>` element from `src/embed/` — the #25 embed runtime, imported by relative
 * path so Devvit's esbuild bundles it from source. There is no second sim and no second renderer:
 * a fork here would mean maintaining two engines and would break the byte-identity contract that is
 * the whole product claim.
 *
 * Params are hardcoded for Phase 1. Redis-backed per-post params are Phase 2.
 *
 * ## Why the diagnostics strip exists
 *
 * The go/no-go question is whether **wasm instantiates** and **WebGL2 acquires a context** inside a
 * Reddit webview — on desktop AND in the iOS/Android apps. On a phone there is no console and no
 * devtools, so a failure has to be *legible on the surface itself*. The strip renders the answer as
 * text: WebGL2 probe, wasm/ready state, live tick count. A blank post tells us nothing; "webgl2: no"
 * tells us exactly where we died. It comes back out in Phase 2.
 */

// The embed's entry module registers <hexlife-world> as a side effect (customElements.define).
import '../../../src/embed/index.js'

/** Hardcoded Phase 1 specimen (same ruleset the embed demo page leads with). */
const RULESET = 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6'
const SEED = 12345
/** Mobile-first grid: a phone GPU is the constraint, not a desktop one. */
const ROWS = 64
const SPEED = 20

/** The bits of `<hexlife-world>`'s public API this page reads. */
type HexWorld = HTMLElement & {
  readonly tickCount: number
  readonly playing: boolean
  readonly error?: string | null
}

/** Does this webview give us a WebGL2 context at all? Probed on a throwaway canvas. */
function probeWebgl2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export function mountHexLife(mount: HTMLElement, status: HTMLElement): void {
  const webgl2 = probeWebgl2()

  const world = document.createElement('hexlife-world') as HexWorld
  world.setAttribute('ruleset', RULESET)
  world.setAttribute('seed', `${SEED}`)
  world.setAttribute('rows', `${ROWS}`)
  world.setAttribute('speed', `${SPEED}`)
  // No attribution link in v1: a post is not a third-party page, and an outbound <a> inside a
  // webview is a nav we haven't cleared with Devvit yet. Deep-linking is Phase 2's job.
  world.setAttribute('link', 'off')

  let ready = false
  world.addEventListener('hexlife-ready', () => {
    ready = true
  })

  mount.append(world)

  // Poll rather than hook the loop: tickCount advancing is the single strongest signal that wasm is
  // running AND the renderer is being driven. If it sticks at 0, we know it never got off the line.
  const render = (): void => {
    const err = world.error
    status.textContent = err
      ? `webgl2:${webgl2 ? 'ok' : 'NO'} · error: ${err}`
      : `webgl2:${webgl2 ? 'ok' : 'NO'} · wasm:${ready ? 'ok' : '…'} · ticks:${world.tickCount}`
  }
  render()
  setInterval(render, 500)
}
