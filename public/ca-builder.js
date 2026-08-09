// Browser import maps resolve the two bare package entrypoints; Vite deliberately leaves this
// public-file demo untouched so its deployed bytes are the npm-consumer example.
/* eslint-disable import/no-unresolved */
import {
  blockRuleFromTable,
  initEngine,
  isConservative,
  isIsotropic,
  packBlock,
  ruleFromTable,
  unpackBlock,
} from "@hexlife/embed/ca";
import "@hexlife/embed/ca-element";
/* eslint-enable import/no-unresolved */
import {
  CA_PRESETS,
  caPreset,
  seedCaPreset,
  standaloneRuleSource,
} from "./ca-builder-models.js";
import { buildHexMirror } from "./coffee-percolation-physics.js";

const PACKAGE_VERSION = "1.7.0";
const NEIGHBOR_LABELS = ["SW", "NW", "N", "NE", "SE", "S"];
const BLOCK_LABELS = ["top", "down-right", "below"];

const byId = (id) => document.getElementById(id);
const ui = {
  preset: byId("preset"),
  description: byId("preset-description"),
  backend: byId("backend"),
  states: byId("states"),
  rows: byId("rows"),
  speed: byId("speed"),
  geometry: byId("geometry-note"),
  rebuild: byId("rebuild"),
  stateEditor: byId("state-editor"),
  world: byId("world"),
  status: byId("world-status"),
  play: byId("play"),
  step: byId("step"),
  reset: byId("reset"),
  reseed: byId("reseed"),
  clear: byId("clear"),
  generation: byId("generation"),
  dimensions: byId("dimensions"),
  chunks: byId("chunks"),
  ruleSize: byId("rule-size"),
  census: byId("census"),
  ruleHelp: byId("rule-help"),
  inputs: byId("transition-inputs"),
  outputs: byId("transition-outputs"),
  applyTransition: byId("apply-transition"),
  undoTransition: byId("undo-transition"),
  transitionIndex: byId("transition-index"),
  invariant: byId("invariant"),
  conservative: byId("conservative"),
  isotropic: byId("isotropic"),
  generated: byId("generated-code"),
  copyCode: byId("copy-code"),
  downloadCode: byId("download-code"),
  copyWorld: byId("copy-code-world"),
  toast: byId("toast"),
};

let project = caPreset("coffee-six");
let stateNames = [...project.stateNames];
let palette = [...project.palette];
let baseRule = null;
let rule = null;
let inputSelects = [];
let outputSelects = [];
let seed = 0xc0ffee;
let installing = false;
let appliedConfig = null;
let modelRunning = false;
let modelTickParity = 0;
let quietTicks = 0;
let mirrorMap = null;
let mirrorScratch = null;
const overrides = new Map();

for (const preset of CA_PRESETS) {
  const option = document.createElement("option");
  option.value = preset.id;
  option.textContent = preset.name;
  ui.preset.append(option);
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ui.toast.classList.remove("show"), 1800);
}

function setWorkbenchEnabled(enabled) {
  for (const control of [
    ui.applyTransition,
    ui.play,
    ui.step,
    ui.reset,
    ui.reseed,
    ui.clear,
    ui.copyCode,
    ui.downloadCode,
    ui.copyWorld,
  ]) {
    control.disabled = !enabled;
  }
  for (const control of ui.stateEditor.querySelectorAll("input")) {
    control.disabled = !enabled;
  }
  for (const control of document.querySelectorAll(
    "#transition-inputs select, #transition-outputs select",
  )) {
    control.disabled = !enabled;
  }
  ui.undoTransition.disabled = !enabled || overrides.size === 0;
}

function markConfigurationDirty() {
  modelRunning = false;
  setWorkbenchEnabled(false);
  ui.status.textContent = "configuration changed · rebuild to apply";
  renderStats();
}

