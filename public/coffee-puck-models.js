/**
 * Six-state and sixteen-state tet rules for the 3D coffee-puck lab.
 *
 * DOM-free. A host materializes these with `blockRuleFromTet` from `@hexlife/embed/hcp`.
 * Slot order is geometric: [face0, face1, face2, apex=down].
 */

const EMPTY = 0;
const WATER = 1;
const SATURATED = 2;
const DRY = 3;
const WET = 4;
const SPENT = 5;
const MOBILE = 3;

const D_AIR = 0;
const D_LIQ = [1, 2, 3];
const D_DRY = [4, 5, 6];
const D_WET = [
    [7, 8, 9],
    [10, 11, 12],
    [13, 14, 15],
];
const dFree = (state) => state <= 3;
const dLiquid = (state) => state >= 1 && state <= 3;
const dGround = (state) => state >= 4;
const dDry = (state) => state >= 4 && state <= 6;
const dWet = (state) => state >= 7;
const dConc = (state) => state - 1;
const dDryCharge = (state) => state - 4;
const dWetCharge = (state) => Math.floor((state - 7) / 3);
const dWetBound = (state) => (state - 7) % 3;

export const SIX_STATES = Object.freeze({
    air: 0, water: 1, saturated: 2, dry: 3, wet: 4, spent: 5, mobile: MOBILE,
});

export const SIX_NAMES = Object.freeze([
    'air', 'water', 'saturated', 'dry ground', 'wet ground', 'spent ground',
]);

export const SIX_PALETTE = Object.freeze([
    [18, 16, 14],
    [58, 160, 255],
    [168, 74, 28],
    [201, 168, 124],
    [106, 64, 36],
    [36, 28, 24],
]);

/**
 * Gravity on a tet whose slot 3 is the unique lowest site.
 *
 * Face0 → apex is one of the three equally-tilted down-bonds (same (q, r) on the next layer).
 * A unique heaviest mate may take the apex too, so an isolated parcel uses all three down-bonds
 * across the period instead of only the same-(q, r) zigzag. There is no in-plane face slide:
 * that walk is handed, and even with `setBlockAlternates(true)` even-host phases apply it 2:1,
 * which drains a centre stream out one side of the puck.
 *
 * @param {number[]} out
 * @param {(state: number) => boolean} mobile
 */
export function puckFall(out, mobile) {
    const swap = (a, b) => {
        [out[a], out[b]] = [out[b], out[a]];
    };
    if (out[3] !== EMPTY) return;
    if (out[0] !== EMPTY && mobile(out[0])) {
        swap(0, 3);
        return;
    }
    let best = -1;
    let tied = false;
    for (let i = 1; i < 3; i++) {
        if (!mobile(out[i])) continue;
        if (best === -1 || out[i] > out[best]) {
            best = i;
            tied = false;
        } else if (out[i] === out[best]) {
            tied = true;
        }
    }
    if (best !== -1 && !tied) swap(best, 3);
}

/** Six-state extraction: extract, wet, then fall. */
export function puckSixTransition(tet) {
    const out = [...tet];
    const water = out.indexOf(WATER);
    const wet = out.indexOf(WET);
    if (water !== -1 && wet !== -1) {
        out[water] = SATURATED;
        out[wet] = SPENT;
    }
    const hasFluid = out.some((state) => state < MOBILE && state !== EMPTY);
    if (hasFluid) {
        for (let i = 0; i < 4; i++) if (out[i] === DRY) out[i] = WET;
    }
    puckFall(out, (state) => state < MOBILE);
    return out;
}

function dTransfer(out, locked, can, act, towardApex = false) {
    const open = (a, b) => !locked[a] && !locked[b];
    const take = (a, b) => {
        act(out, a, b);
        locked[a] = true;
        locked[b] = true;
    };
    if (towardApex) {
        for (let face = 0; face < 3; face++) {
            if (open(face, 3) && can(out, face, 3)) {
                take(face, 3);
                return;
            }
        }
    }
    const pairs = [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]];
    for (const [a, b] of pairs) {
        if (open(a, b) && can(out, a, b)) {
            take(a, b);
            return;
        }
    }
}

const dCanImbibe = (out, a, b) =>
    (dLiquid(out[a]) && dDry(out[b])) || (dLiquid(out[b]) && dDry(out[a]));
const dActImbibe = (out, a, b) => {
    const liquid = dLiquid(out[a]) ? a : b;
    const ground = liquid === a ? b : a;
    out[ground] = D_WET[dDryCharge(out[ground])][dConc(out[liquid])];
    out[liquid] = D_AIR;
};
const dCanWick = (out, a, b) =>
    (dWet(out[a]) && dDry(out[b])) || (dWet(out[b]) && dDry(out[a]));
