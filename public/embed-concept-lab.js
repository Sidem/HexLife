// These bare entrypoints are resolved by the import map on each verbatim public demo page.
/* eslint-disable import/no-unresolved */
import '@hexlife/embed';
import {
  blockRuleFromTable,
  isConservative,
  isIsotropic,
  ruleFromTable,
} from '@hexlife/embed/ca';
import '@hexlife/embed/ca-element';
/* eslint-enable import/no-unresolved */

const PACKAGE_VERSION = '1.7.1';
const DEFAULT_BINARY_RULE = 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6';

const concepts = [
  {
    id: 'living-postcard',
    href: 'living-postcard.html',
    title: 'Living Postcard Studio',
    kicker: 'Creative binary world',
    deck: 'Paint a living composition, tune its colour and projection, then copy the exact evolving world as a postcard.',
    complexity: '01 · simplest',
    accent: '#f2b36f', rgb: '242, 179, 111', kind: 'postcard',
    surface: '<hexlife-world> · HXW1 capture',
    experiment: 'A postcard is the world you can reproduce, not a screenshot. Draw directly into the simulation, advance to a compelling moment, recolour it, and export the exact cells and palette in one HXW1 code.',
    packageNote: 'Uses the root custom element, live palette and torus attributes, drawing tools, deterministic reset, and worldCode().',
  },
  {
    id: 'crystal-garden', href: 'crystal-garden.html', title: 'Crystal Garden',
    kicker: 'Four-state growth model', deck: 'Grow sixfold crystals from vapor, boundaries, seeds, and impurities.',
    complexity: '02 · gentle', accent: '#8ad5ff', rgb: '138, 213, 255', kind: 'ca', surface: '<hexlife-ca> · neighborhood k⁷',
    experiment: 'A crystal advances only through its boundary layer. Impurities pin the front, while the supersaturation control changes how much local support a vapor cell needs before joining it.',
    packageNote: 'A four-state radius-one table is materialized once in JavaScript and then executed entirely in Wasm.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 18,
    palette: ['#08121a', '#dff5ff', '#5ab9e8', '#735f8d'], names: ['vapor', 'crystal', 'growth front', 'impurity'], focusState: 1,
    parameter: {label: 'Supersaturation', min: 1, max: 3, value: 2, suffix: ' neighbors'}, actionLabel: 'Add crystal seed',
    rule: crystalRule, seed: seedCrystal, action: addCrystalSeed,
  },
  {
    id: 'hex-ecology', href: 'hex-ecology.html', title: 'Hex Ecology',
    kicker: 'Cyclic spatial ecosystem', deck: 'Watch three species chase one another through migration waves and refuges.',
    complexity: '03 · gentle', accent: '#89e49f', rgb: '137, 228, 159', kind: 'ca', surface: '<hexlife-ca> · census()',
    experiment: 'Lichen, grazers, and hunters form a cyclic food web. Local invasion makes rotating fronts; empty refuges let a species survive a wave that would erase it in a perfectly mixed population.',
    packageNote: 'The state census turns the automaton into a population experiment without copying or interpreting Wasm memory.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 20,
    palette: ['#0a1116', '#68d391', '#f6c85f', '#ef7185'], names: ['empty refuge', 'lichen', 'grazer', 'hunter'], focusState: 2,
    parameter: {label: 'Invasion pressure', min: 1, max: 4, value: 2, suffix: ' predators'}, actionLabel: 'Migration pulse',
    rule: ecologyRule, seed: seedEcology, action: ecologyPulse,
  },
  {
    id: 'excitable-tissue', href: 'excitable-tissue.html', title: 'Excitable Tissue Lab',
    kicker: 'Wave and refractory dynamics', deck: 'Launch pulses, make spiral waves, and interrupt them with inert scars.',
    complexity: '04 · moderate', accent: '#ff7e9d', rgb: '255, 126, 157', kind: 'ca', surface: '<hexlife-ca> · host interventions',
    experiment: 'Excited tissue fires once, becomes refractory, then recovers. The refractory delay prevents a wave from immediately turning back; scars split fronts and can anchor persistent spirals.',
    packageNote: 'Directional slots are available, but this model deliberately treats all six neighbors equally to preserve the lattice’s sixfold symmetry.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 24,
    palette: ['#15121c', '#fff08a', '#e44d7d', '#4b5365'], names: ['resting', 'excited', 'refractory', 'scar'], focusState: 1,
    parameter: {label: 'Excitation threshold', min: 1, max: 3, value: 1, suffix: ' neighbors'}, actionLabel: 'Stimulate edge',
    rule: tissueRule, seed: seedTissue, action: stimulateTissue,
  },
  {
    id: 'mixing-chamber', href: 'mixing-chamber.html', title: 'Diffusion & Mixing Chamber',
    kicker: 'Exactly conserved block dynamics', deck: 'Open a membrane and watch two particle populations mix without losing a single particle.',
    complexity: '05 · moderate', accent: '#d7a7ff', rgb: '215, 167, 255', kind: 'ca', surface: '/ca block backend · conservation',
    experiment: 'Amber and cyan particles begin on opposite sides of a wall. Triangle rewrites are permutations, so every per-state count remains exact while local rotations produce macroscopic mixing.',
    packageNote: 'isConservative() verifies the complete k³ rule table before the model starts; census() checks the invariant while it runs.',
    states: 4, rows: 72, backend: 'block', speed: 20,
    palette: ['#0b1118', '#f0ad5f', '#57c7ff', '#606a78'], names: ['empty', 'amber particle', 'cyan particle', 'membrane'], focusState: 1,
    parameter: {label: 'Agitation', min: 1, max: 4, value: 3, suffix: ''}, actionLabel: 'Open membrane',
    rule: mixingRule, seed: seedMixing, action: openMembrane,
  },
  {
    id: 'wildfire-command', href: 'wildfire-command.html', title: 'Wildfire Command',
    kicker: 'Directional intervention sandbox', deck: 'Race a wind-driven fire front by cutting a break into the forest.',
    complexity: '06 · involved', accent: '#ff8a55', rgb: '255, 138, 85', kind: 'ca', surface: '<hexlife-ca> · anisotropic rule',
    experiment: 'The neighbor table knows which of the six directions contains fire, so wind can bias spread without changing the lattice. A firebreak is a direct host edit to the exact state.',
    packageNote: 'This deliberately uses the neighborhood backend’s anisotropy: physical symmetry is broken only where the wind says it should be.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 16,
    palette: ['#0d1216', '#2f9e56', '#ffcf4d', '#6b5047'], names: ['clearing', 'forest', 'fire', 'ash'], focusState: 2,
    parameter: {label: 'Wind strength', min: 0, max: 3, value: 2, suffix: ''}, actionLabel: 'Cut firebreak',
    rule: wildfireRule, seed: seedWildfire, action: cutFirebreak,
  },
  {
    id: 'outbreak-counterfactuals', href: 'outbreak-counterfactuals.html', title: 'Outbreak Counterfactuals',
    kicker: 'Deterministic intervention study', deck: 'Vaccinate a ring, replay the identical outbreak, and measure what the intervention changed.',
    complexity: '07 · involved', accent: '#65d7d0', rgb: '101, 215, 208', kind: 'ca', surface: '<hexlife-ca> · exact reset',
    experiment: 'Susceptible cells become infectious from local exposure, then recover. Because reset restores the authored initial state exactly, intervention and no-intervention runs are true counterfactuals.',
    packageNote: 'The host owns policy timing while the package owns deterministic stepping, cell validation, rendering, and state census.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 14,
    palette: ['#4c94c6', '#ff6577', '#4e5662', '#76d68d'], names: ['susceptible', 'infectious', 'recovered', 'vaccinated'], focusState: 1,
    parameter: {label: 'Exposure threshold', min: 1, max: 3, value: 2, suffix: ' contacts'}, actionLabel: 'Vaccinate ring',
    rule: outbreakRule, seed: seedOutbreak, action: vaccinateRing,
  },
  {
    id: 'butterfly-microscope', href: 'butterfly-microscope.html', title: 'Butterfly Microscope',
    kicker: 'Paired deterministic experiment', deck: 'Flip one cell and measure how quickly two otherwise identical worlds disagree.',
    complexity: '08 · advanced', accent: '#ae9cff', rgb: '174, 156, 255', kind: 'butterfly', surface: '2 × <hexlife-world> · snapshotCells()',
    experiment: 'Both simulations use the same rule, seed, density, and clock. The right world receives one controlled perturbation; every later difference is causally downstream of that edit.',
    packageNote: 'Snapshots make a stable XOR measurement while checksums prove when the worlds are identical without transferring Wasm memory.',
  },
  {
    id: 'containment', href: 'containment.html', title: 'Containment',
    kicker: 'Shareable cellular puzzle', deck: 'Spend a tiny intervention budget, then survive an eighty-generation deterministic trial.',
    complexity: '09 · advanced', accent: '#f0cc68', rgb: '240, 204, 104', kind: 'containment', surface: '<hexlife-world> · draw · HXW1',
    experiment: 'Every pointer stroke costs one intervention. Remove or add cells, then lock the board and run the trial. The resulting exact world can be copied as a challenge or solution code.',
    packageNote: 'Drawing, exact stepping, activeCount, reset, and world-code capture provide the complete puzzle substrate; scoring remains host-owned.',
  },
  {
    id: 'cellular-synth', href: 'cellular-synth.html', title: 'Cellular Synthesizer',
    kicker: 'Deterministic generative instrument', deck: 'Turn births across the hex lattice into a repeatable stream of notes.',
    complexity: '10 · advanced', accent: '#ff85c8', rgb: '255, 133, 200', kind: 'synth', surface: '<hexlife-world> · Web Audio host',
    experiment: 'Horizontal position chooses pitch, vertical position chooses octave, and newly born cells trigger the notes. The automaton is the score; the browser’s audio graph is only its instrument.',
    packageNote: 'The host diffs safe snapshots after each exact tick. No audio concern or timing policy leaks into the simulation package.',
  },
  {
    id: 'evolution-arena', href: 'evolution-arena.html', title: 'Evolution Arena',
    kicker: 'Parallel ruleset search', deck: 'Breed sixteen rule genomes toward a chosen activity level on one shared initial condition.',
    complexity: '11 · expert', accent: '#93e86f', rgb: '147, 232, 111', kind: 'evolution', surface: '<hexlife-grid> · 1 WebGL context',
    experiment: 'Every candidate receives the same cells and tick budget. The four rules closest to the target activity reproduce with bit mutations, making selection visible as an evolving wall of worlds.',
    packageNote: 'One shared WebGL2 context keeps a population experiment viable where sixteen independent canvas elements would hit the browser context limit.',
  },
  {
    id: 'hex-matter', href: 'hex-matter.html', title: 'Hex Matter',
    kicker: 'Eight-state material sandbox', deck: 'Pour sand, water, oil, steam, ember, plants, and stone into a conservative particle world with local reactions.',
    complexity: '12 · most complex', accent: '#5cc8ff', rgb: '92, 200, 255', kind: 'ca', surface: '/ca block backend · k = 8',
    experiment: 'Dense materials fall through lighter ones, steam rises, embers consume oil and plants, and water quenches heat. Static stone shapes the flow while the material census exposes every source and sink.',
    packageNote: 'The 8³ block table combines conservative transport with explicit reactions. The model reports when it intentionally stops conserving per-state counts.',
    states: 8, rows: 72, backend: 'block', speed: 24,
    palette: ['#091018', '#3ba7ff', '#e5a84b', '#d6bd78', '#65717f', '#ff654f', '#d9f2ff', '#61ae5b'],
    names: ['air', 'water', 'oil', 'sand', 'stone', 'ember', 'steam', 'plant'], focusState: 3,
    parameter: {label: 'Gravity', min: 1, max: 4, value: 3, suffix: ''}, actionLabel: 'Drop materials',
    rule: matterRule, seed: seedMatter, action: dropMatter,
  },
];