function normalizedConfig() {
  const backend = ui.backend.value;
  const maximum = backend === "block" ? 16 : 4;
  const states = Number(ui.states.value);
  const rows = Number(ui.rows.value);
  const speed = Number(ui.speed.value);
  if (!Number.isInteger(states) || states < 2 || states > maximum) {
    throw new RangeError(`${backend} mode needs 2–${maximum} states.`);
  }
  if (!Number.isInteger(rows) || rows < 6 || rows > 512) {
    throw new RangeError("Rows must be an integer from 6 to 512.");
  }
  if (backend === "block" && rows % 3 !== 0) {
    throw new RangeError(
      `Block rows must be divisible by 3; use ${rows - (rows % 3)} or ${rows + (3 - (rows % 3))}.`,
    );
  }
  if (!Number.isFinite(speed) || speed < 1 || speed > 120) {
    throw new RangeError("Speed must be from 1 to 120 ticks per second.");
  }
  return { backend, states, rows, speed };
}

function showGeometryNote() {
  const block = ui.backend.value === "block";
  ui.states.max = block ? "16" : "4";
  ui.rows.step = block ? "3" : "1";
  ui.geometry.innerHTML = block
    ? "<b>Block:</b> rows must be divisible by 3; the element derives an even column count so all three triangular partitions wrap without seams."
    : "<b>Neighborhood:</b> centre + six canonical hex neighbours. The dense k⁷ table caps this backend at k = 4.";
}

function fitStateMetadata(states) {
  const fallback = [
    "#11161c",
    "#55b7ff",
    "#ffb454",
    "#d8dee9",
    "#d46a6a",
    "#8b7cf6",
  ];
  while (stateNames.length < states)
    stateNames.push(`state ${stateNames.length}`);
  while (palette.length < states)
    palette.push(fallback[palette.length % fallback.length]);
  stateNames.length = states;
  palette.length = states;
}

function stateOption(state) {
  const option = document.createElement("option");
  option.value = String(state);
  option.textContent = `${state} · ${stateNames[state]}`;
  return option;
}

function renderStateEditor() {
  ui.stateEditor.replaceChildren();
  stateNames.forEach((name, state) => {
    const row = document.createElement("div");
    row.className = "state-row";
    const draw = document.createElement("input");
    draw.type = "radio";
    draw.name = "draw-state";
    draw.checked = Number(ui.world.getAttribute("draw-state")) === state;
    draw.setAttribute("aria-label", `Draw ${name}`);
    draw.addEventListener("change", () =>
      ui.world.setAttribute("draw-state", String(state)),
    );
    const colour = document.createElement("input");
    colour.type = "color";
    colour.value = palette[state];
    colour.setAttribute("aria-label", `${name} colour`);
    colour.addEventListener("input", () => {
      palette[state] = colour.value;
      ui.world.setAttribute("palette", palette.join(","));
      renderCensus();
      renderGeneratedCode();
    });
    const label = document.createElement("input");
    label.type = "text";
    label.value = name;
    label.setAttribute("aria-label", `State ${state} name`);
    label.addEventListener("change", () => {
      stateNames[state] = label.value.trim() || `state ${state}`;
      renderTransitionEditor();
      renderCensus();
    });
    row.append(draw, colour, label);
    ui.stateEditor.append(row);
  });
}

function activeTransition(config) {
  if (config.backend === project.backend && config.states === project.states)
    return project.transition;
  return config.backend === "block" ? (block) => block : (centre) => centre;
}

function materializeRule(config) {
  const transition = activeTransition(config);
  return config.backend === "block"
    ? blockRuleFromTable(config.states, transition)
    : ruleFromTable(config.states, transition);
}

function selectFor(label, states) {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const select = document.createElement("select");
  for (let state = 0; state < states; state++)
    select.append(stateOption(state));
  wrapper.append(select);
  return { wrapper, select };
}

