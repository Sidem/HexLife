const CONTRACT_URL = '../fixtures/performance/stochastic-phase0-contract.json';
const BUTTERFLY_RULE = 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6';
const SYNTH_RULE = '120C11B442568E21134E30A85A40C880';
const DEFAULT_RULE = '12482080480080006880800180010117';
const status = document.getElementById('status');
const output = document.getElementById('result');
const button = document.getElementById('run');
const publicBase = '/HexLife';
status.textContent = 'Loading binary engine…';
const {EmbedSim, initEmbedWasm, wasmExportsOrThrow} = await import(
  /* @vite-ignore */ `${publicBase}/src/embed/EmbedSim.js`
);
status.textContent = 'Loading k-state engine…';
const {blockRuleFromTable, HexCA, initEngine, ruleFromTable} = await import(
  /* @vite-ignore */ `${publicBase}/src/embed/ca.js`
);
const {EmbedRenderer} = await import(/* @vite-ignore */ `${publicBase}/src/embed/EmbedRenderer.js`);
status.textContent = 'Loading benchmark models…';
const {coffeeDualTransition, seedCaPreset} = await import(/* @vite-ignore */ `${publicBase}/ca-builder-models.js`);
const {buildHexMirror} = await import(/* @vite-ignore */ `${publicBase}/coffee-percolation-physics.js`);
const {createGasModel, createOutbreakModel, createWildfireModel} = await import(
  /* @vite-ignore */ `${publicBase}/embed-concept-models.js`
);
status.textContent = 'Loading frozen contract…';
const contract = await (await fetch(CONTRACT_URL)).json();

status.textContent = 'Initializing Wasm…';
await Promise.all([initEngine(), initEmbedWasm()]);
window.__stochasticPhase0 = {ready: true, running: false, result: null, run: runMatrix};
status.textContent = 'Ready.';
button.addEventListener('click', runMatrix);

async function runMatrix() {
  if (window.__stochasticPhase0.running) return;
  window.__stochasticPhase0.running = true;
  button.disabled = true;
  const results = [];
  const rendererResults = [];
  const demoFrameResults = [];
  const longTasks = [];
  const longTaskObserver = typeof PerformanceObserver === 'function'
    ? new PerformanceObserver((list) => longTasks.push(...list.getEntries().map(({duration}) => duration)))
    : null;
  try { longTaskObserver?.observe({type: 'longtask'}); } catch { /* Browser may not expose long-task timing. */ }
  const started = performance.now();
  try {
    for (const [tier, dimensions] of Object.entries(contract.gridTiers)) {
      const cases = casesFor(dimensions);
      for (let index = 0; index < cases.length; index++) {
        const item = cases[index];
        status.textContent = `${tier}: ${item.engine} / ${item.workload} (${index + 1}/${cases.length})`;
        await nextFrame();
        results.push(measureCase(tier, dimensions, item));
      }
      if (tier === 'demo') {
        for (let index = 0; index < cases.length; index++) {
          const item = cases[index];
          status.textContent = `demo frame: ${item.engine} / ${item.workload} (${index + 1}/${cases.length})`;
          await nextFrame();
          demoFrameResults.push(measureDemoFrame(dimensions, item));
        }
      }
      status.textContent = `${tier}: renderer uploads`;
      await nextFrame();
      rendererResults.push(measureRenderer(tier, dimensions, 'binary'));
      rendererResults.push(measureRenderer(tier, dimensions, 'k-state'));
    }
    await nextFrame();
    longTasks.push(...(longTaskObserver?.takeRecords() || []).map(({duration}) => duration));
    longTaskObserver?.disconnect();
    const tickMemoryGrowth = measureTickMemoryGrowth();
    const result = {
      schemaVersion: 1,
      contractFrozen: contract.frozen,
      capturedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory || null,
      elapsedMs: performance.now() - started,
      wasmMemoryBytes: wasmMemoryBytes(),
      tickMemoryGrowth,
      results,
      rendererResults,
      demoFrameResults,
      longTasks: summarizeOptional(longTasks),
    };
    window.__stochasticPhase0.result = result;
    output.textContent = JSON.stringify(result, null, 2);
    status.textContent = `Complete: ${results.length} cases.`;
  } catch (error) {
    status.textContent = `Failed: ${error.message}`;
    throw error;
  } finally {
    window.__stochasticPhase0.running = false;
    button.disabled = false;
  }
}

