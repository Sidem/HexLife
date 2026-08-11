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

/// Quad merging.
pub const MERGE_NONE: u8 = 0;
pub const MERGE_GREEDY: u8 = 1;

/// Serialized formats.
pub const FORMAT_STL: u8 = 0;
pub const FORMAT_PLY: u8 = 1;
pub const FORMAT_3MF: u8 = 2;

/// Fractional digits written for a 3MF coordinate. The lattice is exact and the scale is one
/// multiply, so six digits is nanometre resolution on a millimetre model — far below anything a
/// printer can resolve, and a fixed count keeps the bytes a pure function of the inputs.
const DECIMALS: i64 = 1_000_000;

/// Sentinel for a lateral direction that leaves the grid. See the module header.
const NO_NEIGHBOR: u32 = u32::MAX;

const FLAG_TOUCHES_PLATE: u8 = 1;
const FLAG_KEEP: u8 = 2;

// ---------------------------------------------------------------------------------------------
// Geometry contract — single-sourced from the renderer, NOT re-derived.
//
// Flat-top hexagons, unit circumradius R, vertices at 0°, 60°, …, 300°
// (`Utils.createFlatTopHexagonVertices`); centers at `x = col · 1.5R`,
// `y = row · √3R + parityOffset` with the half-step by COLUMN parity (`Utils.gridToPixelCoords`).
//
// Both coordinates come out rational in R, so a vertex is addressed by exact INTEGERS and the
// float multiply happens once, at emission:
//
//     x = X · (cellSize / 2)          X = 3·col + CORNER_X[k]
//     y = Y · (cellSize · √3 / 2)     Y = 2·row + (col & 1) + CORNER_Y[k]
//     z = Z · layerHeight             Z = layer
//
// That is what makes the vertex weld exact. Two prisms that share an edge produce bit-identical
// integer keys, so there are no epsilon comparisons and no cracks — and none of it drifts with
// grid size the way accumulated floats would.
const CORNER_X: [i32; 6] = [2, 1, -1, -2, -1, 1];
const CORNER_Y: [i32; 6] = [0, 1, 1, 0, -1, -1];

/// Hexagon edge shared with the neighbor in canonical direction `d`.
///
/// Edge `k` runs from corner `k` to corner `k+1` and faces outward at `30° + 60k`; the neighbor in
/// direction `d` lies at `150° + 60d`. Hence `edge = (d + 2) mod 6`, on BOTH column parities —
/// which is not obvious, and is pinned by `shared_faces_have_identical_vertices` rather than
/// asserted here.
#[inline]
fn lateral_edge(direction: usize) -> usize {
    (direction + 2) % 6
}

/// Unit normals for the six lateral faces, `150° + 60d`.
///
/// Hardcoded rather than computed: every one is an exact multiple of 30°, so the components are
/// only ever 0, ±1/2, ±√3/2 — and a runtime `cos`/`sin` would make the exported bytes depend on the
/// platform's libm, which §7 forbids.
const SQRT3_OVER_2: f32 = 0.866_025_4;
const LATERAL_NORMALS: [[f32; 3]; 6] = [
    [-SQRT3_OVER_2, 0.5, 0.0],
    [-SQRT3_OVER_2, -0.5, 0.0],
    [0.0, -1.0, 0.0],
    [SQRT3_OVER_2, -0.5, 0.0],
    [SQRT3_OVER_2, 0.5, 0.0],
    [0.0, 1.0, 0.0],
];
const NORMAL_UP: usize = 6;
const NORMAL_DOWN: usize = 7;
const FACE_NORMALS: [[f32; 3]; 8] = [
    LATERAL_NORMALS[0],
    LATERAL_NORMALS[1],
    LATERAL_NORMALS[2],
    LATERAL_NORMALS[3],
    LATERAL_NORMALS[4],
    LATERAL_NORMALS[5],
    [0.0, 0.0, 1.0],
    [0.0, 0.0, -1.0],
];

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

    mesh: Mesh,
    /// Serialized bytes. Allocated at export time — the one place §5.1's preallocation rule does
    /// not reach, which is why JS re-views its memory after every export.
    mesh_bytes: Vec<u8>,
    /// For container formats, the parts `mesh_bytes` holds end to end. Empty for the single-file
    /// formats, which is exactly how JS tells the two cases apart.
    parts: Vec<ZipPart>,
}

/// One member of a zip container: where its bytes are, and their CRC-32.
///
/// The checksum is computed HERE rather than in JavaScript. Deflate is the one stage the plan
/// hands to JS, because `CompressionStream` is native and not a per-voxel loop — but a CRC is a
/// per-byte loop over the whole model, which is precisely what §2 keeps out of JS. So Rust emits
/// the payloads and their checksums, and JS is left with ~90 bytes of zip header per entry.
struct ZipPart {
    name: &'static str,
    offset: usize,
    length: usize,
    crc32: u32,
}

/// An indexed surface mesh in EXACT lattice coordinates.
///
/// Positions stay integer until serialization so the weld is exact and the geometry is a pure
/// function of the volume. `face_normals` stores a normal id per triangle rather than a vector,
/// because there are only eight distinct face orientations in this lattice.
#[derive(Default)]
struct Mesh {
    /// Three lattice integers per vertex: `(X, Y, Z)`.
    positions: Vec<i32>,
    indices: Vec<u32>,
    face_normals: Vec<u8>,
    /// Open-addressed weld table: packed lattice key → vertex index + 1, 0 meaning empty. Never
    /// iterated — vertex indices are assigned in emission order, so the output does not depend on
    /// the table's layout.
    weld_keys: Vec<u64>,
    weld_values: Vec<u32>,
    weld_mask: usize,
    weld_len: usize,
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
            mesh: Mesh::default(),
            mesh_bytes: Vec::new(),
            parts: Vec::new(),
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

    // ---- meshing ------------------------------------------------------------------------------

    /// Cull every face shared with a kept solid voxel and emit the rest as an indexed mesh.
    ///
    /// A lateral face becomes one quad (two triangles); a cap becomes a four-triangle fan — a
    /// six-triangle centre fan would cost 50% more for nothing, and caps are a minority of the
    /// surface in any tall extrusion.
    #[wasm_bindgen(js_name = buildMesh)]
    pub fn build_mesh(&mut self, merge: u8) -> Result<(), String> {
        if !self.finalized {
            return Err("WorldSolid.buildMesh: finalize the volume first.".into());
        }
        match merge {
            MERGE_NONE => self.build_mesh_unmerged(),
            MERGE_GREEDY => self.build_mesh_greedy(),
            _ => return Err("WorldSolid.buildMesh: unknown merge mode.".into()),
        }
        Ok(())
    }

    #[wasm_bindgen(getter, js_name = triangleCount)]
    pub fn triangle_count(&self) -> usize {
        self.mesh.face_normals.len()
    }

    #[wasm_bindgen(getter, js_name = vertexCount)]
    pub fn vertex_count(&self) -> usize {
        self.mesh.positions.len() / 3
    }

    /// Serialize the built mesh. `cell_size` is the hexagon circumradius in millimetres and
    /// `layer_height` the thickness of one layer; they are independent so the Z aspect ratio is a
    /// print decision rather than a tick-count accident.
    ///
    /// Writes into a Wasm buffer and leaves it addressable through `meshPtr`/`meshLen`. JavaScript
    /// never formats a triangle.
    #[wasm_bindgen(js_name = serializeMesh)]
    pub fn serialize_mesh(
        &mut self,
        format: u8,
        cell_size: f32,
        layer_height: f32,
    ) -> Result<(), String> {
        if !(cell_size.is_finite() && cell_size > 0.0 && layer_height.is_finite() && layer_height > 0.0)
        {
            return Err("WorldSolid.serializeMesh: cellSize and layerHeight must be positive.".into());
        }
        self.parts.clear();
        match format {
            FORMAT_STL => self.write_binary_stl(cell_size, layer_height),
            FORMAT_PLY => self.write_binary_ply(cell_size, layer_height),
            FORMAT_3MF => self.write_3mf_parts(cell_size, layer_height),
            _ => return Err("WorldSolid.serializeMesh: unknown format.".into()),
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = meshPtr)]
    pub fn mesh_ptr(&self) -> *const u8 {
        self.mesh_bytes.as_ptr()
    }

