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

const PACKAGE_VERSION = "1.10.0";
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
  inputCaption: byId("input-caption"),
  outputCaption: byId("output-caption"),
  inputs: byId("transition-inputs"),
  outputs: byId("transition-outputs"),
  applyTransition: byId("apply-transition"),
  undoTransition: byId("undo-transition"),
  transitionSummary: byId("transition-summary"),
  transitionEditStatus: byId("transition-edit-status"),
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
let workbenchEnabled = false;
let statePicker = null;
let activePickerSelect = null;
let activePickerCell = null;
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
  workbenchEnabled = enabled;
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
    ".transition-diagram select, .transition-diagram button",
  )) {
    control.disabled = !enabled;
  }
  if (!enabled) closeStatePicker(false);
  ui.undoTransition.disabled = !enabled || overrides.size === 0;
  updateTransitionEditState();
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

function stateInk(colour) {
  const red = Number.parseInt(colour.slice(1, 3), 16);
  const green = Number.parseInt(colour.slice(3, 5), 16);
  const blue = Number.parseInt(colour.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 156
    ? "#11161c"
    : "#f7fafc";
}

function placeRuleCell(cell, slot) {
  cell.dataset.slot = slot;
}

function addCellVisual(cell, label, interactive = false) {
  const location = document.createElement("span");
  location.className = "rule-cell-location";
  location.textContent = label;
  const hex = document.createElement(interactive ? "button" : "span");
  hex.className = "rule-hex";
  if (interactive) {
    hex.type = "button";
    hex.setAttribute("aria-haspopup", "dialog");
  }
  const value = document.createElement("strong");
  value.className = "rule-hex-value";
  const name = document.createElement("span");
  name.className = "rule-hex-name";
  hex.append(value, name);
  cell.append(location, hex);
  return hex;
}

function updateCellVisual(cell, state) {
  cell.style.setProperty("--cell-colour", palette[state]);
  cell.style.setProperty("--cell-ink", stateInk(palette[state]));
  cell.querySelector(".rule-hex-value").textContent = String(state);
  cell.querySelector(".rule-hex-name").textContent = stateNames[state];
  if (!cell.classList.contains("is-ghost")) {
    cell.title = `${cell.dataset.slot}: ${stateNames[state]}. Click to change.`;
    const button = cell.querySelector("button.rule-hex");
    button?.setAttribute(
      "aria-label",
      `${cell.dataset.slot}: ${stateNames[state]}. Change state`,
    );
  }
}

function closeStatePicker(restoreFocus = true) {
  if (!statePicker || statePicker.hidden) return;
  const button = activePickerCell?.querySelector("button.rule-hex");
  activePickerCell?.classList.remove("is-picker-open");
  statePicker.hidden = true;
  activePickerSelect = null;
  activePickerCell = null;
  if (restoreFocus) button?.focus();
}

function positionStatePicker() {
  if (!statePicker || statePicker.hidden || !activePickerCell) return;
  if (window.innerWidth <= 760) {
    statePicker.style.removeProperty("left");
    statePicker.style.removeProperty("top");
    statePicker.style.removeProperty("width");
    return;
  }
  const anchor = activePickerCell.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  statePicker.style.width = `${width}px`;
  const height = statePicker.offsetHeight;
  const left = Math.min(
    window.innerWidth - width - 12,
    Math.max(12, anchor.left + anchor.width / 2 - width / 2),
  );
  let top = anchor.bottom + 10;
  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, anchor.top - height - 10);
  }
  statePicker.style.left = `${left}px`;
  statePicker.style.top = `${top}px`;
}

function ensureStatePicker() {
  if (statePicker) return statePicker;
  statePicker = document.createElement("div");
  statePicker.id = "state-picker";
  statePicker.className = "state-picker";
  statePicker.hidden = true;
  statePicker.setAttribute("role", "dialog");
  statePicker.setAttribute("aria-modal", "false");
  document.body.append(statePicker);
  document.addEventListener("pointerdown", (event) => {
    if (
      statePicker.hidden ||
      statePicker.contains(event.target) ||
      activePickerCell?.contains(event.target)
    )
      return;
    closeStatePicker(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !statePicker.hidden) {
      event.preventDefault();
      closeStatePicker();
    }
  });
  window.addEventListener("resize", positionStatePicker);
  window.addEventListener("scroll", positionStatePicker, true);
  return statePicker;
}