function measureDemoFrame(dimensions, item) {
  const canvases = Array.from({length: item.worldCount || 1}, () => {
    const canvas = document.createElement('canvas');
    canvas.style.width = '720px';
    canvas.style.height = '640px';
    document.body.append(canvas);
    return canvas;
  });
  const renderers = canvases.map((canvas) => {
    const renderer = new EmbedRenderer(canvas, {cols: dimensions.columns, rows: dimensions.rows});
    renderer.resize(720, 640, 1);
    if (item.renderMode !== 'binary') {
      renderer.setStatePalette([[8, 16, 24], [90, 200, 255], [255, 174, 82], [224, 96, 132]]);
    }
    return renderer;
  });
  const durations = [];
  for (let run = 0; run < contract.measuredRuns; run++) {
    const subject = item.create();
    const displays = item.hostOwned
      ? subject.getStates().map(() => new HexCA({states: 4, rows: dimensions.rows, columns: dimensions.columns}))
      : [];
    for (let tick = 0; tick < 8; tick++) subject.step();
    const before = performance.now();
    for (let tick = 0; tick < contract.batchTicks.demo; tick++) {
      subject.step();
      const states = subject.getStates();
      const ruleIndices = subject.getRuleIndices?.() || [];
      for (let world = 0; world < states.length; world++) {
        if (item.hostOwned) displays[world].setCells(states[world]);
        if (item.renderMode === 'binary') {
          renderers[world].draw({state: states[world], ruleIndices: ruleIndices[world]});
        } else {
          renderers[world].drawStates(item.hostOwned ? displays[world].state : states[world]);
        }
      }
    }
    for (const renderer of renderers) renderer.gl.finish();
    durations.push((performance.now() - before) / contract.batchTicks.demo);
    for (const display of displays) display.dispose();
    subject.dispose?.();
  }
  for (const renderer of renderers) renderer.destroy();
  for (const canvas of canvases) canvas.remove();
  const stats = summarize(durations);
  return {
    engine: item.engine,
    workload: item.workload,
    cells: dimensions.cells,
    worlds: item.worldCount || 1,
    frameMsRuns: durations,
    medianFrameMs: stats.median,
    p95FrameMs: stats.p95,
    madFrameMs: stats.mad,
    includesHostGridWrite: Boolean(item.hostOwned),
    jsToWasmBytesPerFrame: item.jsToWasmBytesPerTick,
    gpuUploadBytesPerFrame: dimensions.cells * (item.renderMode === 'binary' ? 2 : 1) * (item.worldCount || 1),
  };
}

function measureTickMemoryGrowth() {
  const runs = [];
  const binary = new EmbedSim({rulesetHex: DEFAULT_RULE, rows: 6, columns: 6, initialCells: new Uint8Array(36)});
  const neighborhood = new HexCA({states: 4, rows: 6, columns: 6, backend: 'neighborhood'});
  const block = new HexCA({states: 8, rows: 6, columns: 6, backend: 'block'});
  const wasmMemory = wasmExportsOrThrow().memory;
  for (const [engine, subject, memory] of [
    ['World', binary, wasmMemory],
    ['WorldK/neighborhood', neighborhood, wasmMemory],
    ['WorldK/block', block, wasmMemory],
  ]) {
    const beforeBytes = memory.buffer.byteLength;
    for (let tick = 0; tick < 100_000; tick++) subject.tick();
    const afterBytes = memory.buffer.byteLength;
    runs.push({engine, ticks: 100_000, beforeBytes, afterBytes, growthBytes: afterBytes - beforeBytes});
  }
  binary.dispose();
  neighborhood.dispose();
  block.dispose();
  return runs;
}