const config = concepts.find((item) => item.id === document.body.dataset.concept);
if (!config) throw new Error(`Unknown HexLife concept page: ${document.body.dataset.concept}`);

const root = document.getElementById('concept-root');
document.documentElement.style.setProperty('--concept-accent', config.accent);
document.documentElement.style.setProperty('--concept-accent-rgb', config.rgb);
renderShell(config);

if (config.kind === 'ca') setupCaLab(config);
else if (config.kind === 'postcard') setupPostcard(config);
else if (config.kind === 'butterfly') setupButterfly(config);
else if (config.kind === 'containment') setupContainment(config);
else if (config.kind === 'synth') setupSynth(config);
else if (config.kind === 'evolution') setupEvolution(config);

function renderShell(item) {
  const index = concepts.indexOf(item);
  const previous = concepts[index - 1];
  const next = concepts[index + 1];
  root.innerHTML = `
    <div class="demo-shell concept-root" style="--demo-shell-width: 1420px">
      <header class="demo-masthead">
        <div class="demo-topbar">
          <a class="demo-brand" href="./embed-demos.html"><span>HexLife</span> embed demos</a>
          <nav class="demo-nav" aria-label="HexLife embed demos">
            <a href="./embed-demos.html">Demo library</a>
            <a href="./totalistic-256.html">Rule atlas</a>
            <a href="./coffee-percolation.html">Coffee lab</a>
            <a href="./ca-builder.html">CA builder</a>
          </nav>
        </div>
        <div class="demo-hero-grid">
          <div>
            <span class="complexity-pill">${item.complexity}</span>
            <p class="demo-kicker">${item.kicker}</p>
            <h1>${item.title}</h1>
            <p class="demo-deck">${item.deck}</p>
          </div>
          <a class="demo-package-card" href="https://www.npmjs.com/package/@hexlife/embed" target="_blank" rel="noopener noreferrer">
            <span>Built with the published npm package</span>
            <strong>@hexlife/embed@${PACKAGE_VERSION}</strong>
            <small>${escapeHtml(item.surface)}</small>
          </a>
        </div>
      </header>
      <main class="demo-content">
        <div class="concept-workspace">
          <aside class="concept-panel concept-controls" id="controls"></aside>
          <section class="concept-panel concept-stage">
            <div class="stage-head"><h2>Live world</h2><span id="stage-status">Loading Wasm…</span></div>
            <div class="world-mount" id="world-mount"></div>
          </section>
          <aside class="concept-panel concept-readout">
            <h2>Instrument panel</h2>
            <div class="metric-grid">
              <div class="metric"><span>Generation</span><strong id="metric-generation">0</strong></div>
              <div class="metric"><span id="metric-focus-label">Active</span><strong id="metric-focus">—</strong></div>
              <div class="metric"><span>Changed / difference</span><strong id="metric-change">—</strong></div>
              <div class="metric"><span>Checksum / score</span><strong id="metric-checksum">—</strong></div>
            </div>
            <canvas class="trace" id="trace" width="460" height="184" aria-label="Recent measurement trace"></canvas>
            <div class="legend" id="legend"></div>
          </aside>
        </div>
        <div class="concept-notes">
          <section class="concept-panel concept-note"><h3>The experiment</h3><p>${item.experiment}</p></section>
          <section class="concept-panel concept-note"><h3>Why this package</h3><p>${item.packageNote}</p></section>
        </div>
        <nav class="concept-pager" aria-label="Concept demo order">
          ${previous ? `<a href="./${previous.href}"><small>← Simpler</small><strong>${previous.title}</strong></a>` : '<span></span>'}
          ${next ? `<a href="./${next.href}"><small>More complex →</small><strong>${next.title}</strong></a>` : '<a href="./embed-demos.html"><small>Return to</small><strong>Demo library</strong></a>'}
        </nav>
      </main>
      <footer class="demo-footer">
        <p>Demo ${String(index + 1).padStart(2, '0')} of ${concepts.length} · built with <strong>@hexlife/embed</strong> from npm.</p>
        <nav><a href="./embed-demos.html">All demos</a><a href="https://github.com/Sidem/HexLife/tree/main/packages/hexlife-embed" target="_blank" rel="noopener noreferrer">Package API</a><a href="./">HexLife Explorer</a></nav>
      </footer>
    </div>`;
}

