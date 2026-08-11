//! `WorldSolid` — the solid extrusion engine (roadmap #39).
//!
//! A third `#[wasm_bindgen]` struct in the same crate, compiled ONLY under the `solid` Cargo
//! feature. It shares `compute_neighbor_indices` and the `build.rs` direction tables with the other
//! engines and nothing else: no shared world struct, no branch added to `World`, `WorldK`, or
//! `WorldStochastic`, and zero bytes contributed to the artifacts those engines ship in.
//!
//! This engine does not simulate. It is a *sink*: a host runs any HexLife engine, hands one layer
//! of cell states per tick to `push_layer`, and the stack welds the accumulated layers into a
//! printable solid. That is what makes it engine-agnostic — binary `World`, k-state `WorldK`, and
//! stochastic `WorldStochastic` all feed the same buffer.
//!
//! Every per-voxel loop lives here. The only data movement JavaScript is permitted is one bulk
//! `TypedArray.prototype.set` into the staging layer per tick.
//!
//! **Phase 1 scope.** Volume, ingestion, interpolation, connected components, and the policy
//! filter. Meshing and serialization arrive in Phase 2.
//!
//! ## The boundary is open, not toroidal
//!
//! The simulating engines wrap: cell `(0, r)` neighbors `(cols-1, r)`. A printed object cannot.
//! `docs/SOLID-PLAN.md` §13.3 accepts that the toroidal seam cuts features at the grid boundary —
//! "cuts" is the operative word. So this engine builds its own lateral neighbor table from the same
//! canonical direction deltas but **rejects every step that would wrap**, and that table is what
//! both the component union-find and (in Phase 2) face culling read.
//!
//! Using the wrapped table instead would be wrong twice over: two pieces that touch only across the
//! seam would be reported as one connected object when they will fall apart on the build plate, and
//! the faces along the seam — which are real, exposed boundary surface — would be culled away,
//! leaving holes in a mesh that no longer bounds a solid.

use wasm_bindgen::prelude::*;

use crate::compute_neighbor_indices;

/// Bumped when the volume layout, mesh, or serialized bytes stop being reproducible from a prior
/// version's options. Exports are a pure function of `(volume, geometry options, mesh options)`, so
/// a host that records this version plus its option block can reproduce an object exactly.
pub const SOLID_ENGINE_VERSION: u32 = 1;

/// Upper bound on interpolation sub-layers per tick. Each one multiplies the volume height, and the
/// welding argument in the plan needs only one; the rest are a Z-resolution knob.
const MAX_SUB_LAYERS: usize = 8;

/// Upper bound on prepended base-plate layers.
const MAX_BASE_PLATE: usize = 64;

/// Hard ceiling on the voxel count.
///
/// Set by the component pass, not by the volume: the volume itself is one bit per voxel, but
/// union-find needs a parent and a size per voxel plus a flag byte, so peak cost is ~9.1 bytes per
/// voxel. 2^24 voxels is therefore ~153 MiB — a deliberate wall in a 32-bit address space, and
/// still 15,000 layers of the reference grid.
const MAX_VOXELS: u64 = 1 << 24;

/// Interpolation modes, matching `@hexlife/embed/solid`'s string constants.
pub const INTERPOLATE_NONE: u8 = 0;
pub const INTERPOLATE_BRIDGE: u8 = 1;
pub const INTERPOLATE_UNION: u8 = 2;

/// Component-retention policies.
pub const KEEP_ALL: u8 = 0;
pub const KEEP_LARGEST: u8 = 1;
pub const KEEP_PLATE_CONNECTED: u8 = 2;

/// Sentinel for a lateral direction that leaves the grid. See the module header.
const NO_NEIGHBOR: u32 = u32::MAX;

const FLAG_TOUCHES_PLATE: u8 = 1;
const FLAG_KEEP: u8 = 2;

#[wasm_bindgen]
pub struct WorldSolid {
    rows: usize,
    columns: usize,
    num_cells: usize,
    /// Number of layers ingested from the host, one per `push_layer` call.
    ticks: usize,
    /// Interpolation layers synthesized between consecutive ingested layers.
    sub_layers: usize,
    /// Solid layers prepended below tick 0. Part of the volume rather than a mesh-time special
    /// case, so components, culling, and merging all stay uniform.
    base_plate: usize,
    /// Bitmask over cell state values: bit `s` set means state `s` is solid matter.
    solid_states: u32,
    interpolate: u8,
    total_layers: usize,
    /// Layers consumed by one tick: the ingested layer plus its trailing interpolation layers.
    stride: usize,

    /// `u64` words per layer. Layers are word-aligned so a whole layer is a contiguous slice and
    /// the bitwise stages stay word-parallel; the padding is at most 63 bits per layer.
    words_per_layer: usize,
    /// The bit-packed volume: row-major within a layer, layers contiguous, layer 0 at the bottom.
    volume: Vec<u64>,
    /// The staging layer JS writes into with one bulk `set` per tick.
    staging: Vec<u8>,
    /// 256-entry solid lookup, rebuilt once from `solid_states` at construction so ingestion never
    /// shifts a mask per cell.
    solid_lut: [bool; 256],
    /// Open-boundary lateral neighbors, 6 per cell, `NO_NEIGHBOR` at the seam.
    neighbors: Vec<u32>,

    /// One-layer scratch for the two dilations the bridge set needs.
    dilate_a: Vec<u64>,
    dilate_b: Vec<u64>,

    /// Union-find over voxels, indexed `layer * num_cells + cell`.
    parent: Vec<u32>,
    size: Vec<u32>,
    flags: Vec<u8>,

