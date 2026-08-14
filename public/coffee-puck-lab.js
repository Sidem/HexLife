/**
 * Host for the 3D puck tab inside `coffee-percolation.html`.
 *
 * Same pour / drip / yield contract as the six-state 2D lab. The page owns the stepping; the
 * element stays `paused`. HCP wasm is imported on first open so the 2D tabs pay nothing.
 */

import {
    injectionSites,
    makePuckCells,
    PARTITION_PERIOD,
    puckSixFamiliesPreserved,
    puckSixTransition,
    quietTickLimit,
    SIX_PALETTE,
} from './coffee-puck-models.js';
import {bestRunIndex, pushRunEntry} from './lab-history.js';

const P_IDS = {
    pour: 'p-pour',
    flow: 'p-flow',
    water: 'p-water',
    pack: 'p-pack',
    diameter: 'p-diameter',
    layers: 'p-layers',
    clip: 'p-clip',
    opacity: 'p-opacity',
    spin: 'p-spin',
    uneven: 'p-uneven',
    speed: 'p-speed',
    run: 'p-run',
    brew: 'p-brew',
};

const brew = {
    tick: 0,
    poured: 0,
    budget: 0,
    cupWater: 0,
    cupSat: 0,
    groundTotal: 0,
    running: true,
    best: 0,
    still: 0,
    finished: false,
    seed: 0xC0FFEE,
    summary: null,
};

const runs = [];
let runCount = 0;
let el = null;
let ui = null;
let sixRule = null;
let mounted = false;

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const rollSeed = () => ((Math.random() * 0xFFFFFFFF) >>> 0) || 1;
const $ = (id) => document.getElementById(id);

