/**
 * Remove build output: `dist/`, and the generated files in `public/`.
 *
 * This was `rm -rf dist/ public/*.js*`, which npm hands to `cmd.exe` on Windows, where there is no
 * `rm` — so `clean` failed, and with it `npm run publish` (`clean && build && devvit publish`).
 * Node is the one tool guaranteed to be here, and this script is the same three lines in it.
 *
 * It matters more than a tidy-up: Devvit uploads `public/` **whole**, so anything stale left in it
 * ships. A failed clean was 1.7 MB of orphaned sourcemaps sitting in the publish payload.
 *
 * `public/` is not generated — `chrome.css`, the HTML entrypoints, and `snoo.png` are source and
 * live here. Only the build's own output is removed, by extension.
 */
import {readdir, rm} from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PUBLIC = path.join(ROOT, 'public')

/** Bundles (`*.js`), their maps (`*.js.map`), split chunks, and the emitted wasm (`INLINE_WASM=0`). */
const GENERATED = /(\.js(\.map)?|\.wasm)$/

await rm(path.join(ROOT, 'dist'), {recursive: true, force: true})

for (const name of await readdir(PUBLIC)) {
  if (GENERATED.test(name)) await rm(path.join(PUBLIC, name), {force: true})
}