    pushed: usize,
    finalized: bool,
    report: Report,
}

#[derive(Default, Clone, Copy)]
struct Report {
    component_count: u32,
    kept_components: u32,
    kept_voxels: u32,
    dropped_voxels: u32,
    floating: u32,
}

#[wasm_bindgen]
impl WorldSolid {
    /// Validate the geometry and allocate every buffer.
    ///
    /// Everything is allocated here, up front: growing the isolated linear memory after JavaScript
    /// has built a view into it detaches that view, and the whole point of the one-`set`-per-layer
    /// ingestion path is that the view is built exactly once.
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        rows: usize,
        columns: usize,
        ticks: usize,
        sub_layers: usize,
        base_plate: usize,
        solid_states: u32,
        interpolate: u8,
    ) -> Result<WorldSolid, String> {
        if rows == 0 || columns == 0 {
            return Err("WorldSolid: rows and columns must be positive.".into());
        }
        // The odd-q lattice the simulating engines use only closes on an even column count. The
        // extruded object has open boundaries, but the *lattice* must still be the same one, or the
        // parity offsets in the geometry would disagree with the source world.
        if columns % 2 != 0 {
            return Err("WorldSolid: columns must be even to match the odd-q lattice.".into());
        }
        if ticks == 0 {
            return Err("WorldSolid: ticks must be positive.".into());
        }
        if sub_layers > MAX_SUB_LAYERS {
            return Err(format!("WorldSolid: subLayers must be at most {MAX_SUB_LAYERS}."));
        }
        if base_plate > MAX_BASE_PLATE {
            return Err(format!("WorldSolid: basePlate must be at most {MAX_BASE_PLATE} layers."));
        }
        if solid_states == 0 {
            return Err("WorldSolid: solidStates selects no state, so the volume would be empty.".into());
        }
        if !matches!(
            interpolate,
            INTERPOLATE_NONE | INTERPOLATE_BRIDGE | INTERPOLATE_UNION
        ) {
            return Err("WorldSolid: unknown interpolate mode.".into());
        }

        let stride = 1 + sub_layers;
        let total_layers = base_plate
            .checked_add(ticks.checked_mul(stride).ok_or_else(overflow)?)
            .ok_or_else(overflow)?;
        let num_cells = rows.checked_mul(columns).ok_or_else(overflow)?;
        let voxels = (num_cells as u64)
            .checked_mul(total_layers as u64)
            .ok_or_else(overflow)?;
        if voxels > MAX_VOXELS {
            return Err(format!(
                "WorldSolid: volume of {voxels} voxels exceeds the {MAX_VOXELS}-voxel ceiling; reduce ticks, subLayers, or the grid."
            ));
        }

        let words_per_layer = num_cells.div_ceil(64);
        let mut solid_lut = [false; 256];
        for (state, slot) in solid_lut.iter_mut().enumerate() {
            *slot = state < 32 && (solid_states >> state) & 1 == 1;
        }

        let mut world = WorldSolid {
            rows,
            columns,
            num_cells,
            ticks,
            sub_layers,
            base_plate,
            solid_states,
            interpolate,
            total_layers,
            stride,
            words_per_layer,
            volume: vec![0u64; words_per_layer * total_layers],
            staging: vec![0u8; num_cells],
            solid_lut,
            neighbors: open_boundary_neighbors(columns, rows, num_cells),
            dilate_a: vec![0u64; words_per_layer],
            dilate_b: vec![0u64; words_per_layer],
            parent: vec![0u32; voxels as usize],
            size: vec![0u32; voxels as usize],
            flags: vec![0u8; voxels as usize],
            pushed: 0,
            finalized: false,
            report: Report::default(),
        };

        // The base plate is real matter in the volume from the start, so nothing downstream needs a
        // special case for it: `plate-connected` is simply "the component reaches layer 0".
        for layer in 0..base_plate {
            world.fill_layer_solid(layer);
        }
        Ok(world)
    }

    /// Pointer to the staging layer. JS builds one `Uint8Array` over this and reuses it forever.
    #[wasm_bindgen(js_name = layerPtr)]
    pub fn layer_ptr(&self) -> *const u8 {
        self.staging.as_ptr()
    }

    /// Ingest the staging layer as tick `pushedLayers`.
    ///
    /// Applies the `solidStates` mask while bit-packing — one pass, no intermediate — and, from the
    /// second tick on, fills the interpolation layers that sit between this layer and the previous
    /// one now that both endpoints are known.
    #[wasm_bindgen(js_name = pushLayer)]
    pub fn push_layer(&mut self) -> Result<(), String> {
        if self.finalized {
            return Err("WorldSolid.pushLayer: the stack is already finalized.".into());
        }
        if self.pushed >= self.ticks {
            return Err(format!(
                "WorldSolid.pushLayer: all {} layers have already been pushed.",
                self.ticks
            ));
        }

        let tick = self.pushed;
        let layer = self.base_plate + tick * self.stride;
        self.pack_staging_into(layer);
        if tick > 0 && self.sub_layers > 0 {
            let previous = self.base_plate + (tick - 1) * self.stride;
            self.write_interpolation(previous, layer);
        }
        self.pushed += 1;
        Ok(())
    }

    /// Weld the volume, label components, apply the retention policy, and report what happened.
    ///
    /// A slicer will not join separate bodies — it will happily print forty loose fragments — so
    /// the report exists to tell the user which case they are in *before* they find out on the
    /// build plate.
    #[wasm_bindgen(js_name = finalizeVolume)]
    pub fn finalize_volume(&mut self, keep: u8) -> Result<(), String> {
        if self.finalized {
            return Err("WorldSolid.finalize: already finalized.".into());
        }
        if self.pushed != self.ticks {
            return Err(format!(
                "WorldSolid.finalize: {} of {} layers pushed.",
                self.pushed, self.ticks
            ));
        }
        if !matches!(keep, KEEP_ALL | KEEP_LARGEST | KEEP_PLATE_CONNECTED) {
            return Err("WorldSolid.finalize: unknown keepComponents policy.".into());
        }

        // The last tick has no successor to bridge to. Both `bridge` and `union` are idempotent —
        // bridge(A, A) = A — so the trailing slots are a copy of the final layer. That is also the
        // right thing to print: the top of the object ends at full thickness rather than at a
        // hairline.
        if self.sub_layers > 0 {
            let last = self.base_plate + (self.ticks - 1) * self.stride;
            for offset in 1..=self.sub_layers {
                self.copy_layer(last, last + offset);
            }
        }

        self.label_components();
        self.apply_policy(keep);
        self.finalized = true;
        Ok(())
    }

    // ---- geometry -----------------------------------------------------------------------------

    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.rows
    }

    #[wasm_bindgen(getter)]
    pub fn columns(&self) -> usize {
        self.columns
    }

    #[wasm_bindgen(getter, js_name = numCells)]
    pub fn num_cells(&self) -> usize {
        self.num_cells
    }

    #[wasm_bindgen(getter)]
    pub fn ticks(&self) -> usize {
        self.ticks
    }

    #[wasm_bindgen(getter, js_name = subLayers)]
    pub fn sub_layers(&self) -> usize {
        self.sub_layers
    }

    #[wasm_bindgen(getter, js_name = basePlate)]
    pub fn base_plate(&self) -> usize {
        self.base_plate
    }

    #[wasm_bindgen(getter, js_name = solidStates)]
    pub fn solid_states(&self) -> u32 {
        self.solid_states
    }

    /// Height of the finished volume in layers, base plate included.
    #[wasm_bindgen(getter, js_name = totalLayers)]
    pub fn total_layers(&self) -> usize {
        self.total_layers
    }

    /// Bytes the bit-packed volume occupies.
    #[wasm_bindgen(getter, js_name = volumeBytes)]
    pub fn volume_bytes(&self) -> usize {
        self.volume.len() * 8
    }

    #[wasm_bindgen(getter, js_name = pushedLayers)]
    pub fn pushed_layers(&self) -> usize {
        self.pushed
    }

    #[wasm_bindgen(getter, js_name = isFinalized)]
    pub fn is_finalized(&self) -> bool {
        self.finalized
    }

    /// The linear index of `cell`'s neighbor in canonical `direction` 0..5, or `-1` where that
    /// direction leaves the grid.
    ///
    /// This is the table lateral faces are culled against and components are grown over, exposed so
    /// a host can pin the mesh's adjacency against `neighbor-dirs.json` rather than trusting a
    /// second derivation of the hex geometry. Bounded and O(1) — never a data path.
    #[wasm_bindgen(js_name = neighborOf)]
    pub fn neighbor_of(&self, cell: usize, direction: usize) -> Result<i32, String> {
        if cell >= self.num_cells || direction >= 6 {
            return Err("WorldSolid.neighborOf: cell or direction out of range.".into());
        }
        let neighbor = self.neighbors[cell * 6 + direction];
        Ok(if neighbor == NO_NEIGHBOR { -1 } else { neighbor as i32 })
    }

    // ---- report -------------------------------------------------------------------------------

    /// Components found in the welded volume, before the retention policy.
    #[wasm_bindgen(getter, js_name = componentCount)]
    pub fn component_count(&self) -> u32 {
        self.report.component_count
    }

    /// Components that survived the policy. One means the object prints as a single piece.
    #[wasm_bindgen(getter, js_name = keptComponents)]
    pub fn kept_components(&self) -> u32 {
        self.report.kept_components
    }

    #[wasm_bindgen(getter, js_name = keptVoxels)]
    pub fn kept_voxels(&self) -> u32 {
        self.report.kept_voxels
    }

    #[wasm_bindgen(getter, js_name = droppedVoxels)]
    pub fn dropped_voxels(&self) -> u32 {
        self.report.dropped_voxels
    }

    /// Components that never reach layer 0. Under a vacuum-stable rule with bridge interpolation
    /// this is provably zero; anywhere else it is the count of pieces that would print loose.
    #[wasm_bindgen(getter)]
    pub fn floating(&self) -> u32 {
        self.report.floating
    }

    /// FNV-1a over the packed volume. The mesh must be a pure function of its inputs, and this is
    /// the cheapest way for a test to hold the first half of that promise.
    #[wasm_bindgen(js_name = volumeChecksum)]
    pub fn volume_checksum(&self) -> u32 {
        let mut hash: u32 = 0x811C_9DC5;
        for word in &self.volume {
            for byte in word.to_le_bytes() {
                hash ^= byte as u32;
                hash = hash.wrapping_mul(0x0100_0193);
            }
        }
        hash
    }

    /// Whether the voxel at `(cell, layer)` is solid. Bounded accessor for tests and hosts that
    /// want to inspect a fixture; the pipeline never reads the volume one voxel at a time from JS.
    #[wasm_bindgen(js_name = voxelAt)]
    pub fn voxel_at(&self, cell: usize, layer: usize) -> Result<bool, String> {
        if cell >= self.num_cells || layer >= self.total_layers {
            return Err("WorldSolid.voxelAt: cell or layer out of range.".into());
        }
        Ok(get_bit(&self.volume, layer * self.words_per_layer, cell))
    }
}