function transitionIndex() {
  const { backend, states } = normalizedConfig();
  if (backend === "block") {
    return inputSelects.reduce(
      (index, select) => index * states + Number(select.value),
      0,
    );
  }
  const centre = Number(inputSelects[0].value);
  let index = centre * states ** 6;
  for (let slot = 0; slot < 6; slot++)
    index += Number(inputSelects[slot + 1].value) * states ** slot;
  return index;
}

function readTransition() {
  if (!rule) return;
  const { backend, states } = normalizedConfig();
  const index = transitionIndex();
  const values =
    backend === "block" ? unpackBlock(states, rule[index]) : [rule[index]];
  values.forEach((value, slot) => {
    outputSelects[slot].value = String(value);
  });
  ui.transitionIndex.textContent =
    backend === "block"
      ? `table[${index}] · ordered triangle, not a square-grid 2×2 block`
      : `table[${index}] · centre occupies the k⁶ place; neighbour slot j occupies kʲ`;
}

function renderTransitionEditor() {
  let config;
  try {
    config = normalizedConfig();
  } catch {
    return;
  }
  inputSelects = [];
  outputSelects = [];
  ui.inputs.replaceChildren();
  ui.outputs.replaceChildren();
  const inputLabels =
    config.backend === "block" ? BLOCK_LABELS : ["centre", ...NEIGHBOR_LABELS];
  const outputLabels =
    config.backend === "block" ? BLOCK_LABELS : ["new centre"];
  ui.ruleHelp.textContent =
    config.backend === "block"
      ? "Choose one ordered partition triangle and its replacement. The engine visits a different perfect triangle partition on each phase."
      : "Choose the centre and all six neighbours. Slot order is the package’s canonical odd-q hex order, shared with the Wasm engine.";
  for (const label of inputLabels) {
    const field = selectFor(label, config.states);
    field.select.addEventListener("change", readTransition);
    inputSelects.push(field.select);
    ui.inputs.append(field.wrapper);
  }
  for (const label of outputLabels) {
    const field = selectFor(label, config.states);
    outputSelects.push(field.select);
    ui.outputs.append(field.wrapper);
  }
  readTransition();
}

function setCheck(element, value, trueLabel = "yes", falseLabel = "no") {
  element.className = value == null ? "" : value ? "pass" : "fail";
  element.textContent =
    value == null ? "not applicable" : value ? trueLabel : falseLabel;
}

function checkPresetInvariant(config) {
  if (
    !project.invariant ||
    project.backend !== config.backend ||
    project.states !== config.states
  )
    return null;
  for (let index = 0; index < config.states ** 3; index++) {
    const input = [
      Math.floor(index / config.states ** 2),
      Math.floor(index / config.states) % config.states,
      index % config.states,
    ];
    if (!project.invariant(input, unpackBlock(config.states, rule[index])))
      return false;
  }
  return true;
}

function renderChecks() {
  if (!rule) return;
  const config = normalizedConfig();
  const invariant = checkPresetInvariant(config);
  setCheck(
    ui.invariant,
    invariant,
    project.invariantLabel ? `preserves ${project.invariantLabel}` : "passes",
    "broken by this table",
  );
  if (config.backend === "block") {
    setCheck(ui.conservative, isConservative(config.states, rule));
    setCheck(ui.isotropic, isIsotropic(config.states, rule));
  } else {
    setCheck(ui.conservative, null);
    setCheck(ui.isotropic, null);
  }
}

function installWorld() {
  if (installing || !ui.world.world) return;
  installing = true;
  try {
    const config = normalizedConfig();
    baseRule = materializeRule(config);
    rule = baseRule.slice();
    overrides.clear();
    appliedConfig = { ...config };
    modelRunning = false;
    modelTickParity = 0;
    quietTicks = 0;
    mirrorMap = null;
    mirrorScratch = null;
    setWorkbenchEnabled(true);
    ui.world.setAttribute("palette", palette.join(","));
    ui.world.setRule(rule);
    ui.world.setCells(
      seedCaPreset(project.id, ui.world.rows, ui.world.columns, seed),
    );
    ui.world.tick(0);
    ui.status.textContent = "ready · Wasm WorldK · WebGL2 shader";
    renderTransitionEditor();
    renderChecks();
    renderStats();
    renderGeneratedCode();
  } catch (error) {
    ui.status.textContent = error.message;
  } finally {
    installing = false;
  }
}