function commonControls({parameter = null, actionLabel = 'Intervene', playLabel = 'Play'}) {
  const controls = document.getElementById('controls');
  controls.innerHTML = `
    <h2>Experiment controls</h2>
    <div class="control-stack">
      <div class="control-row"><button class="primary" id="play">${playLabel}</button><button id="step">Step</button><button id="reset">Reset</button></div>
      ${parameter ? `<div class="field"><div class="field-head"><label for="parameter">${parameter.label}</label><output id="parameter-output">${parameter.value}${parameter.suffix}</output></div><input id="parameter" type="range" min="${parameter.min}" max="${parameter.max}" value="${parameter.value}" /></div>` : ''}
      <div class="control-row two"><button id="action">${actionLabel}</button><button id="copy">Copy exact world</button></div>
    </div>
    <p class="concept-status" id="control-status" aria-live="polite">Preparing the exact initial state…</p>`;
  return controls;
}

function setupCaLab(item) {
  commonControls({parameter: item.parameter, actionLabel: item.actionLabel});
  renderLegend(item.names, item.palette);
  document.getElementById('metric-focus-label').textContent = item.names[item.focusState];
  const mount = document.getElementById('world-mount');
  const world = document.createElement('hexlife-ca');
  world.id = 'world';
  world.setAttribute('states', String(item.states));
  world.setAttribute('rows', String(item.rows));
  world.setAttribute('backend', item.backend);
  world.setAttribute('speed', String(item.speed));
  world.setAttribute('palette', item.palette.join(','));
  world.setAttribute('draw', '');
  world.setAttribute('draw-state', String(Math.min(1, item.states - 1)));
  world.setAttribute('paused', '');
  world.setAttribute('link', 'off');
  const trace = [];
  let parameter = item.parameter.value;
  let ready = false;
  let lastGeneration = -1;

  world.addEventListener('hexlife-ca-ready', () => {
    installModel();
    ready = true;
    setText('stage-status', `${item.backend} · k = ${item.states} · ${world.rows} × ${world.columns}`);
    setText('control-status', 'Ready. Run, step, paint, or apply the intervention.');
    update();
  }, {once: true});
  world.addEventListener('hexlife-ca-playstate', (event) => {
    document.getElementById('play').textContent = event.detail.userPaused ? 'Play' : 'Pause';
  });
  world.addEventListener('hexlife-ca-settled', () => setText('control-status', 'The world reached an exact fixed point. Any edit wakes it again.'));
  mount.append(world);

  function installModel() {
    const rule = item.rule(parameter);
    world.setRule(rule);
    world.setCells(item.seed(world.rows, world.columns));
    const invariant = item.backend === 'block'
      ? `${isConservative(item.states, rule) ? 'conservative' : 'reactive'} · ${isIsotropic(item.states, rule) ? 'isotropic' : 'directional'}`
      : 'radius 1 · six canonical neighbors';
    setText('control-status', `Rule installed: ${invariant}.`);
    trace.length = 0;
  }

  document.getElementById('play').addEventListener('click', () => {
    if (!ready) return;
    if (world.userPaused) world.play(); else world.pause();
  });
  document.getElementById('step').addEventListener('click', () => { if (ready) { world.pause(); world.tick(1); update(); } });
  document.getElementById('reset').addEventListener('click', () => { if (ready) { world.pause(); installModel(); update(); } });
  document.getElementById('action').addEventListener('click', () => {
    if (!ready) return;
    item.action(world);
    setText('control-status', `${item.actionLabel} applied at generation ${world.generation}.`);
    update();
  });
  document.getElementById('copy').addEventListener('click', async () => {
    if (!ready) return;
    await copyText(await world.caCode(), 'Exact HXK1 world copied.');
  });
  const parameterInput = document.getElementById('parameter');
  parameterInput.addEventListener('input', () => {
    parameter = Number(parameterInput.value);
    setText('parameter-output', `${parameter}${item.parameter.suffix}`);
    if (ready) { world.pause(); installModel(); update(); }
  });
  window.setInterval(update, 180);

  function update() {
    if (!ready || !world.world) return;
    const census = world.census();
    setText('metric-generation', world.generation.toLocaleString());
    setText('metric-focus', census[item.focusState].toLocaleString());
    setText('metric-change', world.world.lastChangedCount.toLocaleString());
    setText('metric-checksum', world.checksum.toString(16).padStart(8, '0'));
    if (world.generation !== lastGeneration) {
      trace.push(census[item.focusState]);
      if (trace.length > 90) trace.shift();
      drawTrace(trace, item.accent);
      lastGeneration = world.generation;
    }
  }
}

