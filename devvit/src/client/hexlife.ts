/**
 * Shared webview bootstrap for the HexLife Devvit post (#26 Phase 2 — the "Live Specimen" post).
 *
 * Both entrypoints (`splash.html`, the in-feed post view; `game.html`, the expanded view) mount the
 * *same* `<hexlife-world>` element from `src/embed/` — the #25 embed runtime, imported by relative
 * path so Devvit's esbuild bundles it from source. There is no second sim and no second renderer:
 * a fork here would mean maintaining two engines and would break the byte-identity contract that is
 * the whole product claim.
 *
 * **The post's world is a world code** (`HXW1.…`), authored in the explorer and pasted into the
 * create-post form; the server hands it to us from Redis. It carries the grid, the ruleset, the exact
 * starting cells and the exact color table, so nothing here is configurable and nothing is re-derived
 * — this webview renders precisely the world its author was looking at.
 *
 * **It starts paused, on purpose.** A feed is full of posts; one that starts moving the moment it
 * scrolls into view is an animation you did not ask for. The element's poster overlay (its play
 * button) is the affordance: the viewer opts in, and only then does anything tick.
 *
 * Transport chrome (play/pause, restart, speed) lives *outside* the element so both entrypoints share
 * one control strip; the in-element corner reset is hidden via `::part(reset)`.
 */

// The embed's entry module registers <hexlife-world> as a side effect (customElements.define).
import '../../../src/embed/index.js'
import {fetchWorldCode} from './fetch.ts'

/**
 * The fallback specimen, for a post created without a code (the app-install demo post). Plain
 * attributes, no code — a random seeded world rather than a broken one.
 */
const DEMO = {
  ruleset: 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6',
  seed: '12345',
  rows: '64',
  speed: '20',
}

/** The bits of `<hexlife-world>`'s public API this page reads. */
type HexWorld = HTMLElement & {
  readonly tickCount: number
  readonly playing: boolean
  readonly userPaused: boolean
  readonly error?: string | null
  /** The live sim, once booted — read to seed the speed slider with the code's speed. */
  readonly sim?: {speed: number} | null
  play(): void
  pause(): void
  reset(): void
}

/**
 * @param mount Where the world goes.
 * @param status A one-line surface for boot/failure text. There is no console on a phone, so a
 *   failure has to be legible on the post itself; on success it goes away entirely.
 */
export async function mountHexLife(
  mount: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  status.textContent = 'Loading…'

  const code = await fetchWorldCode()

  const world = document.createElement('hexlife-world') as HexWorld
  if (code) world.setAttribute('code', code)
  else for (const [k, v] of Object.entries(DEMO)) world.setAttribute(k, v)

  // Paused ⇒ the element shows its play overlay and ticks nothing until the viewer presses it.
  world.setAttribute('paused', '')
  // No attribution link inside a post: an outbound <a> in a webview is a navigation we have not
  // cleared with Devvit, and the post is not a third-party page that owes us a credit.
  world.setAttribute('link', 'off')

  mount.append(world)

  wireTransport(world)

  // The element renders its own error state in-place (bad code, no WebGL2); mirror it to the status
  // line so the failure is visible even if the canvas area is clipped in the feed.
  const settle = (): void => {
    const speedInput = document.getElementById(
      'speed',
    ) as HTMLInputElement | null
    // Seed the slider from the code's speed once the sim exists, so the control starts where the post
    // actually runs rather than at the markup default.
    if (speedInput && world.sim) speedInput.value = String(world.sim.speed)
    syncPlayPauseLabel(world)
    status.textContent = world.error ?? ''
    status.hidden = !world.error
  }
  world.addEventListener('hexlife-ready', settle)
  // A failed boot dispatches nothing, so poll briefly for the error state rather than hanging on
  // "Loading…" forever.
  setTimeout(settle, 2000)
}

/** Play/pause + restart + speed — shared by splash and game entrypoints. */
function wireTransport(world: HexWorld): void {
  const speedInput = document.getElementById('speed') as HTMLInputElement | null
  const playPauseBtn = document.getElementById(
    'play-pause',
  ) as HTMLButtonElement | null
  const restartBtn = document.getElementById(
    'restart',
  ) as HTMLButtonElement | null

  if (speedInput) {
    // `speed` is a playback rate, not part of the tick sequence, so the element applies it live.
    speedInput.addEventListener('input', () =>
      world.setAttribute('speed', speedInput.value),
    )
  }

  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      // Prefer the element's user-paused flag over `playing` (which is also false when offscreen).
      if (world.userPaused || !world.playing) {
        world.removeAttribute('paused')
        world.play()
      } else {
        world.pause()
        world.setAttribute('paused', '')
      }
      syncPlayPauseLabel(world)
    })
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      world.reset()
      // Stay in whatever play state we were in — restart rewinds, it doesn't force pause.
      if (!world.playing && !world.userPaused) world.play()
      syncPlayPauseLabel(world)
    })
  }

  // Keep the button glyph honest when the user presses the in-element poster overlay instead.
  world.addEventListener('hexlife-ready', () => syncPlayPauseLabel(world))
  // The element doesn't emit a play/pause event; poll cheaply while mounted.
  setInterval(() => syncPlayPauseLabel(world), 400)
}

function syncPlayPauseLabel(world: HexWorld): void {
  const btn = document.getElementById('play-pause') as HTMLButtonElement | null
  if (!btn) return
  const showPlay = world.userPaused || !world.playing
  btn.textContent = showPlay ? '▶' : '❚❚'
  btn.setAttribute('aria-label', showPlay ? 'Play' : 'Pause')
  btn.title = showPlay ? 'Play' : 'Pause'
}
