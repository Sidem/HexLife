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

/** Teaches esbuild Vite's `?url` (→ data URI) and `?raw` (→ text) import suffixes. */
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
      loader: 'dataurl', // MIME comes from the extension → application/wasm.
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

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/client/splash.ts', 'src/client/game.ts'],
  outdir: 'public',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  sourcemap: 'linked',
  logLevel: 'warning',
  minify: argv.includes('--minify'),
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