impl WorldSolid {
    fn layer_base(&self, layer: usize) -> usize {
        layer * self.words_per_layer
    }

    fn fill_layer_solid(&mut self, layer: usize) {
        let base = self.layer_base(layer);
        let words = self.words_per_layer;
        self.volume[base..base + words].fill(u64::MAX);
        mask_tail(&mut self.volume[base..base + words], self.num_cells);
    }

    fn copy_layer(&mut self, from: usize, to: usize) {
        let words = self.words_per_layer;
        let from_base = self.layer_base(from);
        let to_base = self.layer_base(to);
        self.volume.copy_within(from_base..from_base + words, to_base);
    }

    /// Bit-pack the staging layer through the solid mask. One pass over the cells, one word built
    /// at a time — the mask is a table lookup, never a shift per cell.
    fn pack_staging_into(&mut self, layer: usize) {
        let base = self.layer_base(layer);
        for word_index in 0..self.words_per_layer {
            let start = word_index * 64;
            let end = (start + 64).min(self.num_cells);
            let mut word = 0u64;
            for cell in start..end {
                if self.solid_lut[self.staging[cell] as usize] {
                    word |= 1u64 << (cell - start);
                }
            }
            self.volume[base + word_index] = word;
        }
    }

    /// Fill the `sub_layers` slots between two ingested layers.
    ///
    /// `bridge(p) = (A(p) ∧ ∃q ∈ N(p)∪{p} : B(q)) ∨ (B(p) ∧ ∃q ∈ N(p)∪{p} : A(q))` — exactly the
    /// set that turns diagonal space-time contact, where two prisms meet along a single
    /// zero-thickness hinge, into real face contact, without the fattening `A ∪ B` causes.
    ///
    /// With `sub_layers > 1` the same set repeats: the extra layers are a Z-resolution knob, not
    /// extra welding.
    fn write_interpolation(&mut self, a_layer: usize, b_layer: usize) {
        let words = self.words_per_layer;
        let a_base = self.layer_base(a_layer);
        let b_base = self.layer_base(b_layer);
        let first = self.layer_base(a_layer + 1);

        match self.interpolate {
            INTERPOLATE_BRIDGE => {
                dilate(&self.volume[a_base..a_base + words], &self.neighbors, &mut self.dilate_a);
                dilate(&self.volume[b_base..b_base + words], &self.neighbors, &mut self.dilate_b);
                for word in 0..words {
                    self.volume[first + word] = (self.volume[a_base + word] & self.dilate_b[word])
                        | (self.volume[b_base + word] & self.dilate_a[word]);
                }
            }
            INTERPOLATE_UNION => {
                for word in 0..words {
                    self.volume[first + word] = self.volume[a_base + word] | self.volume[b_base + word];
                }
            }
            // `none` still has to fill the slots it was asked for; the honest filler is the layer
            // below, which extrudes it rather than inventing contact. The JS surface forces
            // `subLayers` to 0 here, so this is a floor, not a path anyone reaches by accident.
            _ => {
                for word in 0..words {
                    self.volume[first + word] = self.volume[a_base + word];
                }
            }
        }

        for offset in 2..=self.sub_layers {
            self.copy_layer(a_layer + 1, a_layer + offset);
        }
    }

