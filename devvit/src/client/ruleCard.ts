/**
 * Read-only ruleset card for the expanded lab (#26): the in-post answer to "what ruleset is
 * this?". A *viewer*, deliberately not the Explorer's editor — no tabs, no 128 tap targets, no
 * scope switches — so it works at phone sizes where the editor's detailed grid does not.
 *
 * Renders from {@link describeRuleset}: neighbor-count and rotationally-symmetric rules get
 * Born/Survive rows of hex-flower chips (one per active orbit / count); raw rules get the
 * 128-bit fingerprint grid, which is the only honest picture such a rule has.
 */

import {
  describeRuleset,
  ORBIT_LABELS,
  type RulesetDescription,
} from '../../../src/core/rulesetDescriptor.js'

/** Label → the 6-bit mask drawn on its chip. Bare digits use the count's canonical first orbit. */
const LABEL_MASKS: ReadonlyMap<string, number> = (() => {
  const masks = new Map<string, number>()
  for (const [rep, label] of ORBIT_LABELS) {
    masks.set(label, rep)
    const digit = label[0] ?? ''
    // First orbit of each count wins — for a bare digit the arrangement is immaterial anyway.
    if (!masks.has(digit)) masks.set(digit, rep)
  }
  return masks
})()

/** Neighbor-bit → unit direction, matching Symmetry.js: 0=SW 1=NW 2=N 3=NE 4=SE 5=S. */
const DIRS: readonly [number, number][] = [
  [-0.866, 0.5], // SW
  [-0.866, -0.5], // NW
  [0, -1], // N
  [0.866, -0.5], // NE
  [0.866, 0.5], // SE
  [0, 1], // S
]

/** Flat-top hexagon path centered on (cx, cy) — matches the world's cell orientation. */
function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 * Math.PI) / 180
    pts.push(
      `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`,
    )
  }
  return pts.join(' ')
}

/**
 * One neighborhood diagram: center cell (dead for Born, alive for Survive) with the orbit's
 * neighbor arrangement lit. `title` carries the plain-language reading for hover/long-press.
 */
function flowerSVG(mask: number, centerAlive: boolean, title: string): string {
  const c = 32
  const dist = 19
  const r = 9
  const cell = (cx: number, cy: number, alive: boolean): string =>
    `<polygon points="${hexPoints(cx, cy, r)}" class="${alive ? 'rc-on' : 'rc-off'}"></polygon>`
  let cells = cell(c, c, centerAlive)
  for (let bit = 0; bit < 6; bit++) {
    const [dx, dy] = DIRS[bit] ?? [0, 0]
    cells += cell(c + dx * dist, c + dy * dist, ((mask >> bit) & 1) === 1)
  }
  return (
    `<svg viewBox="0 0 64 64" role="img" aria-label="${title}">` +
    `<title>${title}</title>${cells}</svg>`
  )
}

/** "2o" → "2 neighbors, adjacent" — the chip tooltip. */
function labelTitle(label: string): string {
  const n = label[0]
  const arrangement: {[suffix: string]: string} = {
    o: 'adjacent',
    m: 'one apart',
    p: 'opposite',
    "m'": 'one apart (mirrored)',
  }
  const suffix = label.slice(1)
  const arr = arrangement[suffix]
  return arr
    ? `${n} neighbors, ${arr}`
    : `${n} neighbor${n === '1' ? '' : 's'}, any arrangement`
}

/** A Born/Survive row: caption + one chip per active label, or a quiet "never". */
function rowHTML(
  caption: string,
  labels: string[],
  centerAlive: boolean,
): string {
  const chips =
    labels.length === 0
      ? '<span class="rc-never">never</span>'
      : labels
          .map(label => {
            const mask = LABEL_MASKS.get(label) ?? 0
            const title = labelTitle(label)
            return (
              `<span class="rc-chip">${flowerSVG(mask, centerAlive, title)}` +
              `<span class="rc-chip-label">${label}</span></span>`
            )
          })
          .join('')
  return `<div class="rc-row"><span class="rc-caption">${caption}</span><div class="rc-chips">${chips}</div></div>`
}

/**
 * 128-bit fingerprint for raw rules: two 16×4 blocks (dead-center / live-center halves of the
 * table), each cell one rule output. Not an explanation — raw rules don't have one — but a
 * truthful picture, and visibly *not* reducible to a tidy chip row.
 */
function fingerprintSVG(hex: string): string {
  const s = 9
  const gap = 8
  const blockH = 4 * s
  let cells = ''
  for (let i = 0; i < 128; i++) {
    const nibble = parseInt(hex[i >> 2] ?? '0', 16)
    const alive = ((nibble >> (3 - (i & 3))) & 1) === 1
    const cs = i >> 6 // 0 = dead center (first 64), 1 = live center
    const idx = i & 63
    const x = (idx % 16) * s
    const y = Math.floor(idx / 16) * s + cs * (blockH + gap)
    cells += `<rect x="${x}" y="${y}" width="${s - 1}" height="${s - 1}" class="${alive ? 'rc-on' : 'rc-off'}"></rect>`
  }
  const w = 16 * s
  const h = 2 * blockH + gap
  return (
    `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="128-entry rule map">` +
    `<title>128-entry rule map — top: dead center, bottom: live center</title>${cells}</svg>`
  )
}

/**
 * Fill the card's content elements for the given ruleset. Pure DOM writes into existing ids;
 * wiring (open/close/copy/deep-link) stays in hexlife.ts with the rest of the page's controls.
 * Returns the description so the caller can reuse it (feed badge, links).
 */
export function paintRuleCard(
  rulesetHex: string,
  name: string,
): RulesetDescription | null {
  const desc = describeRuleset(rulesetHex)
  const title = document.getElementById('rule-card-title')
  const notation = document.getElementById('rule-card-notation')
  const summary = document.getElementById('rule-card-summary')
  const viz = document.getElementById('rule-card-viz')
  const hexEl = document.getElementById('rule-card-hex')

  if (title) title.textContent = name
  if (notation) notation.textContent = desc?.notation ?? ''
  if (summary) summary.textContent = desc?.summary ?? ''
  if (hexEl) hexEl.textContent = rulesetHex

  if (viz) {
    if (!desc) viz.innerHTML = ''
    else if (desc.type === 'raw') {
      viz.innerHTML = `${fingerprintSVG(desc.hex)}<p class="rc-note">Each square is one of the 128 rule-table entries (bright = next state alive). Top block: dead center cell; bottom: live.</p>`
    } else {
      viz.innerHTML =
        rowHTML('Born', desc.birth, false) +
        rowHTML('Survive', desc.survival, true) +
        (desc.type === 'r-sym'
          ? '<p class="rc-note">o = adjacent · m = one apart · p = opposite — this rule cares how neighbors are arranged, not just how many.</p>'
          : '')
    }
  }
  return desc
}