function openStatePicker(select, cell) {
  if (!workbenchEnabled || select.disabled) return;
  closeStatePicker(false);
  const picker = ensureStatePicker();
  activePickerSelect = select;
  activePickerCell = cell;
  cell.classList.add("is-picker-open");
  picker.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "state-picker-heading";
  const headingCopy = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "Choose a state";
  const title = document.createElement("strong");
  title.id = "state-picker-title";
  title.textContent = `${cell.dataset.slot} cell`;
  headingCopy.append(eyebrow, title);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "state-picker-close";
  close.setAttribute("aria-label", "Close state picker");
  close.textContent = "×";
  close.addEventListener("click", () => closeStatePicker());
  heading.append(headingCopy, close);

  const options = document.createElement("div");
  options.className = "state-picker-options";
  options.setAttribute("aria-labelledby", title.id);
  stateNames.forEach((name, state) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "state-picker-option";
    option.classList.toggle("is-selected", Number(select.value) === state);
    option.style.setProperty("--option-colour", palette[state]);
    option.setAttribute("aria-pressed", String(Number(select.value) === state));
    const swatch = document.createElement("span");
    swatch.className = "state-picker-swatch";
    const number = document.createElement("strong");
    number.textContent = String(state);
    const label = document.createElement("span");
    label.textContent = name;
    option.append(swatch, number, label);
    option.addEventListener("click", () => {
      activePickerSelect.value = String(state);
      activePickerSelect.dispatchEvent(new Event("change", { bubbles: true }));
      closeStatePicker();
    });
    options.append(option);
  });
  picker.append(heading, options);
  picker.hidden = false;
  positionStatePicker();
  options.querySelector(".is-selected")?.focus();
}