function setupPostcard(item) {
  commonControls({actionLabel: 'Toggle torus'});
  const controls = document.querySelector('.control-stack');
  controls.insertAdjacentHTML('beforeend', `<div class="field"><div class="field-head"><label for="palette">Palette</label></div><select id="palette"><option value="default">Default spectrum</option><option value="viridis">Viridis</option><option value="monochrome">Monochrome</option><option value="volcanic">Volcanic</option></select></div><div class="field"><div class="field-head"><label for="hue">Hue shift</label><output id="hue-output">0°</output></div><input id="hue" type="range" min="0" max="359" value="0"></div>`);
  renderLegend(['dead cell', 'living cell', 'your brush'], ['#10161e', '#f2b36f', '#ffffff']);
  const world = document.createElement('hexlife-world');
  for (const [name, value] of Object.entries({ruleset: DEFAULT_BINARY_RULE, rows: '96', seed: '12489', density: '0.32', speed: '18', palette: 'default', brush: '2'})) world.setAttribute(name, value);
  world.setAttribute('draw', ''); world.setAttribute('paused', ''); world.setAttribute('link', 'off');
  document.getElementById('world-mount').append(world);
  world.addEventListener('hexlife-ready', () => { setText('stage-status', 'Draw directly on the world'); setText('control-status', 'Paint, evolve, recolour, then copy the living postcard.'); updateBinary(world, item.accent); }, {once: true});
  bindBinaryTransport(world, item.accent);
  document.getElementById('action').addEventListener('click', () => {
    if (world.hasAttribute('torus')) world.removeAttribute('torus'); else world.setAttribute('torus', '9');
    setText('control-status', world.hasAttribute('torus') ? 'Torus projection enabled. Drag to orbit.' : 'Flat drawing surface restored.');
  });
  document.getElementById('palette').addEventListener('change', (event) => world.setAttribute('palette', event.target.value));
  document.getElementById('hue').addEventListener('input', (event) => { world.setAttribute('hue-shift', event.target.value); setText('hue-output', `${event.target.value}°`); });
}

function setupButterfly(item) {
  commonControls({parameter: {label: 'Perturbation radius', min: 0, max: 3, value: 0, suffix: ' cells'}, actionLabel: 'Reapply perturbation'});
  renderLegend(['reference world', 'perturbed world', 'XOR divergence'], ['#748399', item.accent, '#ffffff']);
  const mount = document.getElementById('world-mount');
  mount.innerHTML = '<div class="dual-worlds" id="dual"></div>';
  const dual = document.getElementById('dual');
  const left = binaryWorld(); const right = binaryWorld();
  dual.append(figure('Reference', left), figure('One controlled edit', right));
  let readyCount = 0; let timer = 0; let radius = 0; const trace = [];
  const onReady = () => { readyCount++; if (readyCount === 2) { perturb(); setText('stage-status', 'Tick-locked paired worlds'); setText('control-status', 'Only the highlighted experiment receives the controlled edit.'); update(); } };
  left.addEventListener('hexlife-ready', onReady, {once: true}); right.addEventListener('hexlife-ready', onReady, {once: true});
  document.getElementById('play').addEventListener('click', () => {
    if (readyCount < 2) return;
    if (timer) stop(); else { timer = window.setInterval(step, 110); setText('play', 'Pause'); }
  });
  document.getElementById('step').addEventListener('click', step);
  document.getElementById('reset').addEventListener('click', () => { stop(); left.reset(); right.reset(); perturb(); trace.length = 0; update(); });
  document.getElementById('action').addEventListener('click', () => { right.reset(); left.reset(); perturb(); trace.length = 0; update(); });
  document.getElementById('copy').addEventListener('click', async () => copyText(await right.worldCode(), 'Perturbed HXW1 world copied.'));
  document.getElementById('parameter').addEventListener('input', (event) => { radius = Number(event.target.value); setText('parameter-output', `${radius} cells`); });

  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Play'); }
  function step() { if (readyCount < 2) return; left.tick(1); right.tick(1); update(); }
  function perturb() {
    if (!right.sim) return;
    const centerRow = Math.floor(right.sim.rows / 2); const centerCol = Math.floor(right.sim.cols / 2); const edits = [];
    for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
      if (Math.abs(dr) + Math.abs(dc) > radius * 2) continue;
      const index = ((centerRow + dr + right.sim.rows) % right.sim.rows) * right.sim.cols + ((centerCol + dc + right.sim.cols) % right.sim.cols);
      edits.push({index, value: right.sim.state[index] ? 0 : 1});
    }
    right.sim.setCells(edits); right.tick(0);
  }
  function update() {
    if (!left.sim || !right.sim) return;
    const a = left.sim.snapshotCells(); const b = right.sim.snapshotCells(); let difference = 0;
    for (let i = 0; i < a.length; i++) difference += a[i] !== b[i] ? 1 : 0;
    setText('metric-generation', left.tickCount.toLocaleString()); setText('metric-focus-label', 'Different cells'); setText('metric-focus', difference.toLocaleString());
    setText('metric-change', `${((difference / a.length) * 100).toFixed(2)}%`); setText('metric-checksum', difference ? 'diverged' : 'identical');
    trace.push(difference); if (trace.length > 90) trace.shift(); drawTrace(trace, item.accent);
  }
}

