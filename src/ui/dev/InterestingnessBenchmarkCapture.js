import { classifyRulesetConstraint } from '../../core/rulesetDescriptor.js';

const SCREEN_TICKS = 160;
const CONFIRM_TICKS = 600;
const SAMPLE_EVERY = 10;
const WARMUP_TICKS = 20;
const PROBE_TICKS = 64;
const REFERENCE_RULESETS = {
    churn: '4CAC74B122612B1EEBE3FFFDDCFBFFB7',
    gliders: '12482080480080006880800180010117',
};
const REFERENCE_ICS = {
    chaos: { mode: 'density', params: { density: 0.5 } },
    sparse: { mode: 'density', params: { density: 0.05 } },
    seed: {
        mode: 'cluster',
        params: {
            count: 1, density: 1, densityVariation: 0, diameter: 14, diameterVariation: 0,
            eccentricity: 0, orientation: 0, orientationVariation: 0, gaussianStdDev: 1.5,
        },
    },
};
const REFERENCE_CASES = [
    { id: 'churn_sparse_160', hex: REFERENCE_RULESETS.churn, icLabel: 'sparse', seed: 1781242654715, ticks: 160 },
    { id: 'churn_sparse_600', hex: REFERENCE_RULESETS.churn, icLabel: 'sparse', seed: 1781242654715, ticks: 600 },
    { id: 'gliders_chaos_160', hex: REFERENCE_RULESETS.gliders, icLabel: 'chaos', seed: 4242, ticks: 160 },
    { id: 'gliders_sparse_160', hex: REFERENCE_RULESETS.gliders, icLabel: 'sparse', seed: 4242, ticks: 160 },
    { id: 'gliders_seed_160', hex: REFERENCE_RULESETS.gliders, icLabel: 'seed', seed: 4242, ticks: 160 },
];

// Preserve the original Stage-0 panel as a longitudinal slice inside the expanded library snapshot.
const STAGE0_POSITIVE_HEXES = new Set([
    '004180808001D20490122500400D0800',
    '400811081000190281004A0844200020',
    '0860021D400412C2C8008E110205A182',
    '0088800010028810820000F431000D08',
    '00248110000200838101085400000010',
    '2505020A152DFF2CBB21326B0277901F',
    '120C11B442568E21134E30A85A40C880',
    '12482080480080006880800180010117',
    '8157327A1F4C7AC80152275D1C3F67B7',
    '84304E4024A82000162D5CB263E49A49',
    '12080081400181171249219649169669',
    '12482080480080016880811580170737',
    '16686880688080000117177E177E7EE8',
    '16686881688181160117177E177E7EE8',
    '6880800180010116E880800080000001',
    '16686880688080006880800080000001',
]);

function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
}

function normalizeMetrics(result, icLabel) {
    const { probeHamming, ruleUsageDelta, worldIndex, type, ...rest } = result;
    void probeHamming;
    void worldIndex;
    void type;
    if (rest.blockEntropy?.samples) {
        rest.blockEntropy = { ...rest.blockEntropy };
        delete rest.blockEntropy.samples;
    }
    rest.ruleUsageDelta = Array.from(new Uint32Array(ruleUsageDelta));
    rest.icLabel = icLabel;
    return rest;
}

function normalizeReferenceMetrics(result) {
    const { probeHamming, ruleUsageDelta, ...rest } = result;
    void probeHamming;
    if (rest.blockEntropy?.samples) {
        rest.blockEntropy = { ...rest.blockEntropy };
        delete rest.blockEntropy.samples;
    }
    rest.ruleUsageDelta = Array.from(new Uint32Array(ruleUsageDelta));
    return rest;
}