function refreshStateOptions() {
  for (const select of document.querySelectorAll(
    ".transition-diagram select",
  )) {
    for (const option of select.options) {
      const state = Number(option.value);
      option.textContent = `${state} · ${stateNames[state]}`;
    }
  }
  refreshTransitionVisuals();
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
      refreshTransitionVisuals();
      renderCensus();
      renderGeneratedCode();
    });
    const label = document.createElement("input");
    label.type = "text";
    label.value = name;
    label.setAttribute("aria-label", `State ${state} name`);
    label.addEventListener("change", () => {
      stateNames[state] = label.value.trim() || `state ${state}`;
      refreshStateOptions();
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

function selectFor(label, states, output = false) {
  const wrapper = document.createElement("div");
  wrapper.className = "rule-cell";
  placeRuleCell(wrapper, label);
  const hex = addCellVisual(wrapper, label, true);
  const select = document.createElement("select");
  select.setAttribute(
    "aria-label",
    `${output ? "Next" : "Current"} state at ${label}`,
  );
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  for (let state = 0; state < states; state++)
    select.append(stateOption(state));
  wrapper.append(select);
  hex.addEventListener("click", () => openStatePicker(select, wrapper));
  updateCellVisual(wrapper, 0);
  return { wrapper, select };
}

function ghostCell(label, sourceIndex) {
  const cell = document.createElement("div");
  cell.className = "rule-cell is-ghost";
  cell.dataset.sourceIndex = String(sourceIndex);
  placeRuleCell(cell, label);
  addCellVisual(cell, label);
  updateCellVisual(cell, 0);
  cell.setAttribute("aria-hidden", "true");
  return cell;
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
      ? `Lookup entry ${index.toLocaleString()} · one ordered three-cell triangle`
      : `Lookup entry ${index.toLocaleString()} · centre plus six neighbours`;
  refreshTransitionVisuals();
}

function refreshTransitionVisuals() {
  for (const select of [...inputSelects, ...outputSelects]) {
    const cell = select.closest(".rule-cell");
    if (cell) updateCellVisual(cell, Number(select.value));
  }
  for (const ghost of ui.outputs.querySelectorAll(".is-ghost")) {
    updateCellVisual(
      ghost,
      Number(inputSelects[Number(ghost.dataset.sourceIndex)]?.value || 0),
    );
  }
  const backend = ui.backend.value;
  outputSelects.forEach((select, index) => {
    const inputIndex = backend === "block" ? index : 0;
    select
      .closest(".rule-cell")
      ?.classList.toggle(
        "is-changed",
        Number(select.value) !== Number(inputSelects[inputIndex]?.value),
      );
  });
  renderTransitionSummary();
  updateTransitionEditState();
}

function appendSummaryChange(container, location, before, after = null) {
  const item = document.createElement("span");
  item.className = "summary-change";
  if (after != null && before !== after) item.classList.add("is-changed");
  const label = document.createElement("span");
  label.className = "summary-location";
  label.textContent = location;
  const beforeSwatch = document.createElement("span");
  beforeSwatch.className = "summary-swatch";
  beforeSwatch.style.setProperty("--summary-colour", palette[before]);
  const beforeName = document.createElement("span");
  beforeName.textContent = stateNames[before];
  item.append(label, beforeSwatch, beforeName);
  if (after != null) {
    const arrow = document.createElement("span");
    arrow.className = "summary-arrow";
    arrow.textContent = "→";
    const afterSwatch = document.createElement("span");
    afterSwatch.className = "summary-swatch";
    afterSwatch.style.setProperty("--summary-colour", palette[after]);
    const afterName = document.createElement("span");
    afterName.textContent = stateNames[after];
    item.append(arrow, afterSwatch, afterName);
  }
  container.append(item);
}

function renderTransitionSummary() {
  if (!ui.transitionSummary || !inputSelects.length || !outputSelects.length)
    return;
  ui.transitionSummary.replaceChildren();
  const lead = document.createElement("span");
  lead.className = "summary-lead";
  lead.textContent = "This entry says";
  ui.transitionSummary.append(lead);
  if (ui.backend.value === "block") {
    BLOCK_LABELS.forEach((label, index) =>
      appendSummaryChange(
        ui.transitionSummary,
        label,
        Number(inputSelects[index].value),
        Number(outputSelects[index].value),
      ),
    );
    return;
  }
  appendSummaryChange(
    ui.transitionSummary,
    "centre",
    Number(inputSelects[0].value),
    Number(outputSelects[0].value),
  );
  const context = document.createElement("span");
  context.className = "summary-lead";
  context.textContent = "when surrounded by";
  ui.transitionSummary.append(context);
  NEIGHBOR_LABELS.forEach((label, index) =>
    appendSummaryChange(
      ui.transitionSummary,
      label,
      Number(inputSelects[index + 1].value),
    ),
  );
}

function pendingTransitionValue() {
  if (!rule || !outputSelects.length) return null;
  const config = normalizedConfig();
  return config.backend === "block"
    ? packBlock(
        config.states,
        outputSelects.map((select) => Number(select.value)),
      )
    : Number(outputSelects[0].value);
}

function updateTransitionEditState() {
  if (!ui.transitionEditStatus) return;
  let dirty = false;
  if (rule && inputSelects.length && outputSelects.length) {
    try {
      dirty = pendingTransitionValue() !== rule[transitionIndex()];
    } catch {
      dirty = false;
    }
  }
  ui.transitionEditStatus.classList.toggle("is-dirty", dirty);
  ui.transitionEditStatus.textContent = dirty
    ? "Unsaved next state"
    : "Matches the saved rule";
  ui.applyTransition.disabled = !workbenchEnabled || !dirty;
  ui.applyTransition.textContent = dirty
    ? "Save this transition"
    : "Transition is saved";
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
  ui.inputs.dataset.backend = config.backend;
  ui.outputs.dataset.backend = config.backend;
  const inputLabels =
    config.backend === "block" ? BLOCK_LABELS : ["centre", ...NEIGHBOR_LABELS];
  const outputLabels = config.backend === "block" ? BLOCK_LABELS : ["centre"];
  ui.ruleHelp.textContent =
    config.backend === "block"
      ? "The rule reads one three-cell tile and replaces all three cells together. Position is meaning: the left pair share a column; the third cell sits down-right."
      : "The rule reads the centre and its six touching hex neighbours, then writes one new state into the centre.";
  ui.inputCaption.textContent =
    config.backend === "block"
      ? "Tap a hex to set the state the engine sees."
      : "Tap any hex to set the neighbourhood.";
  ui.outputCaption.textContent =
    config.backend === "block"
      ? "Tap a hex to choose what appears in that same place."
      : "Tap the solid centre to choose its next state.";
  for (const label of inputLabels) {
    const field = selectFor(label, config.states);
    field.select.addEventListener("change", readTransition);
    inputSelects.push(field.select);
    ui.inputs.append(field.wrapper);
  }
  if (config.backend === "neighborhood") {
    NEIGHBOR_LABELS.forEach((label, index) =>
      ui.outputs.append(ghostCell(label, index + 1)),
    );
  }
  for (const label of outputLabels) {
    const field = selectFor(label, config.states, true);
    field.wrapper.classList.add("is-focus");
    field.select.addEventListener("change", refreshTransitionVisuals);
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
{"imports":{"@hexlife/embed/ca":"https://cdn.jsdelivr.net/npm/@hexlife/embed@${PACKAGE_VERSION}/src/embed/ca.js","@hexlife/embed/ca-element":"https://cdn.jsdelivr.net/npm/@hexlife/embed@${PACKAGE_VERSION}/src/embed/ca-element.js"}}
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
  const index = transitionIndex();
  const value = pendingTransitionValue();
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