function setupContainment(item) {
  commonControls({actionLabel: 'Run 80-tick trial', playLabel: 'Run trial'});
  renderLegend(['dead', 'live', 'intervention'], ['#111820', '#f0cc68', '#ffffff']);
  const world = binaryWorld({rows: 80, density: 0.39, brush: 0, draw: true});
  document.getElementById('world-mount').append(world);
  let budget = 8; let running = false; const trace = [];
  world.addEventListener('hexlife-ready', () => { resetChallenge(); setText('stage-status', '8 intervention strokes available'); }, {once: true});
  world.addEventListener('pointerdown', () => { if (!running && budget > 0) { budget--; setText('stage-status', `${budget} intervention strokes left`); if (!budget) world.removeAttribute('draw'); } });
  const runTrial = async () => {
    if (!world.sim || running) return; running = true; world.removeAttribute('draw'); setText('control-status', 'Trial running. The board is locked.');
    for (let i = 0; i < 80; i++) { world.tick(1); trace.push(world.sim.activeCount); if (trace.length > 90) trace.shift(); if (i % 4 === 0) { update(); await nextFrame(); } }
    running = false; const ratio = world.sim.activeCount / world.sim.numCells; const score = Math.max(0, Math.round(1000 * (1 - ratio)));
    setText('metric-checksum', score.toLocaleString()); setText('control-status', `Trial complete: containment score ${score}. Copy this exact outcome or reset to retry.`); update();
  };
  document.getElementById('play').addEventListener('click', runTrial); document.getElementById('action').addEventListener('click', runTrial);
  document.getElementById('step').addEventListener('click', () => { if (!running) { world.tick(1); update(); } });
  document.getElementById('reset').addEventListener('click', resetChallenge);
  document.getElementById('copy').addEventListener('click', async () => copyText(await world.worldCode(), 'Exact challenge state copied.'));
  function resetChallenge() { if (!world.sim) return; world.reset(); budget = 8; running = false; trace.length = 0; world.setAttribute('draw', ''); setText('control-status', 'Each pointer stroke costs one intervention. Spend carefully, then run the trial.'); update(); }
  function update() { if (!world.sim) return; setText('metric-generation', world.tickCount); setText('metric-focus-label', 'Live cells'); setText('metric-focus', world.sim.activeCount.toLocaleString()); setText('metric-change', `${budget} edits left`); if (!running && world.tickCount < 80) setText('metric-checksum', 'not scored'); drawTrace(trace, item.accent); }
}

