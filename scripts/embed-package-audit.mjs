import {readdir, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';

const packageDir = new URL('../dist/embed-package/src/embed/', import.meta.url);
const rootEntry = new URL('index.js', packageDir);
const MAX_ROOT_GZIP_BYTES = 100 * 1024;
const WASM_DATA_URI = /data:[^,;]*?(?:;[^,]*)?;base64,AGFzbQ[A-Za-z0-9+/=]*/g;

const files = await javascriptFiles(packageDir);
const wasmOccurrences = [];
for (const url of files) {
  const source = await readFile(url, 'utf8');
  const matches = source.match(WASM_DATA_URI) || [];
  if (matches.length > 1) {
    throw new Error(`${relative(url)} embeds ${matches.length} Wasm binaries; expected at most one.`);
  }
  for (const match of matches) wasmOccurrences.push({file: relative(url), bytes: match.length});
}
if (wasmOccurrences.length !== 4) {
  throw new Error(`Expected exactly four isolated Wasm payloads, found ${wasmOccurrences.length}.`);
}

const closure = await staticClosure(rootEntry);
const rootGzipBytes = closure.reduce((sum, item) => sum + item.gzipBytes, 0);
if (rootGzipBytes > MAX_ROOT_GZIP_BYTES) {
  throw new Error(
    `@hexlife/embed root closure is ${rootGzipBytes} gzip bytes; limit is ${MAX_ROOT_GZIP_BYTES}.`,
  );
}

console.log(`Embed artifact audit passed: ${wasmOccurrences.length} isolated Wasm payloads; `
  + `root closure ${rootGzipBytes} / ${MAX_ROOT_GZIP_BYTES} gzip bytes across ${closure.length} files.`);

async function javascriptFiles(base) {
  const entries = await readdir(base, {withFileTypes: true, recursive: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => pathToFileURL(`${entry.parentPath}/${entry.name}`));
}

async function staticClosure(entry) {
  const pending = [entry];
  const seen = new Set();
  const result = [];
  const importPattern = /\b(?:import|export)\s*(?:[^'";]*?\sfrom\s*)?["'](\.[^"']+\.js)["']/g;
  while (pending.length) {
    const url = pending.pop();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const bytes = await readFile(url);
    const source = bytes.toString('utf8');
    result.push({file: relative(url), gzipBytes: gzipSync(bytes, {level: 9}).byteLength});
    for (const match of source.matchAll(importPattern)) pending.push(new URL(match[1], url));
  }
  return result;
}

function relative(url) {
  return decodeURIComponent(url.href.slice(packageDir.href.length));
}