    /// Union-find over 8-face adjacency: the six lateral prism faces plus up and down.
    ///
    /// Edge-only and vertex-only contact are deliberately NOT adjacency. That is the whole point —
    /// two prisms meeting along an edge are a zero-thickness hinge, and calling them connected is
    /// how you produce an object that reports as one piece and arrives as two.
    fn label_components(&mut self) {
        let voxels = self.num_cells * self.total_layers;
        for (index, slot) in self.parent[..voxels].iter_mut().enumerate() {
            *slot = index as u32;
        }
        self.size[..voxels].fill(1);
        self.flags[..voxels].fill(0);

        for layer in 0..self.total_layers {
            let base = self.layer_base(layer);
            let voxel_base = layer * self.num_cells;
            for word_index in 0..self.words_per_layer {
                let mut word = self.volume[base + word_index];
                while word != 0 {
                    let bit = word.trailing_zeros() as usize;
                    word &= word - 1;
                    let cell = word_index * 64 + bit;
                    let voxel = (voxel_base + cell) as u32;

                    // Down only: the up face of the voxel below is the same face, so unioning both
                    // directions would double the work for nothing.
                    if layer > 0 && get_bit(&self.volume, base - self.words_per_layer, cell) {
                        union(&mut self.parent, &mut self.size, voxel, voxel - self.num_cells as u32);
                    }
                    for direction in 0..6 {
                        let neighbor = self.neighbors[cell * 6 + direction];
                        if neighbor != NO_NEIGHBOR && get_bit(&self.volume, base, neighbor as usize) {
                            union(
                                &mut self.parent,
                                &mut self.size,
                                voxel,
                                voxel_base as u32 + neighbor,
                            );
                        }
                    }
                }
            }
        }
    }