function setupSynth(item) {
  commonControls({parameter: {label: 'Tempo', min: 70, max: 240, value: 150, suffix: ' BPM'}, actionLabel: 'Reseed score', playLabel: 'Start audio'});
  document.querySelector('.control-stack').insertAdjacentHTML('beforeend', '<div class="synth-keyboard" id="keyboard"></div>');
  document.getElementById('keyboard').innerHTML = Array.from({length: 8}, (_, index) => `<span class="synth-key" data-key="${index}"></span>`).join('');
  renderLegend(['birth = note', 'horizontal = pitch', 'vertical = octave'], [item.accent, '#73d49c', '#f4be63']);
  const world = binaryWorld({rows: 72, density: 0.27}); document.getElementById('world-mount').append(world);
  let context = null; let timer = 0; let tempo = 150; let previous = null; const trace = [];
  world.addEventListener('hexlife-ready', () => { previous = world.sim.snapshotCells(); setText('stage-status', 'Audio starts only after pressing Start audio'); setText('control-status', 'Each exact tick becomes one musical beat.'); update(); }, {once: true});
  document.getElementById('play').addEventListener('click', () => { if (timer) stop(); else start(); });
  document.getElementById('step').addEventListener('click', () => musicalTick(true));
  document.getElementById('reset').addEventListener('click', reseed); document.getElementById('action').addEventListener('click', reseed);
  document.getElementById('copy').addEventListener('click', async () => copyText(await world.worldCode(), 'The exact visual score was copied.'));
  document.getElementById('parameter').addEventListener('input', (event) => { tempo = Number(event.target.value); setText('parameter-output', `${tempo} BPM`); if (timer) { stop(); start(); } });
  function start() { if (!world.sim) return; context ||= new AudioContext(); context.resume(); timer = window.setInterval(() => musicalTick(true), 60000 / tempo); setText('play', 'Stop audio'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Start audio'); }
  function reseed() { stop(); world.reset(Math.floor(Math.random() * 0xffffffff)); previous = world.sim?.snapshotCells() || null; trace.length = 0; update(); }
  function musicalTick(sound) {
    if (!world.sim || !previous) return; world.tick(1); const next = world.sim.snapshotCells(); const births = [];
    for (let i = 0; i < next.length; i++) if (!previous[i] && next[i]) births.push(i);
    previous = next; if (sound && context) playBirths(context, births, world.sim.cols, item.accent); trace.push(births.length); if (trace.length > 90) trace.shift(); update(births.length);
  }
  function update(births = 0) { if (!world.sim) return; setText('metric-generation', world.tickCount); setText('metric-focus-label', 'Notes this beat'); setText('metric-focus', births); setText('metric-change', `${world.sim.activeCount.toLocaleString()} live`); setText('metric-checksum', world.checksum.toString(16).padStart(8, '0')); drawTrace(trace, item.accent); }
}

function setupEvolution(item) {
  commonControls({parameter: {label: 'Target activity', min: 5, max: 90, value: 42, suffix: '%'}, actionLabel: 'Breed next generation', playLabel: 'Evaluate population'});
  document.getElementById('step').textContent = 'Tick 10'; document.getElementById('reset').textContent = 'New population'; document.getElementById('copy').textContent = 'Copy selected rule';
  renderLegend(['low activity', 'near target', 'high activity'], ['#26313a', item.accent, '#f4be63']);
  const grid = document.createElement('hexlife-grid');
  for (const [name, value] of Object.entries({layout: '4x4', rows: '54', seed: '7291', density: '0.42', speed: '18', gap: '4', palette: 'viridis', paused: '', link: 'off'})) grid.setAttribute(name, value);
  let generation = 0; let target = 42; let rules = initialPopulation(); let selected = 0; const trace = [];
  grid.rulesets = rules; document.getElementById('world-mount').append(grid);
  grid.addEventListener('hexlife-ready', () => { setText('stage-status', '16 rules · one initial condition · one GPU context'); setText('control-status', 'Evaluate, select the closest survivors, then breed their mutations.'); update(); }, {once: true});
  grid.addEventListener('hexlife-worldselect', (event) => { selected = event.detail.index; setText('control-status', `Selected candidate ${selected + 1}: ${rules[selected]}`); update(); });
  document.getElementById('play').addEventListener('click', evaluate);
  document.getElementById('step').addEventListener('click', () => { grid.tick(10); update(); });
  document.getElementById('reset').addEventListener('click', () => { generation = 0; rules = initialPopulation(Date.now()); grid.rulesets = rules; grid.reset(7291); trace.length = 0; update(); });
  document.getElementById('action').addEventListener('click', breed);
  document.getElementById('copy').addEventListener('click', () => copyText(rules[selected], 'Selected 128-bit ruleset copied.'));
  document.getElementById('parameter').addEventListener('input', (event) => { target = Number(event.target.value); setText('parameter-output', `${target}%`); update(); });
  async function evaluate() { grid.reset(7291); for (let i = 0; i < 5; i++) { grid.tick(10); update(); await nextFrame(); } setText('control-status', 'Evaluation complete. Breed to keep the four candidates nearest the target.'); }
  function scores() { return grid.worlds.map((world, index) => ({index, score: Math.abs((world.activeCount / world.numCells) * 100 - target)})).sort((a, b) => a.score - b.score); }
  function breed() {
    if (!grid.worlds.length) return; const winners = scores().slice(0, 4).map(({index}) => rules[index]); const next = [];
    for (let i = 0; i < 16; i++) next.push(i < 4 ? winners[i] : mutateHex(winners[i % 4], generation * 31 + i, 1 + (i % 3)));
    rules = next; generation++; grid.rulesets = rules; grid.reset(7291); selected = 0; trace.push(Number(scores()[0]?.score || 0)); if (trace.length > 90) trace.shift(); setText('control-status', `Population ${generation + 1} created from four survivors.`); update();
  }
  function update() {
    if (!grid.worlds.length) return; const ranked = scores(); const best = ranked[0]; const activity = (grid.worlds[best.index].activeCount / grid.worlds[best.index].numCells) * 100;
    setText('metric-generation', grid.generation); setText('metric-focus-label', 'Population'); setText('metric-focus', generation + 1); setText('metric-change', `${activity.toFixed(1)}% best`); setText('metric-checksum', `${best.score.toFixed(2)} error`); drawTrace(trace, item.accent);
  }
}

function binaryWorld({rows = 72, density = 0.34, brush = 1, draw = false} = {}) {
  const world = document.createElement('hexlife-world');
  for (const [name, value] of Object.entries({ruleset: DEFAULT_BINARY_RULE, rows, seed: 13579, density, speed: 18, palette: 'monochrome', brush, paused: '', link: 'off'})) world.setAttribute(name, String(value));
  if (draw) world.setAttribute('draw', '');
  return world;
}

function bindBinaryTransport(world, accent) {
  const trace = [];
  document.getElementById('play').addEventListener('click', () => { if (!world.sim) return; if (world.userPaused) world.play(); else world.pause(); });
  document.getElementById('step').addEventListener('click', () => { world.pause(); world.tick(1); updateBinary(world, accent, trace); });
  document.getElementById('reset').addEventListener('click', () => { world.pause(); world.reset(); trace.length = 0; updateBinary(world, accent, trace); });
  document.getElementById('copy').addEventListener('click', async () => copyText(await world.worldCode(), 'Exact HXW1 world copied.'));
  world.addEventListener('hexlife-playstate', (event) => setText('play', event.detail.userPaused ? 'Play' : 'Pause'));
  window.setInterval(() => updateBinary(world, accent, trace), 180);
}

function updateBinary(world, accent, trace = []) {
  if (!world.sim) return;
  setText('metric-generation', world.tickCount.toLocaleString()); setText('metric-focus', world.sim.activeCount.toLocaleString()); setText('metric-change', `${((world.sim.activeCount / world.sim.numCells) * 100).toFixed(1)}%`); setText('metric-checksum', world.checksum.toString(16).padStart(8, '0'));
  if (trace[trace.length - 1] !== world.sim.activeCount) { trace.push(world.sim.activeCount); if (trace.length > 90) trace.shift(); drawTrace(trace, accent); }
}

function renderLegend(names, colors) {
  document.getElementById('legend').innerHTML = names.map((name, index) => `<div class="legend-item"><span class="swatch" style="background:${colors[index]}"></span><span>${index} · ${name}</span></div>`).join('');
}

function drawTrace(values, color) {
  const canvas = document.getElementById('trace'); const context = canvas.getContext('2d'); const width = canvas.width; const height = canvas.height;
  context.clearRect(0, 0, width, height); context.strokeStyle = '#283541'; context.lineWidth = 1;
  for (let y = 1; y < 4; y++) { context.beginPath(); context.moveTo(0, y * height / 4); context.lineTo(width, y * height / 4); context.stroke(); }
  if (values.length < 2) return; const max = Math.max(1, ...values); context.strokeStyle = color; context.lineWidth = 3; context.beginPath();
  values.forEach((value, index) => { const x = index * width / Math.max(1, values.length - 1); const y = height - 8 - (value / max) * (height - 16); if (index) context.lineTo(x, y); else context.moveTo(x, y); }); context.stroke();
}

function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
function escapeHtml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
async function copyText(value, message) { if (!value) return; await navigator.clipboard.writeText(value); setText('control-status', message); }
function nextFrame() { return new Promise((resolve) => requestAnimationFrame(resolve)); }
function figure(caption, world) { const element = document.createElement('figure'); element.append(world); const label = document.createElement('figcaption'); label.textContent = caption; element.append(label); return element; }
function rng(seed) { let value = seed >>> 0; return () => { value = (value + 0x6d2b79f5) >>> 0; let next = Math.imul(value ^ value >>> 15, 1 | value); next = next + Math.imul(next ^ next >>> 7, 61 | next) ^ next; return ((next ^ next >>> 14) >>> 0) / 4294967296; }; }
function indexOf(row, column, rows, columns) { return ((row + rows) % rows) * columns + ((column + columns) % columns); }

function crystalRule(threshold) { return ruleFromTable(4, (center, neighbors) => { const crystals = neighbors.filter((value) => value === 1).length; const fronts = neighbors.filter((value) => value === 2).length; if (center === 1 || center === 3) return center; if (center === 2) return crystals || fronts >= 2 ? 1 : 2; return crystals >= threshold || (crystals && fronts >= 2) ? 2 : 0; }); }
function seedCrystal(rows, columns) { const cells = new Uint8Array(rows * columns); const random = rng(0xc7a57a1); for (let i = 0; i < cells.length; i++) if (random() < 0.014) cells[i] = 3; const r = Math.floor(rows / 2); const c = Math.floor(columns / 2); cells[indexOf(r, c, rows, columns)] = 1; for (let d = 0; d < 6; d++) cells[indexOf(r + (d % 2), c + d - 3, rows, columns)] = 1; return cells; }
function addCrystalSeed(world) { const cells = world.world.snapshotCells(); const r = Math.floor(world.rows * 0.3); const c = Math.floor(world.columns * 0.68); for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) cells[indexOf(r + dr, c + dc, world.rows, world.columns)] = 1; world.setCells(cells); }

function ecologyRule(threshold) { return ruleFromTable(4, (center, neighbors) => { const counts = [0, 0, 0, 0]; neighbors.forEach((value) => counts[value]++); if (center === 0) { const best = [1, 2, 3].sort((a, b) => counts[b] - counts[a])[0]; return counts[best] >= threshold + 1 ? best : 0; } const predator = center % 3 + 1; return counts[predator] >= threshold ? predator : center; }); }
function seedEcology(rows, columns) { const cells = new Uint8Array(rows * columns); const random = rng(0xec0109); for (let i = 0; i < cells.length; i++) cells[i] = random() < 0.08 ? 0 : 1 + Math.floor(random() * 3); return cells; }
function ecologyPulse(world) { const cells = world.world.snapshotCells(); const r0 = Math.floor(world.rows * 0.25); const c0 = Math.floor(world.columns * 0.25); for (let r = r0 - 4; r <= r0 + 4; r++) for (let c = c0 - 4; c <= c0 + 4; c++) cells[indexOf(r, c, world.rows, world.columns)] = 1; world.setCells(cells); }

function tissueRule(threshold) { return ruleFromTable(4, (center, neighbors) => { if (center === 3) return 3; if (center === 1) return 2; if (center === 2) return 0; const excited = neighbors.filter((value) => value === 1).length; return excited >= threshold && excited <= threshold + 2 ? 1 : 0; }); }
function seedTissue(rows, columns) { const cells = new Uint8Array(rows * columns); for (let r = 0; r < rows; r++) { if (r % 17 === 0) cells[indexOf(r, Math.floor(columns * 0.62), rows, columns)] = 3; if (r > rows * 0.2 && r < rows * 0.8) cells[indexOf(r, Math.floor(columns * 0.68), rows, columns)] = 3; } for (let c = 0; c < columns; c++) cells[indexOf(Math.floor(rows / 2), c, rows, columns)] = c < 3 ? 1 : 0; return cells; }
function stimulateTissue(world) { const cells = world.world.snapshotCells(); for (let r = 0; r < world.rows; r++) if (r % 2 === 0) cells[indexOf(r, 2, world.rows, world.columns)] = 1; world.setCells(cells); }

function mixingRule(agitation) { return blockRuleFromTable(4, ([a, b, c]) => { if (a === 3 || b === 3 || c === 3) return [a, b, c]; const phase = (a * 5 + b * 3 + c + agitation) % 5; return phase < agitation ? [c, a, b] : [b, c, a]; }); }
function seedMixing(rows, columns) { const cells = new Uint8Array(rows * columns); const random = rng(0xd1ff05); const mid = Math.floor(columns / 2); for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) { const index = r * columns + c; if (Math.abs(c - mid) <= 1) cells[index] = 3; else if (random() < 0.58) cells[index] = c < mid ? 1 : 2; } return cells; }
function openMembrane(world) { const cells = world.world.snapshotCells(); const mid = Math.floor(world.columns / 2); for (let r = Math.floor(world.rows * 0.38); r < Math.ceil(world.rows * 0.62); r++) for (let dc = -1; dc <= 1; dc++) cells[indexOf(r, mid + dc, world.rows, world.columns)] = 0; world.setCells(cells); }

