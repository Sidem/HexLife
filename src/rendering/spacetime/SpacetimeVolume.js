/**
 * The scrub ring, mirrored into GPU memory as a `TEXTURE_2D_ARRAY` (#40 Phase 2).
 *
 * One retained tick is one texture layer; one cell is one `R8UI` byte holding `rule * 2 + state`,
 * which the fragment shader uses as a direct index into the live 128x2 colour LUT. That is why a
 * palette change retints the entire history with **zero** re-upload: `generateColorLUT` rewrites
 * 128x2 texels and not one byte of this volume moves.
 *
 * Ring semantics mirror {@link StateHistoryRing} exactly — `push` overwrites the oldest layer once
 * full, `truncate` drops the newest, `reset` empties it — because the object on screen *is* that
 * ring, and any divergence would show as the shape disagreeing with the scrub bar. The layers are
 * stored in physical write order and unwrapped in the shader from `base`, so a `push` at capacity
 * costs exactly one `texSubImage3D` and never a shuffle.
 *
 * The whole module lives in the lazily imported spacetime chunk, so a session that never opens the
 * mode never even fetches this file, let alone allocates the texture (#40 §2.1).
 */
export class SpacetimeVolume {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {number} cols
     * @param {number} rows
     * @param {number} depth Layer capacity — already clamped to the ring size and the device cap.
     */
    constructor(gl, cols, rows, depth) {
        this.gl = gl;
        this.cols = cols;
        this.rows = rows;
        this.depth = Math.max(1, depth);
        /** Physical layer the next push writes to. */
        this.head = 0;
        /** Layers currently holding real history (≤ depth). */
        this.length = 0;
        /** Tick number of the newest layer, for headless verification against the flat view. */
        this.tipTick = -1;
        /** Total uploads since creation, so a "zero re-upload" claim can be checked, not asserted. */
        this.uploads = 0;

        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, cols, rows, this.depth);
        // Integer textures cannot be filtered.
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    }

    /**
     * Physical index of the OLDEST live layer. The shader walks up from here, wrapping at `depth`,
     * so logical layer `i` (0 = oldest, at the bottom of the object) is physical `(base + i) % depth`.
     */
    get base() {
        return ((this.head - this.length) % this.depth + this.depth) % this.depth;
    }

    /**
     * Upload one tick as the new tip.
     * @param {ArrayBuffer|Uint8Array} layer `cols * rows` bytes of `rule * 2 + state`.
     * @param {number} [tick]
     */
    push(layer, tick = -1) {
        const bytes = layer instanceof Uint8Array ? layer : new Uint8Array(layer);
        if (bytes.length < this.cols * this.rows) return false;
        this._upload(this.head, bytes.subarray(0, this.cols * this.rows), 1);
        this.head = (this.head + 1) % this.depth;
        if (this.length < this.depth) this.length++;
        this.tipTick = tick;
        return true;
    }

    /**
     * Replace the whole volume with the frames the worker's ring already held, oldest → newest.
     * Written as ONE `texSubImage3D` of the (up to `depth`) contiguous layers rather than a loop,
     * because on enable this is the single largest upload the mode ever makes.
     * @param {ArrayBuffer|Uint8Array} layers `count * cols * rows` bytes, oldest layer first.
     * @param {number} count
     */
    backfill(layers, count) {
        const cells = this.cols * this.rows;
        const bytes = layers instanceof Uint8Array ? layers : new Uint8Array(layers);
        // A ring deeper than the texture (a device cap below 240) keeps the NEWEST frames — the tip
        // is what the user is looking at, and the oldest ticks are the ones scrolling out anyway.
        const kept = Math.min(count, this.depth, Math.floor(bytes.length / cells) || 0);
        this.head = 0;
        this.length = kept;
        if (kept <= 0) return 0;
        const skipped = count - kept;
        this._upload(0, bytes.subarray(skipped * cells, (skipped + kept) * cells), kept);
        this.head = kept % this.depth;
        return kept;
    }

    /**
     * Drop the newest layers so exactly `length` remain — the worker truncating the recorded future
     * when the user resumes from a scrub. No texels are touched: the layers stay where they are and
     * simply stop being addressed, which is what makes the top of the object disappear for free.
     */
    truncate(length) {
        const kept = Math.max(0, Math.min(Math.floor(length) || 0, this.length));
        const dropped = this.length - kept;
        if (dropped <= 0) return 0;
        this.head = ((this.head - dropped) % this.depth + this.depth) % this.depth;
        this.length = kept;
        return dropped;
    }

    /** Empty the volume (the recorded timeline was discarded). Again, no upload — just indices. */
    reset() {
        this.head = 0;
        this.length = 0;
        this.tipTick = -1;
    }

    /** True once there is anything to draw. */
    get isEmpty() {
        return this.length === 0;
    }

    _upload(firstLayer, bytes, layerCount) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
        // One byte per cell with no row padding. An odd column count (222 at the medium preset) is
        // not a multiple of the default 4-byte unpack alignment, and the upload is rejected outright
        // with "ArrayBufferView not big enough" without this.
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(
            gl.TEXTURE_2D_ARRAY, 0, 0, 0, firstLayer, this.cols, this.rows, layerCount,
            gl.RED_INTEGER, gl.UNSIGNED_BYTE, bytes,
        );
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        this.uploads++;
    }

    dispose() {
        if (!this.texture) return;
        this.gl.deleteTexture(this.texture);
        this.texture = null;
        this.length = 0;
        this.head = 0;
    }
}