    /// Mark which roots survive, then clear every voxel that does not. Runs after
    /// `label_components`, which leaves `parent`/`size` valid.
    fn apply_policy(&mut self, keep: u8) {
        let voxels = self.num_cells * self.total_layers;

        // Layer 0 is the build surface: either the base plate or tick 0 itself.
        for cell in 0..self.num_cells {
            if get_bit(&self.volume, 0, cell) {
                let root = find(&mut self.parent, cell as u32) as usize;
                self.flags[root] |= FLAG_TOUCHES_PLATE;
            }
        }

        // One deterministic pass to census the roots. No hash map anywhere in this engine: its
        // iteration order would leak into which component "largest" picks on a tie.
        let mut component_count = 0u32;
        let mut floating = 0u32;
        let mut largest_root = u32::MAX;
        let mut largest_size = 0u32;
        for layer in 0..self.total_layers {
            let base = self.layer_base(layer);
            let voxel_base = layer * self.num_cells;
            for word_index in 0..self.words_per_layer {
                let mut word = self.volume[base + word_index];
                while word != 0 {
                    let bit = word.trailing_zeros() as usize;
                    word &= word - 1;
                    let voxel = (voxel_base + word_index * 64 + bit) as u32;
                    if find(&mut self.parent, voxel) != voxel {
                        continue;
                    }
                    component_count += 1;
                    if self.flags[voxel as usize] & FLAG_TOUCHES_PLATE == 0 {
                        floating += 1;
                    }
                    // Strictly greater keeps the first root in scan order on a tie, which makes
                    // `largest` a deterministic choice rather than an allocator-order one.
                    if self.size[voxel as usize] > largest_size {
                        largest_size = self.size[voxel as usize];
                        largest_root = voxel;
                    }
                }
            }
        }

        for voxel in 0..voxels {
            let voxel = voxel as u32;
            if find(&mut self.parent, voxel) != voxel {
                continue;
            }
            let keeps = match keep {
                KEEP_LARGEST => voxel == largest_root,
                KEEP_PLATE_CONNECTED => self.flags[voxel as usize] & FLAG_TOUCHES_PLATE != 0,
                _ => true,
            };
            if keeps {
                self.flags[voxel as usize] |= FLAG_KEEP;
            }
        }

        let mut kept_voxels = 0u32;
        let mut dropped_voxels = 0u32;
        let mut kept_components = 0u32;
        for layer in 0..self.total_layers {
            let base = self.layer_base(layer);
            let voxel_base = layer * self.num_cells;
            for word_index in 0..self.words_per_layer {
                let mut word = self.volume[base + word_index];
                let mut cleared = 0u64;
                while word != 0 {
                    let bit = word.trailing_zeros() as usize;
                    word &= word - 1;
                    let cell = word_index * 64 + bit;
                    let voxel = (voxel_base + cell) as u32;
                    let root = find(&mut self.parent, voxel) as usize;
                    if self.flags[root] & FLAG_KEEP != 0 {
                        kept_voxels += 1;
                        if voxel as usize == root {
                            kept_components += 1;
                        }
                    } else {
                        dropped_voxels += 1;
                        cleared |= 1u64 << bit;
                    }
                }
                self.volume[base + word_index] &= !cleared;
            }
        }

        self.report = Report {
            component_count,
            kept_components,
            kept_voxels,
            dropped_voxels,
            floating,
        };
    }
}

/// Engine version for hosts recording a reproducible recipe.
#[wasm_bindgen]
pub fn solid_engine_version() -> u32 {
    SOLID_ENGINE_VERSION
}

/// Derive the **open-boundary** lateral neighbor table from the canonical shared one.
///
/// Deliberately derived rather than re-derived: `compute_neighbor_indices` is the crate's single
/// definition of hex adjacency, shared with `World`, `WorldK`, and `WorldStochastic`, and a second
/// hand-rolled copy here is exactly the drift §4 warns about — it would produce a plausible-looking
/// object whose faces are culled against the wrong neighbors.
///
/// Every canonical direction steps at most one column and one row, so a wrapped entry is detectable
/// without re-reading the deltas at all: if the neighbor is more than one step away in either axis,
/// it crossed the seam and there is no prism on the other side of that face.
fn open_boundary_neighbors(columns: usize, rows: usize, num_cells: usize) -> Vec<u32> {
    let cols = columns as i32;
    let mut table = compute_neighbor_indices(cols, rows as i32, num_cells);
    for cell in 0..num_cells {
        let col = cell as i32 % cols;
        let row = cell as i32 / cols;
        for direction in 0..6 {
            let neighbor = table[cell * 6 + direction] as i32;
            let neighbor_col = neighbor % cols;
            let neighbor_row = neighbor / cols;
            if (neighbor_col - col).abs() > 1 || (neighbor_row - row).abs() > 1 {
                table[cell * 6 + direction] = NO_NEIGHBOR;
            }
        }
    }
    table
}

/// `out(p) = ∃q ∈ N(p)∪{p} : src(q)` — one hop of lateral dilation over a single layer.
fn dilate(src: &[u64], neighbors: &[u32], out: &mut [u64]) {
    out.fill(0);
    for (word_index, &word) in src.iter().enumerate() {
        let mut bits = word;
        while bits != 0 {
            let bit = bits.trailing_zeros() as usize;
            bits &= bits - 1;
            let cell = word_index * 64 + bit;
            out[word_index] |= 1u64 << bit;
            for direction in 0..6 {
                let neighbor = neighbors[cell * 6 + direction];
                if neighbor != NO_NEIGHBOR {
                    let neighbor = neighbor as usize;
                    out[neighbor >> 6] |= 1u64 << (neighbor & 63);
                }
            }
        }
    }
}

#[inline]
fn get_bit(volume: &[u64], base: usize, cell: usize) -> bool {
    (volume[base + (cell >> 6)] >> (cell & 63)) & 1 == 1
}

/// Zero the padding bits above `num_cells` in a layer's final word. Leaving them set would invent
/// matter that no cell owns and corrupt every popcount and bit scan downstream.
fn mask_tail(layer: &mut [u64], num_cells: usize) {
    let used = num_cells & 63;
    if used != 0 {
        if let Some(last) = layer.last_mut() {
            *last &= (1u64 << used) - 1;
        }
    }
}