function measureRenderer(tier, dimensions, mode) {
  const canvas = document.createElement('canvas');
  canvas.style.width = '720px';
  canvas.style.height = '640px';
  document.body.append(canvas);
  const renderer = new EmbedRenderer(canvas, {cols: dimensions.columns, rows: dimensions.rows});
  renderer.resize(720, 640, 1);
  const cells = densityCells(dimensions.cells, 0.5, 0x90f0 + dimensions.cells);
  const ruleIndices = densityCells(dimensions.cells, 0.5, 0xa770 + dimensions.cells);
  if (mode === 'k-state') renderer.setStatePalette([[8, 16, 24], [90, 200, 255], [255, 174, 82], [224, 96, 132]]);
  const draw = mode === 'binary'
    ? () => renderer.draw({state: cells, ruleIndices})
    : () => renderer.drawStates(cells);
  draw();
  renderer.gl.finish();
  const durations = [];
  for (let run = 0; run < contract.measuredRuns; run++) {
    const before = performance.now();
    draw();
    renderer.gl.finish();
    durations.push(performance.now() - before);
  }
  const stats = summarize(durations);
  renderer.destroy();
  canvas.remove();
  return {
    tier,
    mode,
    cells: dimensions.cells,
    frameMsRuns: durations,
    medianFrameMs: stats.median,
    p95FrameMs: stats.p95,
    madFrameMs: stats.mad,
    gpuUploadBytesPerFrame: dimensions.cells * (mode === 'binary' ? 2 : 1),
    drawCallsPerFrame: 1,
  };
}

function measureCase(tier, dimensions, item) {
  const baseTicks = contract.batchTicks[tier];
  const multiplier = item.workload.startsWith('settled')
    ? contract.timingMultipliers.settled
    : item.workload === 'empty'
      ? contract.timingMultipliers.empty
      : 1;
  const measuredTicks = baseTicks * multiplier;
  const warmupTicks = tier === 'demo' ? 8 : tier === 'medium' ? 3 : 1;
  const durations = [];
  const heapDeltas = [];
  let finalChecksum = 0;
  for (let run = 0; run < contract.measuredRuns; run++) {
    const subject = item.create();
    for (let tick = 0; tick < warmupTicks; tick++) subject.step();
    const heapBefore = performance.memory?.usedJSHeapSize ?? null;
    const before = performance.now();
    for (let tick = 0; tick < measuredTicks; tick++) subject.step();
    const duration = performance.now() - before;
    const heapAfter = performance.memory?.usedJSHeapSize ?? null;
    durations.push(duration / measuredTicks);
    if (heapBefore !== null && heapAfter !== null) heapDeltas.push(heapAfter - heapBefore);
    finalChecksum ^= subject.checksum();
    subject.dispose?.();
  }
  const stats = summarize(durations);
  return {
    tier,
    engine: item.engine,
    workload: item.workload,
    cells: dimensions.cells,
    measuredTicks,
    msPerTickRuns: durations,
    medianMsPerTick: stats.median,
    p95MsPerTick: stats.p95,
    madMsPerTick: stats.mad,
    medianNsPerCellTick: stats.median * 1e6 / dimensions.cells,
    medianTicksPerSecond: 1000 / stats.median,
    jsToWasmBytesPerTick: item.jsToWasmBytesPerTick,
    tickAllocations: item.tickAllocations,
    heapDeltaRuns: heapDeltas,
    finalChecksum: finalChecksum >>> 0,
  };
}

