import {readFile, rename, rm, writeFile} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stagingDir = join(projectRoot, 'dist', 'totalistic-standalone-build')
const builtHtmlPath = join(stagingDir, 'totalistic-256.html')
const outputPath = join(projectRoot, 'dist', 'totalistic-256-standalone.html')

const html = await readFile(builtHtmlPath, 'utf8')
const externalModulePattern = /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="([^"]+)")[^>]*><\/script>/g
const moduleScripts = [...html.matchAll(externalModulePattern)]

if (moduleScripts.length !== 1) {
  throw new Error(`Expected one generated module script, found ${moduleScripts.length}.`)
}

const scriptUrl = moduleScripts[0][1]
if (/^(?:[a-z]+:|\/\/)/i.test(scriptUrl)) {
  throw new Error(`Generated module script is not local: ${scriptUrl}`)
}

const scriptPath = resolve(dirname(builtHtmlPath), scriptUrl.split(/[?#]/, 1)[0])
const relativeScriptPath = relative(stagingDir, scriptPath)
if (relativeScriptPath.startsWith(`..${sep}`) || relativeScriptPath === '..') {
  throw new Error(`Generated module script escaped the staging directory: ${scriptUrl}`)
}

const javascript = (await readFile(scriptPath, 'utf8')).replaceAll('</script', '<\\/script')
const inlineModule = `<script type="module">\n${javascript}\n</script>`
// A bundled program can legitimately contain replacement tokens such as `$&`. Passing it directly
// as the replacement string would expand those tokens and reinsert the external script tag into the
// supposedly standalone document; a callback returns the bundle literally.
let standaloneHtml = html.replace(moduleScripts[0][0], () => inlineModule)

// The live demos share one presentation shell. Vite emits that stylesheet as a local asset, so the
// offline atlas must inline it alongside the module rather than quietly becoming network-dependent.
const stylesheetPattern = /<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]+)")[^>]*>/g
const stylesheets = [...standaloneHtml.matchAll(stylesheetPattern)]
for (const stylesheet of stylesheets) {
  const stylesheetUrl = stylesheet[1]
  if (/^(?:[a-z]+:|\/\/)/i.test(stylesheetUrl)) {
    throw new Error(`Generated stylesheet is not local: ${stylesheetUrl}`)
  }
  const stylesheetPath = resolve(dirname(builtHtmlPath), stylesheetUrl.split(/[?#]/, 1)[0])
  const relativeStylesheetPath = relative(stagingDir, stylesheetPath)
  if (relativeStylesheetPath.startsWith(`..${sep}`) || relativeStylesheetPath === '..') {
    throw new Error(`Generated stylesheet escaped the staging directory: ${stylesheetUrl}`)
  }
  const css = (await readFile(stylesheetPath, 'utf8')).replaceAll('</style', '<\\/style')
  standaloneHtml = standaloneHtml.replace(stylesheet[0], () => `<style>\n${css}\n</style>`)
}

const externalResourcePattern = /<(?:script|link|img|source|audio|video|object|embed|iframe)\b[^>]*\b(?:src|href|data)="(?!data:|#)([^"]+)"[^>]*>/gi
const externalResources = [...standaloneHtml.matchAll(externalResourcePattern)].map((match) => match[1])
if (externalResources.length > 0) {
  throw new Error(`Standalone HTML still references runtime assets: ${externalResources.join(', ')}`)
}
if (!standaloneHtml.includes('data:application/wasm;base64,')) {
  throw new Error('Standalone HTML does not contain the inlined Wasm module.')
}

await writeFile(`${outputPath}.tmp`, standaloneHtml)
await rename(`${outputPath}.tmp`, outputPath)
await rm(stagingDir, {recursive: true})

const sizeKiB = (Buffer.byteLength(standaloneHtml) / 1024).toFixed(1)
console.log(`Created ${relative(projectRoot, outputPath)} (${sizeKiB} KiB, no runtime assets).`)
