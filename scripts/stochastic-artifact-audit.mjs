import {createHash} from 'node:crypto';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';

const root = new URL('../', import.meta.url);
const output = new URL('../tests/fixtures/performance/stochastic-phase0-artifacts.json', import.meta.url);
const exceptionsPath = new URL(
  '../tests/fixtures/performance/stochastic-artifact-exceptions.json',
  import.meta.url,
);
const acceptedRecordPaths = [
  exceptionsPath,
  new URL('../tests/fixtures/performance/spacetime-artifact-record.json', import.meta.url),
  new URL('../tests/fixtures/performance/embed-optimization-artifact-record.json', import.meta.url),
];
const files = [
  'src/core/wasm-engine/hexlife_wasm_bg.wasm',
  'src/core/wasm-engine/hexlife_wasm.js',
  ...(await builtJavaScriptFiles()),
];
const artifacts = {};
for (const relative of files) {
  const bytes = await readFile(new URL(relative, root));
  artifacts[relative] = {
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, {level: 9}).byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

const report = {
  schemaVersion: 1,
  frozen: '2026-08-10',
  buildCommand: 'npm run build:embed',
  packageVersion: '1.7.1',
  stochasticArtifactPresent: false,
  artifacts,
};
const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--write')) {
  await writeFile(output, rendered);
  console.log(`Wrote ${output.pathname}`);
} else {
  const baseline = JSON.parse(await readFile(output, 'utf8'));
  const records = await Promise.all(
    acceptedRecordPaths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
  );
  const accepted = new Map();
  for (const record of records) {
    for (const [file, measurements] of Object.entries(record.files)) {
      accepted.set(logicalPath(file), measurements);
    }
  }
  const changed = [];
  const noted = [];
  const currentByLogicalPath = new Map(
    Object.entries(artifacts).map(([file, measurements]) => [logicalPath(file), {file, measurements}]),
  );
  for (const [baselineFile, prior] of Object.entries(baseline.artifacts)) {
    const key = logicalPath(baselineFile);
    const current = currentByLogicalPath.get(key);
    if (!current) {
      changed.push(`${baselineFile}: missing from current build`);
      continue;
    }
    const gzip = current.measurements.gzipBytes;
    if (gzip <= prior.gzipBytes * 1.005) continue;
    // The frozen 0.5% ceiling is not moved. A file may only exceed it if it is named in the tracked
    // exception record, and only up to the exact size recorded there — so an accepted trade cannot
    // quietly become a licence for further growth.
    const exception = accepted.get(key);
    if (!exception) {
      changed.push(`${current.file}: gzip ${prior.gzipBytes} -> ${gzip} (>0.5%, no recorded exception)`);
    } else if (gzip > exception.acceptedGzipBytes) {
      changed.push(
        `${current.file}: gzip ${gzip} exceeds its recorded exception of ${exception.acceptedGzipBytes}`,
      );
    } else {
      noted.push(`${current.file}: gzip ${prior.gzipBytes} -> ${gzip} (recorded exception)`);
    }
  }
  if (changed.length) throw new Error(`Existing artifact boundary regressed:\n${changed.join('\n')}`);
  if (noted.length) {
    console.log(`Existing artifacts within their recorded exceptions:\n  ${noted.join('\n  ')}`);
    console.log(`Latest owner ruling ${records.at(-1).ownerDecision.date}: `
      + `${records.at(-1).ownerDecision.ruling}. ${records.at(-1).ownerDecision.scope}`);
  } else {
    console.log('Existing artifact gzip sizes stay within the frozen 0.5% ceiling.');
  }
}

// Vite content hashes change whenever the inlined Wasm bytes change. Compare the logical chunk
// identity so the frozen size gate survives a hash-only rename without treating a new stochastic
// entry (which correctly has no Phase-0 baseline) as an old-consumer regression.
function logicalPath(file) {
  return file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '-<hash>.js');
}

async function builtJavaScriptFiles() {
  const base = new URL('../dist/embed-package/src/embed/', import.meta.url);
  const entries = (await readdir(base, {withFileTypes: true}))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `dist/embed-package/src/embed/${entry.name}`);
  const chunks = (await readdir(new URL('chunks/', base), {withFileTypes: true}))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `dist/embed-package/src/embed/chunks/${entry.name}`);
  return [...entries, ...chunks].sort();
}
