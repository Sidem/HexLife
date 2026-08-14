[← `@hexlife/embed` docs](./README.md)

# Entry points

Twelve public imports. The split is not cosmetic: each one is the boundary between "this host needs
a DOM", "this host needs a separately loaded Wasm artifact", and "this host needs neither".

| Import | Needs | Use for |
| :--- | :--- | :--- |
| `@hexlife/embed` | DOM, WebGL2, Wasm | The browser. Importing it registers [`<hexlife-world>`](./hexlife-world.md) and [`<hexlife-grid>`](./hexlife-grid.md). |
| `@hexlife/embed/api` | Nothing | Node and browsers alike: world codes, ruleset metadata, palette names, GPU probing. No DOM at module scope. → [`/api`](./api.md) |
| `@hexlife/embed/sim` | Wasm | Node and browser workers: deterministic host-driven simulation without DOM or rendering. → [`/sim`](./sim.md) |
| `@hexlife/embed/render` | DOM, WebGL2 | Browser hosts: draw externally supplied state without allocating or ticking a simulation. → [`/render`](./renderer.md) |
| `@hexlife/embed/spacetime` | DOM, WebGL2 | Browser hosts: a whole run drawn as a 3D solid — one retained tick per layer, ray-marched, turnable and sliceable. Simulates nothing; a host feeds it generations. Separate from `/render` because it is a second program, two more shaders and a texture ring. → [`/spacetime`](./spacetime.md) |
| `@hexlife/embed/ca` | Wasm | **k-state** worlds: multi-state simulation on the same lattice, with an optionally mass-conserving backend. A second engine — everything else here stays binary. No DOM at module scope. → [`/ca`](./ca.md) |
| `@hexlife/embed/ca-element` | DOM, WebGL2, Wasm | Importing it registers `<hexlife-ca>`, the k-state element. Separate from `/ca` because that entry is DOM-free, and separate from the root because a binary embed should not carry the k-state engine. |
| `@hexlife/embed/stochastic` | Wasm | Stateful/probabilistic neighborhood worlds and the conserved lattice gas, with compiled native rules, age epochs, counter RNG, census and checksums. A separately loaded artifact with no DOM at module scope. → [`/stochastic`](./stochastic.md) |
| `@hexlife/embed/stochastic-element` | DOM, WebGL2, Wasm | Importing it registers `<hexlife-stochastic>`. The **only** element entry that reaches the stochastic artifact — which is why it is separate from both `/stochastic` (DOM-free) and every other element entry. |
| `@hexlife/embed/solid` | Wasm | Extrude a run of *any* of these engines through time into a printable solid, and serialize STL, PLY or 3MF. A third separately loaded artifact; no DOM at module scope. → [`/solid`](./solid.md) |
| `@hexlife/embed/hcp` | Wasm | **HCP** worlds: a general k-state CA on the hexagonal close-packed lattice, with a 6-phase `k⁴` tetrahedral block. A **fourth** separately loaded artifact; no DOM at module scope. → [`/hcp`](./hcp.md) |
| `@hexlife/embed/hcp-element` | DOM, WebGL2, Wasm | Importing it registers `<hexlife-hcp>`. The only element entry that reaches the HCP artifact. |

A server that validates a pasted world code must import **only** `@hexlife/embed/api` — the root
entry evaluates custom-element, Wasm and WebGL code at import time.

The browser bundle **inlines the Wasm binary** as a data URI rather than fetching a side-car asset,
because a strict host CSP (a Reddit webview, for instance) is not something an embed can widen.

## Four engines and an extruder, one package

| Engine | States | Entry | Wasm artifact |
| :--- | :--- | :--- | :--- |
| Binary | 2 | root, `/sim` | The main one. |
| k-state | 2–16 | `/ca`, `/ca-element` | The same one, a separate engine struct. |
| Stochastic | up to 64 rows of transitions, or 5 gas states | `/stochastic`, `/stochastic-element` | A **second** artifact, loaded only by these two. |
| Solid extruder | simulates nothing — a layer sink for any of the above | `/solid` | A **third** artifact, loaded only by this one. |
| Spacetime view | simulates nothing — the same layer sink, drawn instead of meshed | `/spacetime` | **None.** Pure WebGL2. |
| HCP | 2–16 | `/hcp`, `/hcp-element` | A **fourth** artifact, loaded only by these two. 12-neighbour close-packed lattice, `k⁴` tets. |

Importing the package root, `/sim`, `/ca`, `/ca-element`, `/stochastic`, `/solid` or `/spacetime`
neither downloads nor initializes the HCP artifact.

## Types

Every entry ships its own `.d.ts`, resolved through the `exports` map, so a TypeScript consumer gets
the same split: importing `/api` never pulls DOM types in.

## Loading from a CDN

Import the exact published subpath file, pinned to an exact version:

```html
<script type="importmap">
  {
    "imports": {
      "@hexlife/embed/ca": "https://cdn.jsdelivr.net/npm/@hexlife/embed@1.10.0/src/embed/ca.js",
      "@hexlife/embed/ca-element": "https://cdn.jsdelivr.net/npm/@hexlife/embed@1.10.0/src/embed/ca-element.js"
    }
  }
</script>
```

Do **not** use jsDelivr's `/+esm` transform for more than one subpath. It bundles each entry
standalone, so `@hexlife/embed/sim` and `@hexlife/embed` would each get their own module state and
their own Wasm instance, and the two would never agree about anything.