#[inline]
fn find(parent: &mut [u32], mut voxel: u32) -> u32 {
    while parent[voxel as usize] != voxel {
        // Path halving: one write per step, no second pass, no recursion.
        let grandparent = parent[parent[voxel as usize] as usize];
        parent[voxel as usize] = grandparent;
        voxel = grandparent;
    }
    voxel
}

#[inline]
fn union(parent: &mut [u32], size: &mut [u32], a: u32, b: u32) {
    let mut root_a = find(parent, a);
    let mut root_b = find(parent, b);
    if root_a == root_b {
        return;
    }
    // Union by size, ties broken by the smaller index so the forest is a pure function of the
    // volume rather than of the order the caller happened to walk it in.
    if size[root_a as usize] < size[root_b as usize]
        || (size[root_a as usize] == size[root_b as usize] && root_b < root_a)
    {
        core::mem::swap(&mut root_a, &mut root_b);
    }
    parent[root_b as usize] = root_a;
    size[root_a as usize] += size[root_b as usize];
}

fn overflow() -> String {
    "WorldSolid: geometry overflows the address space.".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stack(rows: usize, columns: usize, ticks: usize, sub: usize, plate: usize) -> WorldSolid {
        WorldSolid::new(rows, columns, ticks, sub, plate, 0b10, INTERPOLATE_BRIDGE)
            .expect("valid geometry")
    }

    /// Push `layer` (one byte per cell) as the next tick.
    fn push(world: &mut WorldSolid, layer: &[u8]) {
        world.staging.copy_from_slice(layer);
        world.push_layer().expect("push");
    }

    fn empty(world: &WorldSolid) -> Vec<u8> {
        vec![0u8; world.num_cells]
    }

    #[test]
    fn total_layers_counts_interpolation_and_the_base_plate() {
        let s = stack(30, 36, 100, 1, 2);
        assert_eq!(s.total_layers(), 2 + 100 * 2);
        assert_eq!(s.num_cells(), 1080);
        assert_eq!(s.volume_bytes(), 1080_usize.div_ceil(64) * 8 * 202);

        let none = WorldSolid::new(30, 36, 100, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        assert_eq!(none.total_layers(), 100);
    }

    #[test]
    fn rejects_geometry_that_cannot_match_the_lattice() {
        assert!(WorldSolid::new(6, 7, 4, 0, 0, 0b10, INTERPOLATE_BRIDGE).is_err());
        assert!(WorldSolid::new(0, 8, 4, 0, 0, 0b10, INTERPOLATE_BRIDGE).is_err());
        assert!(WorldSolid::new(6, 8, 0, 0, 0, 0b10, INTERPOLATE_BRIDGE).is_err());
    }

    #[test]
    fn rejects_unbounded_or_empty_requests() {
        assert!(WorldSolid::new(6, 8, 4, MAX_SUB_LAYERS + 1, 0, 0b10, INTERPOLATE_BRIDGE).is_err());
        assert!(WorldSolid::new(6, 8, 4, 0, MAX_BASE_PLATE + 1, 0b10, INTERPOLATE_BRIDGE).is_err());
        assert!(WorldSolid::new(6, 8, 4, 0, 0, 0, INTERPOLATE_BRIDGE).is_err());
        assert!(WorldSolid::new(6, 8, 4, 0, 0, 0b10, 9).is_err());
        assert!(WorldSolid::new(4096, 4096, 1024, 0, 0, 0b10, INTERPOLATE_BRIDGE).is_err());
    }

    /// §9 test 5 — the direction parity the whole mesh rests on.
    #[test]
    fn neighbor_table_matches_the_canonical_deltas_on_both_parities() {
        let rows = 6;
        let cols = 8;
        let s = stack(rows, cols, 2, 0, 0);
        for row in 0..rows as i32 {
            for col in 0..cols as i32 {
                let cell = (row * cols as i32 + col) as usize;
                let dirs = if col % 2 != 0 {
                    &crate::NEIGHBOR_DIRS_ODD_R
                } else {
                    &crate::NEIGHBOR_DIRS_EVEN_R
                };
                for (direction, delta) in dirs.iter().enumerate() {
                    let nc = col + delta[0];
                    let nr = row + delta[1];
                    let expected = if nc < 0 || nc >= cols as i32 || nr < 0 || nr >= rows as i32 {
                        -1
                    } else {
                        nr * cols as i32 + nc
                    };
                    assert_eq!(s.neighbor_of(cell, direction).unwrap(), expected);
                }
            }
        }
    }

    /// The seam is a cut, not a wrap. A single column of matter at col 0 and another at the last
    /// column are two pieces, however the simulation saw them.
    #[test]
    fn the_lattice_seam_is_an_open_boundary() {
        let mut s = stack(6, 8, 3, 0, 0);
        let mut layer = vec![0u8; 48];
        for row in 0..6 {
            layer[row * 8] = 1;
            layer[row * 8 + 7] = 1;
        }
        for _ in 0..3 {
            push(&mut s, &layer);
        }
        s.finalize_volume(KEEP_ALL).unwrap();
        assert_eq!(s.component_count(), 2);
    }

    #[test]
    fn ingestion_applies_the_solid_mask_and_bit_packs() {
        // States 1 and 3 are matter; 0 and 2 are void.
        let mut s = WorldSolid::new(4, 8, 1, 0, 0, 0b1010, INTERPOLATE_NONE).unwrap();
        let mut layer = vec![0u8; 32];
        layer[0] = 1;
        layer[1] = 2;
        layer[2] = 3;
        layer[31] = 1;
        push(&mut s, &layer);
        s.finalize_volume(KEEP_ALL).unwrap();
        assert!(s.voxel_at(0, 0).unwrap());
        assert!(!s.voxel_at(1, 0).unwrap());
        assert!(s.voxel_at(2, 0).unwrap());
        assert!(s.voxel_at(31, 0).unwrap());
        assert_eq!(s.kept_voxels(), 3);
    }

    #[test]
    fn the_base_plate_is_solid_matter_from_construction() {
        let mut s = stack(4, 8, 2, 0, 3);
        let layer = empty(&s);
        push(&mut s, &layer);
        push(&mut s, &layer);
        s.finalize_volume(KEEP_ALL).unwrap();
        // Three full plate layers, nothing above them, all one piece.
        assert_eq!(s.kept_voxels(), 3 * 32);
        assert_eq!(s.component_count(), 1);
        assert_eq!(s.floating(), 0);
    }

    /// §9 test 7 — adjacency strictness. Two voxels in diagonal space-time contact touch along a
    /// single edge, which is a zero-thickness hinge, not a joint.
    #[test]
    fn diagonal_space_time_contact_is_two_pieces_without_bridging() {
        let build = |mode: u8, sub: usize| {
            let mut s = WorldSolid::new(6, 8, 2, sub, 0, 0b10, mode).unwrap();
            let mut first = vec![0u8; 48];
            first[2 * 8 + 2] = 1;
            let mut second = vec![0u8; 48];
            // Direction 3 from an even column is (+1, -1): a lateral neighbor of (2,2), so the two
            // prisms share only the vertical edge between them once they are on different layers.
            second[1 * 8 + 3] = 1;
            s.staging.copy_from_slice(&first);
            s.push_layer().unwrap();
            s.staging.copy_from_slice(&second);
            s.push_layer().unwrap();
            s.finalize_volume(KEEP_ALL).unwrap();
            s
        };
        assert_eq!(build(INTERPOLATE_NONE, 0).component_count(), 2);
        assert_eq!(build(INTERPOLATE_BRIDGE, 1).component_count(), 1);
    }

    #[test]
    fn bridge_is_the_contact_set_and_union_is_the_fattening_one() {
        let make = |mode: u8| {
            let mut s = WorldSolid::new(6, 8, 2, 1, 0, 0b10, mode).unwrap();
            let mut first = vec![0u8; 48];
            first[2 * 8 + 2] = 1;
            let mut second = vec![0u8; 48];
            second[1 * 8 + 3] = 1;
            s.staging.copy_from_slice(&first);
            s.push_layer().unwrap();
            s.staging.copy_from_slice(&second);
            s.push_layer().unwrap();
            s.finalize_volume(KEEP_ALL).unwrap();
            s
        };
        // Bridge keeps exactly the two endpoints in the intermediate layer; union would keep them
        // too, but bridge drops anything not in A ∪ B, which is what stops it fattening.
        let bridged = make(INTERPOLATE_BRIDGE);
        assert!(bridged.voxel_at(2 * 8 + 2, 1).unwrap());
        assert!(bridged.voxel_at(1 * 8 + 3, 1).unwrap());
        let union_mode = make(INTERPOLATE_UNION);
        assert!(union_mode.voxel_at(2 * 8 + 2, 1).unwrap());
        assert!(union_mode.voxel_at(1 * 8 + 3, 1).unwrap());
    }

    /// §9 test 6 — the bridge connectivity theorem, tested against its own hypothesis rather than
    /// against a handful of rulesets.
    ///
    /// Vacuum stability says birth requires a live neighbor: every live cell at `t+1` has a live
    /// cell in its neighborhood-or-self at `t`. So we generate layer sequences that satisfy exactly
    /// that — each layer is an arbitrary subset of the previous layer's dilation — and assert that
    /// bridge interpolation leaves nothing floating. Any such rule is covered, not just the ones
    /// someone thought to write down.
    #[test]
    fn bridge_grounds_every_vacuum_stable_sequence_to_layer_zero() {
        let rows = 8;
        let cols = 10;
        let cells = rows * cols;
        let neighbors = open_boundary_neighbors(cols, rows, cells);

        for seed in 0..64u64 {
            let mut rng = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
            let mut next = || {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                rng
            };

            let mut current = vec![0u8; cells];
            current[(rows / 2) * cols + cols / 2] = 1;

            let mut world =
                WorldSolid::new(rows, cols, 12, 1, 0, 0b10, INTERPOLATE_BRIDGE).unwrap();
            for _ in 0..12 {
                world.staging.copy_from_slice(&current);
                world.push_layer().unwrap();

                // Candidates = dilation of the current layer. Keep an arbitrary subset.
                let mut candidate = vec![false; cells];
                for cell in 0..cells {
                    if current[cell] == 0 {
                        continue;
                    }
                    candidate[cell] = true;
                    for direction in 0..6 {
                        let neighbor = neighbors[cell * 6 + direction];
                        if neighbor != NO_NEIGHBOR {
                            candidate[neighbor as usize] = true;
                        }
                    }
                }
                let mut following = vec![0u8; cells];
                let mut any = false;
                for cell in 0..cells {
                    if candidate[cell] && next() % 3 != 0 {
                        following[cell] = 1;
                        any = true;
                    }
                }
                // A layer that dies out entirely is not a counterexample to the theorem, but it
                // would make the rest of the run trivial. Keep one cell alive.
                if !any {
                    following[(rows / 2) * cols + cols / 2] = 1;
                }
                current = following;
            }
            world.finalize_volume(KEEP_ALL).unwrap();
            assert_eq!(world.floating(), 0, "seed {seed} left a floating component");
            assert_eq!(world.component_count(), 1, "seed {seed} fragmented");
        }
    }

    /// The theorem is specific to bridging. Without it the same sequences do float — otherwise the
    /// test above would be passing for the wrong reason.
    #[test]
    fn without_bridging_a_vacuum_stable_sequence_can_still_float() {
        let rows = 8;
        let cols = 10;
        let cells = rows * cols;
        let mut world = WorldSolid::new(rows, cols, 2, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let mut first = vec![0u8; cells];
        first[4 * cols + 4] = 1;
        let mut second = vec![0u8; cells];
        second[3 * cols + 5] = 1; // a lateral neighbor: legal under vacuum stability, but diagonal
        world.staging.copy_from_slice(&first);
        world.push_layer().unwrap();
        world.staging.copy_from_slice(&second);
        world.push_layer().unwrap();
        world.finalize_volume(KEEP_ALL).unwrap();
        assert_eq!(world.component_count(), 2);
        assert_eq!(world.floating(), 1);
    }

    #[test]
    fn keep_policies_filter_and_report_what_they_dropped() {
        // Two separated pillars, one three cells wide, one single. No plate.
        let rows = 6;
        let cols = 10;
        let cells = rows * cols;
        let build = |keep: u8| {
            let mut s = WorldSolid::new(rows, cols, 3, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
            let mut layer = vec![0u8; cells];
            layer[1 * cols + 1] = 1;
            layer[2 * cols + 1] = 1;
            layer[3 * cols + 1] = 1;
            layer[1 * cols + 8] = 1;
            for _ in 0..3 {
                s.staging.copy_from_slice(&layer);
                s.push_layer().unwrap();
            }
            s.finalize_volume(keep).unwrap();
            s
        };

        let all = build(KEEP_ALL);
        assert_eq!(all.component_count(), 2);
        assert_eq!(all.kept_components(), 2);
        assert_eq!(all.kept_voxels(), 12);
        assert_eq!(all.dropped_voxels(), 0);
        assert_eq!(all.floating(), 0); // both pillars stand on layer 0

        let largest = build(KEEP_LARGEST);
        assert_eq!(largest.kept_components(), 1);
        assert_eq!(largest.kept_voxels(), 9);
        assert_eq!(largest.dropped_voxels(), 3);
        assert!(!largest.voxel_at(1 * cols + 8, 0).unwrap());
        assert!(largest.voxel_at(1 * cols + 1, 0).unwrap());
    }

    #[test]
    fn plate_connected_drops_what_never_reaches_the_build_surface() {
        let rows = 6;
        let cols = 10;
        let cells = rows * cols;
        let mut s = WorldSolid::new(rows, cols, 3, 0, 1, 0b10, INTERPOLATE_NONE).unwrap();
        let grounded = {
            let mut layer = vec![0u8; cells];
            layer[2 * cols + 2] = 1;
            layer
        };
        let floater = {
            let mut layer = vec![0u8; cells];
            layer[2 * cols + 2] = 1;
            layer[4 * cols + 7] = 1;
            layer
        };
        // Tick 0 sits on the plate; the second cell only appears from tick 1, and nothing ever
        // connects it downward.
        s.staging.copy_from_slice(&grounded);
        s.push_layer().unwrap();
        s.staging.copy_from_slice(&floater);
        s.push_layer().unwrap();
        s.staging.copy_from_slice(&floater);
        s.push_layer().unwrap();
        s.finalize_volume(KEEP_PLATE_CONNECTED).unwrap();

        assert_eq!(s.component_count(), 2);
        assert_eq!(s.floating(), 1);
        assert_eq!(s.kept_components(), 1);
        assert_eq!(s.dropped_voxels(), 2);
        assert!(!s.voxel_at(4 * cols + 7, 2).unwrap());
    }

    #[test]
    fn the_volume_is_a_pure_function_of_its_inputs() {
        let run = || {
            let mut s = stack(6, 10, 8, 2, 1);
            let mut rng = 0x1234_5678_9ABC_DEF0u64;
            for _ in 0..8 {
                let mut layer = vec![0u8; 60];
                for cell in layer.iter_mut() {
                    rng ^= rng << 13;
                    rng ^= rng >> 7;
                    rng ^= rng << 17;
                    *cell = (rng & 1) as u8;
                }
                s.staging.copy_from_slice(&layer);
                s.push_layer().unwrap();
            }
            s.finalize_volume(KEEP_PLATE_CONNECTED).unwrap();
            (s.volume_checksum(), s.kept_voxels(), s.component_count())
        };
        assert_eq!(run(), run());
        assert_eq!(run(), run());
    }

    #[test]
    fn refuses_to_finalize_a_half_pushed_stack_and_to_overfill_one() {
        let mut s = stack(4, 8, 2, 0, 0);
        let layer = empty(&s);
        push(&mut s, &layer);
        assert!(s.finalize_volume(KEEP_ALL).is_err());
        push(&mut s, &layer);
        assert!(s.push_layer().is_err());
        s.finalize_volume(KEEP_ALL).unwrap();
        assert!(s.finalize_volume(KEEP_ALL).is_err());
        assert!(s.push_layer().is_err());
    }

    #[test]
    fn padding_bits_above_the_cell_count_never_become_matter() {
        // 12 cells in a 64-bit word: 52 padding bits that a solid base plate must not light up.
        let mut s = WorldSolid::new(3, 4, 1, 0, 2, 0b10, INTERPOLATE_NONE).unwrap();
        let layer = vec![0u8; 12];
        s.staging.copy_from_slice(&layer);
        s.push_layer().unwrap();
        s.finalize_volume(KEEP_ALL).unwrap();
        assert_eq!(s.kept_voxels(), 24);
    }
}
