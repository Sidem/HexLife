/**
 * Engine ownership for every public embed demo and reference instrument.
 *
 * This is deliberately data rather than prose: the demo-library source-policy test treats it as
 * the migration checklist for WorldStochastic. `engine` is the target package family each surface
 * demonstrates; `currentOwner` and `debts` freeze the pre-implementation Phase-0 baseline.
 */
export const EMBED_DEMO_OWNERSHIP = Object.freeze([
  demo('crystal-garden', 'crystal-garden.html', 'library', 'k-state', 'WorldK/neighborhood'),
  demo('hex-ecology', 'hex-ecology.html', 'library', 'k-state', 'WorldK/neighborhood'),
  demo('excitable-tissue', 'excitable-tissue.html', 'library', 'k-state', 'WorldK/neighborhood'),
  demo('mixing-chamber', 'mixing-chamber.html', 'library', 'stochastic', 'JavaScript/exclusion-gas', [
    'host-neighbor-loop', 'four-tick-scratch-allocations', 'full-grid-js-to-wasm',
  ]),
  demo('wildfire-command', 'wildfire-command.html', 'library', 'stochastic', 'JavaScript/wildfire-age', [
    'host-neighbor-loop', 'tick-scratch-allocation', 'full-grid-js-to-wasm', 'host-clock',
  ]),
  demo('outbreak-counterfactuals', 'outbreak-counterfactuals.html', 'library', 'stochastic', 'JavaScript/paired-outbreak-age', [
    'two-host-neighbor-loops', 'two-tick-scratch-allocations', 'two-full-grid-js-to-wasm', 'host-common-random-schedule',
  ]),
  demo('butterfly-microscope', 'butterfly-microscope.html', 'library', 'binary', 'World+host-difference', [
    'two-full-grid-snapshots', 'host-xor-scan', 'tick-mask-allocation', 'full-grid-mask-js-to-wasm',
  ]),
  demo('cellular-synth', 'cellular-synth.html', 'library', 'binary', 'World+host-birth-analysis', [
    'full-grid-snapshot', 'host-birth-scan', 'unbounded-birth-index-array',
  ]),
  demo('hex-matter', 'hex-matter.html', 'library', 'k-state', 'WorldK/block'),
  demo('totalistic-256', 'totalistic-256.html', 'reference', 'binary', 'World/grid'),
  demo('coffee-percolation', 'coffee-percolation.html', 'reference', 'k-state', 'WorldK/block+host-conjugation', [
    'two-full-grid-permutations-on-odd-ticks', 'chunk-skipping-disabled-by-host-write',
  ]),
  demo('ca-builder', 'ca-builder.html', 'reference', 'k-state', 'WorldK/neighborhood-or-block'),
]);

function demo(id, href, section, engine, currentOwner, debts = []) {
  return Object.freeze({
    id,
    href,
    section,
    engine,
    currentOwner,
    debts: Object.freeze(debts),
    phase0Status: debts.length ? 'frozen-debt' : 'native',
  });
}

/** @param {string} id */
export function demoOwnershipFor(id) {
  return EMBED_DEMO_OWNERSHIP.find((entry) => entry.id === id) || null;
}
