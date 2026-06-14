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
 * Protocol (worker → host):
 *   { type: 'READY' } | { type: 'INIT_ERROR', error }
 *   { type: 'EMBED_RESULT', id, embedding: ArrayBuffer } | { type: 'EMBED_ERROR', id, error }
 */

let RawImage = null;
let processor = null;
let model = null;
let ready = false;

/**
 * Lazily import transformers.js and load the CLIP vision encoder + its image processor. Tries the
 * requested device, falling back to wasm if an accelerated backend (webgpu) is unavailable.
 * @param {{modelId: string, cdnUrl: string, device: string, dtype: string}} opts
 */
async function init(opts) {
    const transformers = await import(/* @vite-ignore */ opts.cdnUrl);
    const { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage: RI } = transformers;
    RawImage = RI;

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
    }
};
