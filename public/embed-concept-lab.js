// Bare package entrypoints are resolved by the import map on each public demo page.
/* eslint-disable import/no-unresolved */
import '@hexlife/embed';
import {blockRuleFromTable, isConservative, isIsotropic, ruleFromTable} from '@hexlife/embed/ca';
import '@hexlife/embed/ca-element';
/* eslint-enable import/no-unresolved */
import {sealPerimeter} from './embed-concept-boundaries.js';
import {neighborIndex} from './embed-demo-geometry.js';
import {demoOwnershipFor} from './embed-demo-manifest.js';
import {
  AIR,
  EMBER,
  MATERIAL_COLORS,
  MATERIAL_NAMES,
  OIL,
  PLANT,
  SAND,
  STATES as MATTER_STATES,
  STATE_COLORS,
  STONE,
  WATER,
  conservesMaterials,
  materialCensus,
  materialOf,
  matterTransition,
  repairParity,
  seedMatterVessel,
  stateFor,
} from './hex-matter-model.js';

/**
 * The stochastic engine and the analysis primitives are loaded **per demo**, never per page.
 *
 * Nine pages share this module, and a static import is eager: writing `import
 * '@hexlife/embed/stochastic-element'` at the top would put the second Wasm artifact — the whole
 * point of which is that it is separately loaded — onto Crystal Garden, which is a k-state world and
 * will never stochastically anything. So the three stochastic demos and the two analysis demos pull
 * theirs in at dispatch, and every other page requests exactly the bytes it did before.
 *
 * The import map on each page points at the package's **own files** (`/src/embed/*.js`), not at
 * jsDelivr's `/+esm` aliases. That is load-bearing rather than cosmetic: `+esm` re-bundles every
 * subpath entry standalone, so `@hexlife/embed/sim` would get a private copy of `EmbedSim` — its own
 * module state and its own Wasm instance — and the analysis primitives would be inspecting a
 * different engine from the one the elements are running. The raw files keep the package's shared
 * `chunks/`, so all of it is one engine.
 *
 * @type {any} `embed-stochastic-rules.js`'s namespace, once a stochastic demo has asked for it.
 */
let stochastic = null;
/** @type {any} `@hexlife/embed/sim`'s analysis exports, once Butterfly or Synth has asked. */
let analysis = null;

const PACKAGE_VERSION = '1.10.0';
const BUTTERFLY_RULE = 'D5F5EBB9CD2C79E4B3F1F0E6ED1D67A6';
const SYNTH_RULES = {
  spinners: '120C11B442568E21134E30A85A40C880',
  gliders: '12482080480080006880800180010117',
  crystals: '84304E4024A82000162D5CB263E49A49',
};

/**
 * Grid sizes every demo offers.
 *
 * One list for all nine, and **every entry is a multiple of 3**, because Hex Matter runs on the
 * block backend and the three-phase triangular partition seams on any other row count. A per-demo
 * list would let that constraint drift out of sight; a shared one cannot.
 */
const SIZE_PRESETS = [
  [48, '48 rows · compact'],
  [72, '72 rows · standard'],
  [108, '108 rows · large'],
  [162, '162 rows · very large'],
  [216, '216 rows · huge'],
];

/** Brush radii the demos expose. 0 is a single cell; 12 is a comfortable pouring nozzle. */
const BRUSH_MIN = 0;
const BRUSH_MAX = 12;

/**
 * Hex Ecology's full five-species vocabulary; a shorter cycle is simply a prefix of it.
 *
 * Up here rather than beside the ecology functions because the descriptor table below reaches it
 * through `ecologyNames` / `ecologyPalette` *while the module is still evaluating* — the setup call
 * is top-level, so anything it touches has to be initialized before it, and a `const` further down
 * the file is in its temporal dead zone.
 */
const ECOLOGY_SPECIES = [
  ['lichen', '#68d391'],
  ['grazer', '#f6c85f'],
  ['hunter', '#ef7185'],
  ['scavenger', '#7dd3fc'],
  ['blight', '#c084fc'],
];