async function captureBurst(worldManager, entry, ticks, worldIndex) {
    const proxy = worldManager.worlds[worldIndex];
    worldManager._applyExploreRuleset(worldIndex, entry.hex);
    proxy.resetWorld(entry.initialState, entry.seed);
    const result = await proxy.runEvaluation({
        ticks,
        sampleEvery: SAMPLE_EVERY,
        warmupTicks: WARMUP_TICKS,
        probe: { enabled: true, probeTicks: PROBE_TICKS },
    });
    return normalizeMetrics(result, entry.icLabel);
}

async function capturePanel(appContext, library, negatives, onProgress) {
    const positives = library.map((entry, index) => ({
        id: `lib${String(index).padStart(2, '0')}_${slug(entry.name)}`,
        label: 'interesting',
        source: `library:${index}`,
        note: entry.name,
        cohort: STAGE0_POSITIVE_HEXES.has(entry.hex) ? 'stage0' : 'library-2026-07-28',
        hex: entry.hex,
        icLabel: `library:${entry.initialState.mode}`,
        seed: entry.seed,
        initialState: entry.initialState,
    }));
    const panel = [...positives, ...negatives.map(entry => ({ ...entry, cohort: 'stage0' }))];
    const entries = [];
    const worldCount = appContext.worldManager.worlds.length;

    for (let offset = 0; offset < panel.length; offset += worldCount) {
        const batch = panel.slice(offset, offset + worldCount);
        onProgress(`Screening ${offset + 1}–${offset + batch.length} of ${panel.length}…`);
        const metrics = await Promise.all(batch.map((entry, i) =>
            captureBurst(appContext.worldManager, entry, SCREEN_TICKS, i)
        ));
        onProgress(`Confirming ${offset + 1}–${offset + batch.length} of ${panel.length}…`);
        const confirmMetrics = await Promise.all(batch.map((entry, i) =>
            captureBurst(appContext.worldManager, entry, CONFIRM_TICKS, i)
        ));
        for (let i = 0; i < batch.length; i++) {
            const entry = batch[i];
            entries.push({
                ...entry,
                constraintClass: classifyRulesetConstraint(entry.hex),
                metrics: metrics[i],
                confirmMetrics: confirmMetrics[i],
            });
        }
    }

    return {
        _meta: {
            description: 'Complete public-library interestingness benchmark (#37 refresh). Real EVALUATION_RESULT captures for every curated public ruleset and the Stage-0 hand-verified boring controls. Generated by ?headless=1&benchmark=1 — never hand-edit.',
            capture: {
                warmupTicks: WARMUP_TICKS,
                sampleEvery: SAMPLE_EVERY,
                probeTicks: PROBE_TICKS,
                screenTicks: SCREEN_TICKS,
                confirmTicks: CONFIRM_TICKS,
                embeddings: 'off',
                gridCols: 222,
                gridRows: 192,
            },
            capturedAt: new Date().toISOString().slice(0, 10),
            libraryCount: library.length,
            counts: {
                total: entries.length,
                interesting: positives.length,
                boring: negatives.length,
                stage0Interesting: positives.filter(entry => entry.cohort === 'stage0').length,
            },
            byClass: entries.reduce((acc, entry) => {
                const key = `${entry.constraintClass}/${entry.label}`;
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {}),
        },
        entries,
    };
}

async function captureReferences(appContext, priorMeta, onProgress) {
    const output = { _meta: priorMeta };
    onProgress(`Capturing ${REFERENCE_CASES.length} reference fixtures…`);
    const results = await Promise.all(REFERENCE_CASES.map(async (entry, worldIndex) => {
        const proxy = appContext.worldManager.worlds[worldIndex];
        appContext.worldManager._applyExploreRuleset(worldIndex, entry.hex);
        proxy.resetWorld(REFERENCE_ICS[entry.icLabel], entry.seed);
        const result = await proxy.runEvaluation({
            ticks: entry.ticks,
            sampleEvery: SAMPLE_EVERY,
            warmupTicks: WARMUP_TICKS,
            probe: { enabled: true, probeTicks: PROBE_TICKS },
        });
        return normalizeReferenceMetrics(result);
    }));
    for (let i = 0; i < REFERENCE_CASES.length; i++) {
        output[REFERENCE_CASES[i].id] = results[i];
    }
    return output;
}

function waitForWorkers(worldManager) {
    if (worldManager.areAllWorkersInitialized()) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setInterval(() => {
            if (!worldManager.areAllWorkersInitialized()) return;
            clearInterval(timer);
            resolve();
        }, 50);
    });
}