function wildfireRule(wind) { return ruleFromTable(4, (center, neighbors) => { if (center === 2) return 3; if (center === 3) return neighbors.filter((value) => value === 1).length >= 5 ? 1 : 3; if (center !== 1) return center; const weights = [1, 1, 1, 1 + wind, 1 + wind, 1]; const exposure = neighbors.reduce((sum, value, index) => sum + (value === 2 ? weights[index] : 0), 0); return exposure >= 2 ? 2 : 1; }); }
function seedWildfire(rows, columns) { const cells = new Uint8Array(rows * columns); const random = rng(0xf1ae); for (let i = 0; i < cells.length; i++) cells[i] = random() < 0.72 ? 1 : 0; for (let r = 0; r < rows; r++) if (r % 3 !== 0) cells[indexOf(r, 4, rows, columns)] = 2; return cells; }
function cutFirebreak(world) { const cells = world.world.snapshotCells(); const col = Math.floor(world.columns * 0.58); for (let r = 0; r < world.rows; r++) for (let dc = -1; dc <= 1; dc++) cells[indexOf(r, col + dc, world.rows, world.columns)] = 0; world.setCells(cells); }

function outbreakRule(threshold) { return ruleFromTable(4, (center, neighbors) => { if (center === 1) return 2; if (center === 2 || center === 3) return center; const infectious = neighbors.filter((value) => value === 1).length; return infectious >= threshold ? 1 : 0; }); }
function seedOutbreak(rows, columns) { const cells = new Uint8Array(rows * columns); const random = rng(0x0b7bea4); for (let i = 0; i < cells.length; i++) cells[i] = random() < 0.035 ? 3 : 0; const points = [[0.32, 0.35], [0.57, 0.62], [0.72, 0.24]]; points.forEach(([rr, cc]) => { const r = Math.floor(rows * rr); const c = Math.floor(columns * cc); for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) cells[indexOf(r + dr, c + dc, rows, columns)] = 1; }); return cells; }
function vaccinateRing(world) { const cells = world.world.snapshotCells(); const rr = Math.floor(world.rows / 2); const cc = Math.floor(world.columns / 2); const radius = Math.floor(Math.min(world.rows, world.columns) * 0.21); for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.columns; c++) { const distance = Math.hypot(r - rr, c - cc); if (Math.abs(distance - radius) < 1.4 && cells[r * world.columns + c] === 0) cells[r * world.columns + c] = 3; } world.setCells(cells); }

