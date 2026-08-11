/**
 * Solid Garden — a package consumer that turns a run into a printable object.
 *
 * Four published entry points and nothing else: `/sim` ticks the automaton, `/render` draws the
 * cross-section, `/solid` welds the layers into a solid and serializes it, and `/api` answers the
 * one question the whole guarantee rests on — is this rule vacuum-stable?
 *
 * The ownership rule this page has to respect: every per-voxel operation lives in Wasm. The only
 * data movement here is one `TypedArray.set` per tick into the stack's staging layer, plus one
 * `slice()` per tick to keep the cross-section scrubbable. Both are bulk copies, never loops.
 */

/* eslint-disable import/no-unresolved */
// Resolved by the browser's import map to the published package on jsDelivr, at an exact version.
// There is no local install to resolve against, which is the point: this page is a consumer.
import {isVacuumStable, normalizeRulesetHex, rulesetName} from '@hexlife/embed/api'
import {createDensityState, createSimulation} from '@hexlife/embed/sim'
import {createRenderer} from '@hexlife/embed/render'
import {createSolidStack, initSolidEngine, solidMemoryBytes} from '@hexlife/embed/solid'
/* eslint-enable import/no-unresolved */

/**
 * Vacuum-stable growth rules, every one of them verified to print as a single connected piece from
 * a single seed. Vacuum stability is not decoration here: it is the precondition of the bridge
 * connectivity guarantee, so these are the configurations that *provably* hold together rather than
 * the ones that usually do.
 *
 * A rule whose birth set excludes 1 cannot grow from a single seed at all — the seed has no
 * neighbour with a live neighbour — which is why every birth set below contains it.
 */
const PRESETS = [
  {
    id: 'crystal-garden',
    label: 'Crystal Garden — dense sixfold growth',
    hex: '7EE8E880E8808000FFFFFFFFFFFFFFFF',
    note: 'Born with 1–2 live neighbours, never dies. Fills its envelope into a solid crystal.',
  },
  {
    id: 'coral',
    label: 'Coral — branching, open structure',
    hex: '6880800080000000FFFFFFFFFFFFFFFF',
    note: 'Born with exactly 1 neighbour. Grows thin arms that keep branching instead of filling in.',
  },
  {
    id: 'frost',
    label: 'Frost — feathered plates',
    hex: '6881811681161668FFFFFFFFFFFFFFFF',
    note: 'Born with 1 or 4 neighbours. Plates thicken while the edges stay ragged.',
  },
  {
    id: 'bloom',
    label: 'Bloom — alternating shells',
    hex: '6996966996696996FFFFFFFFFFFFFFFF',
    note: 'Born on odd neighbour counts. Concentric shells with a lace texture between them.',
  },
  {
    id: 'vein',
    label: 'Vein — grows and prunes',
    hex: '7FFEFEE8FEE8E8800117177F177F7FFF',
    note: 'The only preset where cells also die: a far more intricate surface, still one piece.',
  },
]

const $ = (id) => document.getElementById(id)

const ui = {
  stage: $('stage'),
  overlay: $('stage-overlay'),
  previewTick: $('preview-tick'),
  previewTickOut: $('preview-tick-out'),
  rule: $('rule'),
  ruleHex: $('rule-hex'),
  ruleNote: $('rule-note'),
  start: $('start'),
  densityField: $('density-field'),
  density: $('density'),
  densityOut: $('density-out'),
  seed: $('seed'),
  rows: $('rows'),
  cols: $('cols'),
  ticks: $('ticks'),
  ticksOut: $('ticks-out'),
  interpolate: $('interpolate'),
  subLayers: $('sub-layers'),
  subLayersOut: $('sub-layers-out'),
  basePlate: $('base-plate'),
  basePlateOut: $('base-plate-out'),
  keep: $('keep'),
  cellSize: $('cell-size'),
  layerHeight: $('layer-height'),
  format: $('format'),
  merge: $('merge'),
  download: $('download'),
  verdict: $('verdict'),
  timing: $('timing'),
  budget: $('budget'),
  frame: document.querySelector('.garden-canvas-frame'),
  drawTools: $('draw-tools'),
  drawClear: $('draw-clear'),
  drawRandom: $('draw-random'),
  drawCentre: $('draw-centre'),
  out: {
    pieces: $('r-pieces'),
    floating: $('r-floating'),
    kept: $('r-kept'),
    dropped: $('r-dropped'),
    layers: $('r-layers'),
    size: $('r-size'),
    triangles: $('r-triangles'),
    bytes: $('r-bytes'),
  },
}

