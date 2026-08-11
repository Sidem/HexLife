/**
 * Engine ownership for every public embed demo and reference instrument.
 *
 * This is deliberately data rather than prose: the demo-library source-policy test treats it as the
 * migration checklist for WorldStochastic. `engine` is the package family each surface demonstrates,
 * `currentOwner` is what actually runs its tick, and `debts` lists the host-owned running-path costs
 * it still carries.
 *
 * **Every debt is now empty.** The six that had them were migrated on 2026-08-10 (STOCHASTIC-PLAN
 * Phase B): the three stochastic demos moved to `WorldStochastic`, Butterfly and Synth to the native
 * analysis primitives, and Coffee to the native alternating partition. An entry only lost its debts
 * when the running path was actually gone, and `stochasticPhase0.test.js` asserts the removal
 * against the page sources rather than trusting this list.
 */
export const EMBED_DEMO_OWNERSHIP = Object.freeze([
  demo('crystal-garden', 'crystal-garden.html', 'library', 'k-state', 'WorldK/neighborhood'),
  demo('hex-ecology', 'hex-ecology.html', 'library', 'k-state', 'WorldK/neighborhood'),
  demo('excitable-tissue', 'excitable-tissue.html', 'library', 'k-state', 'WorldK/neighborhood'),
  demo('mixing-chamber', 'mixing-chamber.html', 'library', 'stochastic', 'WorldStochastic/lattice-gas'),
  demo('wildfire-command', 'wildfire-command.html', 'library', 'stochastic', 'WorldStochastic/neighborhood'),
  demo('outbreak-counterfactuals', 'outbreak-counterfactuals.html', 'library', 'stochastic', 'WorldStochastic/neighborhood-paired'),
  demo('butterfly-microscope', 'butterfly-microscope.html', 'library', 'binary', 'World+WorldDifference'),
  demo('cellular-synth', 'cellular-synth.html', 'library', 'binary', 'World+BirthLanes'),
  demo('hex-matter', 'hex-matter.html', 'library', 'k-state', 'WorldK/block'),
  demo('totalistic-256', 'totalistic-256.html', 'reference', 'binary', 'World/grid'),
  demo('coffee-percolation', 'coffee-percolation.html', 'reference', 'k-state', 'WorldK/block-alternating'),
  demo('ca-builder', 'ca-builder.html', 'reference', 'k-state', 'WorldK/neighborhood-or-block'),
  // The engine family is the one that RUNS the world, which is what this manifest audits. Solid
  // Garden ticks a binary `World`; `WorldSolid` simulates nothing — it is a layer sink that owns
  // the meshing, so it appears here as the second half of the owner rather than as an engine.
  demo('solid-garden', 'solid-garden.html', 'reference', 'binary', 'World+WorldSolid/extrude'),
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
