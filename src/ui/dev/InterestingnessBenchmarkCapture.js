import { classifyRulesetConstraint } from '../../core/rulesetDescriptor.js';
import {
    scoreSingleIC,
    applyConfirmation,
    SCORE_CONFIG,
} from '../../core/analysis/InterestingnessScore.js';
import { historicalNovelty, trajectoryNovelty } from '../../core/analysis/EmbeddingNovelty.js';
import {
    NOISE_PROMPTS,
    noiseSimilarity,
    noiseFactor,
} from '../../core/analysis/PerceptualContrast.js';

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

function buildBenchmarkPanel(library, negatives) {
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
    return [...positives, ...negatives.map(entry => ({ ...entry, cohort: 'stage0' }))]
        .map(entry => ({ ...entry, constraintClass: classifyRulesetConstraint(entry.hex) }));
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
    const panel = buildBenchmarkPanel(library, negatives);
    const positives = panel.filter(entry => entry.label === 'interesting');
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

async function captureCalibrationFrames(worldManager, entry, worldIndex) {
    const proxy = worldManager.worlds[worldIndex];
    worldManager._applyExploreRuleset(worldIndex, entry.hex);
    proxy.resetWorld(entry.initialState, entry.seed);
    const result = await proxy.runEvaluation({
        ticks: CONFIRM_TICKS,
        sampleEvery: SAMPLE_EVERY,
        warmupTicks: WARMUP_TICKS,
        probe: { enabled: true, probeTicks: PROBE_TICKS },
    });
    if (!result || result.cancelled) return null;

    const frames = [];
    const first = await worldManager._captureExploreFrame(worldIndex);
    if (first) frames.push(first);
    for (let i = 1; i < 6; i++) {
        const advanced = await proxy.runEvaluation({
            ticks: 50,
            sampleEvery: SAMPLE_EVERY,
            warmupTicks: 0,
            probe: { enabled: false },
        });
        if (!advanced || advanced.cancelled) break;
        const frame = await worldManager._captureExploreFrame(worldIndex);
        if (frame) frames.push(frame);
    }
    return {
        confirmMetrics: normalizeMetrics(result, entry.icLabel),
        frames,
    };
}

async function embedCalibrationFrames(embeddingService, captured, promptVectors) {
    if (!captured || captured.frames.length < 2) return null;
    const embeddings = [];
    for (const frame of captured.frames) {
        const vector = await embeddingService.embed(frame);
        if (vector && vector.length) embeddings.push(vector);
    }
    if (embeddings.length < 2) return null;
    const openEndedness = historicalNovelty(embeddings);
    const similarity = noiseSimilarity(embeddings, promptVectors);
    if (!Number.isFinite(similarity)) return null;
    const confirmIC = scoreSingleIC({
        ...captured.confirmMetrics,
        embedding: { openEndedness },
    }, SCORE_CONFIG);
    const confirmed = applyConfirmation(0, confirmIC, captured.confirmMetrics, {
        ...SCORE_CONFIG,
        confirmCycleMaxPeriod: 120,
        confirmCyclePenalty: 0.25,
    });
    return {
        openEndedness,
        trajectorySpeed: trajectoryNovelty(embeddings),
        noiseSimilarity: similarity,
        unpenalizedScore: confirmed.rejected ? 0 : confirmed.finalScore,
        rejected: confirmed.rejected,
        cyclic: confirmed.cyclic,
    };
}

function quantile(values, q) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * q;
    const lo = Math.floor(position);
    const hi = Math.ceil(position);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

function contrastStats(entries, config) {
    const scored = entries.map(entry => ({
        ...entry,
        score: entry.unpenalizedScore * noiseFactor(entry.noiseSimilarity, config),
    }));
    const positives = scored.filter(entry => entry.label === 'interesting');
    const negatives = scored.filter(entry => entry.label === 'boring');
    let wins = 0;
    let pairs = 0;
    for (const positive of positives) {
        for (const negative of negatives) {
            pairs++;
            if (positive.score > negative.score) wins++;
        }
    }
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
        strength: config.strength,
        wins,
        pairs,
        pairwiseAccuracy: pairs ? wins / pairs : NaN,
        marginMean: mean(positives.map(entry => entry.score)) - mean(negatives.map(entry => entry.score)),
    };
}

