const publicBase = '/HexLife';
const status = document.getElementById('status');
const output = document.getElementById('result');
const button = document.getElementById('run');
const contract = await (await fetch('../fixtures/performance/stochastic-phase0-contract.json')).json();
const baseline = await (await fetch('../fixtures/performance/stochastic-phase0-browser-baseline.json')).json();
const {blockRuleFromTable, HexCA, initEngine} = await import(`${publicBase}/src/embed/ca.js`);
const {coffeeDualTransition, seedCaPreset} = await import(`${publicBase}/ca-builder-models.js`);
const {buildHexMirror} = await import(`${publicBase}/coffee-percolation-physics.js`);
const {
  BACKEND_LATTICE_GAS,
  initStochasticEngine,
  StochasticWorld,
} = await import(`${publicBase}/src/embed/stochastic.js`);
const {
  MIXING_SEED,
  OUTBREAK_SEED,
  WILDFIRE_SEED,
  mixingChamber,
  mixingGasRule,
  mixingMembraneSites,
  outbreakInitialState,
  outbreakStochasticRule,
  wildfireInitialState,
  wildfireStochasticRule,
} = await import(`${publicBase}/embed-stochastic-rules.js`);

await Promise.all([initEngine(), initStochasticEngine()]);
status.textContent = 'Ready.';
button.disabled = false;
button.addEventListener('click', runMatrix);

async function runMatrix() {
  button.disabled = true;
  const records = [];
  try {
    for (const [tier, dimensions] of Object.entries(contract.gridTiers)) {
      for (const item of casesFor(dimensions)) {
        status.textContent = `${tier}: ${item.engine} / ${item.workload}`;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        records.push(measureCase(tier, dimensions, item));
      }
    }
    const result = {
      schema: 'hexlife-stochastic-phaseb-browser-release-v1',
      capturedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      contractFrozen: contract.frozen,
      records,
    };
    output.textContent = JSON.stringify(result, null, 2);
    status.textContent = `Complete: ${records.length} cases.`;
  } catch (error) {
    status.textContent = `Failed: ${error.message}`;
    throw error;
  } finally {
    button.disabled = false;
  }
}

function measureCase(tier, dimensions, item) {
  const ticks = contract.batchTicks[tier];
  const warmup = tier === 'demo' ? 8 : tier === 'medium' ? 3 : 1;
  const runs = [];
  let finalChecksum = 0;
  for (let run = 0; run < contract.measuredRuns; run++) {
    const subject = item.create();
    for (let tick = 0; tick < warmup; tick++) subject.step();
    const before = performance.now();
    for (let tick = 0; tick < ticks; tick++) subject.step();
    runs.push((performance.now() - before) / ticks);
    finalChecksum ^= subject.checksum();
    subject.dispose();
  }
  const stats = summarize(runs);
  const frozen = baseline.results.find((record) => (
    record.tier === tier
    && record.engine === item.baselineEngine
    && record.workload === item.baselineWorkload
  ));
  return {
    tier,
    engine: item.engine,
    workload: item.workload,
    cells: dimensions.cells,
    msPerTickRuns: runs,
    medianMsPerTick: stats.median,
    p95MsPerTick: stats.p95,
    madMsPerTick: stats.mad,
    baselineEngine: item.baselineEngine,
    baselineMedianMsPerTick: frozen.medianMsPerTick,
    speedup: frozen.medianMsPerTick / stats.median,
    jsToWasmBytesPerTick: 0,
    tickAllocations: 0,
    finalChecksum: finalChecksum >>> 0,
  };
}

