/**
 * Webview client bundler (#26 Phase 1).
 *
 * This replaces a plain `esbuild` CLI invocation because the client now imports the #25 embed
 * runtime (`../../src/embed/`) straight from the HexLife source tree, and that source uses two
 * **Vite-flavoured import suffixes** that esbuild knows nothing about:
 *
 *   import wasmUrl from '.../hexlife_wasm_bg.wasm?url'   (EmbedSim)
 *   import src     from '.../vertex.glsl?raw'            (EmbedRenderer)
 *
 * Vite resolves those; esbuild would just fail to find a file literally named `…wasm?url`. The
 * plugin below teaches it the same two suffixes:
 *
 *   ?url → a base64 `data:application/wasm;base64,…` URI (the wasm is INLINED into the bundle).
 *          Inlining is not an optimisation here, it is a requirement: a Devvit webview serves only
 *          the files in `public/`, and nothing may be fetched from a CDN.
 *   ?raw → the file's text.
 *
 * The result is a single self-contained `public/game.js` (and `splash.js`) — no side-car assets,
 * which is exactly the shape Devvit wants. Deliberately NOT forking the embed sources to strip the
 * suffixes: one engine, one renderer, one determinism contract (see docs/DEVVIT-PLAN.md).
 */
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import * as esbuild from 'esbuild'

/**
 * Inline the wasm as a base64 `data:` URI (default), or emit it as a real file next to the
 * bundles (`INLINE_WASM=0`).
 *
 * Inlining costs ~33% in size over the raw binary and forfeits streaming compilation, so a real
 * file is the better shape *if it works*. Whether it works is not something this repo can find out:
 * it depends on whether the Devvit webview's CSP permits a same-origin `fetch` of the asset, and
 * only a playtest can answer that. `loadWasmBytes` already handles both (a `data:` URI is decoded
 * with `atob`; anything else is fetched), so this flag flips the whole experiment either way with
 * nothing else to change.
 *
 * Default is inline — the shipped, known-good path. Do not publish with `INLINE_WASM=0` until a
 * playtest confirms the fetch (see DEVVIT-PLAN "Still needs the owner").
 */
const INLINE_WASM = process.env.INLINE_WASM !== '0'

/** Teaches esbuild Vite's `?url` (→ data URI or file) and `?raw` (→ text) import suffixes. */
const viteAssetSuffixes = {
  name: 'vite-asset-suffixes',
  setup(build) {
    build.onResolve({filter: /\?(url|raw)$/}, args => {
      const [file, suffix] = args.path.split('?')
      return {
        path: path.resolve(args.resolveDir, file),
        namespace: suffix === 'url' ? 'asset-url' : 'asset-raw',
      }
    })
    build.onLoad({filter: /.*/, namespace: 'asset-url'}, async args => ({
      contents: await readFile(args.path),
      // dataurl: MIME comes from the extension → application/wasm.
      // file: copied to outdir; the import becomes a relative URL the runtime fetches.
      loader: INLINE_WASM ? 'dataurl' : 'file',
      watchFiles: [args.path],
    }))
    build.onLoad({filter: /.*/, namespace: 'asset-raw'}, async args => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
      watchFiles: [args.path],
    }))
  },
}

const argv = process.argv.slice(2)
const watch = argv.includes('--watch') || argv.includes('--watch=forever')
const metafileArg = argv.find(a => a.startsWith('--metafile='))
/** `--minify` marks the publish build (see package.json `build`). */
const publish = argv.includes('--minify')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/client/splash.ts', 'src/client/game.ts'],
  outdir: 'public',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  // The two entries are ~95% the same bytes — the whole embed runtime, twice. Splitting hoists
  // that into a chunk they share, so expanding a post reuses what the feed card already fetched
  // instead of downloading a second copy of the same engine.
  splitting: true,
  // Sourcemaps are ~4x the code they map and are pure dead weight in a published app: nobody can
  // act on them but us, and `public/` ships whole. Keep them for watch/dev, where they are the
  // entire point of building unminified.
  sourcemap: publish ? false : 'linked',
  // Stable, un-hashed asset names: `npm run clean` removes them by glob, and a hash would leave a
  // new orphan in `public/` on every build.
  assetNames: '[name]',
  chunkNames: '[name]-[hash]',
  logLevel: 'warning',
  minify: publish,
  metafile: !!metafileArg,
  plugins: [viteAssetSuffixes],
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[build-client] watching…')
} else {
  const result = await esbuild.build(options)
  if (metafileArg) {
    const out = metafileArg.slice('--metafile='.length)
    const {mkdir, writeFile} = await import('node:fs/promises')
    await mkdir(path.dirname(out), {recursive: true})
    await writeFile(out, JSON.stringify(result.metafile))
  }
}