function rgbHex(rgb) {
    return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function paletteAttr() {
    return SIX_PALETTE.map(rgbHex).join(',');
}

function dims() {
    const [rows, cols] = ui.diameter.value.split(',').map(Number);
    return {layers: Number(ui.layers.value), rows, cols};
}

function alignPartition() {
    const offset = el.world.generation % PARTITION_PERIOD;
    if (offset) el.tick(PARTITION_PERIOD - offset);
}

function startBrew() {
    if (!el?.world) return;
    el.world.setBlockAlternates(true);
    el.setAttribute('palette', paletteAttr());
    el.setRule(sixRule);
    const {layers, rows, cols} = dims();
    el.setCells(makePuckCells({
        layers, rows, cols,
        packing: Number(ui.pack.value) / 100,
        seed: brew.seed,
        uneven: ui.uneven.checked,
        groundState: 3,
    }));
    alignPartition();
    const c = el.world.census();
    brew.tick = 0;
    brew.poured = 0;
    brew.cupWater = 0;
    brew.cupSat = 0;
    brew.groundTotal = c[3] + c[4] + c[5];
    brew.budget = Math.round(el.world.numCells * (Number(ui.water.value) / 100));
    brew.finished = false;
    brew.still = 0;
    render();
}

function pourAndDrip() {
    const world = el.world;
    const {layers, rows, columns: cols} = world;
    let touched = false;
    if (brew.poured < brew.budget) {
        const sites = injectionSites({
            rows, cols, flow: Number(ui.flow.value), mode: ui.pour.value,
            tick: brew.tick, remaining: brew.budget - brew.poured,
        });
        const n = world.paintIf(0, sites, 0, 1);
        brew.poured += n;
        if (n) touched = true;
    }
    const removed = world.clearStatesInLayer(layers - 1, 0b0110);
    brew.cupWater += removed[1] || 0;
    brew.cupSat += removed[2] || 0;
    if ((removed[1] || 0) + (removed[2] || 0)) touched = true;
    return touched;
}

function render() {
    if (!el?.world) return;
    const c = el.world.census();
    const grounds = c[3] + c[4] + c[5];
    const fluidInBed = c[1] + c[2];
    const cup = brew.cupWater + brew.cupSat;
    const yieldFrac = grounds ? c[5] / grounds : 0;
    if (yieldFrac > brew.best) brew.best = yieldFrac;

    $('p-yield').textContent = pct(yieldFrac);
    $('p-best').textContent = brew.best ? pct(brew.best) : '—';
    $('p-tick').textContent = brew.tick.toLocaleString();
    $('p-poured').textContent = brew.poured.toLocaleString();
    $('p-inbed').textContent = fluidInBed.toLocaleString();
    $('p-incup').textContent = cup.toLocaleString();

    const pouring = brew.poured < brew.budget;
    const choked = brew.finished && pouring;
    const phase = $('p-phase');
    phase.textContent = choked ? 'choked' : brew.finished ? 'finished' : pouring ? 'pouring' : 'draining';
    phase.style.color = choked ? 'var(--bad)' : 'var(--accent)';

    const names = ['air', 'water', 'saturated', 'dry ground', 'wet ground', 'spent ground'];
    const hex = SIX_PALETTE.map(rgbHex);
    const rowFor = (state) => `<tr>
        <th><span class="swatch" style="background:${hex[state]}"></span>${names[state]}</th>
        <td>${c[state].toLocaleString()}</td></tr>`;
    $('p-bed').innerHTML =
        rowFor(3) + rowFor(4) + rowFor(5)
        + `<tr class="sep"><th>grounds untouched</th><td>${grounds ? pct(c[3] / grounds) : '—'}</td></tr>`
        + `<tr><th>grounds spent</th><td>${grounds ? pct(c[5] / grounds) : '—'}</td></tr>`;

    const strength = cup ? brew.cupSat / cup : 0;
    $('p-cup').innerHTML =
        `<tr class="sep"><th>in the cup</th><td>${cup.toLocaleString()}</td></tr>`
        + `<tr><th>strength <span style="opacity:.7">saturated</span></th><td>${cup ? pct(strength) : '—'}</td></tr>`
        + `<tr><td colspan="2"><span class="meter ${strength > 0.6 ? 'good' : 'bad'}"><span style="width:${(strength * 100).toFixed(1)}%"></span></span></td></tr>`
        + `<tr><th>ran through unused</th><td>${cup ? pct(1 - strength) : '—'}</td></tr>`;

    brew.summary = {
        yield: yieldFrac, strength, cup, untouched: grounds ? c[3] / grounds : 0,
        inBed: fluidInBed, grounds, choked,
    };

    $('p-diag').innerHTML =
        `<b>${el.world.layers}×${el.world.rows}×${el.world.columns}</b>`
        + ` = ${el.world.numCells.toLocaleString()} cells`
        + ` · table <b>${6 ** 4}</b> entries`
        + ` · HCP 12-neighbour · partition <b>6-phase tet</b>`
        + (brew.still >= PARTITION_PERIOD ? ' · <b>settled</b>' : '');

    $('p-stagefoot').innerHTML = !brew.finished
        ? 'Same score as the 2D lab: spent grounds over all grounds. Drag to orbit, scroll to dolly, '
          + 'drop opacity to look into the bed, or pull the clip plane to cut a slab.'
        : choked
            ? `<b style="color:var(--bad)">The puck choked.</b> ${(brew.budget - brew.poured).toLocaleString()} `
              + 'cells of water never got in.'
            : c[3] > grounds * 0.8
                ? '<b style="color:var(--bad)">The water found a way around nearly all of the bed.</b> '
                  + 'Try a shower rather than a stream, or a looser pack.'
                : `<b style="color:var(--good)">Brew finished.</b> `
                  + `${fluidInBed.toLocaleString()} cells of liquid stayed held in the puck.`;
}

function recordRun() {
    const summary = brew.summary;
    if (!summary) return;
    const {layers, rows, cols} = dims();
    pushRunEntry(runs, {
        run: ++runCount,
        outcome: summary.choked ? 'choked' : 'finished',
        ticks: brew.tick,
        yield: summary.yield,
        strength: summary.strength,
        cup: summary.cup,
        untouched: summary.untouched,
        pour: ui.pour.value,
        flow: Number(ui.flow.value),
        water: Number(ui.water.value),
        pack: Number(ui.pack.value),
        layers, rows, cols,
        uneven: ui.uneven.checked,
        seed: brew.seed,
    });
    renderLog();
}

function renderLog() {
    const best = bestRunIndex(runs, 'yield');
    const head = ['#', 'outcome', 'pour', 'flow', 'water', 'pack', 'size', 'puck', 'ticks',
        'yield', 'strength', 'untouched', ''];
    const header = `<tr>${head.map((label, i) => `<th${i < 3 ? ' class="left"' : ''}>${label}</th>`).join('')}</tr>`;
    const body = runs.length
        ? runs.map((r, index) => `<tr class="${index === best ? 'best' : ''}">
            <td class="left">${r.run}</td>
            <td class="left ${r.outcome === 'choked' ? 'choked' : 'ok'}">${r.outcome}</td>
            <td class="left">${r.pour}</td>
            <td>${r.flow}</td>
            <td>${r.water}%</td>
            <td>${(r.pack / 100).toFixed(2)}</td>
            <td>${r.layers}×${r.rows}×${r.cols}</td>
            <td>${r.uneven ? 'loose' : 'even'}</td>
            <td>${r.ticks.toLocaleString()}</td>
            <td class="score">${pct(r.yield)}</td>
            <td>${pct(r.strength)}</td>
            <td>${pct(r.untouched)}</td>
            <td><button class="restore" data-run="${r.run}" title="Replay this brew exactly">restore</button></td>
        </tr>`).join('')
        : '<tr><td class="empty" colspan="13">No finished brews yet. Let one settle — the log fills itself.</td></tr>';
    $('p-log').innerHTML = header + body;
}

function restoreRun(run) {
    const entry = runs.find((r) => r.run === run);
    if (!entry) return;
    ui.pour.value = entry.pour;
    ui.flow.value = String(entry.flow);
    ui.water.value = String(entry.water);
    ui.pack.value = String(entry.pack);
    ui.diameter.value = `${entry.rows},${entry.cols}`;
    ui.layers.value = String(entry.layers);
    ui.uneven.checked = entry.uneven;
    syncLabels();
    brew.seed = entry.seed;
    if (!brew.running) { brew.running = true; ui.run.textContent = 'Pause'; }
    const current = dims();
    if (current.layers !== entry.layers || current.rows !== entry.rows || current.cols !== entry.cols) {
        applySize();
    } else {
        startBrew();
    }
}

function applySize() {
    const {layers, rows, cols} = dims();
    el.setAttribute('layers', String(layers));
    el.setAttribute('rows', String(rows));
    el.setAttribute('columns', String(cols));
}

function syncLabels() {
    $('p-flow-v').textContent = ui.flow.value;
    $('p-water-v').textContent = `${ui.water.value}%`;
    $('p-pack-v').textContent = (Number(ui.pack.value) / 100).toFixed(2);
    $('p-layers-v').textContent = ui.layers.value;
    $('p-clip-v').textContent = Number(ui.clip.value).toFixed(2);
    $('p-opacity-v').textContent = Number(ui.opacity.value).toFixed(2);
    $('p-speed-v').textContent = ui.speed.value;
}

export function stepPuck() {
    if (!el?.world || !brew.running) return;
    const limit = quietTickLimit(el.world.layers, el.world.blockAlternates ? 12 : 6);
    if (brew.still >= PARTITION_PERIOD || brew.tick > limit) {
        if (!brew.finished) { brew.finished = true; render(); recordRun(); }
        return;
    }
    const steps = Number(ui.speed.value);
    for (let i = 0; i < steps; i++) {
        const touched = pourAndDrip();
        const changed = el.world.tick(1);
        brew.tick++;
        brew.still = (touched || changed !== 0) ? 0 : brew.still + 1;
        if (brew.still >= PARTITION_PERIOD) break;
    }
    el.tick(0);
    render();
}

export function redrawPuck() {
    if (el?.world) el.tick(0);
}

export function puckMounted() {
    return mounted && !!el?.world;
}

export async function mountPuckLab() {
    if (mounted) {
        redrawPuck();
        return;
    }
    const [{blockRuleFromTet, initHcpEngine}] = await Promise.all([
        // eslint-disable-next-line import/no-unresolved -- bare specifier resolved by the page import map
        import('@hexlife/embed/hcp'),
        // eslint-disable-next-line import/no-unresolved -- bare specifier resolved by the page import map
        import('@hexlife/embed/hcp-element'),
    ]);
    await initHcpEngine();
    sixRule = blockRuleFromTet(6, puckSixTransition);
    if (![...sixRule].every((_, i) => {
        const input = [Math.floor(i / 216) % 6, Math.floor(i / 36) % 6, Math.floor(i / 6) % 6, i % 6];
        const packed = sixRule[i];
        return puckSixFamiliesPreserved(input, [
            packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, (packed >>> 24) & 255,
        ]);
    })) throw new Error('3D six-state family check failed');

    el = $('puck');
    ui = Object.fromEntries(Object.entries(P_IDS).map(([key, id]) => [key, $(id)]));

    const bind = (input, restart) => {
        input.addEventListener('input', () => {
            syncLabels();
            if (restart) startBrew();
        });
    };
    bind(ui.flow, false);
    bind(ui.water, true);
    bind(ui.pack, true);
    bind(ui.speed, false);
    ui.uneven.addEventListener('change', startBrew);
    ui.pour.addEventListener('change', startBrew);
    ui.brew.addEventListener('click', () => { brew.seed = rollSeed(); startBrew(); });
    ui.run.addEventListener('click', () => {
        brew.running = !brew.running;
        ui.run.textContent = brew.running ? 'Pause' : 'Run';
    });
    ui.clip.addEventListener('input', () => {
        syncLabels();
        el.setAttribute('clip', ui.clip.value);
    });
    ui.opacity.addEventListener('input', () => {
        syncLabels();
        el.setAttribute('opacity', ui.opacity.value);
    });
    ui.spin.addEventListener('change', () => {
        el.setAttribute('auto-rotate', ui.spin.checked ? 'true' : 'false');
    });
    ui.layers.addEventListener('input', syncLabels);
    ui.layers.addEventListener('change', applySize);
    ui.diameter.addEventListener('change', applySize);

    $('p-log').addEventListener('click', (event) => {
        const button = event.target.closest('button.restore');
        if (button) restoreRun(Number(button.dataset.run));
    });
    $('p-log-clear').addEventListener('click', () => {
        runs.length = 0;
        runCount = 0;
        renderLog();
    });

    syncLabels();
    renderLog();

    el.addEventListener('hexlife-hcp-ready', startBrew);
    if (el.world) startBrew();
    mounted = true;
}