function casesFor({rows, columns, cells}) {
  const seeded = (density, seed) => densityCells(cells, density, seed);
  const binary = (workload, rule, density) => ({
    engine: 'World', workload, renderMode: 'binary', jsToWasmBytesPerTick: 0, tickAllocations: 0,
    create: () => binarySubject(rows, columns, rule, seeded(density, 0x51a7 + cells)),
  });
  const neighborhood = (workload, rule, initial) => ({
    engine: 'WorldK/neighborhood', workload, renderMode: 'k-state', jsToWasmBytesPerTick: 0, tickAllocations: 0,
    create: () => caSubject(4, rows, columns, 'neighborhood', rule, initial()),
  });
  const block = (workload, rule, initial, states = 8) => ({
    engine: 'WorldK/block', workload, renderMode: 'k-state', jsToWasmBytesPerTick: 0, tickAllocations: 0,
    create: () => caSubject(states, rows, columns, 'block', rule, initial()),
  });

  const crystalRule = ruleFromTable(4, (center, neighbors) => {
    const crystals = count(neighbors, 1);
    const fronts = count(neighbors, 2);
    if (center === 1 || center === 3) return center;
    if (center === 2) return crystals || fronts >= 2 ? 1 : 2;
    return crystals >= 2 || (crystals === 1 && fronts >= 2) ? 2 : 0;
  });
  const ecologyRule = ruleFromTable(4, (center, neighbors) => {
    if (center === 0) return 0;
    const predator = center % 3 + 1;
    return count(neighbors, predator) >= 2 ? predator : center;
  });
  const tissueRule = ruleFromTable(4, (center, neighbors) => (
    center === 3 ? 3 : center === 1 ? 2 : center === 2 ? 0 : count(neighbors, 1) >= 2 ? 1 : 0
  ));
  const settledK4 = ruleFromTable(4, (center) => center);
  const settledK8 = blockRuleFromTable(8, (values) => values);
  const matterRule = blockRuleFromTable(8, (values) => [...values].sort((a, b) => a - b));
  const coffeeRule = blockRuleFromTable(16, (values) => coffeeDualTransition(values, {grindSlots: 1, wicking: true}));
  const coffeeCells = () => seedCaPreset('coffee-dual', rows, columns, 0xc0ffee);

  return [
    binary('empty', DEFAULT_RULE, 0),
    binary('sparse-0.2pct', DEFAULT_RULE, 0.002),
    binary('noise-50pct', DEFAULT_RULE, 0.5),
    binary('butterfly-rule', BUTTERFLY_RULE, 0.34),
    binary('synth-rule', SYNTH_RULE, 0.08),
    neighborhood('settled-k4', settledK4, () => kCells(cells, 4, 0.5, 0x4100)),
    neighborhood('crystal-frontier', crystalRule, () => frontierCells(rows, columns)),
    neighborhood('cyclic-ecology', ecologyRule, () => kCells(cells, 4, 0.91, 0xec0109)),
    neighborhood('tissue-wave', tissueRule, () => tissueCells(rows, columns)),
    block('settled-k8', settledK8, () => kCells(cells, 8, 0.5, 0x8100)),
    block('reactive-hex-matter', matterRule, () => kCells(cells, 8, 0.42, 0x6a77e2)),
    block('coffee-extraction', coffeeRule, coffeeCells, 16),
    {
      engine: 'alternating-block', workload: 'coffee-mirror-oracle',
      renderMode: 'k-state',
      // `ca.state` is a Wasm-memory view, so conjugation crosses no copy boundary. It still makes
      // two O(N) host permutations on odd ticks (one per tick on average), recorded by the audit.
      jsToWasmBytesPerTick: 0, tickAllocations: 0,
      create: () => alternatingCoffeeSubject(rows, columns, coffeeRule, coffeeCells()),
    },
    ...hostCases(rows, columns, cells),
  ];
}

function hostCases(rows, columns, cells) {
  const wildfire = (workload, params) => ({
    engine: 'JavaScript/stochastic-neighborhood', workload,
    renderMode: 'k-state', hostOwned: true,
    jsToWasmBytesPerTick: cells, tickAllocations: 1,
    create: () => modelSubject(createWildfireModel(rows, columns), params, ['age']),
  });
  const gas = (workload, params, open = false) => ({
    engine: 'JavaScript/lattice-gas', workload,
    renderMode: 'k-state', hostOwned: true,
    jsToWasmBytesPerTick: cells, tickAllocations: 4,
    create: () => modelSubject(createGasModel(rows, columns), params, ['velocity'], open),
  });
  return [
    wildfire('no-hazard', {forest: 0, spread: 0, burnTicks: 1, ashTicks: 65535, regrowth: 0}),
    wildfire('sparse-fire-front', {forest: 52, spread: 10, burnTicks: 2, ashTicks: 30, regrowth: 2}),
    wildfire('dense-fire-hazard', {forest: 92, spread: 45, burnTicks: 3, ashTicks: 18, regrowth: 8}),
    outbreakCase(rows, columns, cells, false),
    outbreakCase(rows, columns, cells, true),
    gas('occupancy-8pct', {density: 8, scatter: 7}),
    gas('occupancy-24pct', {density: 24, scatter: 7}),
    gas('occupancy-60pct', {density: 60, scatter: 7}),
    gas('open-membrane', {density: 24, scatter: 7}, true),
    gas('collision-heavy', {density: 60, scatter: 30}),
  ];
}

