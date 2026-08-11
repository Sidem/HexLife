[← `@hexlife/embed` docs](./README.md)

# `@hexlife/embed/render` — the renderer alone

The renderer-only entry is for applications that already own their simulation, verification,
networking, and history. It accepts row-major byte arrays (`index = row * columns + column`) and owns
only the WebGL lifecycle and camera. `setState()` is the state-buffer upload boundary; `panBy()`,
`setZoom()`, `resize()`, and `draw()` do not upload cell state.

```js
const renderer = createRenderer(canvas, {
  rows,
  columns,
  palette: 'default',
  flickerProof: true,
  repeatToroidal: true,
  minZoom: 0.3,
  maxZoom: 5,
  onContextLost: () => showGpuRecoveryNotice(),
  onContextRestored: () => hideGpuRecoveryNotice(),
})

renderer.setState(cells)                 // Uint8Array(rows * columns), values 0/1
renderer.setSelection(42)                // null clears it
renderer.setDraftPreview([{index: 9, value: 1}])
renderer.panBy(24, -8)                   // CSS pixels
renderer.setZoom(1.5, {x: 400, y: 300}) // keep the cell under this canvas point fixed
renderer.centerOnCell(42)
renderer.draw()                          // draw on demand
```

## Hit testing

`hitTest(x, y)` takes CSS pixels relative to the canvas and returns
`{row, column, index}`. With `repeatToroidal: true`, every repeated visual copy resolves to the same
canonical index. The repeated flat view covers the viewport and maps each cell to its nearest
toroidal copy, so continuous pan does not require a second state buffer.

## Draft previews

The live state and draft preview are separate GPU attributes. Draft value `1` is a translucent live
preview and `0` is a translucent erase preview; neither mutates the verified state passed to
`setState()`.

## Instrumentation

`renderer.stats` reports draws, explicit state uploads and bytes, and context losses. These counters
make it possible to assert that camera-only gestures perform no full state-buffer upload.

## Losing the context

The canvas emits `hexlife-renderer-contextlost`, `hexlife-renderer-contextrestored`, and
`hexlife-renderer-error`. Context loss is prevented so the browser may restore it; on restoration the
renderer rebuilds its shared shader resources and re-uploads the latest state, selection, and draft.
Networking and history stay entirely under host control throughout. Call `destroy()` to remove event
listeners and release GPU resources.

## Related

- [`/sim`](./sim.md) — if you want HexLife's simulation as well as its renderer.
- [`<hexlife-world>`](./hexlife-world.md) — if you want both, plus the lifecycle policies, in one tag.