/**
 * Mount a headless/dev-only deterministic benchmark runner.
 * @param {import('../../core/AppContext.js').AppContext} appContext
 * @param {any[]} library
 */
export function mountInterestingnessBenchmarkCapture(appContext, library) {
    const host = document.createElement('section');
    host.id = 'interestingness-benchmark-capture';
    host.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#10141c;color:#eef3ff;padding:24px;overflow:auto;font:14px/1.5 monospace';
    host.innerHTML = `
        <h1>Interestingness benchmark capture</h1>
        <p id="benchmark-status">Waiting for simulation workers…</p>
        <button id="reference-run" type="button" disabled>Capture 5 reference fixtures</button>
        <button id="benchmark-run" type="button" disabled>Capture ${library.length} library entries + controls</button>
        <a id="benchmark-download" hidden>Download JSON</a>
        <pre id="benchmark-json" data-testid="benchmark-json" hidden></pre>
    `;
    document.body.append(host);

    const status = host.querySelector('#benchmark-status');
    const referenceButton = host.querySelector('#reference-run');
    const button = host.querySelector('#benchmark-run');
    const download = host.querySelector('#benchmark-download');
    const output = host.querySelector('#benchmark-json');

    waitForWorkers(appContext.worldManager).then(() => {
        status.textContent = 'Ready.';
        referenceButton.disabled = false;
        button.disabled = false;
    });

    const publishResult = (value, filename) => {
        const json = JSON.stringify(value, null, 1);
        output.textContent = json;
        output.hidden = false;
        download.href = URL.createObjectURL(new Blob([`${json}\n`], { type: 'application/json' }));
        download.download = filename;
        download.hidden = false;
        return json;
    };

    referenceButton.addEventListener('click', async () => {
        referenceButton.disabled = true;
        button.disabled = true;
        try {
            const fixtureUrl = `${import.meta.env.BASE_URL}tests/fixtures/exploreEvalFixtures.json`;
            const prior = await fetch(fixtureUrl).then(response => response.json());
            const references = await captureReferences(appContext, prior._meta, message => {
                status.textContent = message;
            });
            publishResult(references, 'exploreEvalFixtures.json');
            status.textContent = `Complete: ${REFERENCE_CASES.length} reference fixtures.`;
            document.title = 'Reference capture complete';
        } catch (error) {
            console.error('Reference capture failed:', error);
            status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            referenceButton.disabled = false;
            button.disabled = false;
        }
    });

    button.addEventListener('click', async () => {
        referenceButton.disabled = true;
        button.disabled = true;
        try {
            const fixtureUrl = `${import.meta.env.BASE_URL}tests/fixtures/interestingnessBenchmark.json`;
            const prior = await fetch(fixtureUrl).then(response => response.json());
            const negatives = prior.entries
                .filter(entry => entry.label === 'boring')
                .map(entry => ({
                    id: entry.id,
                    label: entry.label,
                    source: entry.source,
                    note: entry.note,
                    hex: entry.hex,
                    icLabel: entry.icLabel,
                    seed: entry.seed,
                    initialState: entry.initialState,
                }));
            const benchmark = await capturePanel(appContext, library, negatives, message => {
                status.textContent = message;
            });
            publishResult(benchmark, 'interestingnessBenchmark.json');
            status.textContent = `Complete: ${benchmark.entries.length} entries.`;
            document.title = 'Benchmark capture complete';
        } catch (error) {
            console.error('Benchmark capture failed:', error);
            status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            referenceButton.disabled = false;
            button.disabled = false;
        }
    });
}
