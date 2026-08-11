[← `@hexlife/embed` docs](./README.md)

# `@hexlife/embed/api` — metadata, codecs, palettes

DOM-free, safe in Node. Nothing in this entry loads Wasm or touches WebGL, which is what makes it the
correct import for a server that only has to *understand* a world.

```js
import {
  decodeWorldCode, encodeWorldCode, explorerUrlForRuleset,
  describeRuleset, rulesetName, ORBIT_LABELS,
  normalizeRulesetHex, isVacuumStable, VACUUM_RULE_INDEX,
  listPresetPalettes,
  detectGraphicsPath, createGpuHelpPanel,
} from '@hexlife/embed/api'
```

## Ruleset identity

`normalizeRulesetHex(value)` trims and uppercases an exact 32-character ruleset identity, returning
`null` for short codes, notation, or malformed input. Use `codeToHex()` when those short codes should
also be accepted.

`isVacuumStable(value)` takes a 32-char hex or a 128-entry rule table and answers whether empty space
stays empty — see [`/sim`](./sim.md#vacuum-stability) for what that buys and why it is one character
of the hex. It returns `false` for anything malformed, so a host can use it as an admission gate
without a separate validity branch. `VACUUM_RULE_INDEX` is the rule index it reads (`0`), named so a
host asserting the bit-order claim does not have to restate the literal.

## World codes

```js
const world = await decodeWorldCode(code) // → DecodedWorld | null, never throws
const code = await encodeWorldCode({rows, cols, rulesetHex, cells})
```

Both are async — the payload is deflated. `decodeWorldCode` resolves to `null` for anything
malformed, which is what makes it safe to point at user input.

The k-state and stochastic codecs are the same shape but live with their engines, in
[`/ca`](./ca.md#hxk1-world-codes) and [`/stochastic`](./stochastic.md#hxs1-world-codes) — both are
DOM-free too, so a Node host can validate any of the three without an engine.

## Ruleset metadata

```js
rulesetName('D5F5…')      // → a deterministic two-word mnemonic
describeRuleset('D5F5…')  // → {notation: 'B2/S35', summary, birth, survival, …} | null
```

`describeRuleset` returns `notation: null` for rules with no compact B/S form. `ORBIT_LABELS` maps
rotation-orbit representatives to their notation labels.

## Palettes

```js
listPresetPalettes()
// → [{key: 'default', name: 'Default Spectrum'},
//    {key: 'viridis', name: 'Viridis', cvdSafe: true},
//    {key: 'symmetryGradient', name: 'Symmetry Groups', logic: 'symmetry'}, …]
```

`key` is what the `palette` attribute takes. `logic` marks the two presets that color by *rule
structure* rather than by taste; `cvdSafe` marks the perceptually-uniform, colorblind-safe ramps.

The two `logic` presets are authored tables rather than ramps: one saturated hue per group — 7
live-neighbor counts, or 14 C6 orbits — on pure black, the same colors the explorer shows, so a rule
reads identically in both. The center bit is deliberately not a color channel, so `palette` answers
"which group fired" and nothing else. Because OFF outputs are black throughout, they carry the
birth/death flash guard for free, whatever `flicker-proof` says.

## GPU support

```js
const gpu = detectGraphicsPath() // {status: 'no-webgl2' | 'software' | 'likely-hardware', info, masked}
if (gpu.status === 'no-webgl2') mount.append(createGpuHelpPanel({status: 'no-webgl2'}))
```

Worth calling before you mount: a device that cannot run WebGL2 will never render a world, and the
element's own message ("This browser can't run WebGL2.") is true but not actionable.
`createGpuHelpPanel` returns detached DOM with browser-specific remediation steps.

## Reference application

HexWorlds is the package's practical reference host: it exercises externally owned simulation,
verified state rendering, Node/browser determinism, and large-world operation. Reusable HexLife
behavior discovered there is implemented and tested in this package first, then consumed through an
exact packed or published version. HexWorlds retains its collaboration protocol, networking, history,
and application UI; it must not carry copies of HexLife determinism or rendering primitives.