/** Per-tick cross-sections, one bulk copy each, so the scrubber costs nothing to serve. */
let snapshots = []
let renderer = null
let renderedGeometry = ''
let latest = null
let pending = 0

/**
 * The hand-drawn initial state, kept at the current grid size.
 *
 * Its own buffer rather than a snapshot, because it has to survive a rebuild: every parameter
 * change re-runs the simulation from tick 0, and tick 0 is this.
 */
let drawn = new Uint8Array(0)
let drawnGeometry = ''
let paintValue = 1

/**
 * The engine's own ceiling: `rows × cols × totalLayers` voxels, capped at 2²⁴ because the component
 * pass needs a parent, a size and a flag per voxel. Checked here so an over-ambitious grid gets a
 * sentence about what to reduce instead of a raw error from the constructor.
 */
const MAX_VOXELS = 1 << 24

const number = (value) => value.toLocaleString('en-US')
const mm = (value) => `${value.toFixed(1)} mm`

function bytes(count) {
  if (count < 1024) return `${count} B`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`
  return `${(count / 1024 / 1024).toFixed(2)} MB`
}

function setOverlay(message) {
  ui.overlay.hidden = !message
  if (message) ui.overlay.textContent = message
}

/** Read the controls once, so a run is a value rather than a scatter of live DOM reads. */
function readOptions() {
  const rows = Math.max(6, Math.min(256, Number(ui.rows.value) || 24))
  // The lattice only closes on an even column count, and the engine rejects an odd one outright.
  let cols = Math.max(6, Math.min(256, Number(ui.cols.value) || 30))
  if (cols % 2 !== 0) cols += 1
  const interpolate = ui.interpolate.value
  return {
    hex: ui.ruleHex.value.trim().toUpperCase(),
    start: ui.start.value,
    density: Number(ui.density.value) / 100,
    seed: Math.max(0, Number(ui.seed.value) || 0),
    rows,
    cols,
    ticks: Number(ui.ticks.value),
    interpolate,
    // `none` means no synthesized layers whatever the slider says — mirroring what the engine does
    // rather than letting the readout claim layers that will not exist.
    subLayers: interpolate === 'none' ? 0 : Number(ui.subLayers.value),
    basePlate: Number(ui.basePlate.value),
    keepComponents: ui.keep.value,
    cellSize: Math.max(0.3, Number(ui.cellSize.value) || 2),
    layerHeight: Math.max(0.05, Number(ui.layerHeight.value) || 0.8),
    format: ui.format.value,
    merge: ui.merge.value,
  }
}

/** The cross-section for a given tick. `/render` owns the WebGL lifecycle; we only hand it bytes. */
function drawTick(index) {
  if (!snapshots.length) return
  const clamped = Math.max(0, Math.min(snapshots.length - 1, index))
  ui.previewTick.value = String(clamped)
  ui.previewTickOut.textContent = String(clamped)
  renderer?.setState(snapshots[clamped])
  renderer?.draw()
}

/**
 * Resize the drawn state to the current grid, keeping whatever still fits.
 *
 * Row-major, so a plain copy would shear the picture the moment the column count changed. Copying
 * row by row is the only way a drawing survives a grid tweak looking like itself.
 */
function fitDrawn(rows, cols) {
  const geometry = `${rows}x${cols}`
  if (drawnGeometry === geometry) return drawn

  const next = new Uint8Array(rows * cols)
  if (drawn.length) {
    const [oldRows, oldCols] = drawnGeometry.split('x').map(Number)
    const keepRows = Math.min(rows, oldRows)
    const keepCols = Math.min(cols, oldCols)
    for (let row = 0; row < keepRows; row++) {
      next.set(drawn.subarray(row * oldCols, row * oldCols + keepCols), row * cols)
    }
  } else {
    next[Math.floor(rows / 2) * cols + Math.floor(cols / 2)] = 1
  }
  drawn = next
  drawnGeometry = geometry
  return drawn
}

/** Voxels the requested geometry would allocate, and whether the engine will take it. */
function volumeOf(options) {
  const layers = options.basePlate + options.ticks * (1 + options.subLayers)
  return {layers, voxels: options.rows * options.cols * layers}
}

function ensureRenderer(rows, cols) {
  const geometry = `${rows}x${cols}`
  if (renderer && renderedGeometry === geometry) return renderer
  renderer?.destroy()
  renderer = createRenderer(ui.stage, {
    rows,
    columns: cols,
    palette: 'default',
    flickerProof: true,
    repeatToroidal: false,
  })
  renderedGeometry = geometry
  renderer.resize()
  return renderer
}

async function build() {
  const options = readOptions()
  const token = ++pending

  const normalized = normalizeRulesetHex(options.hex)
  if (!normalized) {
    ui.ruleHex.setAttribute('aria-invalid', 'true')
    ui.ruleNote.textContent = 'That is not a 32-character hexadecimal ruleset.'
    return
  }
  ui.ruleHex.removeAttribute('aria-invalid')

  const stable = isVacuumStable(normalized)
  const preset = PRESETS.find((entry) => entry.hex === normalized)
  ui.ruleNote.textContent = preset
    ? preset.note
    : `${rulesetName(normalized)} — ${stable ? 'vacuum-stable' : 'not vacuum-stable'}.`

  const {layers, voxels} = volumeOf(options)
  ui.budget.textContent =
    `${number(options.rows * options.cols)} cells × ${number(layers)} layers = ` +
    `${number(voxels)} voxels.`
  if (voxels > MAX_VOXELS) {
    setOverlay(
      `${number(voxels)} voxels is past the engine's ${number(MAX_VOXELS)} ceiling. ` +
        'Reduce ticks, sub-layers, or the grid.',
    )
    return
  }

  setOverlay('Growing…')
  const startedAt = performance.now()

  const initialCells =
    options.start === 'draw'
      ? fitDrawn(options.rows, options.cols).slice()
      : options.start === 'seed'
        ? seedCell(options.rows, options.cols)
        : createDensityState({
            rows: options.rows,
            columns: options.cols,
            seed: options.seed,
            density: options.density,
          })

  const world = await createSimulation({
    rulesetHex: normalized,
    rows: options.rows,
    columns: options.cols,
    initialCells,
  })
  if (token !== pending) {
    world.dispose?.()
    return
  }

  let stack
  try {
    stack = createSolidStack({
      rows: options.rows,
      cols: options.cols,
      ticks: options.ticks,
      interpolate: options.interpolate,
      subLayers: options.subLayers,
      basePlate: options.basePlate,
    })
  } catch (error) {
    world.dispose?.()
    setOverlay(String(error.message ?? error))
    return
  }

  // The ingestion loop. `layer.set(world.state)` is one memcpy and it is the only data movement
  // this page is allowed; `slice()` keeps a copy for the scrubber, also in bulk.
  const layer = stack.layerView()
  snapshots = []
  for (let tick = 0; tick < options.ticks; tick++) {
    layer.set(world.state)
    stack.pushLayer()
    snapshots.push(world.state.slice())
    world.tick()
  }
  const ingestedAt = performance.now()

  const report = stack.finalize({keepComponents: options.keepComponents})
  const finalizedAt = performance.now()

  let file
  try {
    file = await stack.export({
      format: options.format,
      cellSize: options.cellSize,
      layerHeight: options.layerHeight,
      merge: options.merge,
    })
  } catch (error) {
    stack.free()
    world.dispose?.()
    setOverlay(String(error.message ?? error))
    return
  }
  const exportedAt = performance.now()

  if (token !== pending) {
    stack.free()
    world.dispose?.()
    return
  }

  latest = {
    file,
    name: `hexlife-${preset?.id ?? 'world'}-${options.rows}x${options.cols}x${options.ticks}.${options.format}`,
  }

  ui.out.pieces.textContent = `${number(report.keptComponents)} of ${number(report.componentCount)}`
  ui.out.floating.textContent = number(report.floating)
  ui.out.kept.textContent = `${number(report.keptVoxels)} cells`
  ui.out.dropped.textContent = number(report.droppedVoxels)
  ui.out.layers.textContent = number(stack.totalLayers)
  ui.out.size.textContent = [
    mm(options.cols * 1.5 * options.cellSize),
    mm(options.rows * Math.sqrt(3) * options.cellSize),
    mm(stack.totalLayers * options.layerHeight),
  ].join(' × ')
  ui.out.triangles.textContent = `${number(stack.triangleCount)} (${number(stack.capTriangleCount)} caps)`
  ui.out.bytes.textContent = `${bytes(file.byteLength)} ${options.format.toUpperCase()}`

  setVerdict(report, stable, options)

  ui.timing.textContent =
    `grow ${Math.round(ingestedAt - startedAt)} ms · weld ${Math.round(finalizedAt - ingestedAt)} ms · ` +
    `mesh ${Math.round(exportedAt - finalizedAt)} ms · ${bytes(solidMemoryBytes())} engine memory`

  ui.previewTick.max = String(Math.max(0, snapshots.length - 1))
  ensureRenderer(options.rows, options.cols)
  // While drawing, hold the view on tick 0 — which IS the drawing, since it is what got pushed
  // first. Snapping to the final tick after every stroke would take the canvas away mid-edit.
  drawTick(options.start === 'draw' ? 0 : snapshots.length - 1)
  setOverlay('')
  ui.download.disabled = false

  stack.free()
  world.dispose?.()
}