const dActWick = (out, a, b) => {
    const source = dWet(out[a]) ? a : b;
    const destination = source === a ? b : a;
    out[destination] = D_WET[dDryCharge(out[destination])][dWetBound(out[source])];
    out[source] = D_DRY[dWetCharge(out[source])];
};
const dCanDrain = (out, a, b) => dWet(out[a]) && out[b] === D_AIR;
const dActDrain = (out, a, b) => {
    out[b] = D_LIQ[dWetBound(out[a])];
    out[a] = D_DRY[dWetCharge(out[a])];
};

/**
 * Sixteen-state dual-porosity transition.
 * @param {number[]} tet
 * @param {{grindSlots?: number, wicking?: boolean}} [options]
 */
export function puckDualTransition(tet, {grindSlots = 2, wicking = true} = {}) {
    const out = [...tet];
    const slots = Math.max(1, Math.min(4, Math.round(grindSlots)));
    for (let i = 4 - slots; i < 4; i++) {
        const state = out[i];
        if (dWet(state) && dWetCharge(state) > 0 && dWetBound(state) < 2) {
            out[i] = D_WET[dWetCharge(state) - 1][dWetBound(state) + 1];
        }
    }
    const locked = [false, false, false, false];
    dTransfer(out, locked, dCanImbibe, dActImbibe);
    dTransfer(out, locked, wicking ? dCanWick : () => false, dActWick);
    dTransfer(out, locked, dCanDrain, dActDrain, true);

    let low = -1;
    let high = -1;
    for (let i = 0; i < 4; i++) {
        if (!dLiquid(out[i])) continue;
        if (low === -1 || out[i] < out[low]) low = i;
        if (high === -1 || out[i] > out[high]) high = i;
    }
    if (low !== -1 && high !== low && out[high] - out[low] >= 2) {
        out[low]++;
        out[high]--;
    }
    puckFall(out, dFree);
    return out;
}

export function puckSixFamiliesPreserved(tet, out) {
    const fluid = (values) => values.filter((state) => state < MOBILE).length;
    const ground = (values) => values.filter((state) => state >= MOBILE).length;
    return fluid(tet) === fluid(out) && ground(tet) === ground(out);
}

export function puckDualQuantities(tet, out) {
    const ground = (state) => (dGround(state) ? 1 : 0);
    const liquid = (state) => (dLiquid(state) || dWet(state) ? 1 : 0);
    const solute = (state) => (
        dLiquid(state)
            ? dConc(state)
            : dWet(state)
                ? dWetCharge(state) + dWetBound(state)
                : dDry(state)
                    ? dDryCharge(state)
                    : 0
    );
    const sum = (values, metric) => values.reduce((total, state) => total + metric(state), 0);
    return [ground, liquid, solute].every((metric) => sum(tet, metric) === sum(out, metric))
        && tet.every((state, index) => dGround(state) === dGround(out[index]));
}

export const PULSE_BLOOM_TICKS = 40;
export const PULSE_REST_TICKS = 60;
export const PARTITION_PERIOD = 6;
export const HEADSPACE_LAYERS = 4;
export const DRIP_LAYERS = 4;

/**
 * Inclusive-exclusive [lo, hi) of layers that hold the bed. Headspace and drip stay empty so
 * the pour is visible above the puck and the drip is visible below it.
 * @param {number} layers
 * @param {number} [headspace]
 * @param {number} [drip]
 */
export function bedRange(layers, headspace = HEADSPACE_LAYERS, drip = DRIP_LAYERS) {
    const n = Math.max(2, Math.floor(layers));
    const cap = Math.max(1, Math.floor(n / 2) - 1);
    const top = Math.min(Math.max(1, Math.floor(headspace)), cap);
    const bot = Math.min(Math.max(1, Math.floor(drip)), cap);
    let lo = top;
    let hi = n - bot;
    if (hi <= lo) {
        lo = 1;
        hi = n - 1;
    }
    return {lo, hi};
}

function evenlySpaced(span, count, phase) {
    const n = Math.max(0, Math.min(span, Math.floor(count)));
    if (n === 0) return [];
    const shift = ((Math.floor(phase) % span) + span) % span;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = (Math.floor(((i + 0.5) * span) / n) + shift) % span;
    return out;
}

const SQRT3 = Math.sqrt(3);

/**
 * Odd-q pixel XY of a layer-0 site. Matches `sitePosition(col, row, 0)` in `@hexlife/embed/hcp`.
 * @param {number} row
 * @param {number} col
 * @returns {[number, number]}
 */
export function siteXY(row, col) {
    return [col * 1.5, (row + ((col & 1) ? 0.5 : 0)) * SQRT3];
}

