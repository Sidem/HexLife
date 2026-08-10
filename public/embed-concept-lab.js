// Bare package entrypoints are resolved by the import map on each public demo page.
/* eslint-disable import/no-unresolved */
import '@hexlife/embed';
import {blockRuleFromTable, isConservative, isIsotropic, ruleFromTable} from '@hexlife/embed/ca';
import '@hexlife/embed/ca-element';
/* eslint-enable import/no-unresolved */
import {sealPerimeter} from './embed-concept-boundaries.js';
import {demoOwnershipFor} from './embed-demo-manifest.js';
import {
  createGasModel,
  createOutbreakModel,
  createWildfireModel,
  neighborIndex,
} from './embed-concept-models.js';

const PACKAGE_VERSION = '1.8.0';
const BUTTERFLY_RULE = 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6';
const SYNTH_RULES = {
  spinners: '120C11B442568E21134E30A85A40C880',
  gliders: '12482080480080006880800180010117',
  crystals: '84304E4024A82000162D5CB263E49A49',
};

const concepts = [
  {
    id: 'crystal-garden', href: 'crystal-garden.html', title: 'Crystal Garden',
    kicker: 'Four-state growth laboratory', deck: 'Design compact, dendritic, or faceted crystals and sculpt their impurity field.',
    complexity: '01 · simplest', accent: '#8ad5ff', rgb: '138, 213, 255', kind: 'native',
    surface: '<hexlife-ca> · neighborhood k⁷', topology: 'sealed impurity rim',
    experiment: 'Crystal cells seed a moving growth front; vapor joins only when the selected geometry and local support agree. Seed arms determine initial symmetry, while impurities pin branches and split facets. Every control rebuilds the same deterministic garden so changes are directly comparable.',
    packageNote: 'A four-state radius-one table is generated from the controls once, then every tick runs in the optimized Wasm k-state engine.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 18, focusState: 1,
    palette: ['#08121a', '#dff5ff', '#5ab9e8', '#735f8d'], names: ['vapor', 'crystal', 'growth front', 'impurity'],
    parameters: [
      range('threshold', 'Supersaturation', 1, 3, 2, ' neighbors'),
      select('geometry', 'Growth geometry', 'dendritic', [['compact', 'Compact'], ['dendritic', 'Dendritic'], ['faceted', 'Faceted']]),
      range('arms', 'Seed arms', 1, 6, 6, ''),
      range('impurities', 'Impurity density', 0, 8, 2, '%'),
    ],
    actions: [['seed', 'Add satellite seed'], ['ring', 'Add impurity ring'], ['clear', 'Clear interior impurities']],
    rule: crystalRule, seed: seedCrystal, action: crystalAction,
  },
  {
    id: 'hex-ecology', href: 'hex-ecology.html', title: 'Hex Ecology',
    kicker: 'Cyclic spatial ecosystem', deck: 'Rebalance three species, create refuges, and intervene in the waves they form.',
    complexity: '02 · gentle', accent: '#89e49f', rgb: '137, 228, 159', kind: 'native',
    surface: '<hexlife-ca> · census()', topology: 'intentional toroidal habitat',
    experiment: 'Lichen is invaded by grazers, grazers by hunters, and hunters by lichen. Local invasion creates rotating ecological fronts; empty refuges interrupt them. Change starting abundance, refuge area, or invasion pressure, then add any species as a migration pulse while the population census tracks the result.',
    packageNote: 'The neighborhood engine owns the food-web transitions; census() turns the same world into a live population instrument without reading Wasm memory.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 20, focusState: 2, paintable: true,
    palette: ['#0a1116', '#68d391', '#f6c85f', '#ef7185'], names: ['empty refuge', 'lichen', 'grazer', 'hunter'],
    parameters: [
      range('pressure', 'Invasion pressure', 1, 4, 2, ' neighbors'),
      range('refuges', 'Empty refuges', 0, 30, 9, '%'),
      range('lichen', 'Lichen weight', 1, 8, 5, ''),
      range('grazers', 'Grazer weight', 1, 8, 3, ''),
      range('hunters', 'Hunter weight', 1, 8, 2, ''),
    ],
    actions: [['lichen', 'Add lichen patch'], ['grazer', 'Add grazer patch'], ['hunter', 'Add hunter patch'], ['refuge', 'Excavate refuge']],
    rule: ecologyRule, seed: seedEcology, action: ecologyAction,
  },
  {
    id: 'excitable-tissue', href: 'excitable-tissue.html', title: 'Excitable Tissue Lab',
    kicker: 'Wave and refractory dynamics', deck: 'See exactly why coherent fronts propagate while isolated sparks fail.',
    complexity: '03 · moderate', accent: '#ff7e9d', rgb: '255, 126, 157', kind: 'native',
    surface: '<hexlife-ca> · excitable medium', topology: 'sealed scar rim',
    experiment: 'Yellow cells are excited for one tick, turn pink and refractory for one tick, then recover to dark resting tissue. Mode 1 lets a single spark transmit, mode 2 requires at least two excited neighbors, and mode 3 is a selective front detector that fires on exactly two—dense clumps suppress themselves instead of exploding. The authored presets make all three settings visibly meaningful, while scars split or anchor fronts.',
    packageNote: 'The rule deliberately treats all six neighbors equally. Refractory memory is represented as a state, so wave dynamics still execute entirely inside the deterministic k-state engine.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 15, focusState: 1, paintable: true,
    palette: ['#15121c', '#fff08a', '#e44d7d', '#4b5365'], names: ['resting tissue', 'excited', 'refractory', 'scar'],
    parameters: [
      select('threshold', 'Propagation mode', '2', [['1', '1 · Spark-sensitive'], ['2', '2 · Coherent front'], ['3', '3 · Selective front']]),
      select('stimulus', 'Initial stimulus', 'thick-front', [['thin-front', 'Thin front'], ['thick-front', 'Thick front'], ['broken-wave', 'Broken wave'], ['pacemaker', 'Pacemaker island']]),
      range('width', 'Stimulus thickness', 1, 7, 4, ' cells'),
      range('scars', 'Scar density', 0, 8, 2, '%'),
    ],
    actions: [['front', 'Launch coherent front'], ['pulse', 'Fire central pulse'], ['scar', 'Add scar barrier']],
    rule: tissueRule, seed: seedTissue, action: tissueAction,
  },
  {
    id: 'mixing-chamber', href: 'mixing-chamber.html', title: 'Diffusion & Mixing Chamber',
    kicker: 'Exclusion lattice gas', deck: 'Open a finite chamber where particles travel, collide, reflect, and mix.',
    complexity: '04 · moderate', accent: '#d7a7ff', rgb: '215, 167, 255', kind: 'host-gas',
    surface: '<hexlife-ca> · particle host model', topology: 'finite reflecting vessel',
    experiment: 'Each colored cell is now a particle with a hidden direction. It advances through empty space, reflects from walls and occupied cells, and bounces when particles claim the same destination. The outer wall removes both horizontal and vertical wrapping; the two gases cannot meet until you open the visible membrane.',
    packageNote: 'A six-velocity gas needs more information than one visible cell state. A seeded O(N) host model owns velocity and collisions; the package validates and renders its four visible states.',
    states: 4, rows: 60, backend: 'block', speed: 26, focusState: 1,
    palette: ['#0b1118', '#f0ad5f', '#57c7ff', '#606a78'], names: ['vacuum', 'amber molecule', 'cyan molecule', 'reflecting wall'],
    parameters: [range('density', 'Particle density', 8, 55, 24, '%'), range('scatter', 'Thermal scattering', 0, 30, 7, '%')],
    actions: [['open', 'Open membrane'], ['restart', 'Close & refill chamber']],
  },
  {
    id: 'wildfire-command', href: 'wildfire-command.html', title: 'Wildfire Command',
    kicker: 'Probabilistic fire ecology', deck: 'Shape spread, wind, burn time, ash recovery, and firefighting interventions.',
    complexity: '05 · involved', accent: '#ff8a55', rgb: '255, 138, 85', kind: 'host-wildfire',
    surface: '<hexlife-ca> · seeded probability', topology: 'sealed clearing rim',
    experiment: 'Every burning neighbor independently contributes a chance of ignition, so fire spreads naturally even with no wind. Wind boosts only aligned exposure. Trees burn for several ticks, become ash, then regrow after a configurable delay and probability—making repeated fire succession possible rather than ending in a frozen board.',
    packageNote: 'A counter-based random value keyed by seed, cell, and tick makes every run replayable. The host performs one six-neighbor pass per tick; the package renders the validated ecosystem.',
    states: 4, rows: 60, backend: 'block', speed: 12, focusState: 2,
    palette: ['#0d1216', '#2f9e56', '#ffcf4d', '#6b5047'], names: ['clearing', 'forest', 'fire', 'ash'],
    parameters: [
      range('forest', 'Forest cover', 45, 95, 78, '%'), range('spread', 'Spread per fire neighbor', 2, 55, 18, '%'),
      select('wind', 'Wind', 'none', [['none', 'No wind'], ['east', 'East'], ['west', 'West'], ['north', 'North'], ['south', 'South']]),
      range('windBoost', 'Wind multiplier', 1, 4, 2, '×'), range('burnTicks', 'Burn duration', 1, 6, 2, ' ticks'),
      range('ashTicks', 'Ash recovery delay', 4, 45, 20, ' ticks'), range('regrowth', 'Regrowth chance', 1, 20, 5, '% / tick'),
    ],
    actions: [['break', 'Cut firebreak'], ['spot', 'Ignite central spot'], ['regrow', 'Force ash regrowth']],
  },
  {
    id: 'outbreak-counterfactuals', href: 'outbreak-counterfactuals.html', title: 'Outbreak Counterfactuals',
    kicker: 'Paired probabilistic intervention study', deck: 'Replay the same random exposure schedule with and without vaccination.',
    complexity: '06 · involved', accent: '#65d7d0', rgb: '101, 215, 208', kind: 'outbreak',
    surface: '2 × <hexlife-ca> · paired seeded model', topology: 'intentional toroidal population',
    experiment: 'Each infectious neighbor adds an independent infection chance: p = 1 − (1 − x)ⁿ. Both populations use the same seed, initial cases, and cell-by-cell random schedule; only vaccination differs. Duration, waning immunity, coverage, and efficacy are explicit, so “cases prevented” is a genuine counterfactual measurement.',
    packageNote: 'This is a package-compatible prototype of a probabilistic CA. Epidemiological memory and seeded chance stay in an O(6N) host model while two package elements render the paired states.',
    states: 4, rows: 54, backend: 'block', speed: 14, focusState: 1,
    palette: ['#4c94c6', '#ff6577', '#4e5662', '#76d68d'], names: ['susceptible', 'infectious', 'recovered', 'vaccinated'],
    parameters: [
      range('infection', 'Chance per infected neighbor', 1, 40, 12, '%'), range('infectiousTicks', 'Infectious duration', 2, 14, 6, ' ticks'),
      range('immunityTicks', 'Recovered immunity', 8, 80, 36, ' ticks'), range('coverage', 'Vaccine coverage', 0, 60, 20, '%'),
      range('efficacy', 'Vaccine efficacy', 0, 100, 85, '%'),
    ],
    actions: [['ring', 'Add vaccination ring'], ['restart', 'Replay counterfactual']],
  },
  {
    id: 'butterfly-microscope', href: 'butterfly-microscope.html', title: 'Butterfly Microscope',
    kicker: 'Paired deterministic experiment', deck: 'Flip one cell and watch every downstream disagreement glow red.',
    complexity: '07 · advanced', accent: '#ae9cff', rgb: '174, 156, 255', kind: 'butterfly',
    surface: '2 × <hexlife-world> · red XOR overlay',
    experiment: 'Both simulations use the same rule, seed, density, and clock. The right world receives one controlled edit; a red overlay marks the exact cells where the two snapshots disagree. Paste any valid 32-character HexLife ruleset to compare orderly, chaotic, or insensitive dynamics.',
    packageNote: 'Safe snapshots make the XOR layer and divergence curve exact. A third package renderer displays the binary difference mask without altering either experiment.',
  },
  {
    id: 'cellular-synth', href: 'cellular-synth.html', title: 'Cellular Synthesizer',
    kicker: 'Pattern-driven generative instrument', deck: 'Turn sparse spinners, gliders, or crystal growth into an intelligible musical score.',
    complexity: '08 · advanced', accent: '#ff85c8', rgb: '255, 133, 200', kind: 'synth',
    surface: '<hexlife-world> · Web Audio host',
    experiment: 'Only births—cells that were off last beat and on this beat—sound. Horizontal bands select one of eight scale notes; vertical position changes octave. Sparse, structure-forming rules keep the rhythm legible, and the lit keyboard shows exactly which lanes fired.',
    packageNote: 'The package supplies exact single ticks and immutable snapshots. Tempo, scale, waveform, voice limiting, and Web Audio remain clean host concerns.',
  },
  {
    id: 'hex-matter', href: 'hex-matter.html', title: 'Hex Matter',
    kicker: 'Eight-state material sandbox', deck: 'Choose a material brush, pour substances, build vessels, and tune their reactions.',
    complexity: '09 · most complex', accent: '#5cc8ff', rgb: '92, 200, 255', kind: 'native',
    surface: '<hexlife-ca> · block k³ · k = 8', topology: 'sealed stone vessel',
    experiment: 'Sand sinks, water and oil separate, steam rises, embers ignite oil and plants, and water quenches heat. Select any material as the drawing brush, then pour or ignite authored regions. Gravity and reaction modes rebuild the block rule so you can isolate transport from chemistry.',
    packageNote: 'The 8³ Margolus-style block table combines local transport with optional reactions. Drawing and the census expose all eight states without custom renderer code.',
    states: 8, rows: 72, backend: 'block', speed: 22, focusState: 3, paintable: true,
    palette: ['#091018', '#3ba7ff', '#e5a84b', '#d6bd78', '#65717f', '#ff654f', '#d9f2ff', '#61ae5b'],
    names: ['air', 'water', 'oil', 'sand', 'stone', 'ember', 'steam', 'plant'],
    parameters: [range('gravity', 'Gravity', 0, 4, 3, ''), select('reactions', 'Chemistry', 'full', [['full', 'Full reactions'], ['no-fire', 'No combustion'], ['transport', 'Transport only']])],
    actions: [['rain', 'Rain water'], ['sand', 'Pour sand'], ['oil', 'Pour oil'], ['ignite', 'Add embers'], ['garden', 'Grow plants'], ['clear', 'Clear vessel']],
    rule: matterRule, seed: seedMatter, action: matterAction,
  },
];

