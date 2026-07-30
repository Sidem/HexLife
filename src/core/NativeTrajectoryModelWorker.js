// Package export is declared as "./wasm"; eslint-import-resolver-vite does not currently follow
// that conditional subpath, while Vite and Node resolve it correctly.
// eslint-disable-next-line import/no-unresolved
import * as ort from 'onnxruntime-web/wasm';
// ONNX Runtime otherwise derives this URL from its bundled module location. That works in a plain
// CDN build but points at an HTML fallback under Vite's dev worker graph. Import the asset explicitly
// so both dev and GitHub Pages production builds use Vite's hashed/base-aware URL.
// eslint-disable-next-line import/no-unresolved
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
// eslint-disable-next-line import/no-unresolved
import ortWasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { buildNativeTrajectoryInputs } from './analysis/NativeTrajectoryPreprocess.js';
import { validateNativeTrajectoryModelManifest } from './analysis/NativeTrajectoryModelManifest.js';

let session = null;
let manifest = null;
let backend = null;

function hex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function loadModel(manifestUrl) {
    const response = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`model manifest request failed (${response.status})`);
    const loaded = validateNativeTrajectoryModelManifest(await response.json());
    // Vite copies public/ verbatim, so the artifact sits at a stable, non-content-hashed URL that
    // GitHub Pages serves with max-age=600. The manifest above is force-revalidated but the artifact
    // is not, so a browser still holding a previous model.onnx would pair it with the fresh manifest
    // and fail the digest check below. Keying the URL on the digest self-invalidates whenever the
    // model changes, while keeping the artifact cacheable between changes.
    const artifactUrl = new URL(loaded.artifact, response.url);
    artifactUrl.searchParams.set('v', String(loaded.artifactSha256).toLowerCase());
    const artifactResponse = await fetch(artifactUrl.href);
    if (!artifactResponse.ok) throw new Error(`model artifact request failed (${artifactResponse.status})`);
    const artifact = await artifactResponse.arrayBuffer();
    const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', artifact)));
    if (digest !== String(loaded.artifactSha256).toLowerCase()) throw new Error('native-model artifact hash mismatch');

    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
        wasm: ortWasmUrl,
        mjs: ortWasmModuleUrl,
    };
    // The compact native model is CPU-oriented. The Wasm-only entry avoids shipping ONNX Runtime's
    // much larger WebGPU/JSEP binary; Stage 4B may add a separately benchmarked custom/WebGPU runtime
    // only if the measured model needs it.
    session = await ort.InferenceSession.create(artifact, { executionProviders: ['wasm'] });
    backend = 'wasm';
    manifest = loaded;
}

self.onmessage = async (event) => {
    const message = event.data || {};
    if (message.type === 'INIT') {
        try {
            await loadModel(message.manifestUrl);
            self.postMessage({ type: 'READY', manifest, backend });
        } catch (error) {
            self.postMessage({ type: 'INIT_ERROR', error: error?.message || String(error) });
        }
        return;
    }
    if (message.type !== 'EVALUATE') return;
    if (!session || !manifest) {
        self.postMessage({ type: 'EVALUATE_ERROR', id: message.id, error: 'native model is not ready' });
        return;
    }
    try {
        const frames = (message.frames || []).map((buffer) => new Uint8Array(buffer));
        if (frames.length > Number(manifest.maxFrames || 32)) throw new Error('trajectory exceeds model maxFrames');
        const inputs = buildNativeTrajectoryInputs({
            frames,
            rows: message.rows,
            cols: message.cols,
            tickOffsets: message.tickOffsets,
        });
        const outputs = await session.run({
            features: new ort.Tensor('uint8', inputs.features, inputs.featureDims),
            tick_offsets: new ort.Tensor('float32', inputs.tickOffsets, [1, frames.length]),
            frame_mask: new ort.Tensor('float32', inputs.frameMask, [1, frames.length]),
        });
        const descriptor = Float32Array.from(outputs.descriptor.data);
        const reward = Number(outputs.reward.data[0]);
        self.postMessage(
            { type: 'EVALUATE_RESULT', id: message.id, descriptor: descriptor.buffer, reward, modelId: manifest.modelId },
            [descriptor.buffer],
        );
    } catch (error) {
        self.postMessage({ type: 'EVALUATE_ERROR', id: message.id, error: error?.message || String(error) });
    }
};
