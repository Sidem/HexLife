import {copyFile, mkdir} from 'node:fs/promises'

/**
 * Every `.d.ts` the published package ships, listed EXPLICITLY rather than globbed.
 *
 * A glob would be shorter and would also silently ship whatever happened to be lying in `src/`. The
 * cost of the explicit list is that a new entry point needs a line here — and the failure when it is
 * forgotten is quiet: the JS resolves, the types 404, and a TypeScript consumer gets `any` (or a
 * hard "could not find a declaration file") from a package that otherwise looks healthy. Adding an
 * entry to `vite.embed.config.js` without adding it here is exactly that bug.
 */
const copies = [
  ['packages/hexlife-embed/package.json', 'dist/embed-package/package.json'],
  ['packages/hexlife-embed/README.md', 'dist/embed-package/README.md'],
  ['LICENSE', 'dist/embed-package/LICENSE'],
  ['src/embed/api.d.ts', 'dist/embed-package/src/embed/api.d.ts'],
  ['src/embed/sim.d.ts', 'dist/embed-package/src/embed/sim.d.ts'],
  ['src/embed/render.d.ts', 'dist/embed-package/src/embed/render.d.ts'],
  ['src/embed/ca.d.ts', 'dist/embed-package/src/embed/ca.d.ts'],
  ['src/embed/stochastic.d.ts', 'dist/embed-package/src/embed/stochastic.d.ts'],
  ['src/embed/ca-element.d.ts', 'dist/embed-package/src/embed/ca-element.d.ts'],
  ['src/embed/stochastic-element.d.ts', 'dist/embed-package/src/embed/stochastic-element.d.ts'],
  ['src/embed/index.d.ts', 'dist/embed-package/src/embed/index.d.ts'],
  ['src/embed/hexlife-world.d.ts', 'dist/embed-package/src/embed/hexlife-world.d.ts'],
  ['src/embed/hexlife-grid.d.ts', 'dist/embed-package/src/embed/hexlife-grid.d.ts'],
  ['src/core/rulesetDescriptor.d.ts', 'dist/embed-package/src/core/rulesetDescriptor.d.ts'],
  ['src/core/rulesetCode.d.ts', 'dist/embed-package/src/core/rulesetCode.d.ts'],
  ['src/core/rulesetHex.d.ts', 'dist/embed-package/src/core/rulesetHex.d.ts'],
  ['src/core/rulesetName.d.ts', 'dist/embed-package/src/core/rulesetName.d.ts'],
  ['src/core/colorPalettes.d.ts', 'dist/embed-package/src/core/colorPalettes.d.ts'],
  ['src/core/WorldCodec.d.ts', 'dist/embed-package/src/core/WorldCodec.d.ts'],
  // `ca.d.ts` and `ca-element.d.ts` both re-export from this one, so omitting it breaks their types
  // rather than merely leaving the codec untyped.
  ['src/core/CaCodec.d.ts', 'dist/embed-package/src/core/CaCodec.d.ts'],
  ['src/utils/gpuSupport.d.ts', 'dist/embed-package/src/utils/gpuSupport.d.ts'],
]

for (const [source, destination] of copies) {
  await mkdir(new URL(`../${destination.split('/').slice(0, -1).join('/')}/`, import.meta.url), {
    recursive: true,
  })
  await copyFile(
    new URL(`../${source}`, import.meta.url),
    new URL(`../${destination}`, import.meta.url),
  )
}
