/**
 * Foundation-model embedding worker for the perceptual auto-explore objective (v3.0, ASAL-style).
 * Loads a small CLIP image encoder via transformers.js and turns rendered frames (RGBA pixels) into
 * embedding vectors, entirely off the main/sim threads.
 *
 * transformers.js is dynamically imported from a CDN (passed in the INIT message) rather than bundled,
 * so the multi-MB library + ONNX runtime are only fetched when the user opts in, and the model weights
 * (tens of MB) are browser-cached by transformers.js for subsequent loads. A Vite-ignore annotation on
 * the dynamic import keeps Vite from trying to resolve/bundle the runtime URL at build time.
 *
 * Contract: this worker NEVER throws across the message boundary. Every failure (library fetch, model
 * load, unsupported browser, inference error) is reported as an INIT_ERROR / EMBED_ERROR message, and
 * {@link module:services/EmbeddingService} degrades the search to the statistical objective. The host
 * app therefore works identically whether or not a model is ever available.
 *
 * Protocol (host → worker):
 *   { type: 'INIT', modelId, cdnUrl, device, dtype }
 *   { type: 'EMBED', id, width, height, data: ArrayBuffer }   // RGBA bytes, width*height*4
 *   { type: 'EMBED_TEXT', id, text }                          // a natural-language target prompt (v3.2)
 * Protocol (worker → host):
 *   { type: 'READY' } | { type: 'INIT_ERROR', error }
 *   { type: 'EMBED_RESULT', id, embedding: ArrayBuffer } | { type: 'EMBED_ERROR', id, error }
 *   { type: 'EMBED_TEXT_RESULT', id, embedding: ArrayBuffer } | { type: 'EMBED_TEXT_ERROR', id, error }
 */

let RawImage = null;
let processor = null;
let model = null;
let ready = false;

// --- Text tower (v3.2, ASAL supervised target search) ---------------------------------------------
// The text encoder is loaded LAZILY on the first EMBED_TEXT (users who never type a target prompt don't
// pay the download). The transformers module + the INIT options are captured at INIT so the text pipeline
// loads from the SAME modelId as the active vision encoder (a mismatched text tower silently produces
// garbage similarities). `textLoadPromise` is cached so concurrent EMBED_TEXTs share one load.
let transformersMod = null;
let initOpts = null;
let tokenizer = null;
let textModel = null;
let textLoadPromise = null;

/**
 * Lazily import transformers.js and load the CLIP vision encoder + its image processor. Tries the
 * requested device, falling back to wasm if an accelerated backend (webgpu) is unavailable.
 * @param {{modelId: string, cdnUrl: string, device: string, dtype: string}} opts
 */
async function init(opts) {
    const transformers = await import(/* @vite-ignore */ opts.cdnUrl);
    const { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage: RI } = transformers;
    RawImage = RI;
    // Captured for the lazy text-tower load (same module + modelId/device/dtype as the vision path).
    transformersMod = transformers;
    initOpts = opts;

    // Pull weights from the Hub (not the local /models path) and let the browser cache them.
    if (env) {
        env.allowLocalModels = false;
        if (env.useBrowserCache !== undefined) env.useBrowserCache = true;
    }

    const dtype = opts.dtype || 'q8';
    const wanted = opts.device && opts.device !== 'auto' ? opts.device : undefined;

    processor = await AutoProcessor.from_pretrained(opts.modelId);
    try {
        model = await CLIPVisionModelWithProjection.from_pretrained(opts.modelId, { dtype, device: wanted });
    } catch (err) {
        // An accelerated backend may be unavailable (no WebGPU) — fall back to the portable wasm one.
        if (wanted && wanted !== 'wasm') {
            model = await CLIPVisionModelWithProjection.from_pretrained(opts.modelId, { dtype, device: 'wasm' });
        } else {
            throw err;
        }
    }
    ready = true;
}

/**
 * Embed one RGBA frame into a (projected, L2-normalized) CLIP image embedding.
 * @param {{width: number, height: number, data: ArrayBuffer}} msg
 * @returns {Promise<Float32Array>}
 */
