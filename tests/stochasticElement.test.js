import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {
  defaultStochasticPalette,
  GAS_VISIBLE_STATES,
  readStochasticPalette,
  readStochasticRows,
  readStochasticSpeed,
  stochasticColumnsForRows,
  STOCHASTIC_DEFAULTS,
  STOCHASTIC_ROWS_MAX,
  STOCHASTIC_ROWS_MIN,
} from '../src/embed/stochasticAttrs.js';

/**
 * `<hexlife-stochastic>` — the parts a node process can actually hold.
 *
 * The element itself evaluates `class extends HTMLElement` at import time and needs WebGL2 to do
 * anything, so it is smoke-tested in the browser (`tests/performance/stochastic-element-only.html`).
 * What is testable here is what matters most about it:
 *
 * 1. **Attribute coercion**, the whole trust boundary between a stranger's HTML and the engine.
 * 2. **The import boundary**, which is the reason the second Wasm artifact exists at all. A single
 *    stray import from the root or k-state path would put the stochastic engine into every binary
 *    embed's bundle, and no runtime test would notice — the page would simply work, and be 60 KB
 *    heavier for a feature it never uses.
 */

const embedDir = new URL('../src/embed/', import.meta.url);

describe('<hexlife-stochastic> attribute coercion', () => {
  it('clamps rows rather than refusing them — neither backend partitions the grid', () => {
    expect(readStochasticRows(null)).toBe(STOCHASTIC_DEFAULTS.rows);
    expect(readStochasticRows('nonsense')).toBe(STOCHASTIC_DEFAULTS.rows);
    expect(readStochasticRows('2')).toBe(STOCHASTIC_ROWS_MIN);
    expect(readStochasticRows('99999')).toBe(STOCHASTIC_ROWS_MAX);
    // 64 is fatal on <hexlife-ca> in block mode and perfectly ordinary here.
    expect(readStochasticRows('64')).toBe(64);
  });

  it('derives an even column count, because an odd-q torus cannot close without one', () => {
    for (let rows = STOCHASTIC_ROWS_MIN; rows <= 200; rows++) {
      const columns = stochasticColumnsForRows(rows);
      expect(columns % 2, `columns for ${rows} rows`).toBe(0);
      expect(columns).toBeGreaterThanOrEqual(2);
    }
  });

  it('clamps speed into a sane range and keeps 0 as a legitimate "hold still"', () => {
    expect(readStochasticSpeed(null)).toBe(STOCHASTIC_DEFAULTS.speed);
    expect(readStochasticSpeed('0')).toBe(0);
    expect(readStochasticSpeed('-4')).toBe(0);
    expect(readStochasticSpeed('99999')).toBe(1000);
    expect(readStochasticSpeed('7.5')).toBe(7.5);
  });

  it('gives the lattice gas a semantic palette rather than a hue sweep', () => {
    const gas = defaultStochasticPalette(GAS_VISIBLE_STATES, 'lattice-gas');
    expect(gas).toHaveLength(GAS_VISIBLE_STATES);
    // Vacuum reads as the background; the two species are distinct; mixed is neither of them.
    expect(gas[0]).toEqual([26, 26, 26]);
    expect(gas[1]).not.toEqual(gas[2]);
    expect(gas[3]).not.toEqual(gas[1]);
    expect(gas[3]).not.toEqual(gas[2]);

    const neighborhood = defaultStochasticPalette(4, 'neighborhood');
    expect(neighborhood).toHaveLength(4);
    expect(neighborhood[0]).toEqual([26, 26, 26]);
    expect(neighborhood).not.toEqual(defaultStochasticPalette(4, 'lattice-gas'));
  });

  it('never hands the renderer a short or oversized palette', () => {
    // The renderer rejects an empty palette and would leave the world undrawn; `states` is 0 until a
    // rule is installed, which is exactly the window a booting element draws in.
    expect(defaultStochasticPalette(0, 'neighborhood')).toHaveLength(1);
    expect(defaultStochasticPalette(0, 'lattice-gas')).toHaveLength(1);

    const padded = readStochasticPalette('#ff0000', 5, 'lattice-gas');
    expect(padded).toHaveLength(5);
    expect(padded[0]).toEqual([255, 0, 0]);
    expect(padded.slice(1)).toEqual(defaultStochasticPalette(5, 'lattice-gas').slice(1));

    const truncated = readStochasticPalette('#f00,#0f0,#00f,#fff,#000,#123', 3, 'neighborhood');
    expect(truncated).toHaveLength(3);

    // An unparseable entry falls back in place instead of blanking the world.
    const partial = readStochasticPalette('not-a-colour,#00ff00', 3, 'neighborhood');
    expect(partial[0]).toEqual(defaultStochasticPalette(3, 'neighborhood')[0]);
    expect(partial[1]).toEqual([0, 255, 0]);
  });
});