/** One live cell at the centre — the start §5.3's guarantee is written for. */
function seedCell(rows, cols) {
  const cells = new Uint8Array(rows * cols)
  cells[Math.floor(rows / 2) * cols + Math.floor(cols / 2)] = 1
  return cells
}

const isDrawing = () => ui.start.value === 'draw'

/** Show the drawn state itself, which is tick 0 of whatever gets built from it. */
function showDrawn() {
  const options = readOptions()
  const cells = fitDrawn(options.rows, options.cols)
  ensureRenderer(options.rows, options.cols)
  renderer.setState(cells)
  renderer.draw()
  ui.previewTick.value = '0'
  ui.previewTickOut.textContent = '0'
}

/**
 * Paint one cell under the pointer.
 *
 * `hitTest` is the renderer's own inverse of its layout, in CSS pixels relative to the canvas — the
 * alternative is a second copy of the hexagon geometry here, which is exactly the drift the
 * geometry contract exists to prevent.
 */
function paintAt(event) {
  if (!renderer) return
  const rect = ui.stage.getBoundingClientRect()
  const target = renderer.hitTest(event.clientX - rect.left, event.clientY - rect.top)
  if (!target || drawn[target.index] === paintValue) return
  drawn[target.index] = paintValue
  renderer.setState(drawn)
  renderer.draw()
  schedule()
}