const config = concepts.find((item) => item.id === document.body.dataset.concept);
if (!config) throw new Error(`Unknown HexLife concept page: ${document.body.dataset.concept}`);
const ownership = demoOwnershipFor(config.id);
if (!ownership || ownership.section !== 'library') {
  throw new Error(`Missing demo ownership declaration for ${config.id}.`);
}
config.engine = ownership.engine;
const root = document.getElementById('concept-root');
document.documentElement.style.setProperty('--concept-accent', config.accent);
document.documentElement.style.setProperty('--concept-accent-rgb', config.rgb);
renderShell(config);

if (config.kind === 'native') setupNativeLab(config);
else if (config.kind === 'host-gas') setupHostLab(config, createGasModel);
else if (config.kind === 'host-wildfire') setupHostLab(config, createWildfireModel);
else if (config.kind === 'outbreak') setupOutbreak(config);
else if (config.kind === 'butterfly') setupButterfly(config);
else if (config.kind === 'synth') setupSynth(config);

function range(id, label, min, max, value, suffix, step = 1) { return {id, label, type: 'range', min, max, value, suffix, step}; }
function select(id, label, value, options) { return {id, label, type: 'select', value, options}; }

function renderShell(item) {
  const index = concepts.indexOf(item);
  const previous = concepts[index - 1];
  const next = concepts[index + 1];
  root.innerHTML = `<div class="demo-shell concept-root" style="--demo-shell-width: 1460px">
    <header class="demo-masthead"><div class="demo-topbar"><a class="demo-brand" href="./embed-demos.html"><span>HexLife</span> embed demos</a><nav class="demo-nav" aria-label="HexLife embed demos"><a href="./embed-demos.html">Demo library</a><a href="./totalistic-256.html">Rule atlas</a><a href="./coffee-percolation.html">Coffee lab</a><a href="./ca-builder.html">CA builder</a></nav></div>
      <div class="demo-hero-grid"><div><span class="complexity-pill">${item.complexity}</span><p class="demo-kicker">${item.kicker}</p><h1>${item.title}</h1><p class="demo-deck">${item.deck}</p></div><a class="demo-package-card" href="https://www.npmjs.com/package/@hexlife/embed" target="_blank" rel="noopener noreferrer"><span>Built with the published npm package</span><strong>@hexlife/embed@${PACKAGE_VERSION}</strong><small>${escapeHtml(item.surface)}</small></a></div></header>
    <main class="demo-content"><div class="concept-workspace"><aside class="concept-panel concept-controls" id="controls"></aside><section class="concept-panel concept-stage"><div class="stage-head"><h2>Live experiment</h2><span id="stage-status">Loading Wasm…</span></div><div class="world-mount" id="world-mount"></div></section><aside class="concept-panel concept-readout"><h2>Instrument panel</h2><div class="metric-grid"><div class="metric"><span>Generation</span><strong id="metric-generation">0</strong></div><div class="metric"><span id="metric-focus-label">Active</span><strong id="metric-focus">—</strong></div><div class="metric"><span>Changed / difference</span><strong id="metric-change">—</strong></div><div class="metric"><span>Checksum / score</span><strong id="metric-checksum">—</strong></div></div><canvas class="trace" id="trace" width="460" height="184" aria-label="Recent measurement trace"></canvas><div class="legend" id="legend"></div></aside></div>
      <div class="concept-notes"><section class="concept-panel concept-note"><h3>What to look for</h3><p>${item.experiment}</p></section><section class="concept-panel concept-note"><h3>Model boundary</h3><p>${item.packageNote}</p></section></div>
      <nav class="concept-pager" aria-label="Concept demo order">${previous ? `<a href="./${previous.href}"><small>← Simpler</small><strong>${previous.title}</strong></a>` : '<span></span>'}${next ? `<a href="./${next.href}"><small>More complex →</small><strong>${next.title}</strong></a>` : '<a href="./embed-demos.html"><small>Return to</small><strong>Demo library</strong></a>'}</nav></main>
    <footer class="demo-footer"><p>Demo ${String(index + 1).padStart(2, '0')} of ${concepts.length} · built with <strong>@hexlife/embed</strong> from npm.</p><nav><a href="./embed-demos.html">All demos</a><a href="https://github.com/Sidem/HexLife/tree/main/packages/hexlife-embed" target="_blank" rel="noopener noreferrer">Package API</a><a href="./">HexLife Explorer</a></nav></footer></div>`;
}

