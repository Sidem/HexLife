/**
 * Webview client bundler.
 *
 * The browser runtime comes from the versioned `@hexlife/embed` package. That package has
 * already inlined the Wasm module and shader sources, so this build only bundles the two Devvit
 * entry points and splits their shared runtime into one reusable chunk.
 *
 * The result is a self-contained `public/game.js` / `splash.js` plus shared chunks. No CDN or
 * same-origin Wasm fetch is required by the Reddit webview's CSP.
 */
import path from 'node:path'
import * as esbuild from 'esbuild'

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
  // The two entries are mostly the same bytes. Splitting hoists the embed runtime into a shared
  // chunk so expanding a post reuses what the feed card already fetched.
  splitting: true,
  // Published source maps are dead weight in the Devvit upload. Keep them for local watch builds.
  sourcemap: publish ? false : 'linked',
  chunkNames: '[name]-[hash]',
  logLevel: 'warning',
  minify: publish,
  metafile: !!metafileArg,
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
