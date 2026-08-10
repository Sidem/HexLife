import {readFile, writeFile} from 'node:fs/promises';
import {
  createGasModel,
  createOutbreakModel,
  createWildfireModel,
} from '../public/embed-concept-models.js';

const destination = new URL('../tests/fixtures/stochastic/js-oracles.json', import.meta.url);
const selectedGenerations = new Set([0, 1, 2, 5, 10, 20, 40, 80]);
const excerptIndices = [0, 1, 2, 73, 144, 511, 1024, 2047, 3021, 4095];

const fixtures = {
  schemaVersion: 1,
  frozen: '2026-08-10',
  source: 'public/embed-concept-models.js',
  checksum: 'FNV-1a/u8',
  selectedGenerations: [...selectedGenerations],
  fixtures: [
    captureGas(),
    captureWildfire(),
    ...captureOutbreakPair(),
  ],
};

const rendered = `${JSON.stringify(fixtures, null, 2)}\n`;
if (process.argv.includes('--write')) {
  await writeFile(destination, rendered);
  console.log(`Wrote ${destination.pathname}`);
} else {
  const current = await readFile(destination, 'utf8');
  if (current !== rendered) {
    throw new Error('Stochastic JS oracle drifted. Review the model change, then regenerate with --write.');
  }
  console.log('Stochastic JS differential oracles match the frozen fixture.');
}

function captureGas() {
  const rows = 60;
  const columns = 70;
  const params = {density: 24, scatter: 7};
  const model = createGasModel(rows, columns);
  model.reset(params);
  return capture('mixing-chamber', 'gas', rows, columns, params, model, {
    auxiliary: () => model.velocity,
    metrics: () => ({collisions: model.collisions, membraneOpen: model.membraneOpen}),
    beforeStep: (generation) => { if (generation === 20) model.openMembrane(); },
  });
}

function captureWildfire() {
  const rows = 60;
  const columns = 70;
  const params = {
    forest: 78,
    spread: 18,
    wind: 'none',
    windBoost: 2,
    burnTicks: 2,
    ashTicks: 20,
    regrowth: 5,
  };
  const model = createWildfireModel(rows, columns);
  model.reset(params);
  return capture('wildfire-command', 'neighborhood', rows, columns, params, model, {
    auxiliary: () => u16Bytes(model.age),
    metrics: () => ({}),
  });
}

function captureOutbreakPair() {
  const rows = 54;
  const columns = 64;
  const params = {
    infection: 12,
    infectiousTicks: 6,
    immunityTicks: 36,
    coverage: 20,
    efficacy: 85,
  };
  return [false, true].map((intervention) => {
    const model = createOutbreakModel(rows, columns, {intervention});
    model.reset(params);
    return capture(
      intervention ? 'outbreak-intervention' : 'outbreak-baseline',
      'neighborhood',
      rows,
      columns,
      {...params, intervention},
      model,
      {
        auxiliary: () => u16Bytes(model.age),
        metrics: () => ({totalInfections: model.totalInfections}),
        beforeStep: (generation) => {
          if (intervention && generation === 20) model.vaccinateRing();
        },
      },
    );
  });
}

function capture(id, backend, rows, columns, params, model, hooks) {
  const generations = [];
  record();
  for (let generation = 0; generation < 80; generation++) {
    hooks.beforeStep?.(generation);
    model.step();
    record();
  }
  return {id, backend, rows, columns, params, generations};

  function record() {
    if (!selectedGenerations.has(model.generation)) return;
    generations.push({
      generation: model.generation,
      visibleChecksum: checksum(model.cells),
      auxiliaryChecksum: checksum(hooks.auxiliary()),
      census: census(model.cells),
      excerpt: excerptIndices.map((index) => model.cells[index]),
      ...hooks.metrics(),
    });
  }
}

function census(cells) {
  const counts = [];
  for (const state of cells) counts[state] = (counts[state] || 0) + 1;
  return Array.from({length: counts.length}, (_, index) => counts[index] || 0);
}

function checksum(bytes) {
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function u16Bytes(values) {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}
