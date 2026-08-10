import {spawnSync} from 'node:child_process';
import {cpus, platform, release as osRelease, arch} from 'node:os';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const manifest = 'hexlife-wasm/Cargo.toml';
const outputPath = resolve('tests/fixtures/performance/stochastic-phaseb-native-release.json');
const phase0 = JSON.parse(readFileSync(
  resolve('tests/fixtures/performance/stochastic-phase0-native-baseline.json'),
  'utf8',
));

const commands = {
  existing: ['test', '--release', '--manifest-path', manifest,
    'stochastic_phase0_native_baseline', '--', '--ignored', '--nocapture'],
  stochastic: ['test', '--release', '--manifest-path', manifest,
    '--no-default-features', '--features', 'stochastic', 'stochastic_native_benchmark',
    '--', '--ignored', '--nocapture'],
  analysis: ['test', '--release', '--manifest-path', manifest,
    'phase_a_native_analysis_benchmark', '--', '--ignored', '--nocapture'],
};

function run(args) {
  const result = spawnSync('cargo', args, {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return `${result.stdout}\n${result.stderr}`;
}

function percentile(values, proportion) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * proportion) - 1];
}

function summarize(values) {
  const median = percentile(values, 0.5);
  return {
    medianNsPerTick: median,
    p95NsPerTick: percentile(values, 0.95),
    madNsPerTick: percentile(values.map((value) => Math.abs(value - median)), 0.5),
  };
}

function parse(output, prefix) {
  return output.split(/\r?\n/)
    .filter((line) => line.startsWith(`${prefix}|`))
    .map((line) => {
      const parts = line.split('|');
      const hasMode = prefix === 'PHASEA_NATIVE';
      const sampleNsPerTick = parts[hasMode ? 6 : 5].split(',').map(Number);
      return {
        tier: parts[1],
        engine: parts[2],
        workload: parts[3],
        ...(hasMode ? {mode: parts[4]} : {}),
        cellCount: Number(parts[hasMode ? 5 : 4]),
        sampleNsPerTick,
        ...summarize(sampleNsPerTick),
      };
    });
}

const existing = parse(run(commands.existing), 'PHASE0_NATIVE');
const stochastic = parse(run(commands.stochastic), 'PHASEA_NATIVE');
const analysis = parse(run(commands.analysis), 'PHASEA_NATIVE');
if (existing.length !== 30 || stochastic.length !== 45 || analysis.length !== 18) {
  throw new Error(
    `Unexpected benchmark row count: existing=${existing.length}, stochastic=${stochastic.length}, `
    + `analysis=${analysis.length}.`,
  );
}

const baselineByKey = new Map(phase0.records.map((record) => [
  `${record.tier}|${record.engine}|${record.workload}`,
  record,
]));
const existingComparisons = existing.map((record) => {
  const baseline = baselineByKey.get(`${record.tier}|${record.engine}|${record.workload}`);
  return {
    tier: record.tier,
    engine: record.engine,
    workload: record.workload,
    baselineMedianNsPerTick: baseline.medianNsPerTick,
    releaseMedianNsPerTick: record.medianNsPerTick,
    medianChangePct: (record.medianNsPerTick / baseline.medianNsPerTick - 1) * 100,
  };
});

const audit = {
  schema: 'hexlife-stochastic-phaseb-native-release-v1',
  capturedAt: new Date().toISOString(),
  build: 'Cargo release profile; seven measured batches after warmup; frozen Phase-0 workloads',
  host: {
    platform: `${platform()} ${osRelease()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCores: cpus().length,
    node: process.version,
  },
  commands: Object.fromEntries(Object.entries(commands).map(([key, args]) => [
    key,
    `cargo ${args.join(' ')}`,
  ])),
  note:
    'The release repeat ran later on the same host under a uniformly slower thermal/power state. '
    + 'Existing hot loops are source-identical to Phase 0; use existingComparisons as environmental '
    + 'controls and the paired enabled/disabled and native/oracle rows for release decisions.',
  existing,
  existingComparisons,
  stochastic,
  analysis,
};

const serialized = `${JSON.stringify(audit, null, 2)}\n`;
if (process.argv.includes('--write')) {
  writeFileSync(outputPath, serialized);
  console.log(`Wrote ${outputPath}`);
} else {
  console.log(serialized);
}