async function capturePerceptualCalibration(appContext, library, negatives, onProgress) {
    const worldManager = appContext.worldManager;
    const embeddingService = worldManager.embeddingService;
    embeddingService.setEnabled(true);
    onProgress('Loading the default CLIP model…');
    if (!await embeddingService.ensureReady()) throw new Error('CLIP model failed to load');

    onProgress('Embedding the fixed noise-prompt battery…');
    const promptVectors = [];
    for (const prompt of NOISE_PROMPTS) {
        const vector = await embeddingService.embedText(prompt);
        if (vector && vector.length) promptVectors.push(vector);
    }
    if (!promptVectors.length) throw new Error('Noise prompts failed to embed');

    const panel = buildBenchmarkPanel(library, negatives);
    const references = [
        {
            id: 'reference_gliders_chaos',
            label: 'reference',
            hex: REFERENCE_RULESETS.gliders,
            icLabel: 'chaos',
            seed: 4242,
            initialState: REFERENCE_ICS.chaos,
        },
        {
            id: 'reference_churn_sparse',
            label: 'reference',
            hex: REFERENCE_RULESETS.churn,
            icLabel: 'sparse',
            seed: 1781242654715,
            initialState: REFERENCE_ICS.sparse,
        },
    ];
    const recipes = [...panel, ...references];
    const rows = [];
    const snapshot = worldManager._captureAutoExploreSnapshot();
    worldManager._setAllWorldsEnabledForExplore(true);
    try {
        const worldCount = worldManager.worlds.length;
        for (let offset = 0; offset < recipes.length; offset += worldCount) {
            const batch = recipes.slice(offset, offset + worldCount);
            onProgress(`Capturing perceptual trajectories ${offset + 1}–${offset + batch.length} of ${recipes.length}…`);
            const captured = await Promise.all(batch.map((entry, index) =>
                captureCalibrationFrames(worldManager, entry, index)
            ));
            for (let index = 0; index < batch.length; index++) {
                onProgress(`Embedding trajectory ${offset + index + 1} of ${recipes.length}…`);
                const perceptual = await embedCalibrationFrames(embeddingService, captured[index], promptVectors);
                if (perceptual) rows.push({ ...batch[index], ...perceptual });
            }
        }
    } finally {
        worldManager._restoreAutoExploreSnapshot(snapshot);
    }

    const panelRows = rows.filter(entry => entry.label !== 'reference');
    const positiveSimilarities = panelRows
        .filter(entry => entry.label === 'interesting')
        .map(entry => entry.noiseSimilarity);
    const negativeSimilarities = panelRows
        .filter(entry => entry.label === 'boring')
        .map(entry => entry.noiseSimilarity);
    const simMin = quantile(positiveSimilarities, 0.75);
    const simMax = quantile(negativeSimilarities, 0.5);
    if (!(simMax > simMin)) {
        throw new Error(`Noise contrast did not separate the panel (positive q75 ${simMin}, negative median ${simMax})`);
    }
    const candidates = [];
    for (let strength = 0; strength <= 0.9001; strength += 0.05) {
        candidates.push(contrastStats(panelRows, { simMin, simMax, strength: Number(strength.toFixed(2)) }));
    }
    // Prefer the smallest strength that reaches the best pairwise accuracy. Margin is diagnostic,
    // but must not make an optional model-derived multiplier harsher once the ordering stops improving.
    candidates.sort((a, b) =>
        b.pairwiseAccuracy - a.pairwiseAccuracy
        || a.strength - b.strength
        || b.marginMean - a.marginMean
    );
    const best = candidates[0];
    const referenceRows = rows.filter(entry => entry.label === 'reference');
    const glider = referenceRows.find(entry => entry.id === 'reference_gliders_chaos');
    const churn = referenceRows.find(entry => entry.id === 'reference_churn_sparse');
    const recommendedHalfSat = glider && churn && glider.openEndedness > 0 && churn.openEndedness > 0
        ? Math.sqrt(glider.openEndedness * churn.openEndedness)
        : null;

    return {
        _meta: {
            description: '#37 Stage-3 CLIP calibration; generated in-browser from deterministic recipes.',
            capturedAt: new Date().toISOString().slice(0, 10),
            embeddingSpace: embeddingService.getSpaceId(),
            prompts: NOISE_PROMPTS,
            trajectory: { frames: 6, frameTicks: 50, confirmTicks: CONFIRM_TICKS },
            rowsCaptured: panelRows.length,
        },
        distributions: {
            interesting: {
                min: quantile(positiveSimilarities, 0),
                q25: quantile(positiveSimilarities, 0.25),
                median: quantile(positiveSimilarities, 0.5),
                q75: simMin,
                max: quantile(positiveSimilarities, 1),
            },
            boring: {
                min: quantile(negativeSimilarities, 0),
                q25: quantile(negativeSimilarities, 0.25),
                median: simMax,
                q75: quantile(negativeSimilarities, 0.75),
                max: quantile(negativeSimilarities, 1),
            },
        },
        recommendation: {
            simMin,
            simMax,
            strength: best.strength,
            pairwiseAccuracy: best.pairwiseAccuracy,
            marginMean: best.marginMean,
            baselineEmbeddingsOn: contrastStats(panelRows, { simMin, simMax, strength: 0 }),
            openEndednessHalfSat: recommendedHalfSat,
        },
        references: referenceRows.map(({ id, openEndedness, trajectorySpeed, noiseSimilarity }) => ({
            id, openEndedness, trajectorySpeed, noiseSimilarity,
        })),
        strengthSweep: candidates.sort((a, b) => a.strength - b.strength),
        entries: panelRows.map(({
            id, label, hex, constraintClass, openEndedness, trajectorySpeed,
            noiseSimilarity: similarity, unpenalizedScore, rejected, cyclic,
        }) => ({
            id, label, hex, constraintClass, openEndedness, trajectorySpeed,
            noiseSimilarity: similarity, unpenalizedScore, rejected, cyclic,
        })),
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
        <button id="perceptual-run" type="button" disabled>Calibrate Stage 3 perceptual contrast</button>
        <a id="benchmark-download" hidden>Download JSON</a>
        <pre id="benchmark-json" data-testid="benchmark-json" hidden></pre>
    `;
    document.body.append(host);

    const status = host.querySelector('#benchmark-status');
    const referenceButton = host.querySelector('#reference-run');
    const button = host.querySelector('#benchmark-run');
    const perceptualButton = host.querySelector('#perceptual-run');
    const download = host.querySelector('#benchmark-download');
    const output = host.querySelector('#benchmark-json');

    waitForWorkers(appContext.worldManager).then(() => {
        status.textContent = 'Ready.';
        referenceButton.disabled = false;
        button.disabled = false;
        perceptualButton.disabled = false;
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
        perceptualButton.disabled = true;
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
            perceptualButton.disabled = false;
        }
    });

    button.addEventListener('click', async () => {
        referenceButton.disabled = true;
        button.disabled = true;
        perceptualButton.disabled = true;
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
            perceptualButton.disabled = false;
        }
    });

    perceptualButton.addEventListener('click', async () => {
        referenceButton.disabled = true;
        button.disabled = true;
        perceptualButton.disabled = true;
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
            const calibration = await capturePerceptualCalibration(appContext, library, negatives, message => {
                status.textContent = message;
            });
            publishResult(calibration, 'perceptualContrastCalibration.json');
            status.textContent = `Complete: ${calibration._meta.rowsCaptured} perceptual entries.`;
            document.title = 'Perceptual calibration complete';
        } catch (error) {
            console.error('Perceptual calibration failed:', error);
            status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            referenceButton.disabled = false;
            button.disabled = false;
            perceptualButton.disabled = false;
        }
    });
}