function casesFor({rows, columns}) {
  const wildfire = (workload, values) => {
    const params = {wind: 'none', windBoost: 2, ...values};
    return {
      engine: 'WorldStochastic/neighborhood',
      baselineEngine: 'JavaScript/stochastic-neighborhood',
      baselineWorkload: workload,
      workload,
      create: () => stochasticSubject(new StochasticWorld({
        rows,
        columns,
        seed: WILDFIRE_SEED,
        rule: wildfireStochasticRule(params),
        cells: wildfireInitialState(rows, columns, params),
      })),
    };
  };
  const gas = (workload, params, open = false) => ({
    engine: 'WorldStochastic/lattice-gas',
    baselineEngine: 'JavaScript/lattice-gas',
    baselineWorkload: workload,
    workload,
    create: () => {
      const chamber = mixingChamber(rows, columns, params);
      const world = new StochasticWorld({
        rows,
        columns,
        seed: MIXING_SEED,
        backend: BACKEND_LATTICE_GAS,
        rule: mixingGasRule(params),
        channels: chamber.channels,
        walls: chamber.walls,
      });
      if (open) for (const index of mixingMembraneSites(rows, columns)) world.setWall(index, false);
      return stochasticSubject(world);
    },
  });
  const outbreak = (paired) => ({
    engine: 'WorldStochastic/neighborhood',
    baselineEngine: 'JavaScript/stochastic-neighborhood',
    baselineWorkload: paired ? 'paired-outbreak' : 'outbreak-growth',
    workload: paired ? 'paired-outbreak' : 'outbreak-growth',
    create: () => outbreakSubject(rows, columns, paired),
  });
  return [
    wildfire('no-hazard', {forest: 0, spread: 0, burnTicks: 1, ashTicks: 65535, regrowth: 0}),
    wildfire('sparse-fire-front', {forest: 52, spread: 10, burnTicks: 2, ashTicks: 30, regrowth: 2}),
    wildfire('dense-fire-hazard', {forest: 92, spread: 45, burnTicks: 3, ashTicks: 18, regrowth: 8}),
    outbreak(false),
    outbreak(true),
    gas('occupancy-8pct', {density: 8, scatter: 7}),
    gas('occupancy-24pct', {density: 24, scatter: 7}),
    gas('occupancy-60pct', {density: 60, scatter: 7}),
    gas('open-membrane', {density: 24, scatter: 7}, true),
    gas('collision-heavy', {density: 60, scatter: 30}),
    coffeeCase(rows, columns, false),
    coffeeCase(rows, columns, true),
  ];
}

function outbreakSubject(rows, columns, paired) {
  const params = {infection: 12, infectiousTicks: 6, immunityTicks: 36, coverage: 20, efficacy: 85};
  const rule = outbreakStochasticRule(params);
  const baseline = new StochasticWorld({
    rows,
    columns,
    seed: OUTBREAK_SEED,
    rule,
    cells: outbreakInitialState(rows, columns, params),
  });
  const intervention = paired ? new StochasticWorld({
    rows,
    columns,
    seed: OUTBREAK_SEED,
    rule,
    cells: outbreakInitialState(rows, columns, params, {intervention: true}),
  }) : null;
  return {
    step() { baseline.tick(); intervention?.tick(); },
    checksum() { return baseline.checksum() ^ (intervention?.checksum() ?? 0); },
    dispose() { baseline.dispose(); intervention?.dispose(); },
  };
}

function stochasticSubject(world) {
  return {
    step: () => world.tick(),
    checksum: () => world.checksum() ^ world.auxiliaryChecksum(),
    dispose: () => world.dispose(),
  };
}

function coffeeCase(rows, columns, hostMirror) {
  const rule = blockRuleFromTable(16, (values) => coffeeDualTransition(values, {grindSlots: 1, wicking: true}));
  const cells = seedCaPreset('coffee-dual', rows, columns, 0xc0ffee);
  return {
    engine: hostMirror ? 'JavaScript/coffee-mirror-oracle' : 'WorldK/alternating-block',
    baselineEngine: 'alternating-block',
    baselineWorkload: 'coffee-mirror-oracle',
    workload: hostMirror ? 'coffee-mirror-oracle-repeat' : 'coffee-extraction',
    create: () => coffeeSubject(rows, columns, rule, cells, hostMirror),
  };
}

function coffeeSubject(rows, columns, rule, cells, hostMirror) {
  const ca = new HexCA({states: 16, rows, columns, backend: 'block', rule, cells});
  if (!hostMirror) ca.setBlockAlternates(true);
  const mirror = hostMirror ? buildHexMirror(rows, columns) : null;
  const scratch = hostMirror ? new Uint8Array(cells.length) : null;
  let generation = 0;
  const reflect = () => {
    for (let index = 0; index < ca.state.length; index++) scratch[mirror[index]] = ca.state[index];
    ca.state.set(scratch);
    ca.markAllDirty();
  };
  return {
    step() {
      if (hostMirror && generation++ % 2 === 1) {
        reflect();
        ca.tick();
        reflect();
      } else {
        ca.tick();
      }
    },
    checksum: () => ca.checksum(),
    dispose: () => ca.dispose(),
  };
}

function summarize(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = values.map((value) => Math.abs(value - median)).toSorted((a, b) => a - b);
  return {
    median,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    mad: deviations[Math.floor(deviations.length / 2)],
  };
}
