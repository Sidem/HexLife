import {copyFile, mkdir} from 'node:fs/promises'

const copies = [
  ['packages/hexlife-embed/package.json', 'dist/embed-package/package.json'],
  ['packages/hexlife-embed/README.md', 'dist/embed-package/README.md'],
  ['LICENSE', 'dist/embed-package/LICENSE'],
  ['src/embed/api.d.ts', 'dist/embed-package/src/embed/api.d.ts'],
  ['src/embed/hexlife-world.d.ts', 'dist/embed-package/src/embed/hexlife-world.d.ts'],
  ['src/core/rulesetDescriptor.d.ts', 'dist/embed-package/src/core/rulesetDescriptor.d.ts'],
  ['src/core/rulesetName.d.ts', 'dist/embed-package/src/core/rulesetName.d.ts'],
  ['src/core/colorPalettes.d.ts', 'dist/embed-package/src/core/colorPalettes.d.ts'],
  ['src/core/WorldCodec.d.ts', 'dist/embed-package/src/core/WorldCodec.d.ts'],
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