function matterRule(gravity) { const density = [0, 3, 2, 5, 9, 1, -1, 8]; return blockRuleFromTable(8, (block) => { const out = [...block]; const ember = out.indexOf(5); const water = out.indexOf(1); const oil = out.indexOf(2); const plant = out.indexOf(7); if (ember !== -1 && water !== -1) { out[ember] = 6; out[water] = 4; } else if (ember !== -1 && oil !== -1) out[oil] = 5; else if (ember !== -1 && plant !== -1) out[plant] = 5; const movable = (state) => state !== 4 && state !== 7; const swap = (a, b) => { [out[a], out[b]] = [out[b], out[a]]; }; if (gravity > 0 && movable(out[0]) && movable(out[2]) && density[out[0]] > density[out[2]]) swap(0, 2); else if (gravity > 1 && movable(out[0]) && movable(out[1]) && out[2] !== 0 && density[out[0]] > density[out[1]]) swap(0, 1); else if (gravity > 2 && movable(out[1]) && movable(out[2]) && out[0] !== 0 && density[out[1]] > density[out[2]]) swap(1, 2); return out; }); }
function seedMatter(rows, columns) { const cells = new Uint8Array(rows * columns); const random = rng(0x6a77e2); for (let r = Math.floor(rows * 0.82); r < rows; r++) for (let c = 0; c < columns; c++) cells[r * columns + c] = 4; for (let r = Math.floor(rows * 0.16); r < rows * 0.42; r++) for (let c = 5; c < columns - 5; c++) { const p = random(); cells[r * columns + c] = p < 0.18 ? 3 : p < 0.27 ? 1 : p < 0.34 ? 2 : 0; } for (let r = Math.floor(rows * 0.58); r < rows * 0.8; r++) cells[indexOf(r, Math.floor(columns * 0.72), rows, columns)] = 7; cells[indexOf(Math.floor(rows * 0.64), Math.floor(columns * 0.68), rows, columns)] = 5; return cells; }
function dropMatter(world) { const cells = world.world.snapshotCells(); const random = rng(world.generation + 99); for (let r = 2; r < 9; r++) for (let c = Math.floor(world.columns * 0.25); c < world.columns * 0.75; c++) if (random() < 0.55) cells[r * world.columns + c] = [1, 2, 3][Math.floor(random() * 3)]; world.setCells(cells); }

function playBirths(context, births, columns, accent) {
  const chosen = births.filter((_, index) => index % Math.max(1, Math.floor(births.length / 6))).slice(0, 6); const now = context.currentTime; const keys = document.querySelectorAll('.synth-key'); keys.forEach((key) => key.style.setProperty('--key-level', '.12'));
  chosen.forEach((index, order) => { const note = Math.floor((index % columns) / columns * 8); const octave = Math.floor(index / columns) % 3; const frequency = 110 * 2 ** (([0, 2, 4, 7, 9, 12, 14, 16][note] + octave * 12) / 12); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = order % 2 ? 'triangle' : 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18); oscillator.connect(gain).connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.2); keys[note]?.style.setProperty('--key-level', '.8'); keys[note]?.style.setProperty('background', accent); });
}

function initialPopulation(seed = 0x51a7) { return Array.from({length: 16}, (_, index) => mutateHex(DEFAULT_BINARY_RULE, seed + index * 17, 2 + index % 5)); }
function mutateHex(hex, seed, flips) { const random = rng(seed); const bits = hex.split('').flatMap((digit) => Number.parseInt(digit, 16).toString(2).padStart(4, '0').split('')); for (let i = 0; i < flips; i++) { const index = Math.floor(random() * bits.length); bits[index] = bits[index] === '1' ? '0' : '1'; } let out = ''; for (let i = 0; i < bits.length; i += 4) out += Number.parseInt(bits.slice(i, i + 4).join(''), 2).toString(16); return out.toUpperCase(); }