function bindPainting() {
  ui.stage.addEventListener('pointerdown', (event) => {
    if (!isDrawing() || event.button !== 0 || !renderer) return
    const rect = ui.stage.getBoundingClientRect()
    const target = renderer.hitTest(event.clientX - rect.left, event.clientY - rect.top)
    if (!target) return
    // The first cell decides the whole gesture: start on empty space and you paint, start on a live
    // cell and you erase. One drag does both, with nothing to discover in a toolbar.
    paintValue = drawn[target.index] ? 0 : 1
    // Capture keeps a fast drag from escaping the canvas mid-stroke. It throws for a pointer id the
    // browser has no record of, which a synthetic event has, so a failure here must not lose the
    // stroke — the painting below does not depend on it.
    try {
      ui.stage.setPointerCapture(event.pointerId)
    } catch {
      /* not a live pointer; paint anyway */
    }
    event.preventDefault()
    paintAt(event)
  })
  ui.stage.addEventListener('pointermove', (event) => {
    if (!isDrawing() || !ui.stage.hasPointerCapture(event.pointerId)) return
    paintAt(event)
  })
  const release = (event) => {
    if (ui.stage.hasPointerCapture(event.pointerId)) ui.stage.releasePointerCapture(event.pointerId)
  }
  ui.stage.addEventListener('pointerup', release)
  ui.stage.addEventListener('pointercancel', release)
}

/** Replace the drawn state, redraw it, and rebuild from it. */
function setDrawn(fill) {
  const options = readOptions()
  fitDrawn(options.rows, options.cols)
  fill(drawn, options)
  showDrawn()
  schedule()
}

/**
 * Say what the run actually establishes, and no more.
 *
 * The connectivity guarantee has two conditions — a vacuum-stable rule *and* bridge interpolation
 * with at least one sub-layer. Claiming it whenever the result happens to be one piece would be the
 * page telling a comfortable lie: a dense growth rule comes out connected under `'none'` too, and
 * nothing about that generalises.
 */
function setVerdict(report, stable, options) {
  const guaranteed = stable && options.interpolate === 'bridge' && options.subLayers >= 1
  const plural = (count) => (count === 1 ? '' : 's')

  if (report.keptComponents === 1 && report.floating === 0) {
    ui.verdict.dataset.tone = 'good'
    ui.verdict.textContent = guaranteed
      ? 'One connected piece, nothing floating — guaranteed, not lucky: this rule is vacuum-stable and bridging turns every diagonal contact into a real face.'
      : `One connected piece, nothing floating — but on this run rather than by guarantee, because ${
          stable ? 'interpolation is not set to bridge' : 'this rule is not vacuum-stable'
        }.`
    return
  }

  if (report.keptComponents === 1) {
    ui.verdict.dataset.tone = 'warn'
    ui.verdict.textContent =
      `One piece will print, but ${report.floating} component${plural(report.floating)} never reached the ` +
      `plate and ${number(report.droppedVoxels)} cells were dropped to get there.`
    return
  }

  ui.verdict.dataset.tone = 'bad'
  ui.verdict.textContent =
    `${number(report.keptComponents)} separate bodies. A slicer will not join them — it prints all of them loose. ` +
    (options.interpolate === 'bridge'
      ? 'Try keep = largest, or grow from a single seed under a vacuum-stable rule.'
      : 'Switch interpolation to bridge: diagonal contact between layers is a hinge, not a joint.')
}