function renderControls(item, {playLabel = 'Play', copyLabel = 'Copy exact world'} = {}) {
  const controls = document.getElementById('controls');
  controls.innerHTML = `<h2>Experiment controls</h2><div class="control-stack"><div class="control-row"><button class="primary" id="play">${playLabel}</button><button id="step">Step</button><button id="reset">Reset</button></div>
    <div class="parameter-grid">${(item.parameters || []).map(parameterHtml).join('')}</div>
    ${item.paintable ? `<div class="field"><label for="paint-state">Material brush</label><select id="paint-state">${item.names.map((name, index) => `<option value="${index}">${index} · ${name}</option>`).join('')}</select><small>Drag directly on the world to paint.</small></div>` : ''}
    ${item.actions ? `<div class="field"><label for="action-choice">Intervention</label><select id="action-choice">${item.actions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div>` : ''}
    <div class="control-row two"><button id="action">Apply intervention</button><button id="copy">${copyLabel}</button></div></div><p class="concept-status" id="control-status" aria-live="polite">Preparing the exact initial state…</p>`;
  return valuesFromControls(item.parameters || []);
}

function parameterHtml(parameter) {
  if (parameter.type === 'select') return `<div class="field"><label for="param-${parameter.id}">${parameter.label}</label><select id="param-${parameter.id}">${parameter.options.map(([value, label]) => `<option value="${value}"${value === parameter.value ? ' selected' : ''}>${label}</option>`).join('')}</select></div>`;
  return `<div class="field"><div class="field-head"><label for="param-${parameter.id}">${parameter.label}</label><output id="output-${parameter.id}">${parameter.value}${parameter.suffix}</output></div><input id="param-${parameter.id}" type="range" min="${parameter.min}" max="${parameter.max}" step="${parameter.step}" value="${parameter.value}"></div>`;
}

function valuesFromControls(parameters) {
  return Object.fromEntries(parameters.map((parameter) => [parameter.id, parameter.type === 'range' ? Number(parameter.value) : parameter.value]));
}

function bindParameterControls(item, params, onChange) {
  for (const parameter of item.parameters || []) {
    document.getElementById(`param-${parameter.id}`).addEventListener('change', (event) => {
      params[parameter.id] = parameter.type === 'range' ? Number(event.target.value) : event.target.value;
      if (parameter.type === 'range') setText(`output-${parameter.id}`, `${params[parameter.id]}${parameter.suffix}`);
      onChange(parameter);
    });
    if (parameter.type === 'range') document.getElementById(`param-${parameter.id}`).addEventListener('input', (event) => setText(`output-${parameter.id}`, `${event.target.value}${parameter.suffix}`));
  }
}

function createCaElement(item, {draw = false} = {}) {
  const world = document.createElement('hexlife-ca');
  for (const [name, value] of Object.entries({states: item.states, rows: item.rows, backend: item.backend, speed: item.speed, palette: item.palette.join(','), paused: '', link: 'off'})) world.setAttribute(name, String(value));
  if (draw) { world.setAttribute('draw', ''); world.setAttribute('draw-state', '1'); }
  return world;
}

function setupNativeLab(item) {
  const params = renderControls(item);
  renderLegend(item.names, item.palette);
  setText('metric-focus-label', item.names[item.focusState]);
  const world = createCaElement(item, {draw: item.paintable});
  document.getElementById('world-mount').append(world);
  const trace = [];
  let ready = false;
  let lastGeneration = -1;

  world.addEventListener('hexlife-ca-ready', () => {
    ready = true;
    installModel();
    setText('stage-status', `${item.backend} · k = ${item.states} · ${world.rows} × ${world.columns} · ${item.topology}`);
    update();
  }, {once: true});
  world.addEventListener('hexlife-ca-playstate', (event) => setText('play', event.detail.userPaused ? 'Play' : 'Pause'));
  document.getElementById('play').addEventListener('click', () => { if (ready) world.userPaused ? world.play() : world.pause(); });
  document.getElementById('step').addEventListener('click', () => { if (ready) { world.pause(); world.tick(1); update(); } });
  document.getElementById('reset').addEventListener('click', () => { if (ready) { world.pause(); installModel(); update(); } });
  document.getElementById('action').addEventListener('click', () => {
    if (!ready) return;
    item.action(world, params, document.getElementById('action-choice').value);
    setText('control-status', `Intervention applied at generation ${world.generation}.`);
    update();
  });
  document.getElementById('copy').addEventListener('click', async () => { if (ready) await copyText(await world.caCode(), 'Exact HXK1 world copied.'); });
  if (item.paintable) document.getElementById('paint-state').addEventListener('change', (event) => world.setAttribute('draw-state', event.target.value));
  bindParameterControls(item, params, () => { if (ready) { world.pause(); installModel(); update(); } });
  window.setInterval(update, 160);

  function installModel() {
    const rule = item.rule(params);
    world.setRule(rule);
    world.setCells(item.seed(world.rows, world.columns, params));
    trace.length = 0;
    lastGeneration = -1;
    const invariant = item.backend === 'block' ? `${isConservative(item.states, rule) ? 'conservative' : 'reactive'} · ${isIsotropic(item.states, rule) ? 'isotropic' : 'directional'}` : 'six-neighbor radius 1';
    setText('control-status', `Model rebuilt from controls: ${invariant}. Paint or run when ready.`);
  }
  function update() {
    if (!ready || !world.world) return;
    const census = world.census();
    setText('metric-generation', world.generation.toLocaleString());
    setText('metric-focus', census[item.focusState].toLocaleString());
    setText('metric-change', world.world.lastChangedCount.toLocaleString());
    setText('metric-checksum', (world.checksum >>> 0).toString(16).padStart(8, '0'));
    if (world.generation !== lastGeneration) { trace.push(census[item.focusState]); if (trace.length > 90) trace.shift(); drawTrace(trace, item.accent); lastGeneration = world.generation; }
  }
}

function setupHostLab(item, modelFactory) {
  const params = renderControls(item, {copyLabel: 'Copy snapshot JSON'});
  renderLegend(item.names, item.palette);
  setText('metric-focus-label', item.names[item.focusState]);
  const world = createCaElement(item);
  document.getElementById('world-mount').append(world);
  let model = null;
  let timer = 0;
  const trace = [];
  world.addEventListener('hexlife-ca-ready', () => {
    world.setRule(blockRuleFromTable(item.states, (block) => block));
    model = modelFactory(world.rows, world.columns);
    restart();
    setText('stage-status', `${world.rows} × ${world.columns} · ${item.topology} · seeded host model`);
  }, {once: true});
  document.getElementById('play').addEventListener('click', () => timer ? stop() : start());
  document.getElementById('step').addEventListener('click', tick);
  document.getElementById('reset').addEventListener('click', restart);
  document.getElementById('action').addEventListener('click', () => {
    if (!model) return;
    const action = document.getElementById('action-choice').value;
    if (item.kind === 'host-gas' && action === 'restart') { restart(); return; }
    if (item.kind === 'host-gas') model.openMembrane();
    else if (action === 'break') model.cutFirebreak(); else if (action === 'spot') model.ignite('spot'); else model.regrowNow();
    world.setCells(model.cells);
    setText('control-status', `${document.getElementById('action-choice').selectedOptions[0].textContent} applied.`);
    update();
  });
  document.getElementById('copy').addEventListener('click', () => model && copyText(JSON.stringify({demo: item.id, generation: model.generation, params, cells: encodeCells(model.cells)}), 'Experiment snapshot JSON copied.'));
  bindParameterControls(item, params, restart);

  function start() { if (!model) return; timer = window.setInterval(tick, 1000 / item.speed); setText('play', 'Pause'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Play'); }
  function restart() { if (!model) return; stop(); model.reset(params); world.setCells(model.cells); trace.length = 0; setText('control-status', 'Replayed from the fixed seed with the current controls.'); update(); }
  function tick() { if (!model) return; model.step(); world.setCells(model.cells); update(); }
  function update() {
    if (!model) return;
    const census = censusOf(model.cells, item.states);
    trace.push(census[item.focusState]); if (trace.length > 90) trace.shift();
    setText('metric-generation', model.generation); setText('metric-focus', census[item.focusState].toLocaleString());
    setText('metric-change', item.kind === 'host-gas' ? `${model.collisions} collisions` : `${census[3].toLocaleString()} ash`);
    setText('metric-checksum', checksum(model.cells).toString(16).padStart(8, '0'));
    drawTrace(trace, item.accent);
  }
}

function setupOutbreak(item) {
  const params = renderControls(item, {copyLabel: 'Copy comparison snapshot'});
  renderLegend(item.names, item.palette);
  setText('metric-focus-label', 'Cases prevented');
  const mount = document.getElementById('world-mount');
  mount.innerHTML = '<div class="dual-worlds" id="dual"></div>';
  const left = createCaElement(item); const right = createCaElement(item);
  document.getElementById('dual').append(figure('No vaccine', left), figure('Vaccination policy', right));
  let baseline = null; let intervention = null; let timer = 0; let ready = 0; const trace = [];
  const onReady = () => {
    if (++ready !== 2) return;
    const identity = blockRuleFromTable(item.states, (block) => block);
    left.setRule(identity); right.setRule(identity);
    baseline = createOutbreakModel(left.rows, left.columns);
    intervention = createOutbreakModel(right.rows, right.columns, {intervention: true});
    restart(); setText('stage-status', 'Same seed · same exposure schedule · policy is the only difference');
  };
  left.addEventListener('hexlife-ca-ready', onReady, {once: true}); right.addEventListener('hexlife-ca-ready', onReady, {once: true});
  document.getElementById('play').addEventListener('click', () => timer ? stop() : start());
  document.getElementById('step').addEventListener('click', tick);
  document.getElementById('reset').addEventListener('click', restart);
  document.getElementById('action').addEventListener('click', () => {
    if (!intervention) return;
    const action = document.getElementById('action-choice').value;
    if (action === 'restart') restart(); else { intervention.vaccinateRing(); right.setCells(intervention.cells); update(); setText('control-status', 'Vaccination ring added only to the policy world.'); }
  });
  document.getElementById('copy').addEventListener('click', () => baseline && copyText(JSON.stringify({demo: item.id, generation: baseline.generation, params, baseline: encodeCells(baseline.cells), intervention: encodeCells(intervention.cells)}), 'Paired comparison JSON copied.'));
  bindParameterControls(item, params, restart);
  function start() { if (!baseline) return; timer = window.setInterval(tick, 1000 / item.speed); setText('play', 'Pause'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Play'); }
  function restart() { if (!baseline) return; stop(); baseline.reset(params); intervention.reset(params); left.setCells(baseline.cells); right.setCells(intervention.cells); trace.length = 0; setText('control-status', 'Counterfactual replayed from identical initial cases and random schedule.'); update(); }
  function tick() { if (!baseline) return; baseline.step(); intervention.step(); left.setCells(baseline.cells); right.setCells(intervention.cells); update(); }
  function update() {
    if (!baseline) return;
    const leftCensus = censusOf(baseline.cells, 4); const rightCensus = censusOf(intervention.cells, 4);
    const prevented = baseline.totalInfections - intervention.totalInfections; const differences = xorCount(baseline.cells, intervention.cells);
    trace.push(Math.max(0, prevented)); if (trace.length > 90) trace.shift();
    setText('metric-generation', baseline.generation); setText('metric-focus', prevented); setText('metric-change', `${differences.toLocaleString()} cells`); setText('metric-checksum', `${leftCensus[1]} vs ${rightCensus[1]} infectious`); drawTrace(trace, item.accent);
  }
}

function setupButterfly(item) {
  item.parameters = [range('radius', 'Perturbation radius', 0, 4, 0, ' cells')];
  const params = renderControls(item);
  document.querySelector('.parameter-grid').insertAdjacentHTML('beforeend', `<div class="field field-wide"><label for="custom-rule">Custom 32-character ruleset</label><input id="custom-rule" class="text-input mono" value="${BUTTERFLY_RULE}" maxlength="32" spellcheck="false"><small id="rule-help">Paste a HexLife binary rule, then Apply rule.</small></div>`);
  document.getElementById('action').textContent = 'Apply rule';
  renderLegend(['same in both worlds', 'perturbed world', 'difference (red overlay)'], ['#748399', item.accent, '#ff304f']);
  const mount = document.getElementById('world-mount'); mount.innerHTML = '<div class="dual-worlds" id="dual"></div>';
  const left = binaryWorld(BUTTERFLY_RULE, 0.34); const right = binaryWorld(BUTTERFLY_RULE, 0.34);
  const rightStack = document.createElement('div'); rightStack.className = 'difference-stack'; rightStack.append(right);
  const diff = document.createElement('hexlife-ca');
  for (const [key, value] of Object.entries({states: 2, rows: 72, backend: 'block', palette: '#000000,#ff304f', paused: '', link: 'off'})) diff.setAttribute(key, String(value));
  diff.className = 'difference-overlay'; rightStack.append(diff);
  document.getElementById('dual').append(figure('Reference', left), figure('Perturbed + red XOR', rightStack));
  let ready = 0; let timer = 0; const trace = [];
  const onReady = () => { if (++ready === 3) { diff.setRule(blockRuleFromTable(2, (block) => block)); resetPair(); setText('stage-status', 'Red = exact snapshot disagreement'); } };
  left.addEventListener('hexlife-ready', onReady, {once: true}); right.addEventListener('hexlife-ready', onReady, {once: true}); diff.addEventListener('hexlife-ca-ready', onReady, {once: true});
  document.getElementById('play').addEventListener('click', () => timer ? stop() : start()); document.getElementById('step').addEventListener('click', step);
  document.getElementById('reset').addEventListener('click', resetPair);
  document.getElementById('action').addEventListener('click', () => {
    const hex = document.getElementById('custom-rule').value.trim().toUpperCase();
    if (!/^[0-9A-F]{32}$/.test(hex)) { setText('rule-help', 'A ruleset must contain exactly 32 hexadecimal characters.'); return; }
    left.setAttribute('ruleset', hex); right.setAttribute('ruleset', hex); setText('rule-help', 'Rule accepted. Both worlds reset before the perturbation.'); window.setTimeout(resetPair, 0);
  });
  document.getElementById('copy').addEventListener('click', async () => ready === 3 && copyText(await right.worldCode(), 'Perturbed HXW1 world copied.'));
  bindParameterControls(item, params, resetPair);
  function start() { if (ready !== 3) return; timer = window.setInterval(step, 115); setText('play', 'Pause'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Play'); }
  function resetPair() { if (ready !== 3) return; stop(); left.reset(); right.reset(); perturb(right, params.radius); trace.length = 0; setText('control-status', 'Exactly one controlled edit is active; red cells are its downstream consequences.'); update(); }
  function step() { if (ready !== 3) return; left.tick(1); right.tick(1); update(); }
  function update() {
    if (ready !== 3) return; const a = left.sim.snapshotCells(); const b = right.sim.snapshotCells(); const mask = new Uint8Array(a.length); let count = 0;
    for (let index = 0; index < a.length; index++) { mask[index] = a[index] ^ b[index]; count += mask[index]; }
    diff.setCells(mask); trace.push(count); if (trace.length > 90) trace.shift();
    setText('metric-generation', left.tickCount); setText('metric-focus-label', 'Divergent cells'); setText('metric-focus', count.toLocaleString()); setText('metric-change', `${(count / a.length * 100).toFixed(1)}%`); setText('metric-checksum', count ? 'diverged' : 'identical'); drawTrace(trace, '#ff304f');
  }
}

function setupSynth(item) {
  item.parameters = [range('tempo', 'Tempo', 45, 220, 110, ' BPM'), range('density', 'Starting density', 2, 22, 8, '%'), select('rule', 'Pattern engine', 'spinners', [['spinners', 'Spinners / oscillators'], ['gliders', 'Spontaneous gliders'], ['crystals', 'Organic crystals']]), select('scale', 'Scale', 'minor', [['minor', 'Minor pentatonic'], ['major', 'Major'], ['whole', 'Whole tone']]), select('waveform', 'Voice', 'triangle', [['triangle', 'Triangle'], ['sine', 'Sine'], ['square', 'Soft square']])];
  const params = renderControls(item, {playLabel: 'Start audio'});
  document.getElementById('action').textContent = 'New deterministic score';
  document.querySelector('.control-stack').insertAdjacentHTML('beforeend', '<div class="synth-keyboard" id="keyboard" aria-label="Eight pitch lanes"></div>');
  document.getElementById('keyboard').innerHTML = Array.from({length: 8}, (_, index) => `<span class="synth-key"><small>${index + 1}</small></span>`).join('');
  renderLegend(['birth = note', 'horizontal = pitch lane', 'vertical = octave'], [item.accent, '#73d49c', '#f4be63']);
  let scoreSeed = 13579; const world = binaryWorld(SYNTH_RULES[params.rule], params.density / 100, scoreSeed); document.getElementById('world-mount').append(world);
  let context = null; let timer = 0; let previous = null; const trace = [];
  world.addEventListener('hexlife-ready', () => { previous = world.sim.snapshotCells(); setText('stage-status', 'Sparse structure rule · audio requires a click'); setText('control-status', 'Births light their pitch lane. Start audio or step silently.'); update(); }, {once: true});
  document.getElementById('play').addEventListener('click', () => timer ? stop() : start()); document.getElementById('step').addEventListener('click', () => musicalTick(Boolean(context)));
  document.getElementById('reset').addEventListener('click', resetScore); document.getElementById('action').addEventListener('click', () => { scoreSeed += 7919; resetScore(); });
  document.getElementById('copy').addEventListener('click', async () => copyText(await world.worldCode(), 'Exact visual score copied as HXW1.'));
  bindParameterControls(item, params, (parameter) => { if (parameter.id === 'tempo' && timer) { stop(); start(); } else resetScore(); });
  function start() { if (!world.sim) return; context ||= new AudioContext(); context.resume(); timer = window.setInterval(() => musicalTick(true), 60000 / params.tempo); setText('play', 'Stop audio'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Start audio'); }
  function resetScore() { if (!world.sim) return; stop(); world.setAttribute('ruleset', SYNTH_RULES[params.rule]); world.setAttribute('density', String(params.density / 100)); world.setAttribute('seed', String(scoreSeed)); window.setTimeout(() => { world.reset(scoreSeed); previous = world.sim.snapshotCells(); trace.length = 0; update(); }, 0); }
  function musicalTick(sound) { if (!world.sim || !previous) return; world.tick(1); const next = world.sim.snapshotCells(); const births = []; for (let i = 0; i < next.length; i++) if (!previous[i] && next[i]) births.push(i); previous = next; const lanes = laneBirths(births, world.sim.cols); if (sound && context) playLanes(context, lanes, params); trace.push(births.length); if (trace.length > 90) trace.shift(); update(births.length, lanes); }
  function update(births = 0, lanes = []) { if (!world.sim) return; setText('metric-generation', world.tickCount); setText('metric-focus-label', 'Births this beat'); setText('metric-focus', births); setText('metric-change', `${lanes.filter(Boolean).length} pitch lanes`); setText('metric-checksum', world.checksum.toString(16).padStart(8, '0')); drawTrace(trace, item.accent); lightKeys(lanes); }
}

function binaryWorld(ruleset, density = 0.12, seed = 13579) { const world = document.createElement('hexlife-world'); for (const [name, value] of Object.entries({ruleset, rows: 72, seed, density, speed: 18, palette: 'monochrome', paused: '', link: 'off'})) world.setAttribute(name, String(value)); return world; }
function perturb(world, radius) { const cells = world.sim.snapshotCells(); const columns = world.sim.cols; const rows = cells.length / columns; const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2); const edits = []; for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { const index = row * columns + column; if (Math.hypot(row - rows / 2, column - columns / 2) <= radius + 0.3) edits.push({index, value: cells[index] ^ 1}); } if (radius === 0) edits.push({index: center, value: cells[center] ^ 1}); world.sim.setCells(edits); }

function crystalRule(params) { return ruleFromTable(4, (center, neighbors) => { const crystals = neighbors.filter((value) => value === 1).length; const fronts = neighbors.filter((value) => value === 2).length; if (center === 1 || center === 3) return center; if (center === 2) return crystals || fronts >= 2 ? 1 : 2; const supported = params.geometry === 'compact' ? crystals + fronts >= params.threshold + 1 : params.geometry === 'faceted' ? crystals >= params.threshold && fronts >= 1 : crystals >= params.threshold || (crystals === 1 && fronts >= 2); return supported ? 2 : 0; }); }
function seedCrystal(rows, columns, params) { const cells = new Uint8Array(rows * columns); for (let index = 0; index < cells.length; index++) if (seeded(index, 0xc7a57a1) < params.impurities / 100) cells[index] = 3; const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2); cells[center] = 1; for (let direction = 0; direction < params.arms; direction++) { let index = center; for (let length = 0; length < 4; length++) { index = neighborIndex(index, direction, rows, columns, false); if (index >= 0) cells[index] = 1; } } return sealPerimeter(cells, rows, columns, 3); }
function crystalAction(world, params, action) { const cells = world.world.snapshotCells(); if (action === 'clear') { for (let r = 2; r < world.rows - 2; r++) for (let c = 2; c < world.columns - 2; c++) if (cells[r * world.columns + c] === 3) cells[r * world.columns + c] = 0; } else { const rr = Math.floor(world.rows * 0.31); const cc = Math.floor(world.columns * 0.68); const radius = action === 'ring' ? 7 : 2; for (let r = rr - radius - 1; r <= rr + radius + 1; r++) for (let c = cc - radius - 1; c <= cc + radius + 1; c++) { const distance = Math.hypot(r - rr, c - cc); if (action === 'ring' ? Math.abs(distance - radius) < 1 : distance <= radius) cells[r * world.columns + c] = action === 'ring' ? 3 : 1; } } world.setCells(cells); }

function ecologyRule(params) { return ruleFromTable(4, (center, neighbors) => { const counts = [0, 0, 0, 0]; neighbors.forEach((state) => counts[state]++); if (center === 0) { const candidate = [1, 2, 3].sort((a, b) => counts[b] - counts[a])[0]; return counts[candidate] >= params.pressure + 1 ? candidate : 0; } const predator = center % 3 + 1; return counts[predator] >= params.pressure ? predator : center; }); }
function seedEcology(rows, columns, params) { const cells = new Uint8Array(rows * columns); const weights = [params.lichen, params.grazers, params.hunters]; const total = weights.reduce((a, b) => a + b, 0); for (let index = 0; index < cells.length; index++) { const p = seeded(index, 0xec0109); if (p < params.refuges / 100) continue; const species = seeded(index, 0xec0117) * total; cells[index] = species < weights[0] ? 1 : species < weights[0] + weights[1] ? 2 : 3; } return cells; }
function ecologyAction(world, params, action) { const states = {refuge: 0, lichen: 1, grazer: 2, hunter: 3}; const cells = world.world.snapshotCells(); const centerRow = Math.floor(world.rows * (0.25 + seeded(world.generation, 91) * 0.5)); const centerColumn = Math.floor(world.columns * (0.25 + seeded(world.generation, 97) * 0.5)); for (let r = centerRow - 5; r <= centerRow + 5; r++) for (let c = centerColumn - 5; c <= centerColumn + 5; c++) if (Math.hypot(r - centerRow, c - centerColumn) <= 5) cells[((r + world.rows) % world.rows) * world.columns + ((c + world.columns) % world.columns)] = states[action]; world.setCells(cells); }

function tissueRule(params) { return ruleFromTable(4, (center, neighbors) => { if (center === 3) return 3; if (center === 1) return 2; if (center === 2) return 0; const excited = neighbors.filter((state) => state === 1).length; const mode = Number(params.threshold); return mode === 1 ? (excited >= 1 ? 1 : 0) : mode === 2 ? (excited >= 2 ? 1 : 0) : (excited === 2 ? 1 : 0); }); }
function seedTissue(rows, columns, params) { const cells = new Uint8Array(rows * columns); for (let index = 0; index < cells.length; index++) if (seeded(index, 0x71550e) < params.scars / 100) cells[index] = 3; sealPerimeter(cells, rows, columns, 3); const width = params.stimulus === 'thin-front' ? 1 : params.width; if (params.stimulus === 'pacemaker') paintDisk(cells, rows, columns, rows / 2, columns / 2, Math.max(2, width), 1); else { for (let r = 3; r < rows - 3; r++) for (let c = 3; c < 3 + width; c++) if (params.stimulus !== 'broken-wave' || r < rows * 0.43 || r > rows * 0.58) cells[r * columns + c] = 1; } return cells; }
function tissueAction(world, params, action) { const cells = world.world.snapshotCells(); if (action === 'pulse') paintDisk(cells, world.rows, world.columns, world.rows / 2, world.columns / 2, Math.max(2, params.width), 1); else if (action === 'scar') { const column = Math.floor(world.columns * 0.63); for (let row = 8; row < world.rows - 8; row++) if (row < world.rows * 0.46 || row > world.rows * 0.55) cells[row * world.columns + column] = 3; } else for (let row = 3; row < world.rows - 3; row++) for (let column = 3; column < 3 + params.width; column++) cells[row * world.columns + column] = 1; world.setCells(cells); }

function matterRule(params) { const density = [0, 3, 2, 5, 9, 1, -1, 8]; return blockRuleFromTable(8, (block) => { const out = [...block]; if (params.reactions !== 'transport') { const ember = out.indexOf(5); const water = out.indexOf(1); const oil = out.indexOf(2); const plant = out.indexOf(7); if (ember !== -1 && water !== -1) { out[ember] = 6; out[water] = 4; } else if (params.reactions === 'full' && ember !== -1 && oil !== -1) out[oil] = 5; else if (params.reactions === 'full' && ember !== -1 && plant !== -1) out[plant] = 5; } const movable = (state) => state !== 4 && state !== 7; const swap = (a, b) => { [out[a], out[b]] = [out[b], out[a]]; }; if (params.gravity > 0 && movable(out[0]) && movable(out[2]) && density[out[0]] > density[out[2]]) swap(0, 2); else if (params.gravity > 1 && movable(out[0]) && movable(out[1]) && out[2] !== 0 && density[out[0]] > density[out[1]]) swap(0, 1); else if (params.gravity > 2 && movable(out[1]) && movable(out[2]) && out[0] !== 0 && density[out[1]] > density[out[2]]) swap(1, 2); return out; }); }
function seedMatter(rows, columns) { const cells = new Uint8Array(rows * columns); for (let r = Math.floor(rows * 0.17); r < rows * 0.42; r++) for (let c = 5; c < columns - 5; c++) { const p = seeded(r * columns + c, 0x6a77e2); cells[r * columns + c] = p < 0.18 ? 3 : p < 0.27 ? 1 : p < 0.34 ? 2 : 0; } for (let r = Math.floor(rows * 0.82); r < rows; r++) for (let c = 0; c < columns; c++) cells[r * columns + c] = 4; for (let r = Math.floor(rows * 0.58); r < rows * 0.8; r++) cells[r * columns + Math.floor(columns * 0.72)] = 7; cells[Math.floor(rows * 0.64) * columns + Math.floor(columns * 0.68)] = 5; return sealPerimeter(cells, rows, columns, 4); }
function matterAction(world, params, action) { const state = {rain: 1, oil: 2, sand: 3, ignite: 5, garden: 7}[action]; const cells = world.world.snapshotCells(); if (action === 'clear') { for (let r = 2; r < world.rows - 2; r++) for (let c = 2; c < world.columns - 2; c++) cells[r * world.columns + c] = 0; } else { const start = action === 'garden' ? Math.floor(world.rows * 0.63) : 3; const end = action === 'garden' ? Math.floor(world.rows * 0.78) : action === 'ignite' ? 8 : 12; for (let r = start; r < end; r++) for (let c = Math.floor(world.columns * 0.22); c < world.columns * 0.78; c++) if (seeded(r * world.columns + c, world.generation + state * 101) < (action === 'ignite' ? 0.12 : 0.5)) cells[r * world.columns + c] = state; } world.setCells(cells); }

function laneBirths(births, columns) { const lanes = Array(8).fill(null); for (const index of births) { const lane = Math.min(7, Math.floor((index % columns) / columns * 8)); if (lanes[lane] === null) lanes[lane] = index; } return lanes; }
function playLanes(context, lanes, params) { const intervals = {minor: [0, 3, 5, 7, 10, 12, 15, 17], major: [0, 2, 4, 5, 7, 9, 11, 12], whole: [0, 2, 4, 6, 8, 10, 12, 14]}[params.scale]; const now = context.currentTime; lanes.forEach((index, lane) => { if (index === null) return; const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = params.waveform; oscillator.frequency.value = 130.81 * 2 ** (intervals[lane] / 12); gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(params.waveform === 'square' ? 0.025 : 0.055, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2); oscillator.connect(gain).connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.22); }); }
function lightKeys(lanes) { document.querySelectorAll('.synth-key').forEach((key, index) => key.classList.toggle('active', lanes[index] !== null && lanes[index] !== undefined)); }

function renderLegend(names, colors) { document.getElementById('legend').innerHTML = names.map((name, index) => `<div class="legend-item"><span class="swatch" style="background:${colors[index]}"></span><span>${index} · ${name}</span></div>`).join(''); }
function figure(caption, content) { const element = document.createElement('figure'); element.append(content); const label = document.createElement('figcaption'); label.textContent = caption; element.append(label); return element; }
function paintDisk(cells, rows, columns, centerRow, centerColumn, radius, state) { for (let row = Math.floor(centerRow - radius); row <= centerRow + radius; row++) for (let column = Math.floor(centerColumn - radius); column <= centerColumn + radius; column++) if (row >= 0 && row < rows && column >= 0 && column < columns && Math.hypot(row - centerRow, column - centerColumn) <= radius) cells[row * columns + column] = state; }
function censusOf(cells, states) { const census = Array(states).fill(0); cells.forEach((state) => census[state]++); return census; }
function xorCount(a, b) { let count = 0; for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) count++; return count; }
function checksum(cells) { let hash = 0x811c9dc5; for (const cell of cells) { hash ^= cell; hash = Math.imul(hash, 0x01000193); } return hash >>> 0; }
function seeded(index, seed) { let value = (index ^ seed) >>> 0; value = Math.imul(value ^ value >>> 16, 0x45d9f3b); value = Math.imul(value ^ value >>> 16, 0x45d9f3b); return ((value ^ value >>> 16) >>> 0) / 4294967296; }
function encodeCells(cells) { let binary = ''; for (const cell of cells) binary += String.fromCharCode(cell); return btoa(binary); }
function drawTrace(values, color) { const canvas = document.getElementById('trace'); const context = canvas.getContext('2d'); const width = canvas.width; const height = canvas.height; context.clearRect(0, 0, width, height); context.strokeStyle = '#283541'; context.lineWidth = 1; for (let y = 1; y < 4; y++) { context.beginPath(); context.moveTo(0, y * height / 4); context.lineTo(width, y * height / 4); context.stroke(); } if (values.length < 2) return; const max = Math.max(1, ...values); context.strokeStyle = color; context.lineWidth = 3; context.beginPath(); values.forEach((value, index) => { const x = index * width / Math.max(1, values.length - 1); const y = height - 8 - value / max * (height - 16); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke(); }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
function escapeHtml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
async function copyText(value, message) { await navigator.clipboard.writeText(value); setText('control-status', message); }