    #[wasm_bindgen(getter, js_name = meshLen)]
    pub fn mesh_len(&self) -> usize {
        self.mesh_bytes.len()
    }

    /// Triangles belonging to a top or bottom cap. Caps are the one thing greedy merging leaves
    /// alone (§5.5), so this is the measurement that decides whether an ear clipper is ever worth
    /// writing — the answer is "only if this dominates the total".
    #[wasm_bindgen(getter, js_name = capTriangleCount)]
    pub fn cap_triangle_count(&self) -> usize {
        self.mesh
            .face_normals
            .iter()
            .filter(|normal| **normal as usize >= NORMAL_UP)
            .count()
    }

    /// Members of the container the last `serializeMesh` produced, or 0 for a single-file format.
    ///
    /// This is how JavaScript learns that it is holding a 3MF and must wrap the parts in a zip:
    /// Rust emits every byte and every checksum, and JS contributes only the deflate — which is
    /// native, not a loop — and about ninety bytes of header per entry.
    #[wasm_bindgen(getter, js_name = zipPartCount)]
    pub fn zip_part_count(&self) -> usize {
        self.parts.len()
    }

    #[wasm_bindgen(js_name = zipPartName)]
    pub fn zip_part_name(&self, index: usize) -> Result<String, String> {
        Ok(self.part(index)?.name.to_string())
    }

    /// Byte offset of part `index` within `meshPtr`.
    #[wasm_bindgen(js_name = zipPartOffset)]
    pub fn zip_part_offset(&self, index: usize) -> Result<usize, String> {
        Ok(self.part(index)?.offset)
    }

    #[wasm_bindgen(js_name = zipPartLength)]
    pub fn zip_part_length(&self, index: usize) -> Result<usize, String> {
        Ok(self.part(index)?.length)
    }