let debounce = 0
function schedule() {
  ui.download.disabled = true
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    build().catch((error) => setOverlay(String(error.message ?? error)))
  }, 120)
}

/** Only one of the two start-mode control groups is ever relevant. */
function syncStartMode() {
  const mode = ui.start.value
  // Density seeds the soup, and it also seeds the Scatter button — so it stays visible for both.
  ui.densityField.hidden = mode === 'seed'
  ui.drawTools.hidden = mode !== 'draw'
  ui.frame.dataset.painting = String(mode === 'draw')
}

function bindOutput(input, output, format = (value) => value) {
  const sync = () => {
    output.textContent = format(input.value)
  }
  input.addEventListener('input', sync)
  sync()
}

function init() {
  for (const preset of PRESETS) {
    const option = document.createElement('option')
    option.value = preset.hex
    option.textContent = preset.label
    ui.rule.append(option)
  }
  const custom = document.createElement('option')
  custom.value = 'custom'
  custom.textContent = 'Custom ruleset…'
  ui.rule.append(custom)

  ui.rule.value = PRESETS[0].hex
  ui.ruleHex.value = PRESETS[0].hex

  bindOutput(ui.ticks, ui.ticksOut)
  bindOutput(ui.subLayers, ui.subLayersOut)
  bindOutput(ui.basePlate, ui.basePlateOut)
  bindOutput(ui.density, ui.densityOut, (value) => `${value}%`)
  syncStartMode()

  ui.rule.addEventListener('change', () => {
    if (ui.rule.value === 'custom') {
      ui.ruleHex.focus()
      return
    }
    ui.ruleHex.value = ui.rule.value
    schedule()
  })
  ui.ruleHex.addEventListener('input', () => {
    const match = PRESETS.find((entry) => entry.hex === ui.ruleHex.value.trim().toUpperCase())
    ui.rule.value = match ? match.hex : 'custom'
    schedule()
  })
  ui.start.addEventListener('change', () => {
    syncStartMode()
    if (isDrawing()) showDrawn()
    schedule()
  })
  bindPainting()
  ui.drawClear.addEventListener('click', () => setDrawn((cells) => cells.fill(0)))
  ui.drawCentre.addEventListener('click', () =>
    setDrawn((cells, options) => {
      cells.fill(0)
      cells[Math.floor(options.rows / 2) * options.cols + Math.floor(options.cols / 2)] = 1
    }),
  )
  ui.drawRandom.addEventListener('click', () =>
    setDrawn((cells, options) => {
      const seeded = createDensityState({
        rows: options.rows,
        columns: options.cols,
        seed: options.seed,
        density: options.density,
      })
      cells.set(seeded)
    }),
  )
  ui.interpolate.addEventListener('change', () => {
    ui.subLayers.disabled = ui.interpolate.value === 'none'
    schedule()
  })

  for (const input of [
    ui.density,
    ui.seed,
    ui.rows,
    ui.cols,
    ui.ticks,
    ui.subLayers,
    ui.basePlate,
    ui.keep,
    ui.cellSize,
    ui.layerHeight,
    ui.format,
    ui.merge,
  ]) {
    input.addEventListener('change', schedule)
  }

  ui.previewTick.addEventListener('input', () => drawTick(Number(ui.previewTick.value)))

  ui.download.addEventListener('click', () => {
    if (!latest) return
    const blob = new Blob([latest.file], {type: 'application/octet-stream'})
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = latest.name
    anchor.click()
    URL.revokeObjectURL(url)
  })

  // `resize()` reshapes the viewport but does not redraw, and this page draws on demand rather
  // than from a frame loop — so without the explicit draw the canvas stays at the old size.
  window.addEventListener('resize', () => {
    if (!renderer) return
    renderer.resize()
    renderer.draw()
  })
}

setOverlay('Loading the solid engine…')
init()
initSolidEngine()
  .then(() => build())
  .catch((error) => setOverlay(`Could not start: ${error.message ?? error}`))

// A headless hook, mirroring the rest of the demo library: the state a test needs to assert
// without a GPU or a frame callback.
window.__solidGarden = {
  presets: PRESETS,
  options: readOptions,
  rebuild: () => build(),
  get latest() {
    return latest
  },
}
