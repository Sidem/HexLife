/* @ts-self-types="./hexlife_wasm.d.ts" */

/**
 * Eight bounded birth lanes with one representative index each.
 *
 * The Synth demo needs "which pitch lanes had a birth this beat", not the grid. One Rust scan
 * replaces a full-grid snapshot plus an unbounded host birth-index array, and the host reads
 * sixteen numbers instead of N cells.
 *
 * It keeps **no** per-cell storage: `World` double-buffers, so after a tick's swap `next_state`
 * already holds the previous generation. That is both the cheapest possible previous-generation
 * source and the exactly right one â€” `sample` reports the births of the most recent `run_tick`.
 */
export class BirthLanes {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BirthLanesFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_birthlanes_free(ptr, 0);
    }
    /**
     * Clear the reported result without scanning.
     */
    clear() {
        wasm.birthlanes_clear(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    counts_ptr() {
        const ret = wasm.birthlanes_counts_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {World} world
     */
    constructor(world) {
        _assertClass(world, World);
        const ret = wasm.birthlanes_new(world.__wbg_ptr);
        this.__wbg_ptr = ret;
        BirthLanesFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    representatives_ptr() {
        const ret = wasm.birthlanes_representatives_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * One scan of the births the most recent `run_tick` produced.
     *
     * Cells are 0/1 bytes, so "born" is `state & !previous` â€” and eight of them fit one `u64`.
     * Testing whole words first is what keeps this under the analysis-overhead gate on the sparse
     * structure rules the Synth actually uses, where almost every word is birth-free.
     * @param {World} world
     * @returns {number}
     */
    sample(world) {
        _assertClass(world, World);
        const ret = wasm.birthlanes_sample(this.__wbg_ptr, world.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Births in the last [`BirthLanes::sample`], across all lanes.
     * @returns {number}
     */
    total() {
        const ret = wasm.birthlanes_total(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) BirthLanes.prototype[Symbol.dispose] = BirthLanes.prototype.free;

export class World {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_world_free(ptr, 0);
    }
    /**
     * Number of active cells in the current generation (as of the last `run_tick`).
     * @returns {number}
     */
    active_count() {
        const ret = wasm.world_active_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Normalized Shannon entropy of the 7-cell (center + 6 neighbors) block patterns over the
     * current state buffer. Ported from JS so the full-grid scan runs in Wasm instead of on the
     * worker's JS heap. Result is normalized into [0, 1] by dividing by 7 bits.
     * @returns {number}
     */
    block_entropy() {
        const ret = wasm.world_block_entropy(this.__wbg_ptr);
        return ret;
    }
    /**
     * Block-pattern entropy of the current state as `[mean, variance]` (auto-explore spatial-
     * heterogeneity term). `mean` equals {@link World::block_entropy} â€” the normalized Shannon
     * entropy of the 7-cell block-pattern distribution, expressible as the average per-cell
     * surprisal `âˆ’log2(p(pattern))/7`. `variance` is the across-cell variance of that surprisal:
     * near zero when local structure is spatially uniform (every region looks the same) and large
     * when the field mixes very-common patterns (ordered regions) with very-rare ones (disordered
     * regions). Computed in one pass over the cells to build the 128-bucket histogram, then a
     * cheap 128-bucket finalize (`Var = E[sÂ²] âˆ’ E[s]Â²`).
     *
     * NB: returning a `Vec<f64>` allocates in Wasm linear memory; callers holding typed-array
     * views over the heap must `refreshSimViews()` afterwards (see the worker notes).
     * @returns {Float64Array}
     */
    block_entropy_stats() {
        const ret = wasm.world_block_entropy_stats(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Column-axis active-cell centroid angle from the last `compute_active_centroid` (radians).
     * @returns {number}
     */
    centroid_col_angle() {
        const ret = wasm.world_centroid_col_angle(this.__wbg_ptr);
        return ret;
    }
    /**
     * Column-axis centroid concentration (mean resultant length, [0,1]) â€” see the field doc.
     * @returns {number}
     */
    centroid_col_concentration() {
        const ret = wasm.world_centroid_col_concentration(this.__wbg_ptr);
        return ret;
    }
    /**
     * Row-axis active-cell centroid angle from the last `compute_active_centroid` (radians).
     * @returns {number}
     */
    centroid_row_angle() {
        const ret = wasm.world_centroid_row_angle(this.__wbg_ptr);
        return ret;
    }
    /**
     * Row-axis centroid concentration (mean resultant length, [0,1]) â€” see the field doc.
     * @returns {number}
     */
    centroid_row_concentration() {
        const ret = wasm.world_centroid_row_concentration(this.__wbg_ptr);
        return ret;
    }
    /**
     * Spatial-order join-count statistic over the cells that changed in the most recent tick.
     *
     * After `run_tick`, `state` holds the current generation and `next_state` holds the previous
     * generation because the fixed double buffers were swapped. Their inequality therefore forms a
     * binary change mask without allocating it. The same random-mixing-normalized join-count used by
     * `spatial_order` is applied to that mask:
     *
     * - positive => changes are localized into clusters/fronts;
     * - near zero => changes are distributed like random flips at the same density;
     * - negative => changes are anti-clustered/alternating.
     *
     * Returns zero when no cells or all cells changed, because the expected heterogeneous-edge count
     * is then zero. Valid only after at least one tick since a reset or direct state write; evaluation
     * warmup guarantees that precondition. No allocation â€” safe to call without detaching JS views.
     * @returns {number}
     */
    change_spatial_order() {
        const ret = wasm.world_change_spatial_order(this.__wbg_ptr);
        return ret;
    }
    /**
     * Rolling hash of the current state buffer, used for cycle detection.
     * @returns {number}
     */
    checksum_state() {
        const ret = wasm.world_checksum_state(this.__wbg_ptr);
        return ret;
    }
    /**
     * Recompute the active-cell centroid as a per-axis circular mean and stash it in
     * `centroid_col_angle` / `centroid_row_angle` (radians, in (-Ï€, Ï€]). The circular mean is the
     * ONLY correct centroid on a torus: each axis coordinate maps to an angle Î¸ = 2Ï€Â·coord/dim,
     * we accumulate Î£sin/Î£cos, and take atan2 of the resultant vector. A simple arithmetic mean
     * would jump discontinuously across the wrap seam and mis-measure a structure straddling it.
     *
     * One pass, NO allocation (scalar accumulators + four scalar field writes), so it never grows
     * Wasm linear memory and JS typed-array views stay valid â€” no `refreshSimViews()` needed after.
     * With no active cells the resultant is the zero vector and all four outputs default to 0.
     */
    compute_active_centroid() {
        wasm.world_compute_active_centroid(this.__wbg_ptr);
    }
    /**
     * Number of cells that flipped state in the last `run_tick` (turnover/activity proxy).
     * @returns {number}
     */
    last_changed_count() {
        const ret = wasm.world_last_changed_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Public constructor that can be called from JavaScript. All buffers are allocated once,
     * here, and never reallocated for the lifetime of the `World` â€” so the pointers handed to
     * JavaScript (and the views built over them) stay valid as long as Wasm memory is not grown.
     * @param {number} grid_cols
     * @param {number} grid_rows
     */
    constructor(grid_cols, grid_rows) {
        const ret = wasm.world_new(grid_cols, grid_rows);
        this.__wbg_ptr = ret;
        WorldFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    next_rule_indices_ptr() {
        const ret = wasm.world_next_rule_indices_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    next_state_ptr() {
        const ret = wasm.world_next_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    num_cells() {
        const ret = wasm.world_num_cells(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Pack the current generation into the staging buffer as `rule_index * 2 + state`.
     */
    pack_render_layer() {
        wasm.world_pack_render_layer(this.__wbg_ptr);
    }
    /**
     * Hamming distance between the main lane and the probe lane (number of differing cells). Zero
     * when no probe is active.
     * @returns {number}
     */
    probe_hamming() {
        const ret = wasm.world_probe_hamming(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    render_layer_ptr() {
        const ret = wasm.world_render_layer_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Zero the per-rule usage counters (used on world reset / load).
     */
    reset_rule_usage_counters() {
        wasm.world_reset_rule_usage_counters(this.__wbg_ptr);
    }
    /**
     * Restore the two cached tick observables after a non-destructive, worker-side trajectory
     * preview. The worker snapshots/restores both simulation buffers and the usage counters around
     * that preview; these scalar caches are the only remaining run_tick mutation outside those
     * buffers. This does not alter evolution semantics and is not used by normal ticking.
     * @param {number} active_count
     * @param {number} changed_count
     */
    restore_tick_observables(active_count, changed_count) {
        wasm.world_restore_tick_observables(this.__wbg_ptr, active_count, changed_count);
    }
    /**
     * @returns {number}
     */
    rule_indices_ptr() {
        const ret = wasm.world_rule_indices_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    rule_usage_counters_ptr() {
        const ret = wasm.world_rule_usage_counters_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    ruleset_ptr() {
        const ret = wasm.world_ruleset_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance the simulation by one step.
     *
     * Reads `state` + `ruleset`, writes `next_state` + `next_rule_indices`, and increments the
     * per-rule usage counters. The current/next buffers are then swapped internally, so after the
     * call the new generation lives in `state` (and JavaScript must mirror the swap of its views).
     * Returns the number of active cells in the new generation.
     *
     * **Sparse fast path.** Sparse worlds (`createSparseState` genesis on a vacuum-stable rule) are
     * mostly vacuum, and a vacuum cell's next state is not worth deriving: every cell of a
     * BLOCK_SIZE-square block whose halo (see `halo_offsets`) is uniformly `u` has center `u` and
     * all six neighbours `u`, hence rule index `0` (u=0) or `127` (u=1) and the same next state,
     * for the whole block. Such blocks are filled with two `memset`s instead of six dependent loads
     * through the neighbour table per cell, and their contribution to the active/changed counts
     * and the usage histogram is added in closed form. The classification covers uniformly *live*
     * regions as well as empty ones, and does not assume the rule is vacuum-stable â€” an igniting
     * vacuum simply fills the block with 1s.
     *
     * This is an exact rewrite of the dense loop, not an approximation: same values, same counters,
     * byte-identical evolution (`sparse_fast_path_matches_dense_reference` pins that against a
     * reference implementation, and the golden checksums below pin it against recorded history).
     * It is also *stateless across ticks* â€” the classification is recomputed from `state` every
     * tick â€” so the many JS paths that write cells directly (reset, brush, `setCells`, world-code
     * load) cannot leave it stale. What that costs on a grid with nothing to skip is one
     * sequential `u64` pass over `state`, which measures at parity or slightly ahead of the old
     * dense loop; see `BLOCK_SIZE` for the numbers.
     * @returns {number}
     */
    run_tick() {
        const ret = wasm.world_run_tick(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Allocate or drop the spacetime staging buffer. Idempotent. **Allocating**: may detach every
     * JavaScript view over Wasm memory, so rebuild them immediately after.
     * @param {boolean} enabled
     */
    set_render_layer_enabled(enabled) {
        wasm.world_set_render_layer_enabled(this.__wbg_ptr, enabled);
    }
    /**
     * Spatial-order join-count statistic over the current state buffer (auto-explore spatial term).
     *
     * One pass over the flattened `neighbor_indices` table counts the heterogeneous
     * (activeâ†”inactive) unique neighbor pairs `J` â€” each undirected edge is counted once by only
     * considering `neighbor_idx > cell_idx`, so the total unique-edge count is `3N` on the wrapped
     * hex grid (6 neighbors per cell Ã· 2). With density `p = active/N`, the random-mixing
     * expectation is `E[J] = 3N Â· 2p(1âˆ’p)`. Returns `1 âˆ’ J/E[J]` clamped to [âˆ’1, 1]:
     * positive â‡’ clustered/domain structure, negative â‡’ anti-clustered (checkerboard-like),
     * â‰ˆ0 â‡’ well-mixed noise. Returns 0 when `E[J] == 0` (p âˆˆ {0, 1}: an empty or full grid).
     * No allocation â€” safe to call on the live state without detaching JS views.
     * @returns {number}
     */
    spatial_order() {
        const ret = wasm.world_spatial_order(this.__wbg_ptr);
        return ret;
    }
    /**
     * Begin a damage-spreading probe: copy the current state into the probe lane and flip exactly
     * one cell (`flip_index`). Subsequent `run_tick` calls advance both lanes; `probe_hamming`
     * reports the divergence. Lazily allocates the probe buffers on first use. An out-of-range
     * `flip_index` is ignored (the probe then starts as an exact copy â€” Hamming 0).
     * @param {number} flip_index
     */
    start_probe(flip_index) {
        wasm.world_start_probe(this.__wbg_ptr, flip_index);
    }
    /**
     * @returns {number}
     */
    state_ptr() {
        const ret = wasm.world_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Stop the probe and free its buffers (a non-probing World pays no per-tick or memory cost).
     */
    stop_probe() {
        wasm.world_stop_probe(this.__wbg_ptr);
    }
}
if (Symbol.dispose) World.prototype[Symbol.dispose] = World.prototype.free;

/**
 * A persistent XOR mask over two binary worlds of the same size.
 *
 * Replaces the Butterfly demo's two full-grid snapshots, host XOR loop, mask allocation, and
 * mask upload with one native comparison that can write straight into the display world.
 */
export class WorldDifference {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldDifferenceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_worlddifference_free(ptr, 0);
    }
    /**
     * Recompute the mask from two worlds. Allocates nothing.
     * @param {World} left
     * @param {World} right
     * @returns {number}
     */
    compare(left, right) {
        _assertClass(left, World);
        _assertClass(right, World);
        const ret = wasm.worlddifference_compare(this.__wbg_ptr, left.__wbg_ptr, right.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Recompute the mask and publish it straight into a k-state world's own state buffer.
     *
     * This is what removes the last host copy from the Butterfly demo: the difference never
     * becomes a JavaScript array, and nothing is uploaded across the boundary to display it.
     * @param {World} left
     * @param {World} right
     * @param {WorldK} display
     * @returns {number}
     */
    compare_into(left, right, display) {
        _assertClass(left, World);
        _assertClass(right, World);
        _assertClass(display, WorldK);
        const ret = wasm.worlddifference_compare_into(this.__wbg_ptr, left.__wbg_ptr, right.__wbg_ptr, display.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Cells that differ, from the last [`WorldDifference::compare`].
     * @returns {number}
     */
    hamming() {
        const ret = wasm.worlddifference_hamming(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    mask_ptr() {
        const ret = wasm.worlddifference_mask_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} num_cells
     */
    constructor(num_cells) {
        const ret = wasm.worlddifference_new(num_cells);
        this.__wbg_ptr = ret;
        WorldDifferenceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WorldDifference.prototype[Symbol.dispose] = WorldDifference.prototype.free;

/**
 * A k-state hexagonal cellular automaton on the same toroidal grid as [`crate::World`].
 *
 * Cells are `u8` state values in `0..k`. Unlike `World` there are no `rule_indices` and no
 * `rule_usage_counters`: a k=3 rule index already exceeds `u8`, the rule-index colouring they exist
 * for does not survive `k > 2` (colour by *state* instead), and dropping them saves a store per
 * cell in the k-state path.
 */
export class WorldK {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WorldKFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_worldk_free(ptr, 0);
    }
    /**
     * Chunks recomputed during the last tick, out of `chunk_count()`. Diagnostic: it is the
     * measured pay-off of the skipping path, and a host tuning a model can watch it settle.
     * @returns {number}
     */
    active_chunk_count() {
        const ret = wasm.worldk_active_chunk_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    backend() {
        const ret = wasm.worldk_backend(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    block_alternates() {
        const ret = wasm.worldk_block_alternates(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Occupancy of one state as of the last [`WorldK::compute_census`].
     * @param {number} state
     * @returns {number}
     */
    census_of(state) {
        const ret = wasm.worldk_census_of(this.__wbg_ptr, state);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    census_ptr() {
        const ret = wasm.worldk_census_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Rolling hash of the current generation, using the same mixing constant as
     * `World::checksum_state` so the two are directly comparable at `k = 2`.
     * @returns {number}
     */
    checksum_state() {
        const ret = wasm.worldk_checksum_state(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    chunk_count() {
        const ret = wasm.worldk_chunk_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Refresh the per-state occupancy counts behind `census_ptr` (one pass, no allocation).
     *
     * This is how conservation is checked from the outside: a conservative block rule must hold
     * every entry of this histogram fixed forever.
     */
    compute_census() {
        wasm.worldk_compute_census(this.__wbg_ptr);
    }
    /**
     * Fill every cell with `value`.
     * @param {number} value
     */
    fill(value) {
        const ret = wasm.worldk_fill(this.__wbg_ptr, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    grid_cols() {
        const ret = wasm.worldk_grid_cols(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    grid_rows() {
        const ret = wasm.worldk_grid_rows(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Whether `run_tick` swaps `state` and `next_state` internally, so JavaScript knows whether it
     * must mirror the swap on its views. True for [`BACKEND_NEIGHBORHOOD`] only: block mode
     * rewrites disjoint blocks in place and has no second buffer at all.
     * @returns {boolean}
     */
    is_double_buffered() {
        const ret = wasm.worldk_is_double_buffered(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Whether the world has reached a fixed point it can never leave.
     *
     * The rule is deterministic and time-invariant, so once a full partition cycle passes with no
     * change the configuration maps to itself forever. One comparison per tick catches every still
     * life; hosts use it to stop scheduling frames entirely.
     * @returns {boolean}
     */
    is_settled() {
        const ret = wasm.worldk_is_settled(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Cells that changed in the last `run_tick`.
     * @returns {number}
     */
    last_changed_count() {
        const ret = wasm.worldk_last_changed_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Force every chunk to be recomputed on the next tick.
     *
     * **Any write that bypasses the methods above — including a poke through the JS `state` view —
     * must be followed by this**, or the activity tracker will happily skip the region that
     * changed. `@hexlife/embed/ca` calls it for you on every mutation path.
     */
    mark_all_dirty() {
        wasm.worldk_mark_all_dirty(this.__wbg_ptr);
    }
    /**
     * Allocate a world. Every buffer is allocated here and never reallocated, so the pointers
     * handed to JavaScript stay valid as long as Wasm memory is not grown.
     *
     * Fails rather than silently producing a wrong simulation:
     *
     * - `states` outside `2..=MAX_*_STATES` for the chosen backend;
     * - odd `grid_cols`, which breaks the column wrap's parity (`World` inherits the same
     *   requirement from `deriveGridDimensions`);
     * - `grid_rows` not a multiple of 3 in [`BACKEND_BLOCK`], which puts a seam in the partition.
     *   The embed's default of 64 rows fails this; block worlds need 63 or 66.
     * @param {number} grid_cols
     * @param {number} grid_rows
     * @param {number} states
     * @param {number} backend
     */
    constructor(grid_cols, grid_rows, states, backend) {
        const ret = wasm.worldk_new(grid_cols, grid_rows, states, backend);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WorldKFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    next_state_ptr() {
        const ret = wasm.worldk_next_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    num_cells() {
        const ret = wasm.worldk_num_cells(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The block-partition phase the *next* `run_tick` will use, in `0..BLOCK_PHASES`. Meaningless
     * for [`BACKEND_NEIGHBORHOOD`].
     * @returns {number}
     */
    phase() {
        const ret = wasm.worldk_phase(this.__wbg_ptr);
        return ret;
    }
    /**
     * Number of entries the rule table for this world's backend must have (`k⁷` or `k³`).
     * @returns {number}
     */
    rule_len() {
        const ret = wasm.worldk_rule_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance one generation and return the number of cells whose state changed.
     *
     * In [`BACKEND_NEIGHBORHOOD`] the current/next buffers are swapped internally, so JavaScript
     * must mirror the swap on its views (`is_double_buffered` reports this). In [`BACKEND_BLOCK`]
     * the grid is rewritten in place and no swap happens.
     * @returns {number}
     */
    run_tick() {
        const ret = wasm.worldk_run_tick(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Alternate the block partition's handedness every tick.
     *
     * The up-triangle partition is left-handed: its odd slot always sits one column to the right,
     * which biases transport sideways. Alternating with the mirrored partition cancels that bias
     * while keeping gravity downward. This reproduces a host `mirror → tick → mirror` sequence
     * exactly, without the two full-grid permutations or the `mark_all_dirty` they force.
     *
     * Off by default: existing `BACKEND_BLOCK` worlds and their `HXK1` codes are untouched.
     * @param {boolean} alternates
     */
    set_block_alternates(alternates) {
        wasm.worldk_set_block_alternates(this.__wbg_ptr, alternates);
    }
    /**
     * Install the `k³` block rule for [`BACKEND_BLOCK`].
     *
     * Both the index and the stored value pack a triple as `s0·k² + s1·k + s2` in the block's
     * vertex order (base, `+q` mate, `+r` mate). Conservation and isotropy are *reported*, not
     * enforced — non-conservative rules are legitimate (reactions, sources, sinks) and breaking
     * isotropy is how you get gravity.
     *
     * **Allocates** — see [`WorldK::set_neighborhood_rule`].
     * @param {Uint16Array} rule
     */
    set_block_rule(rule) {
        const ptr0 = passArray16ToWasm0(rule, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldk_set_block_rule(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set one cell, marking its chunk (and therefore its readers) active again.
     * @param {number} index
     * @param {number} value
     */
    set_cell(index, value) {
        const ret = wasm.worldk_set_cell(this.__wbg_ptr, index, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Overwrite every cell. **The only supported bulk write**: it validates the states and resets
     * the activity tracker, which a direct poke through the `state_ptr` view would not.
     *
     * **Allocates** — see [`WorldK::set_neighborhood_rule`].
     * @param {Uint8Array} cells
     */
    set_cells(cells) {
        const ptr0 = passArray8ToWasm0(cells, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldk_set_cells(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Install the dense anisotropic rule for [`BACKEND_NEIGHBORHOOD`].
     *
     * Entry `self·k⁶ + Σ neighbourⱼ·kʲ` (`j` in canonical neighbour order) holds the centre cell's
     * next state. At `k = 2` this is bit-for-bit HexLife's own 128-entry ruleset indexing, which is
     * what `k2_neighborhood_matches_binary_world` exploits.
     *
     * **Allocates** (the slice is copied in from JS), so callers holding typed-array views over the
     * Wasm heap must rebuild them afterwards.
     * @param {Uint8Array} rule
     */
    set_neighborhood_rule(rule) {
        const ptr0 = passArray8ToWasm0(rule, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.worldk_set_neighborhood_rule(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Turn the chunk-skipping fast path off (or back on). Off is the dense reference behaviour;
     * results are identical either way, which is the whole claim the fast-path tests check.
     * @param {boolean} enabled
     */
    set_skipping_enabled(enabled) {
        wasm.worldk_set_skipping_enabled(this.__wbg_ptr, enabled);
    }
    /**
     * @returns {number}
     */
    state_ptr() {
        const ret = wasm.worldk_state_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    states() {
        const ret = wasm.worldk_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * Generations elapsed since construction. Also selects the block partition phase.
     * @returns {bigint}
     */
    tick_count() {
        const ret = wasm.worldk_tick_count(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
}
if (Symbol.dispose) WorldK.prototype[Symbol.dispose] = WorldK.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_bbadd78c1bac3a77: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./hexlife_wasm_bg.js": import0,
    };
}

const BirthLanesFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_birthlanes_free(ptr, 1));
const WorldFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_world_free(ptr, 1));
const WorldDifferenceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_worlddifference_free(ptr, 1));
const WorldKFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_worldk_free(ptr, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('hexlife_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
