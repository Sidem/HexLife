import { spawnSync } from 'node:child_process';
import { cpus, platform, release, arch } from 'node:os';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputPath = resolve('tests/fixtures/performance/stochastic-phase0-native-baseline.json');
const command = [
  'test',
  '--release',
  '--manifest-path',
  'hexlife-wasm/Cargo.toml',
  'stochastic_phase0_native_baseline',
  '--',
  '--ignored',
  '--nocapture',
];
const result = spawnSync('cargo', command, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const percentile = (values, proportion) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * proportion) - 1];
};
const median = (values) => percentile(values, 0.5);
const records = `${result.stdout}\n${result.stderr}`
  .split(/\r?\n/)
  .filter((line) => line.startsWith('PHASE0_NATIVE|'))
  .map((line) => {
    const [, tier, engine, workload, cellCount, samples] = line.split('|');
    const sampleNsPerTick = samples.split(',').map(Number);
    const middle = median(sampleNsPerTick);
    return {
      tier,
      engine,
      workload,
      cellCount: Number(cellCount),
      sampleNsPerTick,
      medianNsPerTick: middle,
      p95NsPerTick: percentile(sampleNsPerTick, 0.95),
      madNsPerTick: median(sampleNsPerTick.map((value) => Math.abs(value - middle))),
    };
  });

if (records.length !== 30) {
  throw new Error(`Expected 30 native benchmark records, received ${records.length}.`);
}

const baseline = {
  schema: 'hexlife-stochastic-phase0-native-performance-v1',
  frozenAt: '2026-08-10',
  command: `cargo ${command.join(' ')}`,
  build: 'Cargo release profile; native rlib test binary; seven measured batches after three warmups',
  host: {
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCores: cpus().length,
    node: process.version,
  },
  caveat:
    'coffee-table-shape-proxy isolates a k=16 block table of the same size; the authored Coffee transition and host conjugation are measured exactly by the browser baseline.',
  records,
};

if (process.argv.includes('--write')) {
  writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
} else {
  console.log(JSON.stringify(baseline, null, 2));
}
