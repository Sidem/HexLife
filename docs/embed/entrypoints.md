[← `@hexlife/embed` docs](./README.md)

# Entry points

Eight public imports. The split is not cosmetic: each one is the boundary between "this host needs
a DOM", "this host needs the second Wasm artifact", and "this host needs neither".

| Import | Needs | Use for |
| :--- | :--- | :--- |
| `@hexlife/embed` | DOM, WebGL2, Wasm | The browser. Importing it registers [`<hexlife-world>`](./hexlife-world.md) and [`<hexlife-grid>`](./hexlife-grid.md). |
| `@hexlife/embed/api` | Nothing | Node and browsers alike: world codes, ruleset metadata, palette names, GPU probing. No DOM at module scope. → [`/api`](./api.md) |
| `@hexlife/embed/sim` | Wasm | Node and browser workers: deterministic host-driven simulation without DOM or rendering. → [`/sim`](./sim.md) |
| `@hexlife/embed/render` | DOM, WebGL2 | Browser hosts: draw externally supplied state without allocating or ticking a simulation. → [`/render`](./renderer.md) |
| `@hexlife/embed/ca` | Wasm | **k-state** worlds: multi-state simulation on the same lattice, with an optionally mass-conserving backend. A second engine — everything else here stays binary. No DOM at module scope. → [`/ca`](./ca.md) |
| `@hexlife/embed/ca-element` | DOM, WebGL2, Wasm | Importing it registers `<hexlife-ca>`, the k-state element. Separate from `/ca` because that entry is DOM-free, and separate from the root because a binary embed should not carry the k-state engine. |
| `@hexlife/embed/stochastic` | Wasm | Stateful/probabilistic neighborhood worlds and the conserved lattice gas, with compiled native rules, age epochs, counter RNG, census and checksums. A separately loaded artifact with no DOM at module scope. → [`/stochastic`](./stochastic.md) |
| `@hexlife/embed/stochastic-element` | DOM, WebGL2, Wasm | Importing it registers `<hexlife-stochastic>`. The **only** element entry that reaches the second Wasm artifact — which is why it is separate from both `/stochastic` (DOM-free) and every other element entry. |

A server that validates a pasted world code must import **only** `@hexlife/embed/api` — the root
entry evaluates custom-element, Wasm and WebGL code at import time.

The browser bundle **inlines the Wasm binary** as a data URI rather than fetching a side-car asset,
because a strict host CSP (a Reddit webview, for instance) is not something an embed can widen.

## Three engines, one package

| Engine | States | Entry | Wasm artifact |
| :--- | :--- | :--- | :--- |
| Binary | 2 | root, `/sim` | The main one. |
| k-state | 2–16 | `/ca`, `/ca-element` | The same one, a separate engine struct. |
| Stochastic | up to 64 rows of transitions, or 5 gas states | `/stochastic`, `/stochastic-element` | A **second** artifact, loaded only by these two. |

Importing the package root, `/sim`, `/ca`, or `/ca-element` neither downloads nor initializes the
stochastic artifact.

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