function rebuildWorld() {
  let config;
  try {
    config = normalizedConfig();
    ui.status.textContent = "rebuilding…";
    modelRunning = false;
    setWorkbenchEnabled(false);
  } catch (error) {
    ui.status.textContent = error.message;
    return;
  }
  fitStateMetadata(config.states);
  renderStateEditor();
  const before = `${ui.world.getAttribute("states")}/${ui.world.getAttribute("rows")}/${ui.world.getAttribute("backend")}`;
  ui.world.setAttribute("states", String(config.states));
  ui.world.setAttribute("rows", String(config.rows));
  ui.world.setAttribute("backend", config.backend);
  ui.world.setAttribute("speed", String(config.speed));
  ui.world.setAttribute("palette", palette.join(","));
  const after = `${config.states}/${config.rows}/${config.backend}`;
  if (before === after && ui.world.world) installWorld();
}

function loadPreset(id) {
  project = caPreset(id);
  stateNames = [...project.stateNames];
  palette = [...project.palette];
  ui.preset.value = project.id;
  ui.description.textContent = project.description;
  ui.backend.value = project.backend;
  ui.states.value = String(project.states);
  ui.rows.value = String(project.rows);
  ui.speed.value = String(project.speed);
  showGeometryNote();
  rebuildWorld();
}

function renderCensus() {
  const counts = ui.world.census();
  if (!counts) return;
  ui.census.replaceChildren();
  counts.forEach((count, state) => {
    const item = document.createElement("div");
    item.className = "census-item";
    item.style.setProperty("--swatch", palette[state]);
    const name = document.createElement("span");
    name.textContent = `${state} · ${stateNames[state]}`;
    const value = document.createElement("strong");
    value.textContent = count.toLocaleString();
    item.append(name, value);
    ui.census.append(item);
  });
}

function usesMirroredCoffeeClock() {
  return (
    project.id.startsWith("coffee-") &&
    appliedConfig?.backend === project.backend &&
    appliedConfig?.states === project.states
  );
}

function reflectWorld() {
  const world = ui.world.world;
  if (!world) return;
  if (!mirrorMap || mirrorMap.length !== world.numCells) {
    mirrorMap = buildHexMirror(world.rows, world.columns);
    mirrorScratch = new Uint8Array(world.numCells);
  }
  const state = world.state;
  for (let index = 0; index < state.length; index++) {
    mirrorScratch[mirrorMap[index]] = state[index];
  }
  state.set(mirrorScratch);
  world.markAllDirty();
}

function advanceModelTick() {
  const world = ui.world.world;
  if (!world) return 0;
  const mirrored = usesMirroredCoffeeClock() && modelTickParity % 2 === 1;
  if (mirrored) reflectWorld();
  const changed = world.tick(1);
  if (mirrored) reflectWorld();
  modelTickParity++;
  quietTicks = changed === 0 ? quietTicks + 1 : 0;
  const settled = usesMirroredCoffeeClock() ? quietTicks >= 6 : world.isSettled;
  if (settled) {
    modelRunning = false;
    ui.status.textContent = `settled at generation ${world.generation.toLocaleString()}`;
  }
  return changed;
}