/** Physical centre of the rectangular host used by {@link diskIndices}. */
export function diskCenter(rows, cols) {
    return [(cols - 1) * 0.75, ((rows - 1) + 0.5) * SQRT3 / 2];
}

/**
 * In-layer indices of the inscribed disk (top-face cells used for pour and puck IC).
 * The circle is in physical XY, not offset (row, col) space — otherwise the bed is an ellipse
 * and a "centre" pour sits off-axis.
 * @param {number} rows
 * @param {number} cols
 */
export function diskIndices(rows, cols) {
    const [cx, cy] = diskCenter(rows, cols);
    const radius = Math.min(cols, rows) * 0.63;
    const r2 = radius * radius;
    const out = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const [x, y] = siteXY(row, col);
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy <= r2) out.push(row * cols + col);
        }
    }
    return out;
}

/**
 * Distinct top-face indices inside the disk that receive an injection this tick.
 * @param {{rows: number, cols: number, flow: number, mode: string, tick: number, remaining: number}} options
 */
export function injectionSites({rows, cols, flow, mode, tick, remaining}) {
    const disk = diskIndices(rows, cols);
    const span = disk.length;
    if (span === 0) return [];
    const requested = Math.max(0, Math.floor(flow));
    const left = Math.max(0, Math.floor(remaining));
    if (mode === 'dump') return evenlySpaced(span, Math.min(left, span), tick).map((i) => disk[i]);

    let rate = Math.min(requested, left);
    if (mode === 'pulse') {
        if (tick < PULSE_BLOOM_TICKS) rate = Math.max(1, Math.round(rate * 0.35));
        else if (tick < PULSE_BLOOM_TICKS + PULSE_REST_TICKS) rate = 0;
    }
    if (rate <= 0) return [];

    if (mode === 'centre') {
        const [cx, cy] = diskCenter(rows, cols);
        const ranked = disk
            .map((index) => {
                const col = index % cols;
                const row = Math.floor(index / cols);
                const [x, y] = siteXY(row, col);
                const dx = x - cx;
                const dy = y - cy;
                return {index, d: dx * dx + dy * dy};
            })
            .sort((a, b) => a.d - b.d || a.index - b.index);
        const width = Math.max(1, Math.min(ranked.length, Math.floor(span * 0.08) * 2 || 2));
        const pool = ranked.slice(0, width).map((entry) => entry.index);
        return evenlySpaced(pool.length, Math.min(rate, pool.length), tick).map((i) => pool[i]);
    }

    const out = [];
    const seen = new Set();
    for (let i = 0; i < Math.min(rate, span); i++) {
        const pick = Math.floor(((i + (tick * 0.37)) % Math.max(1, rate)) * (span / Math.max(1, rate))) % span;
        const index = disk[pick];
        if (!seen.has(index)) {
            seen.add(index);
            out.push(index);
        }
    }
    return out;
}

/** Quiet-tick allowance scales with layers, not rows. */
export function quietTickLimit(layers, period = PARTITION_PERIOD) {
    return Math.max(240, Math.max(1, Math.floor(layers)) * period);
}

/**
 * Seeded disk of dry grounds. Several layers above and below the bed stay empty so the
 * shower and the drip are visible, not a one-cell film.
 * @param {{layers: number, rows: number, cols: number, packing: number, seed: number,
 *   uneven?: boolean, groundState?: number, headspace?: number, drip?: number}} options
 */
export function makePuckCells({
    layers, rows, cols, packing, seed, uneven = false, groundState = 3,
    headspace = HEADSPACE_LAYERS, drip = DRIP_LAYERS,
}) {
    const cells = new Uint8Array(layers * rows * cols);
    const disk = diskIndices(rows, cols);
    let a = seed >>> 0 || 1;
    const random = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const {lo, hi} = bedRange(layers, headspace, drip);
    for (let layer = lo; layer < hi; layer++) {
        const density = uneven && layer > (lo + hi) / 2 ? packing * 0.72 : packing;
        const base = layer * rows * cols;
        for (const index of disk) {
            if (random() < density) cells[base + index] = groundState;
        }
    }
    return cells;
}

export function dualPalette() {
    const colors = [
        [18, 16, 14],
        [58, 160, 255],
        [120, 110, 140],
        [168, 74, 28],
    ];
    colors.push([210, 180, 140], [188, 152, 108], [168, 128, 82]);
    for (let charge = 0; charge < 3; charge++) {
        for (let conc = 0; conc < 3; conc++) {
            colors.push([
                90 + charge * 16 - conc * 8,
                52 + conc * 8 - charge * 6,
                28 + conc * 4,
            ]);
        }
    }
    return colors;
}