async function embed(msg) {
    const rgba = new Uint8ClampedArray(msg.data);
    // RawImage(data, width, height, channels). Drop alpha → RGB, which the CLIP processor expects.
    const image = new RawImage(rgba, msg.width, msg.height, 4).rgb();
    const inputs = await processor(image);
    const { image_embeds } = await model(inputs);
    const data = image_embeds.data; // Float32Array (projection dim, e.g. 512)
    // Copy out of the tensor's backing store into a standalone, transferable buffer.
    const out = new Float32Array(data.length);
    out.set(data);
    return out;
}

/**
 * Lazily load the CLIP text tower (tokenizer + projection head) for the active model, tries the
 * requested device with the same webgpu→wasm fallback as the vision path. Cached: concurrent callers
 * share one load promise. Requires INIT to have run first (captures the transformers module + opts).
 * @returns {Promise<void>}
 */
function loadTextPipeline() {
    if (textLoadPromise) return textLoadPromise;
    textLoadPromise = (async () => {
        if (!transformersMod || !initOpts) throw new Error('text tower requested before INIT');
        const { AutoTokenizer, CLIPTextModelWithProjection } = transformersMod;
        const dtype = initOpts.dtype || 'q8';
        const wanted = initOpts.device && initOpts.device !== 'auto' ? initOpts.device : undefined;
        tokenizer = await AutoTokenizer.from_pretrained(initOpts.modelId);
        try {
            textModel = await CLIPTextModelWithProjection.from_pretrained(initOpts.modelId, { dtype, device: wanted });
        } catch (err) {
            if (wanted && wanted !== 'wasm') {
                textModel = await CLIPTextModelWithProjection.from_pretrained(initOpts.modelId, { dtype, device: 'wasm' });
            } else {
                throw err;
            }
        }
    })();
    // A failed load must not be cached as a permanent reject — clear it so a later prompt can retry.
    textLoadPromise.catch(() => { textLoadPromise = null; });
    return textLoadPromise;
}

/**
 * Embed a natural-language prompt into a (projected, L2-normalized) CLIP text embedding, comparable by
 * cosine against the image embeddings from {@link embed}. Both sides are unit-normalized here.
 * @param {{text: string}} msg
 * @returns {Promise<Float32Array>}
 */
async function embedText(msg) {
    await loadTextPipeline();
    const inputs = tokenizer([String(msg.text ?? '')], { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    const data = text_embeds.data; // Float32Array (projection dim, e.g. 512)
    // Copy out into a standalone buffer and L2-normalize so cosine == dot at the consumer.
    const out = new Float32Array(data.length);
    let norm = 0;
    for (let i = 0; i < data.length; i++) norm += data[i] * data[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-12) {
        for (let i = 0; i < data.length; i++) out[i] = data[i] / norm;
    } else {
        out.set(data);
    }
    return out;
}

self.onmessage = async (event) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === 'INIT') {
        try {
            await init(msg);
            self.postMessage({ type: 'READY' });
        } catch (err) {
            self.postMessage({ type: 'INIT_ERROR', error: (err && err.message) || String(err) });
        }
        return;
    }

    if (msg.type === 'EMBED') {
        if (!ready) {
            self.postMessage({ type: 'EMBED_ERROR', id: msg.id, error: 'model not ready' });
            return;
        }
        try {
            const embedding = await embed(msg);
            self.postMessage({ type: 'EMBED_RESULT', id: msg.id, embedding: embedding.buffer }, [embedding.buffer]);
        } catch (err) {
            self.postMessage({ type: 'EMBED_ERROR', id: msg.id, error: (err && err.message) || String(err) });
        }
        return;
    }

    if (msg.type === 'EMBED_TEXT') {
        if (!ready) {
            self.postMessage({ type: 'EMBED_TEXT_ERROR', id: msg.id, error: 'model not ready' });
            return;
        }
        try {
            const embedding = await embedText(msg);
            self.postMessage({ type: 'EMBED_TEXT_RESULT', id: msg.id, embedding: embedding.buffer }, [embedding.buffer]);
        } catch (err) {
            self.postMessage({ type: 'EMBED_TEXT_ERROR', id: msg.id, error: (err && err.message) || String(err) });
        }
    }
};