    /// CRC-32 of the part's UNCOMPRESSED bytes, which is what a zip entry header records.
    #[wasm_bindgen(js_name = zipPartCrc32)]
    pub fn zip_part_crc32(&self, index: usize) -> Result<u32, String> {
        Ok(self.part(index)?.crc32)
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

// ---------------------------------------------------------------------------------------------
// Meshing.
//
// Two meshers, one surface. `merge: 'none'` emits every exposed face as its own quad or fan and is
// watertight in the half-edge sense — every directed edge appears exactly once with its opposite.
// `merge: 'greedy'` welds runs of coplanar, contiguous, identically-oriented faces into single
// quads, which is where almost the entire triangle budget goes. Both bound exactly the same solid;
// §9 test 9 proves it by comparing their surface areas and enclosed volumes exactly.

impl WorldSolid {
    /// Every exposed face on its own. The reference surface, and the one a strict manifold
    /// validator will accept.
    fn build_mesh_unmerged(&mut self) {
        self.mesh.reset(self.report.kept_voxels as usize);

        for layer in 0..self.total_layers {
            let base = self.layer_base(layer);
            for word_index in 0..self.words_per_layer {
                let mut word = self.volume[base + word_index];
                while word != 0 {
                    let bit = word.trailing_zeros() as usize;
                    word &= word - 1;
                    let cell = word_index * 64 + bit;
                    let col = (cell % self.columns) as i32;
                    let row = (cell / self.columns) as i32;

                    for direction in 0..6 {
                        let neighbor = self.neighbors[cell * 6 + direction];
                        // A seam direction has no prism on the far side, so that face is real,
                        // exposed boundary surface and must NOT be culled.
                        let occluded =
                            neighbor != NO_NEIGHBOR && get_bit(&self.volume, base, neighbor as usize);
                        if !occluded {
                            self.mesh.emit_lateral(col, row, layer as i32, direction);
                        }
                    }

                    let above_solid = layer + 1 < self.total_layers
                        && get_bit(&self.volume, base + self.words_per_layer, cell);
                    if !above_solid {
                        self.mesh.emit_cap(col, row, layer as i32 + 1, true);
                    }
                    let below_solid = layer > 0
                        && get_bit(&self.volume, base - self.words_per_layer, cell);
                    if !below_solid {
                        self.mesh.emit_cap(col, row, layer as i32, false);
                    }
                }
            }
        }
    }

    /// Greedy merging, which in THIS lattice is exactly vertical run merging.
    ///
    /// The plan (§5.5) expected the exposed faces of one lateral plane family to form a 2D grid
    /// indexed by (position along the lattice line, layer), meshed greedily in two axes. In a
    /// honeycomb they do not: every vertex has degree 3 and its three edges have three *different*
    /// orientations, so no two parallel hexagon edges are ever collinear and adjacent. Two lateral
    /// faces of the same direction can be coplanar — columns two apart share a `Y` — but a gap of
    /// four lattice units sits between them, occupied by the slanted edges of the column in
    /// between. Merging across it would invent surface where there is none.
    ///
    /// So the in-layer axis contributes nothing and the whole win is along Z, which is also where
    /// it was always going to be: a wall exposed for `L` consecutive layers collapses from `2L`
    /// triangles to 2, and interpolation layers make those runs long. Recorded as §15.6.
    ///
    /// Cell-major rather than layer-major, because a run is a property of one `(cell, direction)`
    /// pair across layers. Caps are NOT merged (§5.5 defers that behind a measurement).
    fn build_mesh_greedy(&mut self) {
        self.mesh.reset(self.report.kept_voxels as usize);

        for cell in 0..self.num_cells {
            let col = (cell % self.columns) as i32;
            let row = (cell / self.columns) as i32;

            for direction in 0..6 {
                let neighbor = self.neighbors[cell * 6 + direction];
                let mut run_start = usize::MAX;
                for layer in 0..self.total_layers {
                    let base = self.layer_base(layer);
                    // A seam direction has no prism on the far side: that face is exposed on every
                    // layer the cell itself is solid.
                    let exposed = get_bit(&self.volume, base, cell)
                        && !(neighbor != NO_NEIGHBOR
                            && get_bit(&self.volume, base, neighbor as usize));
                    if exposed {
                        if run_start == usize::MAX {
                            run_start = layer;
                        }
                    } else if run_start != usize::MAX {
                        self.mesh
                            .emit_lateral_run(col, row, run_start as i32, layer as i32, direction);
                        run_start = usize::MAX;
                    }
                }
                if run_start != usize::MAX {
                    self.mesh.emit_lateral_run(
                        col,
                        row,
                        run_start as i32,
                        self.total_layers as i32,
                        direction,
                    );
                }
            }

            for layer in 0..self.total_layers {
                let base = self.layer_base(layer);
                if !get_bit(&self.volume, base, cell) {
                    continue;
                }
                let above_solid = layer + 1 < self.total_layers
                    && get_bit(&self.volume, base + self.words_per_layer, cell);
                if !above_solid {
                    self.mesh.emit_cap(col, row, layer as i32 + 1, true);
                }
                let below_solid =
                    layer > 0 && get_bit(&self.volume, base - self.words_per_layer, cell);
                if !below_solid {
                    self.mesh.emit_cap(col, row, layer as i32, false);
                }
            }
        }
    }
}

impl WorldSolid {
    fn part(&self, index: usize) -> Result<&ZipPart, String> {
        self.parts
            .get(index)
            .ok_or_else(|| "WorldSolid: container part index out of range.".to_string())
    }

    /// Binary STL: 80-byte header, `u32` triangle count, then 50 bytes per triangle. No vertex
    /// sharing at all — it is the universal fallback, not the efficient format.
    fn write_binary_stl(&mut self, cell_size: f32, layer_height: f32) {
        let triangles = self.mesh.face_normals.len();
        self.mesh_bytes.clear();
        self.mesh_bytes.reserve(84 + triangles * 50);

        let mut header = [0u8; 80];
        let banner = b"HexLife solid extrusion";
        header[..banner.len()].copy_from_slice(banner);
        self.mesh_bytes.extend_from_slice(&header);
        self.mesh_bytes.extend_from_slice(&(triangles as u32).to_le_bytes());

        // One multiply per coordinate, from the exact lattice integer. No accumulation anywhere.
        let x_scale = cell_size * 0.5;
        let y_scale = cell_size * SQRT3_OVER_2;
        for triangle in 0..triangles {
            let normal = FACE_NORMALS[self.mesh.face_normals[triangle] as usize];
            for component in normal {
                self.mesh_bytes.extend_from_slice(&component.to_le_bytes());
            }
            for corner in 0..3 {
                let vertex = self.mesh.indices[triangle * 3 + corner] as usize;
                let lattice = &self.mesh.positions[vertex * 3..vertex * 3 + 3];
                self.mesh_bytes
                    .extend_from_slice(&(lattice[0] as f32 * x_scale).to_le_bytes());
                self.mesh_bytes
                    .extend_from_slice(&(lattice[1] as f32 * y_scale).to_le_bytes());
                self.mesh_bytes
                    .extend_from_slice(&(lattice[2] as f32 * layer_height).to_le_bytes());
            }
            self.mesh_bytes.extend_from_slice(&0u16.to_le_bytes());
        }
    }

    /// Binary little-endian PLY, indexed. Every vertex is written once and referenced by index, so
    /// it costs roughly a third of the STL for the same surface and is the format to reach for when
    /// something downstream wants the topology rather than a triangle soup.
    fn write_binary_ply(&mut self, cell_size: f32, layer_height: f32) {
        let vertices = self.mesh.positions.len() / 3;
        let triangles = self.mesh.face_normals.len();
        self.mesh_bytes.clear();
        self.mesh_bytes.reserve(256 + vertices * 12 + triangles * 13);

        // The header is ASCII and ends at the newline after `end_header`; everything after it is
        // binary. `int` rather than `uint` for the index list: it is what the format's own reference
        // files use and what the widest set of readers accepts.
        self.mesh_bytes.extend_from_slice(b"ply\nformat binary_little_endian 1.0\n");
        self.mesh_bytes.extend_from_slice(b"comment HexLife solid extrusion\n");
        self.mesh_bytes.extend_from_slice(b"element vertex ");
        push_u64(&mut self.mesh_bytes, vertices as u64);
        self.mesh_bytes
            .extend_from_slice(b"\nproperty float x\nproperty float y\nproperty float z\n");
        self.mesh_bytes.extend_from_slice(b"element face ");
        push_u64(&mut self.mesh_bytes, triangles as u64);
        self.mesh_bytes
            .extend_from_slice(b"\nproperty list uchar int vertex_indices\nend_header\n");

        let x_scale = cell_size * 0.5;
        let y_scale = cell_size * SQRT3_OVER_2;
        for vertex in 0..vertices {
            let lattice = &self.mesh.positions[vertex * 3..vertex * 3 + 3];
            self.mesh_bytes
                .extend_from_slice(&(lattice[0] as f32 * x_scale).to_le_bytes());
            self.mesh_bytes
                .extend_from_slice(&(lattice[1] as f32 * y_scale).to_le_bytes());
            self.mesh_bytes
                .extend_from_slice(&(lattice[2] as f32 * layer_height).to_le_bytes());
        }
        for triangle in 0..triangles {
            self.mesh_bytes.push(3);
            for corner in 0..3 {
                let index = self.mesh.indices[triangle * 3 + corner];
                self.mesh_bytes.extend_from_slice(&(index as i32).to_le_bytes());
            }
        }
    }

    /// The three members of a 3MF container, concatenated with a part table beside them.
    ///
    /// 3MF is the format slicers actually prefer, and the only one of the three that carries real
    /// units — `unit="millimeter"` on the model element, so `cellSize` and `layerHeight` mean what
    /// they say instead of depending on an import dialog.
    ///
    /// The container itself is a zip, and the deflate is JavaScript's (§2): `CompressionStream` is
    /// native, is not per-voxel work, and keeps `miniz_oxide` — and its several kilobytes — out of
    /// an artifact whose whole justification is that it costs its consumers nothing.
    fn write_3mf_parts(&mut self, cell_size: f32, layer_height: f32) {
        self.mesh_bytes.clear();
        let vertices = self.mesh.positions.len() / 3;
        let triangles = self.mesh.face_normals.len();
        self.mesh_bytes.reserve(self.model_upper_bound(cell_size, layer_height));

        self.push_part(
            "[Content_Types].xml",
            br#"<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>"#,
        );
        self.push_part(
            "_rels/.rels",
            br#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>"#,
        );

        let start = self.mesh_bytes.len();
        self.mesh_bytes.extend_from_slice(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">HexLife solid extrusion</metadata>
<resources>
<object id="1" type="model">
<mesh>
<vertices>
"#,
        );

        // Coordinates are computed in f64 from the exact lattice integer — one multiply, no
        // accumulation — and written with a fixed six fractional digits. Both halves matter for §7:
        // the multiply is exact enough that the same lattice always yields the same decimal, and a
        // fixed digit count means no shortest-round-trip formatter's platform quirks get in.
        let x_scale = cell_size as f64 * 0.5;
        let y_scale = cell_size as f64 * (SQRT3_OVER_2 as f64);
        let z_scale = layer_height as f64;
        for vertex in 0..vertices {
            let lattice = &self.mesh.positions[vertex * 3..vertex * 3 + 3];
            self.mesh_bytes.extend_from_slice(b"<vertex x=\"");
            push_decimal(&mut self.mesh_bytes, lattice[0] as f64 * x_scale);
            self.mesh_bytes.extend_from_slice(b"\" y=\"");
            push_decimal(&mut self.mesh_bytes, lattice[1] as f64 * y_scale);
            self.mesh_bytes.extend_from_slice(b"\" z=\"");
            push_decimal(&mut self.mesh_bytes, lattice[2] as f64 * z_scale);
            self.mesh_bytes.extend_from_slice(b"\"/>\n");
        }

        self.mesh_bytes.extend_from_slice(b"</vertices>\n<triangles>\n");
        for triangle in 0..triangles {
            self.mesh_bytes.extend_from_slice(b"<triangle v1=\"");
            push_u64(&mut self.mesh_bytes, self.mesh.indices[triangle * 3] as u64);
            self.mesh_bytes.extend_from_slice(b"\" v2=\"");
            push_u64(&mut self.mesh_bytes, self.mesh.indices[triangle * 3 + 1] as u64);
            self.mesh_bytes.extend_from_slice(b"\" v3=\"");
            push_u64(&mut self.mesh_bytes, self.mesh.indices[triangle * 3 + 2] as u64);
            self.mesh_bytes.extend_from_slice(b"\"/>\n");
        }
        self.mesh_bytes.extend_from_slice(
            b"</triangles>\n</mesh>\n</object>\n</resources>\n<build>\n<item objectid=\"1\"/>\n</build>\n</model>\n",
        );

        let length = self.mesh_bytes.len() - start;
        let crc32 = crc32(&self.mesh_bytes[start..]);
        self.parts.push(ZipPart {
            name: "3D/3dmodel.model",
            offset: start,
            length,
            crc32,
        });
    }

    /// An exact upper bound on the model part's length, so the buffer is reserved once.
    ///
    /// This matters far more than a capacity hint usually does. XML is the bulkiest of the three
    /// formats, and a `Vec` that outgrows its reservation doubles — holding the old allocation and
    /// the new one at the same time. On an unmerged reference volume that single spike was 80 MB of
    /// the export's peak footprint, which is the difference between clearing §8's memory budget and
    /// blowing through it. Reserving a true bound removes the spike outright rather than trimming it.
    ///
    /// The bound is exact rather than generous because the widths are all knowable: coordinates are
    /// the mesh's own largest lattice value times a fixed scale, written with a fixed six fractional
    /// digits, and an index is at most as wide as the vertex count.
    fn model_upper_bound(&self, cell_size: f32, layer_height: f32) -> usize {
        const VERTEX_MARKUP: usize = 25; // `<vertex x="` `" y="` `" z="` `"/>\n`
        const TRIANGLE_MARKUP: usize = 30; // `<triangle v1="` `" v2="` `" v3="` `"/>\n`
        const PREAMBLE: usize = 1024;

        let vertices = self.mesh.positions.len() / 3;
        let triangles = self.mesh.face_normals.len();

        let mut extent = [0i32; 3];
        for position in self.mesh.positions.chunks_exact(3) {
            for (axis, slot) in extent.iter_mut().enumerate() {
                *slot = (*slot).max(position[axis].abs());
            }
        }
        let scales = [
            cell_size as f64 * 0.5,
            cell_size as f64 * SQRT3_OVER_2 as f64,
            layer_height as f64,
        ];
        let coordinate: usize = (0..3)
            // sign, integer digits, point, six fractional digits
            .map(|axis| 1 + digit_width(extent[axis] as f64 * scales[axis]) + 1 + 6)
            .sum();
        let index = digit_width(vertices as f64);

        PREAMBLE
            + vertices * (VERTEX_MARKUP + coordinate)
            + triangles * (TRIANGLE_MARKUP + 3 * index)
    }

    fn push_part(&mut self, name: &'static str, payload: &[u8]) {
        let offset = self.mesh_bytes.len();
        self.mesh_bytes.extend_from_slice(payload);
        self.parts.push(ZipPart {
            name,
            offset,
            length: payload.len(),
            crc32: crc32(payload),
        });
    }
}

impl Mesh {
    fn reset(&mut self, kept_voxels: usize) {
        self.positions.clear();
        self.indices.clear();
        self.face_normals.clear();
        // Sized to grow into, not to avoid growing.
        //
        // Phase 2 sized this from the voxel count on the reasoning that a voxel contributes at most
        // twelve corners. Greedy merging severed that relationship: the reference volume welds
        // 162,703 voxels into 8,248 vertices, so a voxel-derived table over-allocates by two orders
        // of magnitude — twelve megabytes of hash table for a quarter-megabyte mesh, and twelve of
        // the sixteen megabytes the whole export peaked at.
        //
        // The vertex count cannot be known before emission, so start small and let `grow_weld`
        // double. Rehashing costs about one extra insert per vertex amortized, and vertex indices
        // are assigned in emission order regardless of the table's size, so nothing about the
        // output bytes depends on this number.
        let capacity = (kept_voxels / 8).max(1024).next_power_of_two();
        self.weld_keys.clear();
        self.weld_keys.resize(capacity, u64::MAX);
        self.weld_values.clear();
        self.weld_values.resize(capacity, 0);
        self.weld_mask = capacity - 1;
        self.weld_len = 0;
    }

    /// Intern a vertex by its exact lattice coordinate, assigning indices in emission order.
    fn vertex(&mut self, x: i32, y: i32, z: i32) -> u32 {
        // Bias into non-negative territory (corner offsets reach -2 in X and -1 in Y) and pack.
        let key = (((x + 2) as u64) << 42) | (((y + 1) as u64) << 21) | (z as u64);
        let mut slot = (splitmix(key) as usize) & self.weld_mask;
        loop {
            if self.weld_keys[slot] == u64::MAX {
                break;
            }
            if self.weld_keys[slot] == key {
                return self.weld_values[slot];
            }
            slot = (slot + 1) & self.weld_mask;
        }
        let index = (self.positions.len() / 3) as u32;
        self.weld_keys[slot] = key;
        self.weld_values[slot] = index;
        self.weld_len += 1;
        self.positions.extend_from_slice(&[x, y, z]);
        if self.weld_len * 4 > self.weld_keys.len() * 3 {
            self.grow_weld();
        }
        index
    }

    fn grow_weld(&mut self) {
        let capacity = self.weld_keys.len() * 2;
        let old_keys = core::mem::replace(&mut self.weld_keys, vec![u64::MAX; capacity]);
        let old_values = core::mem::replace(&mut self.weld_values, vec![0u32; capacity]);
        self.weld_mask = capacity - 1;
        for (key, value) in old_keys.into_iter().zip(old_values) {
            if key == u64::MAX {
                continue;
            }
            let mut slot = (splitmix(key) as usize) & self.weld_mask;
            while self.weld_keys[slot] != u64::MAX {
                slot = (slot + 1) & self.weld_mask;
            }
            self.weld_keys[slot] = key;
            self.weld_values[slot] = value;
        }
    }

    fn triangle(&mut self, a: u32, b: u32, c: u32, normal: u8) {
        self.indices.extend_from_slice(&[a, b, c]);
        self.face_normals.push(normal);
    }

    /// The corner of cell `(col, row)` at hexagon vertex `k`, on layer plane `z`.
    fn corner(&mut self, col: i32, row: i32, z: i32, k: usize) -> u32 {
        self.vertex(3 * col + CORNER_X[k], 2 * row + (col & 1) + CORNER_Y[k], z)
    }

    /// One lateral face: the quad swept by hexagon edge `lateral_edge(direction)` from layer plane
    /// `z` to `z + 1`.
    fn emit_lateral(&mut self, col: i32, row: i32, z: i32, direction: usize) {
        self.emit_lateral_run(col, row, z, z + 1, direction);
    }

    /// A run of lateral faces welded into one quad, spanning layer planes `z0`..`z1`.
    ///
    /// Wound counter-clockwise seen from outside. Corners run in increasing hexagon-vertex order,
    /// which is counter-clockwise in XY, so `(bottom_a → bottom_b) × ẑ` is the outward normal.
    ///
    /// The unmerged mesher is the `z1 = z0 + 1` case of this, which is deliberate: one emitter
    /// means the two meshers cannot drift in winding, in the direction→edge mapping, or in which
    /// lattice coordinates they weld on.
    fn emit_lateral_run(&mut self, col: i32, row: i32, z0: i32, z1: i32, direction: usize) {
        let edge = lateral_edge(direction);
        let a = self.corner(col, row, z0, edge);
        let b = self.corner(col, row, z0, (edge + 1) % 6);
        let b_top = self.corner(col, row, z1, (edge + 1) % 6);
        let a_top = self.corner(col, row, z1, edge);
        let normal = direction as u8;
        self.triangle(a, b, b_top, normal);
        self.triangle(a, b_top, a_top, normal);
    }

    /// One cap: a four-triangle fan from hexagon vertex 0. `up` selects the winding — hexagon
    /// vertices ascend counter-clockwise in XY, which is outward for a top cap and inward for a
    /// bottom one.
    fn emit_cap(&mut self, col: i32, row: i32, z: i32, up: bool) {
        let mut fan = [0u32; 6];
        for (k, slot) in fan.iter_mut().enumerate() {
            *slot = self.corner(col, row, z, k);
        }
        let normal = if up { NORMAL_UP as u8 } else { NORMAL_DOWN as u8 };
        for k in 1..5 {
            if up {
                self.triangle(fan[0], fan[k], fan[k + 1], normal);
            } else {
                self.triangle(fan[0], fan[k + 1], fan[k], normal);
            }
        }
    }
}

/// Append `value` as a base-10 integer. No allocation: `format!` per coordinate would be three
/// `String`s per vertex, and a large mesh has hundreds of thousands of them.
fn push_u64(out: &mut Vec<u8>, mut value: u64) {
    if value == 0 {
        out.push(b'0');
        return;
    }
    let mut digits = [0u8; 20];
    let mut length = 0;
    while value != 0 {
        digits[length] = b'0' + (value % 10) as u8;
        value /= 10;
        length += 1;
    }
    for index in (0..length).rev() {
        out.push(digits[index]);
    }
}

/// Append `value` as a decimal with at most six fractional digits, trailing zeros trimmed.
///
/// Rounding once from an exact lattice product keeps the text a pure function of the inputs, which
/// `{}`-formatting an `f32` would not be: the shortest-round-trip representation of a coordinate
/// varies with how the value was reached, and the point of the integer lattice is that it never
/// varies at all.
fn push_decimal(out: &mut Vec<u8>, value: f64) {
    let scaled = (value * DECIMALS as f64).round() as i64;
    if scaled < 0 {
        out.push(b'-');
    }
    let magnitude = scaled.unsigned_abs();
    push_u64(out, magnitude / DECIMALS as u64);
    let fraction = magnitude % DECIMALS as u64;
    if fraction == 0 {
        return;
    }
    let mut digits = [0u8; 6];
    let mut rest = fraction;
    for slot in digits.iter_mut().rev() {
        *slot = b'0' + (rest % 10) as u8;
        rest /= 10;
    }
    let end = digits.iter().rposition(|digit| *digit != b'0').unwrap_or(0) + 1;
    out.push(b'.');
    out.extend_from_slice(&digits[..end]);
}

/// Digits in the integer part of `value`. Sizing only — never on the output path, so the `f64` here
/// cannot affect a single serialized byte.
fn digit_width(value: f64) -> usize {
    let mut whole = value.abs() as u64;
    let mut digits = 1;
    while whole >= 10 {
        whole /= 10;
        digits += 1;
    }
    digits
}

/// Nibble-at-a-time CRC-32 table (IEEE polynomial, reflected), built at compile time.
///
/// Sixteen entries rather than the usual 256: the byte-wide table would add a kilobyte of data
/// section to an artifact that is currently 23 KB, and this engine's whole claim is that it costs
/// its consumers nothing it does not have to.
const CRC32_NIBBLE: [u32; 16] = {
    let mut table = [0u32; 16];
    let mut index = 0;
    while index < 16 {
        let mut value = index as u32;
        let mut step = 0;
        while step < 4 {
            value = if value & 1 != 0 {
                0xEDB8_8320 ^ (value >> 1)
            } else {
                value >> 1
            };
            step += 1;
        }
        table[index] = value;
        index += 1;
    }
    table
};

/// CRC-32 of a zip member's uncompressed bytes.
///
/// In Rust, not JavaScript: the deflate JS owns is a native stream, but a checksum is a per-byte
/// loop over the entire model — the exact shape §2 keeps out of the host.
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in bytes {
        crc ^= *byte as u32;
        crc = (crc >> 4) ^ CRC32_NIBBLE[(crc & 0x0F) as usize];
        crc = (crc >> 4) ^ CRC32_NIBBLE[(crc & 0x0F) as usize];
    }
    !crc
}

/// SplitMix64 finalizer — a fixed, platform-independent mixer for the weld table. Deliberately not
/// `RandomState`: nothing here may depend on a per-process seed.
#[inline]
fn splitmix(mut key: u64) -> u64 {
    key = (key ^ (key >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    key = (key ^ (key >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    key ^ (key >> 31)
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

    // ---- Phase 2: the mesher ------------------------------------------------------------------

    /// Build a stack with a single solid voxel at `cell` and mesh it.
    fn one_voxel(rows: usize, cols: usize, cell: usize) -> WorldSolid {
        let mut s = WorldSolid::new(rows, cols, 1, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let mut layer = vec![0u8; rows * cols];
        layer[cell] = 1;
        s.staging.copy_from_slice(&layer);
        s.push_layer().unwrap();
        s.finalize_volume(KEEP_ALL).unwrap();
        s.build_mesh(MERGE_NONE).unwrap();
        s
    }

    /// Every triangle's three (vertex, vertex) edges, as directed lattice-index pairs.
    fn directed_edges(mesh: &Mesh) -> Vec<(u32, u32)> {
        let mut edges = Vec::with_capacity(mesh.face_normals.len() * 3);
        for triangle in 0..mesh.face_normals.len() {
            let a = mesh.indices[triangle * 3];
            let b = mesh.indices[triangle * 3 + 1];
            let c = mesh.indices[triangle * 3 + 2];
            edges.push((a, b));
            edges.push((b, c));
            edges.push((c, a));
        }
        edges
    }

    /// §9 test 1 — the irreducible case.
    #[test]
    fn an_isolated_voxel_is_eight_faces_and_twenty_triangles() {
        let s = one_voxel(6, 8, 2 * 8 + 3);
        // 6 lateral quads = 12 triangles, 2 caps x 4-triangle fan = 8.
        assert_eq!(s.triangle_count(), 20);
        // A hexagonal prism has 12 distinct corners and every one is welded exactly once.
        assert_eq!(s.vertex_count(), 12);
    }

    /// §9 test 2 — watertight. Every edge appears exactly twice, once in each direction. This is
    /// the single strongest statement that the surface bounds a solid.
    #[test]
    fn the_surface_is_watertight_and_consistently_wound() {
        let check = |s: &WorldSolid| {
            let edges = directed_edges(&s.mesh);
            let mut sorted = edges.clone();
            sorted.sort_unstable();
            for (a, b) in &edges {
                assert_eq!(
                    sorted.binary_search(&(*a, *b)).is_ok(),
                    true,
                    "edge missing from its own list"
                );
                // The opposite half-edge must exist exactly once, and this one exactly once.
                assert_eq!(
                    sorted.iter().filter(|e| **e == (*a, *b)).count(),
                    1,
                    "edge {a}->{b} used twice in the same direction"
                );
                assert_eq!(
                    sorted.iter().filter(|e| **e == (*b, *a)).count(),
                    1,
                    "edge {a}->{b} has no opposite"
                );
            }
        };
        check(&one_voxel(6, 8, 2 * 8 + 3));

        // A column, a slab, and a random blob: the interesting cases are the culled interiors.
        let mut column = WorldSolid::new(6, 8, 4, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let mut layer = vec![0u8; 48];
        layer[2 * 8 + 3] = 1;
        for _ in 0..4 {
            column.staging.copy_from_slice(&layer);
            column.push_layer().unwrap();
        }
        column.finalize_volume(KEEP_ALL).unwrap();
        column.build_mesh(MERGE_NONE).unwrap();
        check(&column);

        let mut slab = WorldSolid::new(4, 6, 3, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let full = vec![1u8; 24];
        for _ in 0..3 {
            slab.staging.copy_from_slice(&full);
            slab.push_layer().unwrap();
        }
        slab.finalize_volume(KEEP_ALL).unwrap();
        slab.build_mesh(MERGE_NONE).unwrap();
        check(&slab);

        let mut blob = WorldSolid::new(6, 10, 6, 1, 1, 0b10, INTERPOLATE_BRIDGE).unwrap();
        let mut rng = 0xC0FFEEu64;
        for _ in 0..6 {
            let mut cells = vec![0u8; 60];
            for cell in cells.iter_mut() {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                *cell = (rng & 1) as u8;
            }
            blob.staging.copy_from_slice(&cells);
            blob.push_layer().unwrap();
        }
        blob.finalize_volume(KEEP_ALL).unwrap();
        blob.build_mesh(MERGE_NONE).unwrap();
        check(&blob);
    }

    /// §9 test 3 — Euler characteristic on genus-0 fixtures.
    #[test]
    fn genus_zero_fixtures_have_euler_characteristic_two() {
        let euler = |s: &WorldSolid| {
            let vertices = s.vertex_count() as i64;
            let faces = s.triangle_count() as i64;
            let mut edges: Vec<(u32, u32)> = directed_edges(&s.mesh)
                .into_iter()
                .map(|(a, b)| if a < b { (a, b) } else { (b, a) })
                .collect();
            edges.sort_unstable();
            edges.dedup();
            vertices - edges.len() as i64 + faces
        };

        assert_eq!(euler(&one_voxel(6, 8, 2 * 8 + 3)), 2);

        let mut column = WorldSolid::new(6, 8, 5, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let mut layer = vec![0u8; 48];
        layer[3 * 8 + 4] = 1;
        for _ in 0..5 {
            column.staging.copy_from_slice(&layer);
            column.push_layer().unwrap();
        }
        column.finalize_volume(KEEP_ALL).unwrap();
        column.build_mesh(MERGE_NONE).unwrap();
        assert_eq!(euler(&column), 2);

        let mut slab = WorldSolid::new(4, 6, 2, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let full = vec![1u8; 24];
        for _ in 0..2 {
            slab.staging.copy_from_slice(&full);
            slab.push_layer().unwrap();
        }
        slab.finalize_volume(KEEP_ALL).unwrap();
        slab.build_mesh(MERGE_NONE).unwrap();
        assert_eq!(euler(&slab), 2);
    }

    /// §9 test 4 — culling. A fully solid volume must emit its boundary shell and nothing else.
    #[test]
    fn a_solid_block_emits_only_its_boundary_shell() {
        let rows = 4;
        let cols = 6;
        let layers = 3;
        let mut s = WorldSolid::new(rows, cols, layers, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let full = vec![1u8; rows * cols];
        for _ in 0..layers {
            s.staging.copy_from_slice(&full);
            s.push_layer().unwrap();
        }
        s.finalize_volume(KEEP_ALL).unwrap();
        s.build_mesh(MERGE_NONE).unwrap();

        // Count the exposed faces independently of the mesher: a lateral face is exposed where the
        // open-boundary neighbor is missing, and caps only on the top and bottom layers.
        let mut lateral = 0usize;
        for cell in 0..rows * cols {
            for direction in 0..6 {
                if s.neighbors[cell * 6 + direction] == NO_NEIGHBOR {
                    lateral += 1;
                }
            }
        }
        let expected = (lateral * layers) * 2 + (rows * cols) * 2 * 4;
        assert_eq!(s.triangle_count(), expected);
    }

    /// The two prisms sharing a face must agree on where that face IS. If the direction-to-edge
    /// mapping were wrong on either parity, these vertices would not coincide — and the mesh would
    /// look plausible while being unweldable.
    #[test]
    fn shared_faces_have_identical_vertices() {
        let rows = 6;
        let cols = 8;
        let s = WorldSolid::new(rows, cols, 1, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let lattice = |col: i32, row: i32, k: usize| {
            (3 * col + CORNER_X[k], 2 * row + (col & 1) + CORNER_Y[k])
        };
        for cell in 0..rows * cols {
            let col = (cell % cols) as i32;
            let row = (cell / cols) as i32;
            for direction in 0..6 {
                let neighbor = s.neighbors[cell * 6 + direction];
                if neighbor == NO_NEIGHBOR {
                    continue;
                }
                let n_col = (neighbor as usize % cols) as i32;
                let n_row = (neighbor as usize / cols) as i32;

                let edge = lateral_edge(direction);
                let mine = [lattice(col, row, edge), lattice(col, row, (edge + 1) % 6)];
                // The neighbor sees the same wall through the opposite direction.
                let opposite = lateral_edge((direction + 3) % 6);
                let theirs = [
                    lattice(n_col, n_row, opposite),
                    lattice(n_col, n_row, (opposite + 1) % 6),
                ];
                assert!(
                    (mine[0] == theirs[0] && mine[1] == theirs[1])
                        || (mine[0] == theirs[1] && mine[1] == theirs[0]),
                    "cell {cell} direction {direction}: {mine:?} vs {theirs:?}"
                );
            }
        }
    }

    /// §9 test 8 — determinism. Identical option blocks produce byte-identical exports.
    #[test]
    fn exports_are_byte_identical_across_runs() {
        let run = || {
            let mut s = WorldSolid::new(6, 10, 8, 1, 1, 0b10, INTERPOLATE_BRIDGE).unwrap();
            let mut rng = 0x5EEDu64;
            for _ in 0..8 {
                let mut cells = vec![0u8; 60];
                for cell in cells.iter_mut() {
                    rng ^= rng << 13;
                    rng ^= rng >> 7;
                    rng ^= rng << 17;
                    *cell = (rng & 1) as u8;
                }
                s.staging.copy_from_slice(&cells);
                s.push_layer().unwrap();
            }
            s.finalize_volume(KEEP_PLATE_CONNECTED).unwrap();
            s.build_mesh(MERGE_NONE).unwrap();
            s.serialize_mesh(FORMAT_STL, 2.0, 0.8).unwrap();
            s.mesh_bytes.clone()
        };
        let first = run();
        assert_eq!(first, run());
        assert_eq!(first, run());
        assert!(first.len() > 84);
    }

    #[test]
    fn binary_stl_has_the_shape_the_format_promises() {
        let mut s = one_voxel(6, 8, 2 * 8 + 3);
        s.serialize_mesh(FORMAT_STL, 2.0, 0.8).unwrap();
        let bytes = &s.mesh_bytes;
        assert_eq!(bytes.len(), 84 + 20 * 50);
        assert_eq!(&bytes[..7], b"HexLife");
        let count = u32::from_le_bytes(bytes[80..84].try_into().unwrap());
        assert_eq!(count, 20);

        // The first triangle belongs to lateral direction 0, whose outward normal is 150°.
        let normal_x = f32::from_le_bytes(bytes[84..88].try_into().unwrap());
        let normal_y = f32::from_le_bytes(bytes[88..92].try_into().unwrap());
        assert_eq!(normal_x, -SQRT3_OVER_2);
        assert_eq!(normal_y, 0.5);

        // Every Z lands on a layer plane; the prism is exactly one layer tall.
        let mut zs = Vec::new();
        for triangle in 0..20 {
            for corner in 0..3 {
                let offset = 84 + triangle * 50 + 12 + corner * 12 + 8;
                zs.push(f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()));
            }
        }
        assert!(zs.iter().all(|z| *z == 0.0 || *z == 0.8));
    }

    #[test]
    fn geometry_scales_by_one_multiply_from_the_lattice() {
        let mut s = one_voxel(6, 8, 0);
        s.serialize_mesh(FORMAT_STL, 2.0, 0.5).unwrap();
        // Cell 0 is column 0, row 0: centre at the origin, so corner 0 sits at (+R, 0) = (2, 0).
        let xs: Vec<f32> = (0..3)
            .map(|corner| {
                let offset = 84 + 12 + corner * 12;
                f32::from_le_bytes(s.mesh_bytes[offset..offset + 4].try_into().unwrap())
            })
            .collect();
        assert!(xs.iter().all(|x| x.abs() <= 2.0 + 1e-6));
    }

    #[test]
    fn refuses_to_mesh_before_finalizing_and_rejects_unknown_options() {
        let mut s = WorldSolid::new(4, 8, 1, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        assert!(s.build_mesh(MERGE_NONE).is_err());
        s.staging.copy_from_slice(&vec![0u8; 32]);
        s.push_layer().unwrap();
        s.finalize_volume(KEEP_ALL).unwrap();
        assert!(s.build_mesh(9).is_err());
        s.build_mesh(MERGE_GREEDY).unwrap();
        s.build_mesh(MERGE_NONE).unwrap();
        assert!(s.serialize_mesh(9, 1.0, 1.0).is_err());
        assert!(s.serialize_mesh(FORMAT_STL, 0.0, 1.0).is_err());
        assert!(s.serialize_mesh(FORMAT_STL, 1.0, -1.0).is_err());
    }

    // ---- Phase 3: greedy merging, PLY, 3MF ----------------------------------------------------

    /// The exact surface area and enclosed volume of a mesh, as INTEGERS.
    ///
    /// Both quantities come out of the integer lattice without a single inexact operation, which is
    /// what makes §9 test 9 a proof rather than a tolerance check:
    ///
    /// * Every triangle here is either horizontal (a cap, cross product purely `±ẑ`) or vertical
    ///   (a lateral wall, zero `ẑ` component), so the two are separable.
    /// * A cap's area is `|Cz| · a · b / 2` for integer `Cz`, where `a = cellSize/2` and
    ///   `b = cellSize·√3/2` are the lattice's two horizontal scales.
    /// * A lateral triangle's area is `√(3Cx² + Cy²) · a · h / 2`, and that radicand is always a
    ///   perfect square in this lattice — every hexagon edge has length exactly `cellSize`, whether
    ///   it is one of the two horizontal edges (`2a`) or one of the four slanted ones
    ///   (`√(a² + b²)`, which is the same number). The assertion below pins that.
    /// * The enclosed volume is `Σ P₀ · (P₁ × P₂) / 6` with the scale `a·b·h` factoring out whole,
    ///   because every term is one `x` times one `y` times one `z`.
    fn exact_measures(mesh: &Mesh) -> (i64, i64, i128) {
        let mut cap_cross = 0i64;
        let mut lateral_span = 0i64;
        let mut volume_times_six = 0i128;

        for triangle in 0..mesh.face_normals.len() {
            let mut p = [[0i64; 3]; 3];
            for (corner, slot) in p.iter_mut().enumerate() {
                let vertex = mesh.indices[triangle * 3 + corner] as usize;
                for axis in 0..3 {
                    slot[axis] = mesh.positions[vertex * 3 + axis] as i64;
                }
            }
            let e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
            let e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
            let cx = e1[1] * e2[2] - e1[2] * e2[1];
            let cy = e1[2] * e2[0] - e1[0] * e2[2];
            let cz = e1[0] * e2[1] - e1[1] * e2[0];

            if cx == 0 && cy == 0 {
                cap_cross += cz.abs();
            } else {
                assert_eq!(cz, 0, "a face that is neither horizontal nor vertical");
                let square = 3 * cx * cx + cy * cy;
                let root = (square as f64).sqrt().round() as i64;
                assert_eq!(root * root, square, "a hexagon edge whose length is not exact");
                lateral_span += root;
            }

            let (a, b, c) = (p[0], p[1], p[2]);
            volume_times_six += (a[0] as i128) * ((b[1] as i128) * (c[2] as i128) - (b[2] as i128) * (c[1] as i128))
                - (a[1] as i128) * ((b[0] as i128) * (c[2] as i128) - (b[2] as i128) * (c[0] as i128))
                + (a[2] as i128) * ((b[0] as i128) * (c[1] as i128) - (b[1] as i128) * (c[0] as i128));
        }
        (cap_cross, lateral_span, volume_times_six)
    }

    /// A pseudo-random blob built by an arbitrary sequence of layers, bridged and plate-filtered —
    /// the messiest surface this engine produces, and therefore the one worth measuring.
    fn blob(ticks: usize) -> WorldSolid {
        let rows = 8;
        let cols = 12;
        let mut s = WorldSolid::new(rows, cols, ticks, 1, 1, 0b10, INTERPOLATE_BRIDGE).unwrap();
        let mut rng = 0xB10Bu64;
        for _ in 0..ticks {
            let mut cells = vec![0u8; rows * cols];
            for cell in cells.iter_mut() {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                *cell = (rng & 1) as u8;
            }
            s.staging.copy_from_slice(&cells);
            s.push_layer().unwrap();
        }
        s.finalize_volume(KEEP_PLATE_CONNECTED).unwrap();
        s
    }

    /// §9 test 9 — greedy merging preserves the surface.
    ///
    /// The unmerged mesher is the oracle here, not a peer: the owner's slicer opened its output
    /// with no repair prompt, so "the merged mesh bounds exactly the same solid" is a stronger
    /// statement than re-running the same invariants against the merged output would be.
    #[test]
    fn greedy_merging_preserves_surface_area_and_enclosed_volume() {
        let mut fixtures: Vec<WorldSolid> = Vec::new();
        fixtures.push(one_voxel(6, 8, 2 * 8 + 3));

        let mut column = WorldSolid::new(6, 8, 9, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let mut layer = vec![0u8; 48];
        layer[2 * 8 + 3] = 1;
        for _ in 0..9 {
            column.staging.copy_from_slice(&layer);
            column.push_layer().unwrap();
        }
        column.finalize_volume(KEEP_ALL).unwrap();
        fixtures.push(column);

        let mut slab = WorldSolid::new(4, 6, 5, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let full = vec![1u8; 24];
        for _ in 0..5 {
            slab.staging.copy_from_slice(&full);
            slab.push_layer().unwrap();
        }
        slab.finalize_volume(KEEP_ALL).unwrap();
        fixtures.push(slab);

        fixtures.push(blob(10));

        for (index, world) in fixtures.iter_mut().enumerate() {
            world.build_mesh(MERGE_NONE).unwrap();
            let unmerged = exact_measures(&world.mesh);
            let unmerged_triangles = world.triangle_count();

            world.build_mesh(MERGE_GREEDY).unwrap();
            let merged = exact_measures(&world.mesh);

            assert_eq!(merged.0, unmerged.0, "fixture {index}: cap area changed");
            assert_eq!(merged.1, unmerged.1, "fixture {index}: lateral area changed");
            assert_eq!(merged.2, unmerged.2, "fixture {index}: enclosed volume changed");
            assert!(
                world.triangle_count() <= unmerged_triangles,
                "fixture {index}: merging added triangles"
            );
        }
    }

    /// The shape of the win: a wall exposed for `L` layers costs 2 triangles, not `2L`. A tall
    /// isolated column is therefore the same mesh as a single voxel.
    #[test]
    fn a_vertical_run_collapses_to_one_quad_however_tall_it_is() {
        let mut tall = WorldSolid::new(6, 8, 40, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let mut layer = vec![0u8; 48];
        layer[2 * 8 + 3] = 1;
        for _ in 0..40 {
            tall.staging.copy_from_slice(&layer);
            tall.push_layer().unwrap();
        }
        tall.finalize_volume(KEEP_ALL).unwrap();

        tall.build_mesh(MERGE_NONE).unwrap();
        assert_eq!(tall.triangle_count(), 6 * 2 * 40 + 8);

        tall.build_mesh(MERGE_GREEDY).unwrap();
        // Six lateral quads spanning all forty layers, plus the two unmerged caps.
        assert_eq!(tall.triangle_count(), 6 * 2 + 8);
        assert_eq!(tall.vertex_count(), 12);
        assert_eq!(tall.cap_triangle_count(), 8);
    }

    /// Merging must stop where the wall does. Two separated exposures of the same wall stay two
    /// quads — a single quad spanning the gap would invent surface across a hole.
    #[test]
    fn a_broken_run_stays_broken() {
        let rows = 6;
        let cols = 8;
        let cells = rows * cols;
        let mut s = WorldSolid::new(rows, cols, 5, 0, 0, 0b10, INTERPOLATE_NONE).unwrap();
        let cell = 2 * cols + 3;
        // A column with its middle layer missing: solid, solid, void, solid, solid.
        for layer in 0..5 {
            let mut cells_in = vec![0u8; cells];
            if layer != 2 {
                cells_in[cell] = 1;
            }
            s.staging.copy_from_slice(&cells_in);
            s.push_layer().unwrap();
        }
        s.finalize_volume(KEEP_ALL).unwrap();
        s.build_mesh(MERGE_GREEDY).unwrap();
        // Two prisms, each six merged walls and two caps: 2 × (12 + 8).
        assert_eq!(s.triangle_count(), 40);
        assert_eq!(s.vertex_count(), 24);
    }

    /// Merging is a pure function of the volume too — same fixture, same triangles, same bytes, in
    /// all three formats.
    #[test]
    fn every_format_is_byte_identical_across_runs() {
        for format in [FORMAT_STL, FORMAT_PLY, FORMAT_3MF] {
            let run = || {
                let mut s = blob(8);
                s.build_mesh(MERGE_GREEDY).unwrap();
                s.serialize_mesh(format, 1.5, 0.6).unwrap();
                (s.mesh_bytes.clone(), s.parts.iter().map(|p| p.crc32).collect::<Vec<_>>())
            };
            let first = run();
            assert_eq!(first, run(), "format {format} is not reproducible");
            assert_eq!(first, run(), "format {format} is not reproducible");
            assert!(first.0.len() > 64);
        }
    }

    #[test]
    fn binary_ply_has_the_shape_the_format_promises() {
        let mut s = one_voxel(6, 8, 2 * 8 + 3);
        s.build_mesh(MERGE_GREEDY).unwrap();
        s.serialize_mesh(FORMAT_PLY, 2.0, 0.8).unwrap();
        let bytes = s.mesh_bytes.clone();

        let header_end = find_bytes(&bytes, b"end_header\n").expect("a terminated header") + 11;
        let header = core::str::from_utf8(&bytes[..header_end]).unwrap();
        assert!(header.starts_with("ply\nformat binary_little_endian 1.0\n"));
        assert!(header.contains("element vertex 12\n"));
        assert!(header.contains("element face 20\n"));
        assert!(header.contains("property list uchar int vertex_indices\n"));

        // 12 vertices × 3 floats, then 20 faces of (count byte + 3 int32).
        assert_eq!(bytes.len(), header_end + 12 * 12 + 20 * 13);
        assert_eq!(bytes[header_end + 12 * 12], 3);
        // PLY is indexed, so it is dramatically smaller than the same surface as an STL.
        s.serialize_mesh(FORMAT_STL, 2.0, 0.8).unwrap();
        assert!(bytes.len() < s.mesh_bytes.len());
    }

    #[test]
    fn the_3mf_container_carries_three_parts_with_real_units() {
        let mut s = one_voxel(6, 8, 2 * 8 + 3);
        s.build_mesh(MERGE_GREEDY).unwrap();
        s.serialize_mesh(FORMAT_3MF, 2.0, 0.8).unwrap();

        assert_eq!(s.zip_part_count(), 3);
        assert_eq!(s.zip_part_name(0).unwrap(), "[Content_Types].xml");
        assert_eq!(s.zip_part_name(1).unwrap(), "_rels/.rels");
        assert_eq!(s.zip_part_name(2).unwrap(), "3D/3dmodel.model");
        assert!(s.zip_part_name(3).is_err());

        // The parts tile `mesh_bytes` exactly: JS slices them out by offset, nothing else.
        let mut expected_offset = 0usize;
        for index in 0..3 {
            assert_eq!(s.zip_part_offset(index).unwrap(), expected_offset);
            let length = s.zip_part_length(index).unwrap();
            let start = expected_offset;
            assert_eq!(
                s.zip_part_crc32(index).unwrap(),
                crc32(&s.mesh_bytes[start..start + length])
            );
            expected_offset += length;
        }
        assert_eq!(expected_offset, s.mesh_bytes.len());

        let model = core::str::from_utf8(
            &s.mesh_bytes[s.zip_part_offset(2).unwrap()..],
        )
        .unwrap();
        // Units are the whole reason to prefer 3MF: millimetres are declared, not guessed at import.
        assert!(model.contains(r#"<model unit="millimeter""#));
        assert_eq!(model.matches("<vertex ").count(), 12);
        assert_eq!(model.matches("<triangle ").count(), 20);
        assert!(model.contains("<item objectid=\"1\"/>"));
        // Cell 3 of row 2, corner 0: X = 3·3 + 2 = 11 lattice units × (cellSize/2) = 11 mm.
        assert!(model.contains(r#"x="11""#), "expected an exact whole-millimetre coordinate");
    }

    /// The reserved length must genuinely bound the written one. If it ever stops doing so the
    /// failure is silent — a `Vec` doubling, an 80 MB spike, and a memory budget quietly missed —
    /// so it is asserted on the widest coordinates and the largest indices available.
    #[test]
    fn the_3mf_reservation_bounds_what_gets_written() {
        for (merge, cell_size, layer_height) in [
            (MERGE_GREEDY, 2.0, 0.8),
            (MERGE_NONE, 2.0, 0.8),
            // Scales chosen to make the decimals as wide as they get: a large integer part on one
            // axis and a fully populated fractional part on another.
            (MERGE_NONE, 123.456, 0.000_7),
            (MERGE_GREEDY, 0.001, 999.5),
        ] {
            let mut s = blob(12);
            s.build_mesh(merge).unwrap();
            let bound = s.model_upper_bound(cell_size, layer_height);
            s.serialize_mesh(FORMAT_3MF, cell_size, layer_height).unwrap();
            let written = s.zip_part_length(2).unwrap();
            assert!(
                written <= bound,
                "3MF model of {written} bytes overran its {bound}-byte reservation"
            );
        }
    }

    #[test]
    fn decimals_are_written_exactly_and_without_a_negative_zero() {
        let render = |value: f64| {
            let mut out = Vec::new();
            push_decimal(&mut out, value);
            String::from_utf8(out).unwrap()
        };
        assert_eq!(render(0.0), "0");
        assert_eq!(render(-0.0000001), "0");
        assert_eq!(render(11.0), "11");
        assert_eq!(render(-1.5), "-1.5");
        assert_eq!(render(0.8), "0.8");
        assert_eq!(render(1.732051), "1.732051");
    }

    /// The CRC in a zip header is over the *uncompressed* bytes, and a wrong one makes an archive
    /// that opens in some readers and is rejected by others. Pinned against the polynomial's own
    /// published check value.
    #[test]
    fn crc32_matches_the_published_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
    }

    /// Not named `find`: the module already has one, and shadowing the union-find primitive inside
    /// its own test module is a trap waiting for the next person.
    fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack.windows(needle.len()).position(|window| window == needle)
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