const concepts = [
  {
    id: 'crystal-garden', href: 'crystal-garden.html', title: 'Crystal Garden',
    kicker: 'Four-state growth laboratory', deck: 'Grow real dendrites, plates or blobs, and sculpt the impurity field they grow through.',
    complexity: '01 · simplest', accent: '#8ad5ff', rgb: '138, 213, 255', kind: 'native',
    surface: '<hexlife-ca> · neighborhood k⁷', topology: 'sealed impurity rim',
    experiment: 'Growth is decided by how many *frozen* neighbours a vapour cell has, and the three geometries are three different answers to how much support is the right amount. Dendritic freezes on an exact count, so tips run ahead of flanks and the crystal branches; faceted adds infilling of concave corners, which flattens the boundary into plates; compact accepts any sufficient support and fills a disk. Impurities are permanent obstacles, so branches deflect and split around them.',
    packageNote: 'A four-state radius-one table is generated from the controls once, then every tick runs in the optimized Wasm k-state engine. Changing a growth control re-installs the table on the crystal you are already watching.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 18, focusState: 1, paintable: true, brush: 1,
    palette: ['#08121a', '#dff5ff', '#5ab9e8', '#735f8d'], names: ['vapor', 'crystal', 'growth front', 'impurity'],
    parameters: [
      range('threshold', 'Frozen neighbours needed', 1, 3, 1, '', {scope: 'rule'}),
      select('geometry', 'Growth geometry', 'dendritic', [['dendritic', 'Dendritic'], ['faceted', 'Faceted'], ['compact', 'Compact']], {scope: 'rule'}),
      range('arms', 'Seed arms', 0, 6, 0, ''),
      range('impurities', 'Impurity density', 0, 8, 2, '%'),
    ],
    actions: [['seed', 'Add satellite seed'], ['ring', 'Add impurity ring'], ['clear', 'Clear interior impurities']],
    rule: crystalRule, seed: seedCrystal, action: crystalAction,
  },
  {
    id: 'hex-ecology', href: 'hex-ecology.html', title: 'Hex Ecology',
    kicker: 'Cyclic spatial ecosystem', deck: 'Run a three-, four- or five-species invasion cycle and intervene in the waves it forms.',
    complexity: '02 · gentle', accent: '#89e49f', rgb: '137, 228, 159', kind: 'native',
    surface: '<hexlife-ca> · census()', topology: 'intentional toroidal habitat',
    experiment: 'Every species is invaded by exactly one other and invades exactly one, closing a cycle of whatever length you choose — three species give the familiar rotating spirals, and five give longer-wavelength travelling bands that take much further to settle. Local invasion creates the fronts; empty refuges interrupt them. Change the cycle length, refuge area or invasion pressure, then paint any species straight onto the habitat while the population census tracks the result.',
    packageNote: 'The neighborhood engine owns the food-web transitions; census() turns the same world into a live population instrument without reading Wasm memory. Five species need k = 6, which the dense k⁷ table now reaches — 273 KB, paid only by a world that asks for it.',
    states: ecologyStates, rows: 72, backend: 'neighborhood', speed: 20, focusState: 2, paintable: true, brush: 3,
    palette: ecologyPalette, names: ecologyNames,
    parameters: [
      range('species', 'Species in the cycle', 3, 5, 3, '', {scope: 'world'}),
      range('pressure', 'Invasion pressure', 1, 4, 2, ' neighbors', {scope: 'rule'}),
      range('refuges', 'Empty refuges', 0, 30, 9, '%'),
      range('bias', 'Founder imbalance', 0, 100, 25, '%'),
    ],
    actions: ecologyActions,
    rule: ecologyRule, seed: seedEcology, action: ecologyAction,
  },
  {
    id: 'excitable-tissue', href: 'excitable-tissue.html', title: 'Excitable Tissue Lab',
    kicker: 'Wave and refractory dynamics', deck: 'See exactly why coherent fronts propagate while isolated sparks fail.',
    complexity: '03 · moderate', accent: '#ff7e9d', rgb: '255, 126, 157', kind: 'native',
    surface: '<hexlife-ca> · excitable medium', topology: 'sealed scar rim',
    experiment: 'Yellow cells are excited for one tick, turn pink and refractory for one tick, then recover to dark resting tissue. Mode 1 lets a single spark transmit, mode 2 requires at least two excited neighbors, and mode 3 is a selective front detector that fires on exactly two—dense clumps suppress themselves instead of exploding. Switching mode re-installs the rule on the wave that is already running, so you can watch the same front change behaviour mid-flight.',
    packageNote: 'The rule deliberately treats all six neighbors equally. Refractory memory is represented as a state, so wave dynamics still execute entirely inside the deterministic k-state engine.',
    states: 4, rows: 72, backend: 'neighborhood', speed: 15, focusState: 1, paintable: true, brush: 2,
    palette: ['#15121c', '#fff08a', '#e44d7d', '#4b5365'], names: ['resting tissue', 'excited', 'refractory', 'scar'],
    parameters: [
      select('threshold', 'Propagation mode', '2', [['1', '1 · Spark-sensitive'], ['2', '2 · Coherent front'], ['3', '3 · Selective front']], {scope: 'rule'}),
      select('stimulus', 'Initial stimulus', 'thick-front', [['thin-front', 'Thin front'], ['thick-front', 'Thick front'], ['broken-wave', 'Broken wave'], ['pacemaker', 'Pacemaker island']]),
      range('width', 'Stimulus thickness', 1, 7, 4, ' cells'),
      range('scars', 'Scar density', 0, 8, 2, '%'),
    ],
    actions: [['front', 'Launch coherent front'], ['pulse', 'Fire central pulse'], ['scar', 'Add scar barrier']],
    rule: tissueRule, seed: seedTissue, action: tissueAction,
  },
  {
    id: 'mixing-chamber', href: 'mixing-chamber.html', title: 'Diffusion & Mixing Chamber',
    kicker: 'Conserved lattice gas', deck: 'Open a finite chamber where particles travel, collide, reflect, and mix.',
    complexity: '04 · moderate', accent: '#d7a7ff', rgb: '215, 167, 255', kind: 'stochastic-gas',
    surface: '<hexlife-stochastic> · conserved lattice gas', topology: 'finite reflecting vessel',
    experiment: 'Every lattice site holds six velocity channels, so a particle carries momentum rather than a hidden direction. Head-on pairs rotate, symmetric triads rotate to the other triad, and everything else streams through — each species conserved particle by particle, not on average. The outer wall removes both wraps; the two gases cannot meet until you open the membrane, or draw your own opening with the brush.',
    packageNote: 'The whole tick is native. A compiled collision table is evaluated once per configuration at build time, the six channels live in Wasm, and the host uploads nothing after the vessel is filled — the membrane and the brush both edit the wall buffer alone.',
    states: 5, rows: 72, speed: 26, focusState: 1, seedName: 'MIXING_SEED', paintable: true, brush: 2, drawState: 4,
    palette: ['#0b1118', '#f0ad5f', '#57c7ff', '#f4f7fb', '#606a78'],
    names: ['vacuum', 'amber molecule', 'cyan molecule', 'both species', 'reflecting wall'],
    parameters: [
      range('density', 'Channel occupancy', 8, 55, 24, '%'),
      range('scatter', 'Thermal scattering', 0, 30, 7, '%', {scope: 'rule'}),
    ],
    actions: [['open', 'Open membrane'], ['restart', 'Close & refill chamber']],
    rule: (params) => stochastic.mixingGasRule(params),
    seedWorld: (world, params) => {
      const {channels, walls} = stochastic.mixingChamber(world.rows, world.columns, params, stochastic.MIXING_SEED);
      world.setInitialGasState(channels, walls);
    },
    intervene: (world) => {
      // The only scripted intervention the vessel has, and it is a wall edit: nothing else moves.
      for (const index of stochastic.mixingMembraneSites(world.rows, world.columns)) world.setWall(index, false);
      return 'Membrane opened — the reservoirs can now exchange particles.';
    },
    invariant: (params) => (params.scatter === 0
      ? 'Momentum-conserving collision table installed; both species are exactly conserved.'
      : `Collision table installed with ${params.scatter}% thermal scattering — species conserved, momentum deliberately not.`),
    metrics: (world) => ({
      change: `${world.collisionCount().toLocaleString()} collisions`,
      checksum: `${world.speciesCount(1).toLocaleString()} / ${world.speciesCount(2).toLocaleString()} particles`,
    }),
  },
  {
    id: 'wildfire-command', href: 'wildfire-command.html', title: 'Wildfire Command',
    kicker: 'Probabilistic fire ecology', deck: 'Shape spread, wind, burn time, ash recovery, and firefighting interventions.',
    complexity: '05 · involved', accent: '#ff8a55', rgb: '255, 138, 85', kind: 'stochastic-neighborhood',
    surface: '<hexlife-stochastic> · compiled HSN1 rule', topology: 'sealed clearing rim',
    experiment: 'Every burning neighbor independently contributes a chance of ignition, so fire spreads naturally even with no wind. Wind boosts only aligned exposure. Trees burn for several ticks, become ash, then regrow after a configurable delay and probability—making repeated fire succession possible rather than ending in a frozen board. Every fire-behaviour control recompiles the rule onto the running fire, so you can turn the wind mid-burn, or cut your own firebreak with the brush.',
    packageNote: 'A counter-based random value keyed by seed, cell, and tick makes every run replayable. The controls compile to a native rule table — 64 integer thresholds indexed by which neighbors are burning — and the whole tick, ages included, runs in Wasm with nothing uploaded per generation.',
    states: 4, rows: 72, speed: 12, focusState: 2, seedName: 'WILDFIRE_SEED', paintable: true, brush: 2, drawState: 0,
    palette: ['#0d1216', '#2f9e56', '#ffcf4d', '#6b5047'], names: ['clearing', 'forest', 'fire', 'ash'],
    parameters: [
      range('forest', 'Forest cover', 45, 95, 78, '%'),
      range('spread', 'Spread per fire neighbor', 2, 55, 18, '%', {scope: 'rule'}),
      select('wind', 'Wind', 'none', [['none', 'No wind'], ['east', 'East'], ['west', 'West'], ['north', 'North'], ['south', 'South']], {scope: 'rule'}),
      range('windBoost', 'Wind multiplier', 1, 4, 2, '×', {scope: 'rule'}),
      range('burnTicks', 'Burn duration', 1, 6, 2, ' ticks', {scope: 'rule'}),
      range('ashTicks', 'Ash recovery delay', 4, 45, 20, ' ticks', {scope: 'rule'}),
      range('regrowth', 'Regrowth chance', 1, 20, 5, '% / tick', {scope: 'rule'}),
    ],
    actions: [['break', 'Cut firebreak'], ['spot', 'Ignite central spot'], ['regrow', 'Force ash regrowth']],
    rule: (params) => stochastic.wildfireStochasticRule(params),
    seedWorld: (world, params) => world.setInitialState(stochastic.wildfireInitialState(world.rows, world.columns, params)),
    intervene: (world, params, action) => {
      // Interventions read the current world out and hand it back once. The ages travel with the
      // cells: a firebreak that quietly reset every burning cell's clock would extend the fire.
      const cells = world.world.snapshotCells();
      const ages = world.world.snapshotElapsedAges();
      if (action === 'break') stochastic.wildfireCutFirebreak(cells, world.rows, world.columns);
      else if (action === 'spot') stochastic.wildfireIgnite(cells, world.rows, world.columns, 'spot');
      else stochastic.wildfireRegrowAsh(cells, ages);
      world.setCells(cells, ages);
      return null;
    },
    invariant: (params) => `Rule compiled: ${params.spread}% per burning neighbor`
      + `${params.wind === 'none' ? ', no wind' : `, ${params.wind} wind ×${params.windBoost}`}`
      + `, ${params.burnTicks}-tick burn, regrowth after ${params.ashTicks}.`,
    metrics: (world) => {
      const census = world.census();
      return {
        change: `${census[3].toLocaleString()} ash`,
        checksum: (world.checksum >>> 0).toString(16).padStart(8, '0'),
      };
    },
  },
  {
    id: 'outbreak-counterfactuals', href: 'outbreak-counterfactuals.html', title: 'Outbreak Counterfactuals',
    kicker: 'Paired probabilistic intervention study', deck: 'Replay the same random exposure schedule with and without vaccination.',
    complexity: '06 · involved', accent: '#65d7d0', rgb: '101, 215, 208', kind: 'stochastic-outbreak',
    surface: '2 × <hexlife-stochastic> · shared exposure stream', topology: 'intentional toroidal population',
    experiment: 'Each infectious neighbor adds an independent infection chance: p = 1 − (1 − x)ⁿ. Both populations use the same seed, initial cases, and cell-by-cell random schedule; only vaccination differs. Duration, waning immunity and efficacy recompile onto both running arms at once, so “cases prevented” stays a genuine counterfactual measurement. This is the one demo with no brush: a stroke would land on one arm only, and two arms differing by anything but the declared policy is not a counterfactual.',
    packageNote: 'The common random numbers are now a property of the engine, not of a host loop: the susceptible and vaccinated rows compile to the same named stream, so the same cell draws the same number in both worlds. Cases prevented is read from native transition counters, and neither world uploads a grid per tick.',
    states: 4, rows: 72, speed: 14, focusState: 1, seedName: 'OUTBREAK_SEED',
    palette: ['#4c94c6', '#ff6577', '#4e5662', '#76d68d'], names: ['susceptible', 'infectious', 'recovered', 'vaccinated'],
    parameters: [
      range('infection', 'Chance per infected neighbor', 1, 40, 12, '%', {scope: 'rule'}),
      range('infectiousTicks', 'Infectious duration', 2, 14, 6, ' ticks', {scope: 'rule'}),
      range('immunityTicks', 'Recovered immunity', 8, 80, 36, ' ticks', {scope: 'rule'}),
      range('coverage', 'Vaccine coverage', 0, 60, 20, '%'),
      range('efficacy', 'Vaccine efficacy', 0, 100, 85, '%', {scope: 'rule'}),
    ],
    actions: [['ring', 'Add vaccination ring'], ['restart', 'Replay counterfactual']],
  },
  {
    id: 'butterfly-microscope', href: 'butterfly-microscope.html', title: 'Butterfly Microscope',
    kicker: 'Paired deterministic experiment', deck: 'Flip one cell — or draw a whole shape — and watch every downstream disagreement glow red.',
    complexity: '07 · advanced', accent: '#ae9cff', rgb: '174, 156, 255', kind: 'butterfly',
    surface: '2 × <hexlife-world> · red XOR overlay',
    experiment: 'Both simulations use the same rule, seed, density, and clock. The right world receives a controlled edit — the perturbation disk, or anything you draw on it — and a red overlay marks the exact cells where the two snapshots disagree. The reference world is deliberately not paintable, so whatever red you see is always the consequence of your edit and nothing else. Paste any valid 32-character HexLife ruleset to compare orderly, chaotic, or insensitive dynamics.',
    packageNote: 'Safe snapshots make the XOR layer and divergence curve exact. A third package renderer displays the binary difference mask without altering either experiment.',
    rows: 72, speed: 9, paintable: true, brush: 1,
  },
  {
    id: 'cellular-synth', href: 'cellular-synth.html', title: 'Cellular Synthesizer',
    kicker: 'Pattern-driven generative instrument', deck: 'Turn sparse spinners, gliders, or crystal growth into an intelligible musical score.',
    complexity: '08 · advanced', accent: '#ff85c8', rgb: '255, 133, 200', kind: 'synth',
    surface: '<hexlife-world> · Web Audio host',
    experiment: 'Only births—cells that were off last beat and on this beat—sound. Horizontal bands select one of eight scale notes; vertical position changes octave. Sparse, structure-forming rules keep the rhythm legible, and the lit keyboard shows exactly which lanes fired. Draw on the score to play it: a stroke is a chord waiting for the next beat.',
    packageNote: 'The package supplies exact single ticks and immutable snapshots. Tempo, scale, waveform, voice limiting, and Web Audio remain clean host concerns.',
    rows: 72, paintable: true, brush: 1,
  },
  {
    id: 'hex-matter', href: 'hex-matter.html', title: 'Hex Matter',
    kicker: 'Eight materials, one hydrostatic lattice', deck: 'Pour liquids that find their level, heap sand that keeps its angle, and set fire to the difference.',
    complexity: '09 · most complex', accent: '#5cc8ff', rgb: '92, 200, 255', kind: 'native',
    surface: '<hexlife-ca> · block k³ · k = 13', topology: 'sealed stone basin',
    experiment: 'Water and oil level themselves, and find the *same* level on both sides of the interior wall once they top it; oil separates out and rides on the water; sand sinks through both and slumps to a real angle of repose instead of puddling. Embers fall like the coals they are, run a front along the slick, and boil what they reach — and the steam they give off condenses on the cold stone and rains back down, which is often what finally puts the fire out. Set Chemistry to "Transport only" to watch the same pour with every reaction switched off.',
    packageNote: 'A liquid levels only if it can take one step to the *same row*, and on a flat-top lattice no two neighbours share a height — so a purely downhill block rule leaves any liquid standing in a 30° cone, whatever you sort it by. The fix is in the state, not in the host: air and both liquids carry their own column parity, which is what lets the k³ table tell that bond from the diagonal one, hand it to liquids, and withhold it from sand. Thirteen states, one table, every tick still inside the Wasm block engine.',
    states: MATTER_STATES, rows: 72, backend: 'block', speed: 22, focusState: WATER, paintable: true, brush: 3,
    alternates: true,
    palette: STATE_COLORS,
    names: MATERIAL_NAMES,
    legendColors: MATERIAL_COLORS,
    stateOf: (material) => stateFor(material, 0),
    fold: materialCensus,
    repair: repairParity,
    invariant: matterInvariant,
    parameters: [
      range('gravity', 'Gravity & flow', 0, 3, 3, '', {scope: 'rule'}),
      select('reactions', 'Chemistry', 'full', [['full', 'Full reactions'], ['no-fire', 'No combustion'], ['transport', 'Transport only']], {scope: 'rule'}),
    ],
    actions: [['rain', 'Rain water'], ['sand', 'Pour sand'], ['oil', 'Pour oil'], ['ignite', 'Light the fuel'], ['garden', 'Plant the shore'], ['clear', 'Empty the basin']],
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

if (config.kind === 'native') {
  setupNativeLab(config);
} else if (config.kind === 'stochastic-gas' || config.kind === 'stochastic-neighborhood') {
  stochastic = await loadStochastic();
  setupStochasticLab(config);
} else if (config.kind === 'stochastic-outbreak') {
  stochastic = await loadStochastic();
  setupOutbreak(config);
} else if (config.kind === 'butterfly') {
  analysis = await loadAnalysis();
  setupButterfly(config);
} else if (config.kind === 'synth') {
  analysis = await loadAnalysis();
  setupSynth(config);
}

/** The rules module and the element registration — the only two things that pull the second artifact. */
async function loadStochastic() {
  const [rules] = await Promise.all([
    import('./embed-stochastic-rules.js'),
    // eslint-disable-next-line import/no-unresolved
    import('@hexlife/embed/stochastic-element'),
  ]);
  return rules;
}

// eslint-disable-next-line import/no-unresolved
async function loadAnalysis() { return import('@hexlife/embed/sim'); }

/**
 * A model parameter.
 *
 * `scope` is the whole point of the descriptor and the reason it is data rather than a closure. It
 * says what a change to this control actually *is*:
 *
 * - `'rule'` — a different transition table over the same world. Installed on the running world; the
 *   cells, the generation and whatever you have been watching for two minutes all survive.
 * - `'seed'` — part of the authored generation zero. There is no way to apply it to a world that has
 *   already moved on, so it reseeds. The default, because it is the safe answer.
 * - `'world'` — a different world *shape* (Hex Ecology's `k`). Reboots the element.
 * - `'live'` — a host-side setting the engine never sees at all.
 */
function range(id, label, min, max, value, suffix, {step = 1, scope = 'seed'} = {}) {
  return {id, label, type: 'range', min, max, value, suffix, step, scope};
}
function select(id, label, value, options, {scope = 'seed'} = {}) {
  return {id, label, type: 'select', value, options, scope};
}

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

/**
 * The control panel: model parameters, then the stage controls every demo shares.
 *
 * Speed, world size and brush are deliberately a *separate* group from the model parameters. They
 * are not part of any model — nothing above them changes what is being simulated, only how fast, how
 * much of it, and how wide your finger is — and mixing the two would make "which of these resets my
 * world" unguessable.
 */
function renderControls(item, {playLabel = 'Play', copyLabel = 'Copy exact world', stage = {}} = {}) {
  const controls = document.getElementById('controls');
  const paintable = Boolean(item.paintable);
  // The state picker exists only where a stroke paints a *value*. On `<hexlife-world>` the brush
  // inverts, so there is nothing to pick and offering a list would be a lie about what it does.
  const paintsValues = paintable && Boolean(item.names);
  controls.innerHTML = `<h2>Experiment controls</h2><div class="control-stack"><div class="control-row"><button class="primary" id="play">${playLabel}</button><button id="step">Step</button><button id="reset">Reset</button></div>
    <div class="parameter-grid">${(item.parameters || []).map(parameterHtml).join('')}</div>
    ${paintsValues ? `<div class="field"><label for="paint-state">Material brush</label><select id="paint-state">${paintOptions(item, valuesFromControls(item.parameters || []))}</select><small>Drag directly on the world to paint.</small></div>` : ''}
    ${paintable && !paintsValues ? '<p class="concept-status">Drag on the world to flip cells; the brush radius is below.</p>' : ''}
    ${item.actions ? `<div class="field"><label for="action-choice">Intervention</label><select id="action-choice">${actionOptions(item, valuesFromControls(item.parameters || []))}</select></div>` : ''}
    <div class="control-row two"><button id="action">Apply intervention</button><button id="copy">${copyLabel}</button></div>
    <div class="stage-set"><h3>Stage</h3><div class="parameter-grid">
      ${stage.speed === false ? '' : `<div class="field"><div class="field-head"><label for="stage-speed">Simulation speed</label><output id="output-stage-speed">${item.speed}/s</output></div><input id="stage-speed" type="range" min="1" max="120" step="1" value="${item.speed}"></div>`}
      ${stage.size === false ? '' : `<div class="field"><label for="stage-size">World size</label><select id="stage-size">${SIZE_PRESETS.map(([rows, label]) => `<option value="${rows}"${rows === item.rows ? ' selected' : ''}>${label}</option>`).join('')}</select><small>Changing the size rebuilds the world from its authored start.</small></div>`}
      ${paintable ? `<div class="field"><div class="field-head"><label for="stage-brush">Brush radius</label><output id="output-stage-brush">${item.brush} cells</output></div><input id="stage-brush" type="range" min="${BRUSH_MIN}" max="${BRUSH_MAX}" step="1" value="${item.brush}"></div>` : ''}
    </div></div></div><p class="concept-status" id="control-status" aria-live="polite">Preparing the exact initial state…</p>`;
  return {
    params: valuesFromControls(item.parameters || []),
    stage: {speed: item.speed, rows: item.rows, brush: item.brush},
  };
}

/**
 * The brush list.
 *
 * `names` is the demo's *vocabulary*, which is not always its state list: Hex Matter's eight
 * materials are spread over thirteen engine states, so `stateOf` maps an entry back to the state a
 * stroke should actually write.
 */
function paintOptions(item, params) {
  const stateOf = item.stateOf ?? ((index) => index);
  return resolve(item.names, params).map((name, index) => `<option value="${stateOf(index)}"${index === (item.drawState ?? 1) ? ' selected' : ''}>${index} · ${name}</option>`).join('');
}

function actionOptions(item, params) {
  return resolve(item.actions, params).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

/** A descriptor field that may be authored as a value or as a function of the current parameters. */
function resolve(value, params) {
  return typeof value === 'function' ? value(params) : value;
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

/**
 * Wire the three stage controls. Each handler is optional; a demo that cannot honour one simply
 * does not render it (see `renderControls`), so there is nothing to bind.
 */
function bindStageControls(stage, {onSpeed, onRows, onBrush} = {}) {
  const speed = document.getElementById('stage-speed');
  if (speed && onSpeed) {
    speed.addEventListener('input', (event) => setText('output-stage-speed', `${event.target.value}/s`));
    speed.addEventListener('change', (event) => {
      stage.speed = Number(event.target.value);
      setText('output-stage-speed', `${stage.speed}/s`);
      onSpeed(stage.speed);
    });
  }
  const size = document.getElementById('stage-size');
  if (size && onRows) {
    size.addEventListener('change', (event) => {
      stage.rows = Number(event.target.value);
      onRows(stage.rows);
    });
  }
  const brush = document.getElementById('stage-brush');
  if (brush && onBrush) {
    brush.addEventListener('input', (event) => setText('output-stage-brush', `${event.target.value} cells`));
    brush.addEventListener('change', (event) => {
      stage.brush = Number(event.target.value);
      setText('output-stage-brush', `${stage.brush} cells`);
      onBrush(stage.brush);
    });
  }
}

/**
 * Set attributes, reporting whether any of them actually moved.
 *
 * The return value is what makes a size change safe to drive from one place: a changed structural
 * attribute reboots the element, and the reboot's `ready` event re-installs the model — so the caller
 * must *not* also install it, or it installs into a world that is about to be thrown away. An
 * unchanged one fires no callback at all, and then the caller has to do the work itself.
 */
function applyAttributes(element, attributes) {
  let changed = false;
  for (const [name, value] of Object.entries(attributes)) {
    if (element.getAttribute(name) === String(value)) continue;
    element.setAttribute(name, String(value));
    changed = true;
  }
  return changed;
}

function createCaElement(item, stage, {draw = false} = {}) {
  const world = document.createElement('hexlife-ca');
  for (const [name, value] of Object.entries({
    states: resolve(item.states, valuesFromControls(item.parameters || [])),
    rows: stage.rows,
    backend: item.backend,
    speed: stage.speed,
    palette: resolve(item.palette, valuesFromControls(item.parameters || [])).join(','),
    paused: '',
    link: 'off',
  })) world.setAttribute(name, String(value));
  if (draw) {
    world.setAttribute('draw', '');
    // `drawState` names a vocabulary entry, which is the state itself everywhere but Hex Matter.
    world.setAttribute('draw-state', String((item.stateOf ?? ((index) => index))(item.drawState ?? 1)));
    world.setAttribute('brush', String(stage.brush));
  }
  return world;
}

/**
 * A `<hexlife-stochastic>` for one of the stochastic labs.
 *
 * The seed is assigned before the element is connected, so it is simply the seed the first world is
 * built with rather than a reboot. It is the *demo's* seed, not the element's default: these pages
 * publish specific runs, and `RNG_LEGACY_DEMO_V0` reproduces one only from the seed it was recorded
 * with. Rules arrive from script once the world is up — they are far too large for an attribute.
 */
function createStochasticElement(item, stage, {draw = false} = {}) {
  const world = document.createElement('hexlife-stochastic');
  world.seed = BigInt(stochastic[item.seedName]);
  for (const [name, value] of Object.entries({rows: stage.rows, speed: stage.speed, palette: item.palette.join(','), paused: '', link: 'off'})) world.setAttribute(name, String(value));
  if (draw) {
    world.setAttribute('draw', '');
    world.setAttribute('draw-state', String(item.drawState ?? 1));
    world.setAttribute('brush', String(stage.brush));
  }
  return world;
}

function setupNativeLab(item) {
  const {params, stage} = renderControls(item);
  refreshStateVocabulary(item, params);
  const world = createCaElement(item, stage, {draw: item.paintable});
  document.getElementById('world-mount').append(world);
  const trace = [];
  let ready = false;
  let lastGeneration = -1;

  // NOT `{once: true}`: a world-size or species change reboots the element, and the rebuilt world
  // arrives with no rule and no cells. This event is the only signal that it is ready for them.
  world.addEventListener('hexlife-ca-ready', () => {
    ready = true;
    // The up-triangle partition is left-handed — its odd slot always sits one column the same way —
    // which biases sideways transport. Any demo that lets material move has to cancel that, or a
    // pour leans downhill to one side of the screen for no reason in the model at all.
    if (item.alternates) world.world.setBlockAlternates(true);
    installModel();
    setText('stage-status', `${item.backend} · k = ${world.states} · ${world.rows} × ${world.columns} · ${item.topology}`);
    update();
  });
  world.addEventListener('hexlife-ca-playstate', (event) => setText('play', event.detail.userPaused ? 'Play' : 'Pause'));
  document.getElementById('play').addEventListener('click', () => { if (ready) world.userPaused ? world.play() : world.pause(); });
  document.getElementById('step').addEventListener('click', () => { if (ready) { world.pause(); world.tick(1); update(); } });
  document.getElementById('reset').addEventListener('click', () => { if (ready) { world.pause(); installModel(); update(); } });
  document.getElementById('action').addEventListener('click', () => {
    if (!ready) return;
    // An intervention may report back — "there was nothing here to light" is worth saying.
    const note = item.action(world, params, document.getElementById('action-choice').value);
    setText('control-status', note || `Intervention applied at generation ${world.generation}.`);
    update();
  });
  document.getElementById('copy').addEventListener('click', async () => { if (ready) await copyText(await world.caCode(), 'Exact HXK1 world copied.'); });
  if (item.paintable) document.getElementById('paint-state').addEventListener('change', (event) => world.setAttribute('draw-state', event.target.value));
  // A model whose states encode where a cell *is* has to survive the brush, which paints one fixed
  // state value into both column parities. The rule votes its way through a stroke in progress;
  // this puts the field back the moment the stroke ends. Pointer events cross the shadow root, so
  // listening on the element itself is enough, and `setCell` keeps the activity tracker awake.
  if (item.repair) {
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      world.addEventListener(type, () => {
        if (!ready || !world.world) return;
        const cells = world.world.snapshotCells();
        for (const index of item.repair(cells, world.columns)) world.world.setCell(index, cells[index]);
      });
    }
  }

  bindParameterControls(item, params, (parameter) => {
    if (!ready) return;
    if (parameter.scope === 'rule') {
      // The whole point: a new table over the world that is already running.
      installModel({reseed: false});
      setText('control-status', `${parameter.label} re-installed on the running world at generation ${world.generation} — nothing was reset.`);
    } else if (parameter.scope === 'world') {
      reshapeWorld(parameter);
    } else {
      world.pause();
      installModel();
    }
    update();
  });
  bindStageControls(stage, {
    onSpeed: (speed) => world.setAttribute('speed', String(speed)),
    onRows: (rows) => rebootTo({rows: String(rows)}, `World rebuilt at ${rows} rows.`),
    onBrush: (brush) => world.setAttribute('brush', String(brush)),
  });
  window.setInterval(update, 160);

  /** A `'world'`-scoped parameter: a different `k`, so a different world. Ecology's species count. */
  function reshapeWorld(parameter) {
    refreshStateVocabulary(item, params);
    rebootTo({
      states: String(resolve(item.states, params)),
      palette: resolve(item.palette, params).join(','),
    }, `${parameter.label} changed — the habitat was rebuilt to hold them.`);
  }

  function rebootTo(attributes, message) {
    ready = false;
    if (applyAttributes(world, attributes)) setText('control-status', message);
    else { installModel(); update(); ready = true; }
  }

  /**
   * @param {{reseed?: boolean}} options `reseed: false` installs the rule alone, which is what makes
   *   a `'rule'`-scoped control a change to the running world rather than a restart of it.
   */
  function installModel({reseed = true} = {}) {
    const rule = item.rule(params);
    world.setRule(rule);
    if (reseed) {
      world.setCells(item.seed(world.rows, world.columns, params));
      trace.length = 0;
      lastGeneration = -1;
      const blockInvariant = item.invariant ?? ((states, table) => `${isConservative(states, table) ? 'conservative' : 'reactive'} · ${isIsotropic(states, table) ? 'isotropic' : 'directional'}`);
      const invariant = item.backend === 'block' ? blockInvariant(world.states, rule) : 'six-neighbor radius 1';
      setText('control-status', `Model rebuilt from controls: ${invariant}. Paint or run when ready.`);
    }
  }
  function update() {
    if (!ready || !world.world) return;
    // `fold` collapses engine states back onto the demo's vocabulary where the two differ.
    const census = item.fold ? item.fold(world.census()) : world.census();
    setText('metric-generation', world.generation.toLocaleString());
    setText('metric-focus', (census[item.focusState] || 0).toLocaleString());
    setText('metric-change', world.world.lastChangedCount.toLocaleString());
    setText('metric-checksum', (world.checksum >>> 0).toString(16).padStart(8, '0'));
    if (world.generation !== lastGeneration) { trace.push(census[item.focusState] || 0); if (trace.length > 90) trace.shift(); drawTrace(trace, item.accent); lastGeneration = world.generation; }
  }
}

/** Legend, focus label, brush options and intervention list, for a demo whose `k` can change. */
function refreshStateVocabulary(item, params) {
  const names = resolve(item.names, params);
  renderLegend(names, item.legendColors ?? resolve(item.palette, params));
  setText('metric-focus-label', names[item.focusState] || 'Active');
  const paint = document.getElementById('paint-state');
  if (paint) {
    const previous = paint.value;
    paint.innerHTML = paintOptions(item, params);
    // Keep the brush pointed at the same material when there still is one; a shorter cycle can
    // retire the state that was selected, and a `draw-state` past `k` would clamp silently.
    if ([...paint.options].some((option) => option.value === previous)) paint.value = previous;
    document.querySelector('hexlife-ca')?.setAttribute('draw-state', paint.value);
  }
  const actions = document.getElementById('action-choice');
  if (actions) {
    const previous = actions.value;
    actions.innerHTML = actionOptions(item, params);
    if ([...actions.options].some((option) => option.value === previous)) actions.value = previous;
  }
}

/**
 * The single-world stochastic labs: Mixing Chamber (lattice gas) and Wildfire Command.
 *
 * Structurally the same shape as `setupNativeLab`, and for the same reason — there is no host model
 * left to drive. The element owns the clock, the engine owns the state, and the page's only per-tick
 * job is reading four numbers out for the instrument panel on its own throttle.
 */
function setupStochasticLab(item) {
  const {params, stage} = renderControls(item);
  renderLegend(item.names, item.palette);
  setText('metric-focus-label', item.names[item.focusState]);
  const world = createStochasticElement(item, stage, {draw: item.paintable});
  document.getElementById('world-mount').append(world);
  const trace = [];
  let ready = false;
  let lastGeneration = -1;

  // Not `{once: true}` — a size change reboots the element, and a rebooted stochastic world has
  // dropped its rule as well as its cells, because the rule came from script.
  world.addEventListener('hexlife-stochastic-ready', () => {
    ready = true;
    installModel();
    setText('stage-status', `${world.backend} · ${world.rows} × ${world.columns} · ${item.topology}`);
    update();
  });
  world.addEventListener('hexlife-stochastic-playstate', (event) => setText('play', event.detail.userPaused ? 'Play' : 'Pause'));
  document.getElementById('play').addEventListener('click', () => { if (ready) world.userPaused ? world.play() : world.pause(); });
  document.getElementById('step').addEventListener('click', () => { if (ready) { world.pause(); world.tick(1); update(); } });
  document.getElementById('reset').addEventListener('click', () => { if (ready) { world.pause(); installModel(); update(); } });
  document.getElementById('action').addEventListener('click', () => {
    if (!ready) return;
    const action = document.getElementById('action-choice').value;
    if (action === 'restart') { world.pause(); installModel(); update(); return; }
    const message = item.intervene(world, params, action);
    setText('control-status', message || `${document.getElementById('action-choice').selectedOptions[0].textContent} applied at generation ${world.generation}.`);
    update();
  });
  document.getElementById('copy').addEventListener('click', async () => { if (ready) await copyText(await world.stochasticCode(), 'Exact HXS1 world copied — seed, generation and all.'); });
  if (item.paintable) document.getElementById('paint-state').addEventListener('change', (event) => world.setAttribute('draw-state', event.target.value));

  bindParameterControls(item, params, (parameter) => {
    if (!ready) return;
    if (parameter.scope === 'rule') {
      // A recompiled table on the running fire (or gas): the cells and their ages carry on.
      world.setRule(item.rule(params));
      setText('control-status', `${item.invariant(params)} Applied at generation ${world.generation} — nothing was reset.`);
    } else {
      world.pause();
      installModel();
    }
    update();
  });
  bindStageControls(stage, {
    onSpeed: (speed) => world.setAttribute('speed', String(speed)),
    onRows: (rows) => {
      ready = false;
      if (!applyAttributes(world, {rows: String(rows)})) { ready = true; installModel(); update(); }
      else setText('control-status', `World rebuilt at ${rows} rows.`);
    },
    onBrush: (brush) => world.setAttribute('brush', String(brush)),
  });
  window.setInterval(update, 160);

  function installModel() {
    // The rule first: an HSG1 table switches the world onto the gas backend, so the seeding call
    // below has to happen after it or it would fill a neighborhood world's buffers.
    world.setRule(item.rule(params));
    item.seedWorld(world, params);
    trace.length = 0;
    lastGeneration = -1;
    setText('control-status', item.invariant(params));
  }

  function update() {
    if (!ready || !world.world) return;
    const census = world.census();
    const metrics = item.metrics(world);
    setText('metric-generation', world.generation.toLocaleString());
    setText('metric-focus', census[item.focusState].toLocaleString());
    setText('metric-change', metrics.change);
    setText('metric-checksum', metrics.checksum);
    if (world.generation !== lastGeneration) { trace.push(census[item.focusState]); if (trace.length > 90) trace.shift(); drawTrace(trace, item.accent); lastGeneration = world.generation; }
  }
}

/**
 * Outbreak Counterfactuals: two native worlds, one clock.
 *
 * The one place a host clock is kept deliberately. Each element can pace itself, but two elements
 * pacing themselves would drift — one scrolls offscreen and pauses, the other does not — and a
 * counterfactual whose arms are at different generations is not a counterfactual. So both worlds
 * stay `paused` and a single interval ticks them together. It schedules; it does not simulate.
 *
 * The common random numbers are no longer arranged by the host at all: both infection rows compile
 * to the same named stream, so the same cell draws the same number in both worlds by construction.
 *
 * No brush here, and that is a design decision rather than an omission — a stroke lands on one arm,
 * and two arms differing by anything other than the declared policy are not a counterfactual.
 */
function setupOutbreak(item) {
  const {params, stage} = renderControls(item, {copyLabel: 'Copy comparison snapshot'});
  renderLegend(item.names, item.palette);
  setText('metric-focus-label', 'Cases prevented');
  const mount = document.getElementById('world-mount');
  mount.innerHTML = '<div class="dual-worlds" id="dual"></div>';
  const left = createStochasticElement(item, stage); const right = createStochasticElement(item, stage);
  document.getElementById('dual').append(figure('No vaccine', left), figure('Vaccination policy', right));
  let running = false; let timer = 0; let ready = 0; const trace = [];
  const onReady = () => {
    if (++ready !== 2) return;
    running = true;
    restart();
    setText('stage-status', `Same seed · same compiled exposure stream · ${left.rows} × ${left.columns} · policy is the only difference`);
  };
  left.addEventListener('hexlife-stochastic-ready', onReady);
  right.addEventListener('hexlife-stochastic-ready', onReady);
  document.getElementById('play').addEventListener('click', () => timer ? stop() : start());
  document.getElementById('step').addEventListener('click', tick);
  document.getElementById('reset').addEventListener('click', restart);
  document.getElementById('action').addEventListener('click', () => {
    if (!running) return;
    if (document.getElementById('action-choice').value === 'restart') { restart(); return; }
    // The ring is an intervention on the policy world only: read out, edit, hand back once, with
    // the ages carried across so nobody's infectious clock restarts.
    const cells = right.world.snapshotCells();
    const ages = right.world.snapshotElapsedAges();
    right.setCells(stochastic.outbreakVaccinateRing(cells, right.rows, right.columns), ages);
    update();
    setText('control-status', 'Vaccination ring added only to the policy world.');
  });
  document.getElementById('copy').addEventListener('click', async () => {
    if (!running) return;
    await copyText(JSON.stringify({
      demo: item.id, generation: left.generation, params,
      baseline: await left.stochasticCode(), intervention: await right.stochasticCode(),
    }), 'Paired HXS1 comparison copied — both arms resume exactly where they are.');
  });

  bindParameterControls(item, params, (parameter) => {
    if (!running) return;
    if (parameter.scope === 'rule') {
      // Both arms, one table: they share the exposure stream, so they must share the rule too.
      const rule = stochastic.outbreakStochasticRule(params);
      left.setRule(rule); right.setRule(rule);
      setText('control-status', `${parameter.label} recompiled onto both arms at generation ${left.generation} — the study continues.`);
      update();
    } else {
      restart();
    }
  });
  bindStageControls(stage, {
    onSpeed: () => { if (timer) { stop(); start(); } },
    onRows: (rows) => {
      // Both arms reboot; `onReady` counts to two again and replays the counterfactual.
      ready = 0; running = false; stop();
      const changed = applyAttributes(left, {rows: String(rows)}) | applyAttributes(right, {rows: String(rows)});
      if (changed) setText('control-status', `Both populations rebuilt at ${rows} rows.`);
      else { ready = 2; running = true; restart(); }
    },
  });

  function start() { if (!running) return; timer = window.setInterval(tick, 1000 / stage.speed); setText('play', 'Pause'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Play'); }
  function restart() {
    if (!running) return;
    stop();
    const rule = stochastic.outbreakStochasticRule(params);
    left.setRule(rule); right.setRule(rule);
    left.setInitialState(stochastic.outbreakInitialState(left.rows, left.columns, params, {intervention: false}));
    right.setInitialState(stochastic.outbreakInitialState(right.rows, right.columns, params, {intervention: true}));
    trace.length = 0;
    setText('control-status', 'Counterfactual replayed from identical initial cases and the same compiled stream.');
    update();
  }
  function tick() { if (!running) return; left.tick(1); right.tick(1); update(); }
  function update() {
    if (!running || !left.world || !right.world) return;
    const leftCensus = left.census(); const rightCensus = right.census();
    const prevented = infections(left) - infections(right);
    // One bounded scalar crosses the boundary; the full-grid comparison stays inside Wasm.
    const differences = left.world.differenceCount(right.world);
    trace.push(Math.max(0, prevented)); if (trace.length > 90) trace.shift();
    setText('metric-generation', left.generation); setText('metric-focus', prevented);
    setText('metric-change', `${differences.toLocaleString()} cells`);
    setText('metric-checksum', `${leftCensus[1]} vs ${rightCensus[1]} infectious`);
    drawTrace(trace, item.accent);
  }
  /** Cumulative infections, straight off the engine's per-row transition counters. */
  function infections(world) {
    const counts = world.world.transitionCounts();
    return stochastic.OUTBREAK_INFECTION_ROWS.reduce((sum, row) => sum + (counts[row] || 0), 0);
  }
}

function setupButterfly(item) {
  item.parameters = [range('radius', 'Perturbation radius', 0, 4, 0, ' cells')];
  const {params, stage} = renderControls(item);
  document.querySelector('.parameter-grid').insertAdjacentHTML('beforeend', `<div class="field field-wide"><label for="custom-rule">Custom 32-character ruleset</label><input id="custom-rule" class="text-input mono" value="${BUTTERFLY_RULE}" maxlength="32" spellcheck="false"><small id="rule-help">Paste a HexLife binary rule, then Apply rule.</small></div>`);
  document.getElementById('action').textContent = 'Apply rule';
  renderLegend(['same in both worlds', 'perturbed world', 'difference (red overlay)'], ['#748399', item.accent, '#ff304f']);
  const mount = document.getElementById('world-mount'); mount.innerHTML = '<div class="dual-worlds" id="dual"></div>';
  const left = binaryWorld(BUTTERFLY_RULE, 0.34, 13579, stage);
  // Only the perturbed world takes a brush. Painting the reference too would make "red = the
  // consequence of your edit" false, which is the entire claim this instrument makes.
  const right = binaryWorld(BUTTERFLY_RULE, 0.34, 13579, stage, {draw: true});
  const rightStack = document.createElement('div'); rightStack.className = 'difference-stack'; rightStack.append(right);
  const diff = document.createElement('hexlife-ca');
  for (const [key, value] of Object.entries({states: 2, rows: stage.rows, backend: 'block', palette: '#000000,#ff304f', paused: '', link: 'off'})) diff.setAttribute(key, String(value));
  diff.className = 'difference-overlay'; rightStack.append(diff);
  document.getElementById('dual').append(figure('Reference', left), figure('Perturbed + red XOR', rightStack));
  let ready = 0; let timer = 0; const trace = []; let mask = null;
  const onReady = () => {
    if (++ready !== 3) return;
    diff.setRule(blockRuleFromTable(2, (block) => block));
    // One persistent native mask over the two worlds. It compares them inside Wasm and writes the
    // result straight into the display world's own buffer, so the difference never becomes a
    // JavaScript array and nothing crosses the boundary to show it. Rebuilt on a size change,
    // because its buffer is sized to the worlds it was constructed for.
    if (mask) mask.dispose();
    mask = new analysis.DifferenceMask(left.sim.numCells);
    resetPair();
    setText('stage-status', `Red = exact snapshot disagreement · ${left.sim.rows} × ${left.sim.cols}`);
  };
  // Not `{once: true}`: all three elements reboot when the world size changes.
  left.addEventListener('hexlife-ready', onReady); right.addEventListener('hexlife-ready', onReady); diff.addEventListener('hexlife-ca-ready', onReady);
  document.getElementById('play').addEventListener('click', () => timer ? stop() : start()); document.getElementById('step').addEventListener('click', step);
  document.getElementById('reset').addEventListener('click', resetPair);
  document.getElementById('action').addEventListener('click', () => {
    const hex = document.getElementById('custom-rule').value.trim().toUpperCase();
    if (!/^[0-9A-F]{32}$/.test(hex)) { setText('rule-help', 'A ruleset must contain exactly 32 hexadecimal characters.'); return; }
    left.setAttribute('ruleset', hex); right.setAttribute('ruleset', hex); setText('rule-help', 'Rule accepted. Both worlds reset before the perturbation.'); window.setTimeout(resetPair, 0);
  });
  document.getElementById('copy').addEventListener('click', async () => ready >= 3 && copyText(await right.worldCode(), 'Perturbed HXW1 world copied.'));
  bindParameterControls(item, params, resetPair);
  bindStageControls(stage, {
    onSpeed: () => { if (timer) { stop(); start(); } },
    onRows: (rows) => {
      stop();
      ready = 0;
      const changed = [left, right, diff].map((element) => applyAttributes(element, {rows: String(rows)})).some(Boolean);
      if (changed) setText('control-status', `Both worlds and the difference layer rebuilt at ${rows} rows.`);
      else { ready = 3; resetPair(); }
    },
    onBrush: (brush) => right.setAttribute('brush', String(brush)),
  });
  function start() { if (ready < 3) return; timer = window.setInterval(step, 1000 / stage.speed); setText('play', 'Pause'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Play'); }
  function resetPair() { if (ready < 3) return; stop(); left.reset(); right.reset(); perturb(right, params.radius); trace.length = 0; setText('control-status', 'Exactly one controlled edit is active; red cells are its downstream consequences. Draw on the right world to make a bigger one.'); update(); }
  function step() { if (ready < 3) return; left.tick(1); right.tick(1); update(); }
  function update() {
    if (ready < 3 || !mask) return;
    const count = mask.compareInto(left.sim, right.sim, diff.world);
    // The mask was written inside wasm, so the element has no idea its cells changed.
    diff.redraw();
    trace.push(count); if (trace.length > 90) trace.shift();
    setText('metric-generation', left.tickCount); setText('metric-focus-label', 'Divergent cells'); setText('metric-focus', count.toLocaleString()); setText('metric-change', `${(count / left.sim.numCells * 100).toFixed(1)}%`); setText('metric-checksum', count ? 'diverged' : 'identical'); drawTrace(trace, '#ff304f');
  }
}

function setupSynth(item) {
  item.parameters = [
    range('tempo', 'Tempo', 45, 220, 110, ' BPM', {scope: 'live'}),
    range('density', 'Starting density', 2, 22, 8, '%'),
    select('rule', 'Pattern engine', 'spinners', [['spinners', 'Spinners / oscillators'], ['gliders', 'Spontaneous gliders'], ['crystals', 'Organic crystals']]),
    select('scale', 'Scale', 'minor', [['minor', 'Minor pentatonic'], ['major', 'Major'], ['whole', 'Whole tone']], {scope: 'live'}),
    select('waveform', 'Voice', 'triangle', [['triangle', 'Triangle'], ['sine', 'Sine'], ['square', 'Soft square']], {scope: 'live'}),
  ];
  // Tempo *is* this instrument's speed; a second control for the same number would be a trap.
  const {params, stage} = renderControls(item, {playLabel: 'Start audio', stage: {speed: false}});
  document.getElementById('action').textContent = 'New deterministic score';
  document.querySelector('.control-stack').insertAdjacentHTML('beforeend', '<div class="synth-keyboard" id="keyboard" aria-label="Eight pitch lanes"></div>');
  document.getElementById('keyboard').innerHTML = Array.from({length: 8}, (_, index) => `<span class="synth-key"><small>${index + 1}</small></span>`).join('');
  renderLegend(['birth = note', 'horizontal = pitch lane', 'vertical = octave'], [item.accent, '#73d49c', '#f4be63']);
  let scoreSeed = 13579;
  const world = binaryWorld(SYNTH_RULES[params.rule], params.density / 100, scoreSeed, stage, {draw: true});
  document.getElementById('world-mount').append(world);
  let context = null; let timer = 0; let meter = null; const trace = [];
  // Not `{once: true}`: every structural change — rule, density, seed, size — rebuilds the element's
  // `EmbedSim`, and the meter points at the wasm world that one owns.
  world.addEventListener('hexlife-ready', () => {
    attachMeter();
    trace.length = 0;
    setText('stage-status', `Sparse structure rule · ${world.sim.rows} × ${world.sim.cols} · audio requires a click`);
    setText('control-status', 'Births light their pitch lane. Draw a chord, then start audio or step silently.');
    update();
  });
  document.getElementById('play').addEventListener('click', () => timer ? stop() : start()); document.getElementById('step').addEventListener('click', () => musicalTick(Boolean(context)));
  document.getElementById('reset').addEventListener('click', resetScore); document.getElementById('action').addEventListener('click', () => { scoreSeed += 7919; resetScore(); });
  document.getElementById('copy').addEventListener('click', async () => copyText(await world.worldCode(), 'Exact visual score copied as HXW1.'));
  bindParameterControls(item, params, (parameter) => {
    if (parameter.scope === 'live') { if (parameter.id === 'tempo' && timer) { stop(); start(); } return; }
    resetScore();
  });
  bindStageControls(stage, {
    onRows: (rows) => { if (!applyAttributes(world, {rows: String(rows)})) resetScore(); },
    onBrush: (brush) => world.setAttribute('brush', String(brush)),
  });
  function start() { if (!world.sim) return; context ||= new AudioContext(); context.resume(); timer = window.setInterval(() => musicalTick(true), 60000 / params.tempo); setText('play', 'Stop audio'); }
  function stop() { window.clearInterval(timer); timer = 0; setText('play', 'Start audio'); }
  /**
   * Bind the native lane meter to whichever world the element currently owns.
   *
   * Rebound rather than kept: changing the rule, the density or the size is a structural attribute
   * change, so the element rebuilds its `EmbedSim` and with it the wasm world the meter points at.
   */
  function attachMeter() { if (meter) meter.dispose(); meter = world.sim ? new analysis.BirthLaneMeter(world.sim) : null; }
  function resetScore() {
    if (!world.sim) return;
    stop();
    const changed = applyAttributes(world, {
      ruleset: SYNTH_RULES[params.rule],
      density: String(params.density / 100),
      seed: String(scoreSeed),
    });
    // A changed structural attribute reboots the element and `hexlife-ready` finishes the job. With
    // nothing changed there is no reboot and therefore no event, so do it here instead.
    if (!changed) { world.reset(scoreSeed); attachMeter(); trace.length = 0; update(); }
  }
  function musicalTick(sound) {
    if (!world.sim || !meter) return;
    world.tick(1);
    // One native scan of the tick that just happened. The engine already holds the previous
    // generation in its own back buffer, so this owns no per-cell storage and copies no grid — it
    // reports at most eight counts and eight representative indices.
    const births = meter.sample(world.sim);
    const lanes = Array.from(meter.representatives, (index) => (index < 0 ? null : index));
    if (sound && context) playLanes(context, lanes, params);
    trace.push(births); if (trace.length > 90) trace.shift();
    update(births, lanes);
  }
  function update(births = 0, lanes = []) { if (!world.sim) return; setText('metric-generation', world.tickCount); setText('metric-focus-label', 'Births this beat'); setText('metric-focus', births); setText('metric-change', `${lanes.filter((index) => index !== null).length} pitch lanes`); setText('metric-checksum', (world.checksum >>> 0).toString(16).padStart(8, '0')); drawTrace(trace, item.accent); lightKeys(lanes); }
}

function binaryWorld(ruleset, density = 0.12, seed = 13579, stage = {rows: 72, brush: 1}, {draw = false} = {}) {
  const world = document.createElement('hexlife-world');
  for (const [name, value] of Object.entries({ruleset, rows: stage.rows, seed, density, speed: 18, palette: 'monochrome', paused: '', link: 'off'})) world.setAttribute(name, String(value));
  if (draw) { world.setAttribute('draw', ''); world.setAttribute('brush', String(stage.brush)); }
  return world;
}
function perturb(world, radius) { const cells = world.sim.snapshotCells(); const columns = world.sim.cols; const rows = cells.length / columns; const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2); const edits = []; for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { const index = row * columns + column; if (Math.hypot(row - rows / 2, column - columns / 2) <= radius + 0.3) edits.push({index, value: cells[index] ^ 1}); } if (radius === 0) edits.push({index: center, value: cells[center] ^ 1}); world.sim.setCells(edits); }

/**
 * Crystal Garden's growth law.
 *
 * States: 0 vapour, 1 crystal, 2 growth front (crystal one tick old), 3 impurity. Only vapour ever
 * changes, and it changes on a **count of frozen neighbours** — which is where the morphology comes
 * from. `dendritic` freezes on an exact count, so a tip with one frozen neighbour advances while a
 * flank with two does not, and the boundary destabilizes into branches (Packard's snowflake rule at
 * `threshold = 1`). `faceted` adds the infill of concave corners, which stabilizes the boundary back
 * into flat hexagonal plates. `compact` accepts any sufficient support and grows the disk that the
 * demo used to be. Impurities are permanent, so growth routes around them and branches split.
 */
function crystalRule(params) {
  const need = Number(params.threshold);
  return ruleFromTable(4, (center, neighbors) => {
    if (center === 1 || center === 3) return center;
    if (center === 2) return 1;
    let frozen = 0;
    for (const state of neighbors) if (state === 1 || state === 2) frozen++;
    if (frozen === 0) return 0;
    const grows = params.geometry === 'compact' ? frozen >= need
      : params.geometry === 'faceted' ? (frozen === need || frozen >= 4)
        : frozen === need;
    return grows ? 2 : 0;
  });
}
function seedCrystal(rows, columns, params) { const cells = new Uint8Array(rows * columns); for (let index = 0; index < cells.length; index++) if (seeded(index, 0xc7a57a1) < params.impurities / 100) cells[index] = 3; const center = Math.floor(rows / 2) * columns + Math.floor(columns / 2); cells[center] = 1; for (let direction = 0; direction < params.arms; direction++) { let index = center; for (let length = 0; length < 4; length++) { index = neighborIndex(index, direction, rows, columns, false); if (index >= 0) cells[index] = 1; } } return sealPerimeter(cells, rows, columns, 3); }
function crystalAction(world, params, action) { const cells = world.world.snapshotCells(); if (action === 'clear') { for (let r = 2; r < world.rows - 2; r++) for (let c = 2; c < world.columns - 2; c++) if (cells[r * world.columns + c] === 3) cells[r * world.columns + c] = 0; } else { const rr = Math.floor(world.rows * 0.31); const cc = Math.floor(world.columns * 0.68); const radius = action === 'ring' ? 7 : 2; for (let r = rr - radius - 1; r <= rr + radius + 1; r++) for (let c = cc - radius - 1; c <= cc + radius + 1; c++) { const distance = Math.hypot(r - rr, c - cc); if (action === 'ring' ? Math.abs(distance - radius) < 1 : distance <= radius) cells[r * world.columns + c] = action === 'ring' ? 3 : 1; } } world.setCells(cells); }

// --- Hex Ecology -------------------------------------------------------------------------------
// The cycle length is a control, so `k`, the palette, the names and the intervention list are all
// derived from it rather than written down. `species + 1` states: one per species, plus the refuge.

function ecologySpecies(params) { return Math.max(3, Math.min(ECOLOGY_SPECIES.length, Number(params.species) || 3)); }
function ecologyStates(params) { return ecologySpecies(params) + 1; }
function ecologyNames(params) { return ['empty refuge', ...ECOLOGY_SPECIES.slice(0, ecologySpecies(params)).map(([name]) => name)]; }
function ecologyPalette(params) { return ['#0a1116', ...ECOLOGY_SPECIES.slice(0, ecologySpecies(params)).map(([, color]) => color)]; }
function ecologyActions(params) {
  return [
    ...ECOLOGY_SPECIES.slice(0, ecologySpecies(params)).map(([name], index) => [String(index + 1), `Add ${name} patch`]),
    ['0', 'Excavate refuge'],
  ];
}

/**
 * Cyclic dominance over `n` species: species `s` is invaded by `s + 1`, and species `n` by species 1.
 *
 * At `n = 3` this is exactly the rock-paper-scissors ecology the demo always ran. Longer cycles are
 * the interesting part: with five species a front has to travel four invasions to come back round,
 * so the spirals stretch into long travelling bands that take far longer to settle.
 */
function ecologyRule(params) {
  const n = ecologySpecies(params);
  const k = n + 1;
  return ruleFromTable(k, (center, neighbors) => {
    const counts = new Array(k).fill(0);
    for (const state of neighbors) counts[state]++;
    if (center === 0) {
      let best = 1;
      for (let species = 2; species <= n; species++) if (counts[species] > counts[best]) best = species;
      return counts[best] >= params.pressure + 1 ? best : 0;
    }
    const predator = (center % n) + 1;
    return counts[predator] >= params.pressure ? predator : center;
  });
}

function seedEcology(rows, columns, params) {
  const n = ecologySpecies(params);
  const cells = new Uint8Array(rows * columns);
  // Founder imbalance as a geometric ramp rather than one weight slider per species: it means the
  // same control keeps working when the cycle gets longer. 0% is an even mix.
  const ratio = 1 - params.bias / 110;
  const weights = Array.from({length: n}, (_, index) => ratio ** index);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < cells.length; index++) {
    if (seeded(index, 0xec0109) < params.refuges / 100) continue;
    let roll = seeded(index, 0xec0117) * total;
    let species = 1;
    while (species < n && roll >= weights[species - 1]) { roll -= weights[species - 1]; species++; }
    cells[index] = species;
  }
  return cells;
}

function ecologyAction(world, params, action) { const state = Number(action); const cells = world.world.snapshotCells(); const centerRow = Math.floor(world.rows * (0.25 + seeded(world.generation, 91) * 0.5)); const centerColumn = Math.floor(world.columns * (0.25 + seeded(world.generation, 97) * 0.5)); const radius = Math.max(4, Math.round(world.rows / 14)); for (let r = centerRow - radius; r <= centerRow + radius; r++) for (let c = centerColumn - radius; c <= centerColumn + radius; c++) if (Math.hypot(r - centerRow, c - centerColumn) <= radius) cells[((r + world.rows) % world.rows) * world.columns + ((c + world.columns) % world.columns)] = state; world.setCells(cells); }

function tissueRule(params) { return ruleFromTable(4, (center, neighbors) => { if (center === 3) return 3; if (center === 1) return 2; if (center === 2) return 0; const excited = neighbors.filter((state) => state === 1).length; const mode = Number(params.threshold); return mode === 1 ? (excited >= 1 ? 1 : 0) : mode === 2 ? (excited >= 2 ? 1 : 0) : (excited === 2 ? 1 : 0); }); }
function seedTissue(rows, columns, params) { const cells = new Uint8Array(rows * columns); for (let index = 0; index < cells.length; index++) if (seeded(index, 0x71550e) < params.scars / 100) cells[index] = 3; sealPerimeter(cells, rows, columns, 3); const width = params.stimulus === 'thin-front' ? 1 : params.width; if (params.stimulus === 'pacemaker') paintDisk(cells, rows, columns, rows / 2, columns / 2, Math.max(2, width), 1); else { for (let r = 3; r < rows - 3; r++) for (let c = 3; c < 3 + width; c++) if (params.stimulus !== 'broken-wave' || r < rows * 0.43 || r > rows * 0.58) cells[r * columns + c] = 1; } return cells; }
function tissueAction(world, params, action) { const cells = world.world.snapshotCells(); if (action === 'pulse') paintDisk(cells, world.rows, world.columns, world.rows / 2, world.columns / 2, Math.max(2, params.width), 1); else if (action === 'scar') { const column = Math.floor(world.columns * 0.63); for (let row = 8; row < world.rows - 8; row++) if (row < world.rows * 0.46 || row > world.rows * 0.55) cells[row * world.columns + column] = 3; } else for (let row = 3; row < world.rows - 3; row++) for (let column = 3; column < 3 + params.width; column++) cells[row * world.columns + column] = 1; world.setCells(cells); }

/**
 * Hex Matter's rule, seed and interventions.
 *
 * The physics itself lives in `hex-matter-model.js`, package-free, so `tests/hexMatter.test.js` can
 * run the whole sandbox against a port of the engine's own block partition and assert what the
 * material *does* — that a pool levels, that a heap does not — rather than what the source says.
 */
function matterRule(params) { return blockRuleFromTable(MATTER_STATES, (block) => matterTransition(block, params)); }

/**
 * The invariant line under the stage.
 *
 * `isConservative` is the wrong question here twice over: the reactions genuinely are not
 * conservative, and even pure transport moves a liquid between the two column sublattices, so the
 * per-*state* census cannot hold whatever the rule does. What the table can claim is that transport
 * alone only ever moves materials around, and that is the claim worth printing.
 */
function matterInvariant(states, rule) {
  const unpack = (packed) => [Math.floor(packed / (states * states)), Math.floor(packed / states) % states, packed % states];
  for (let index = 0; index < rule.length; index++) {
    if (!conservesMaterials(unpack(index), unpack(rule[index]))) return 'reactive · directional';
  }
  return 'material-conserving · directional';
}
function seedMatter(rows, columns) { return seedMatterVessel(rows, columns, seeded); }
/**
 * The interventions. Every one of them writes through `stateFor`, so the sublattice survives — that
 * is the one thing a host of this model may not get wrong.
 */
function matterAction(world, params, action) {
  const {rows, columns} = world;
  const cells = world.world.snapshotCells();
  const put = (row, column, material) => { cells[row * columns + column] = stateFor(material, column); };
  const at = (row, column) => materialOf(cells[row * columns + column]);

  if (action === 'clear') {
    for (let row = 2; row < rows - 2; row++) {
      for (let column = 2; column < columns - 2; column++) if (at(row, column) !== STONE) put(row, column, AIR);
    }
  } else if (action === 'ignite') {
    // Into the fuel that is already there. A spark dropped in clear air is out in three ticks —
    // that is the model being right about sparks, so lighting the air would light nothing at all.
    let lit = 0;
    for (let index = 0; index < cells.length; index++) {
      const material = materialOf(cells[index]);
      if (material !== OIL && material !== PLANT) continue;
      if (seeded(index, world.generation * 31 + 977) > 0.05) continue;
      put(Math.floor(index / columns), index % columns, EMBER);
      lit++;
    }
    if (!lit) return 'Nothing to light — pour some oil or plant the shore first.';
  } else if (action === 'garden') {
    // Rooted on whatever surface it grows from, because a plant does not fall.
    for (let column = Math.floor(columns * 0.55); column < columns - 3; column++) {
      let surface = -1;
      for (let row = 3; row < rows - 2 && surface < 0; row++) {
        if (at(row, column) === STONE || at(row, column) === SAND) surface = row;
      }
      if (surface < 8) continue;
      for (let row = surface - 5; row < surface; row++) if (at(row, column) === AIR) put(row, column, PLANT);
    }
  } else {
    const material = {rain: WATER, sand: SAND, oil: OIL}[action];
    for (let row = 3; row < 11; row++) {
      for (let column = Math.floor(columns * 0.12); column < columns * 0.88; column++) {
        if (at(row, column) !== AIR) continue;
        if (seeded(row * columns + column, world.generation * 7 + material * 101) < 0.55) put(row, column, material);
      }
    }
  }
  world.setCells(cells);
  return null;
}

// `laneBirths` lived here until the meter moved into Wasm. The native lane index is the same
// expression in integer arithmetic — `(index % cols) * 8 / cols`, clamped — and the representative
// is still the first birth in scan order, so the score is unchanged.
function playLanes(context, lanes, params) { const intervals = {minor: [0, 3, 5, 7, 10, 12, 15, 17], major: [0, 2, 4, 5, 7, 9, 11, 12], whole: [0, 2, 4, 6, 8, 10, 12, 14]}[params.scale]; const now = context.currentTime; lanes.forEach((index, lane) => { if (index === null) return; const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = params.waveform; oscillator.frequency.value = 130.81 * 2 ** (intervals[lane] / 12); gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(params.waveform === 'square' ? 0.025 : 0.055, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2); oscillator.connect(gain).connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.22); }); }
function lightKeys(lanes) { document.querySelectorAll('.synth-key').forEach((key, index) => key.classList.toggle('active', lanes[index] !== null && lanes[index] !== undefined)); }

function renderLegend(names, colors) { document.getElementById('legend').innerHTML = names.map((name, index) => `<div class="legend-item"><span class="swatch" style="background:${colors[index]}"></span><span>${index} · ${name}</span></div>`).join(''); }
function figure(caption, content) { const element = document.createElement('figure'); element.append(content); const label = document.createElement('figcaption'); label.textContent = caption; element.append(label); return element; }
function paintDisk(cells, rows, columns, centerRow, centerColumn, radius, state) { for (let row = Math.floor(centerRow - radius); row <= centerRow + radius; row++) for (let column = Math.floor(centerColumn - radius); column <= centerColumn + radius; column++) if (row >= 0 && row < rows && column >= 0 && column < columns && Math.hypot(row - centerRow, column - centerColumn) <= radius) cells[row * columns + column] = state; }
function seeded(index, seed) { let value = (index ^ seed) >>> 0; value = Math.imul(value ^ value >>> 16, 0x45d9f3b); value = Math.imul(value ^ value >>> 16, 0x45d9f3b); return ((value ^ value >>> 16) >>> 0) / 4294967296; }
function drawTrace(values, color) { const canvas = document.getElementById('trace'); const context = canvas.getContext('2d'); const width = canvas.width; const height = canvas.height; context.clearRect(0, 0, width, height); context.strokeStyle = '#283541'; context.lineWidth = 1; for (let y = 1; y < 4; y++) { context.beginPath(); context.moveTo(0, y * height / 4); context.lineTo(width, y * height / 4); context.stroke(); } if (values.length < 2) return; const max = Math.max(1, ...values); context.strokeStyle = color; context.lineWidth = 3; context.beginPath(); values.forEach((value, index) => { const x = index * width / Math.max(1, values.length - 1); const y = height - 8 - value / max * (height - 16); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke(); }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
function escapeHtml(value) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
async function copyText(value, message) { await navigator.clipboard.writeText(value); setText('control-status', message); }