function outbreakCase(rows, columns, cells, paired) {
  const params = {infection: 12, infectiousTicks: 6, immunityTicks: 36, coverage: 20, efficacy: 85};
  return {
    engine: 'JavaScript/stochastic-neighborhood',
    workload: paired ? 'paired-outbreak' : 'outbreak-growth',
    renderMode: 'k-state', hostOwned: true, worldCount: paired ? 2 : 1,
    jsToWasmBytesPerTick: cells * (paired ? 2 : 1),
    tickAllocations: paired ? 2 : 1,
    create: () => {
      const baseline = createOutbreakModel(rows, columns);
      baseline.reset(params);
      const intervention = paired ? createOutbreakModel(rows, columns, {intervention: true}) : null;
      intervention?.reset(params);
      return {
        step() { baseline.step(); intervention?.step(); },
        checksum() { return checksum(baseline.cells) ^ (intervention ? checksum(intervention.cells) : 0); },
        getStates() { return intervention ? [baseline.cells, intervention.cells] : [baseline.cells]; },
      };
    },
  };
}

function binarySubject(rows, columns, rulesetHex, initialCells) {
  const sim = new EmbedSim({rulesetHex, rows, columns, initialCells});
  return {
    step: () => sim.tick(), checksum: () => sim.checksum(),
    getStates: () => [sim.state], getRuleIndices: () => [sim.ruleIndices],
    dispose: () => sim.dispose(),
  };
}

function caSubject(states, rows, columns, backend, rule, cells) {
  const ca = new HexCA({states, rows, columns, backend, rule, cells});
  return {
    step: () => ca.tick(), checksum: () => ca.checksum(), getStates: () => [ca.state],
    dispose: () => ca.dispose(),
  };
}

function alternatingCoffeeSubject(rows, columns, rule, cells) {
  const ca = new HexCA({states: 16, rows, columns, backend: 'block', rule, cells});
  const mirror = buildHexMirror(rows, columns);
  const scratch = new Uint8Array(cells.length);
  let tick = 0;
  const reflect = () => {
    for (let index = 0; index < ca.state.length; index++) scratch[mirror[index]] = ca.state[index];
    ca.state.set(scratch);
    ca.markAllDirty();
  };
  return {
    step() { if (tick++ & 1) { reflect(); ca.tick(); reflect(); } else ca.tick(); },
    checksum: () => ca.checksum(),
    getStates: () => [ca.state],
    dispose: () => ca.dispose(),
  };
}

function modelSubject(model, params, auxiliary, open = false) {
  model.reset(params);
  if (open) model.openMembrane();
  return {
    step: () => model.step(),
    checksum: () => auxiliary.reduce((hash, key) => hash ^ checksum(model[key]), checksum(model.cells)),
    getStates: () => [model.cells],
  };
}

function densityCells(length, density, seed) {
  const cells = new Uint8Array(length);
  let value = seed >>> 0;
  for (let index = 0; index < length; index++) {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    cells[index] = (value >>> 0) / 4294967296 < density ? 1 : 0;
  }
  return cells;
}

function kCells(length, states, density, seed) {
  const occupied = densityCells(length, density, seed);
  for (let index = 0; index < length; index++) if (occupied[index]) occupied[index] = 1 + ((index * 17 + seed) % (states - 1));
  return occupied;
}

function frontierCells(rows, columns) {
  const cells = new Uint8Array(rows * columns);
  const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
  cells[center] = 1;
  for (let index = center - columns * 2; index <= center + columns * 2; index += columns) cells[index + 1] = 2;
  return cells;
}

function tissueCells(rows, columns) {
  const cells = new Uint8Array(rows * columns);
  for (let row = 3; row < rows - 3; row++) for (let column = 3; column < 7; column++) cells[row * columns + column] = 1;
  return cells;
}

function count(values, target) { let total = 0; for (const value of values) if (value === target) total++; return total; }

function checksum(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  return {median, p95: sorted[Math.ceil(sorted.length * 0.95) - 1], mad: deviations[Math.floor(deviations.length / 2)]};
}

function summarizeOptional(values) {
  if (!values.length) return {supported: typeof PerformanceObserver === 'function', count: 0, p50Ms: 0, p95Ms: 0, durations: []};
  const sorted = [...values].sort((a, b) => a - b);
  return {
    supported: true,
    count: sorted.length,
    p50Ms: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    durations: sorted,
  };
}

function wasmMemoryBytes() {
  const probe = new HexCA({states: 2, rows: 2, columns: 2});
  const bytes = probe._wasm.memory.buffer.byteLength;
  probe.dispose();
  return bytes;
}

function nextFrame() { return new Promise((resolve) => requestAnimationFrame(resolve)); }