function renderStats() {
  if (!ui.world.world) return;
  ui.generation.textContent = ui.world.generation.toLocaleString();
  ui.dimensions.textContent = `${ui.world.rows} × ${ui.world.columns}`;
  const chunks = ui.world.chunkActivity;
  ui.chunks.textContent = chunks ? `${chunks.active} / ${chunks.total}` : "—";
  ui.ruleSize.textContent = rule
    ? `${rule.length.toLocaleString()} entries`
    : "—";
  ui.play.textContent = modelRunning ? "Pause" : "Run";
  renderCensus();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function generatedHtml() {
  const config = normalizedConfig();
  const matchingPreset =
    config.backend === project.backend && config.states === project.states;
  const sourceId = matchingPreset
    ? project.id
    : config.backend === "block"
      ? "blank-block"
      : "blank-neighborhood";
  const imports =
    config.backend === "block"
      ? "initEngine, blockRuleFromTable"
      : "initEngine, ruleFromTable";
  const tableOverrides = [...overrides]
    .map(([index, value]) => `rule[${index}] = ${value};`)
    .join("\n");
  const cells =
    ui.world.world?.snapshotCells() ||
    seedCaPreset(project.id, ui.world.rows, ui.world.columns, seed);
  const cellData = bytesToBase64(cells);
  const ruleSource = standaloneRuleSource(sourceId).replaceAll(
    "STATES",
    String(config.states),
  );
  const clockSource = sourceId.startsWith("coffee-")
    ? `${buildHexMirror.toString()}
const mirror = buildHexMirror(ca.rows, ca.columns);
const scratch = new Uint8Array(ca.rows * ca.columns);
function reflect() {
  const state = ca.world.state;
  for (let index = 0; index < state.length; index++) scratch[mirror[index]] = state[index];
  state.set(scratch);
  ca.world.markAllDirty();
}
let tick = 0;
let lastTime = performance.now();
let carry = 0;
function frame(now) {
  carry += Math.min(250, now - lastTime) * ${config.speed} / 1000;
  lastTime = now;
  const count = Math.min(8, Math.floor(carry));
  carry -= count;
  for (let step = 0; step < count; step++, tick++) {
    const mirrored = tick % 2 === 1;
    if (mirrored) reflect();
    ca.world.tick(1);
    if (mirrored) reflect();
  }
  if (count) ca.tick(0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`
    : "ca.play();";
  return `<!doctype html>
<meta charset="utf-8">
<title>${project.name} · HexLife CA</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0e12; }
  hexlife-ca { width: min(92vmin, 760px); }
</style>
<script type="importmap">
{"imports":{"@hexlife/embed/ca":"https://cdn.jsdelivr.net/npm/@hexlife/embed@${PACKAGE_VERSION}/ca/+esm","@hexlife/embed/ca-element":"https://cdn.jsdelivr.net/npm/@hexlife/embed@${PACKAGE_VERSION}/ca-element/+esm"}}
</script>
<hexlife-ca states="${config.states}" rows="${config.rows}" backend="${config.backend}" speed="${config.speed}"
  palette="${palette.join(",")}" paused draw draw-state="1"></hexlife-ca>
<script type="module">
import {${imports}} from '@hexlife/embed/ca';
import '@hexlife/embed/ca-element';

await initEngine();
${ruleSource}
${tableOverrides}

const ca = document.querySelector('hexlife-ca');
if (!ca.world) await new Promise((resolve, reject) => {
  ca.addEventListener('hexlife-ca-ready', resolve, {once: true});
  ca.addEventListener('hexlife-ca-error', (event) => reject(Error(event.detail.message)), {once: true});
});
const cells = Uint8Array.from(atob('${cellData}'), (character) => character.charCodeAt(0));
ca.setRule(rule);
ca.setCells(cells);
${clockSource}
</script>`;
}

function renderGeneratedCode() {
  if (!rule || !ui.world.world) return;
  ui.generated.textContent = generatedHtml();
}

async function copyText(text, message) {
  await navigator.clipboard.writeText(text);
  toast(message);
}

ui.world.addEventListener("hexlife-ca-ready", installWorld);
ui.world.addEventListener("hexlife-ca-error", (event) => {
  modelRunning = false;
  ui.status.textContent = event.detail.message;
});

ui.preset.addEventListener("change", () => loadPreset(ui.preset.value));
ui.backend.addEventListener("change", () => {
  showGeometryNote();
  markConfigurationDirty();
});
for (const control of [ui.states, ui.rows, ui.speed]) {
  control.addEventListener("input", markConfigurationDirty);
}
ui.rebuild.addEventListener("click", rebuildWorld);
ui.applyTransition.addEventListener("click", () => {
  if (!rule || ui.applyTransition.disabled) return;
  const config = normalizedConfig();
  const index = transitionIndex();
  const value =
    config.backend === "block"
      ? packBlock(
          config.states,
          outputSelects.map((select) => Number(select.value)),
        )
      : Number(outputSelects[0].value);
  rule[index] = value;
  overrides.set(index, value);
  ui.world.setRule(rule);
  ui.undoTransition.disabled = false;
  readTransition();
  renderChecks();
  renderGeneratedCode();
  toast(`Wrote table entry ${index}`);
});
ui.undoTransition.addEventListener("click", () => {
  rule = baseRule.slice();
  overrides.clear();
  ui.world.setRule(rule);
  ui.undoTransition.disabled = true;
  readTransition();
  renderChecks();
  renderGeneratedCode();
});
ui.play.addEventListener("click", () => {
  modelRunning = !modelRunning;
  quietTicks = 0;
  ui.status.textContent = modelRunning
    ? usesMirroredCoffeeClock()
      ? "running · alternating triangle handedness"
      : "running · native Wasm ticks"
    : "paused · Wasm WorldK · WebGL2 shader";
  renderStats();
});
ui.step.addEventListener("click", () => {
  advanceModelTick();
  ui.world.tick(0);
  renderStats();
  renderGeneratedCode();
});
ui.reset.addEventListener("click", () => {
  modelRunning = false;
  modelTickParity = 0;
  quietTicks = 0;
  ui.world.reset();
  renderStats();
  renderGeneratedCode();
});
ui.reseed.addEventListener("click", () => {
  modelRunning = false;
  modelTickParity = 0;
  quietTicks = 0;
  seed = (seed + 0x9e3779b9) >>> 0;
  ui.world.setCells(
    seedCaPreset(project.id, ui.world.rows, ui.world.columns, seed),
  );
  ui.world.tick(0);
  renderStats();
  renderGeneratedCode();
});
ui.clear.addEventListener("click", () => {
  modelRunning = false;
  modelTickParity = 0;
  quietTicks = 0;
  ui.world.clear();
  renderStats();
  renderGeneratedCode();
});
ui.copyCode.addEventListener("click", () =>
  copyText(generatedHtml(), "Standalone HTML copied"),
);
ui.downloadCode.addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([generatedHtml()], { type: "text/html" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.id}-hexlife.html`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("Standalone HTML downloaded");
});
ui.copyWorld.addEventListener("click", async () => {
  const code = await ui.world.caCode();
  if (code) await copyText(code, "HXK1 world code copied");
});

let lastStats = 0;
let lastSimulationTime = 0;
let tickCarry = 0;
function animationLoop(time) {
  if (modelRunning && ui.world.world && appliedConfig) {
    if (!lastSimulationTime) lastSimulationTime = time;
    tickCarry +=
      (Math.min(250, time - lastSimulationTime) * appliedConfig.speed) / 1000;
    lastSimulationTime = time;
    const count = Math.min(8, Math.floor(tickCarry));
    tickCarry -= count;
    for (let step = 0; step < count && modelRunning; step++) advanceModelTick();
    if (count) ui.world.tick(0);
  } else {
    lastSimulationTime = time;
    tickCarry = 0;
  }
  if (time - lastStats > 250) {
    renderStats();
    lastStats = time;
  }
  requestAnimationFrame(animationLoop);
}

showGeometryNote();
ui.preset.value = project.id;
ui.description.textContent = project.description;
renderStateEditor();
setWorkbenchEnabled(false);
await initEngine();
if (ui.world.world) installWorld();
requestAnimationFrame(animationLoop);