describe('<hexlife-stochastic> package boundary', () => {
  /**
   * Follow every relative import from `entry`, inside `src/`, and return the set of files reached.
   *
   * Deliberately a *transitive* walk rather than a grep of the entry file. The invariant is not "the
   * root does not name stochastic.js" — it is "no module the root pulls in, at any depth, reaches the
   * second artifact", and a shared helper picking up one import is exactly how that would break.
   */
  async function reachableFrom(entry) {
    const seen = new Set();
    const queue = [new URL(entry, embedDir).href];
    while (queue.length) {
      const href = queue.pop();
      if (seen.has(href)) continue;
      seen.add(href);
      let source;
      try {
        source = await readFile(new URL(href), 'utf8');
      } catch {
        continue;   // A `?url` / `?raw` asset or a generated artifact; it imports nothing itself.
      }
      for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]|import\s+['"](\.[^'"]+)['"]/g)) {
        const specifier = (match[1] || match[2]).split('?')[0];
        if (!specifier.endsWith('.js')) continue;
        queue.push(new URL(specifier, href).href);
      }
    }
    return seen;
  }

  const isStochastic = (href) => href.includes('/stochastic-wasm/')
    || href.endsWith('/embed/stochastic.js')
    || href.endsWith('/embed/stochastic-element.js')
    || href.endsWith('/embed/HexStochasticElement.js');

  it('keeps every non-stochastic entry at zero stochastic bytes, transitively', async () => {
    for (const entry of ['index.js', 'sim.js', 'ca.js', 'ca-element.js', 'api.js', 'render.js']) {
      const reached = [...await reachableFrom(entry)].filter(isStochastic);
      expect(reached, `${entry} reaches the stochastic artifact`).toEqual([]);
    }
  });

  it('reaches the artifact from the element entry, through the DOM-free engine module', async () => {
    const reached = await reachableFrom('stochastic-element.js');
    expect([...reached].some((href) => href.endsWith('/embed/stochastic.js'))).toBe(true);
    expect([...reached].some((href) => href.endsWith('/embed/EmbedRenderer.js'))).toBe(true);
    // `stochasticAttrs.js` borrows the k-state coercion helpers; that edge is fine in this
    // direction (they are DOM-free leaf modules) and must never exist in the other one.
    expect([...reached].some((href) => href.endsWith('/embed/caAttrs.js'))).toBe(true);
  });

  it('publishes the element entry with its own types and a side effect declared', async () => {
    const manifest = JSON.parse(await readFile(new URL('../packages/hexlife-embed/package.json', import.meta.url)));
    expect(manifest.exports['./stochastic-element']).toEqual({
      types: './src/embed/stochastic-element.d.ts',
      import: './src/embed/stochastic-element.js',
      default: './src/embed/stochastic-element.js',
    });
    // Registration IS the module's job, so a bundler must not be licensed to tree-shake it away.
    expect(manifest.sideEffects).toContain('./src/embed/stochastic-element.js');
    expect(manifest.sideEffects).not.toContain('./src/embed/stochastic.js');

    const prepare = await readFile(new URL('../scripts/prepare-embed-package.mjs', import.meta.url), 'utf8');
    expect(prepare).toContain(
      "['src/embed/stochastic-element.d.ts', 'dist/embed-package/src/embed/stochastic-element.d.ts']",
    );
  });

  it('builds the element as its own bundle entry', async () => {
    const config = await readFile(new URL('../vite.embed.config.js', import.meta.url), 'utf8');
    expect(config).toContain("'stochastic-element': 'src/embed/stochastic-element.js'");
  });

  it('registers the tag idempotently and only from the element entry', async () => {
    const entry = await readFile(new URL('stochastic-element.js', embedDir), 'utf8');
    expect(entry).toContain("customElements.get(STOCHASTIC_TAG_NAME)");
    expect(entry).toContain("customElements.define(STOCHASTIC_TAG_NAME, HexStochasticElement)");

    const engine = await readFile(new URL('stochastic.js', embedDir), 'utf8');
    expect(engine).not.toContain('customElements');
    expect(engine).not.toContain('HTMLElement');
  });

  it('documents exactly the attributes it observes', async () => {
    const source = await readFile(new URL('HexStochasticElement.js', embedDir), 'utf8');
    const observed = source
      .match(/static get observedAttributes\(\) \{\s*return \[([\s\S]*?)\];/)[1]
      .match(/'([^']+)'/g)
      .map((quoted) => quoted.slice(1, -1));
    // The plan fixes this set: rules and the seed are script, never HTML.
    expect(observed.sort()).toEqual(
      ['code', 'draw', 'draw-state', 'link', 'palette', 'paused', 'rows', 'speed'],
    );

    const readme = await readFile(new URL('../packages/hexlife-embed/README.md', import.meta.url), 'utf8');
    const table = readme.slice(readme.indexOf('## `<hexlife-stochastic>`'));
    for (const attribute of observed) {
      expect(table, `README documents ${attribute}`).toContain(`| \`${attribute}\` |`);
    }
    expect(table).toContain('@hexlife/embed/stochastic-element');
  });

  it('reads the visible state view directly and never streams a grid back in', async () => {
    const source = await readFile(new URL('HexStochasticElement.js', embedDir), 'utf8');
    // The render path hands the wasm view straight to the renderer.
    expect(source).toContain('this.renderer.drawStates(this.world.state)');
    // …and the only `setCells` call sites are the intervention API and `clear()`, never the loop.
    const frameStart = source.indexOf('_frame(now)');
    const loop = source.slice(frameStart, source.indexOf('_drawOnce() {', frameStart));
    expect(frameStart).toBeGreaterThan(0);
    expect(loop).toContain('this.world.tick(ticks)');
    expect(loop).not.toContain('setCells');
    expect(loop).not.toContain('snapshotCells');
  });
});
