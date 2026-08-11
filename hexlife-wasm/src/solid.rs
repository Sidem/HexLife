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
//! **Phase 0 scope (artifact isolation).** Geometry validation and the allocation plan only. The
//! volume, ingestion, interpolation, components, mesher, and serializers arrive in later phases; the
//! point of this phase is to prove the isolation claim before there is anything worth leaking.

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

/// Hard ceiling on the voxel count so a mistyped tick count cannot ask the allocator for a
/// terabyte. 2^31 voxels is 256 MiB bit-packed, far above anything printable.
const MAX_VOXELS: u64 = 1 << 31;

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
    total_layers: usize,
    /// The canonical flattened 6-neighbor table, shared with every other engine and allocated once
    /// here. Lateral face culling and the union-find both index straight into it, so the mesh's
    /// adjacency is the simulation's adjacency by construction rather than by a second derivation.
    neighbor_indices: Vec<u32>,
}

#[wasm_bindgen]
impl WorldSolid {
    /// Validate the geometry and fix the allocation plan.
    ///
    /// Every buffer sized from these numbers is allocated up front in later phases: growing the
    /// isolated linear memory after JavaScript has built a view into it detaches that view, and the
    /// whole point of the one-`set`-per-layer ingestion path is that the view is built once.
    #[wasm_bindgen(constructor)]
    pub fn new(
        rows: usize,
        columns: usize,
        ticks: usize,
        sub_layers: usize,
        base_plate: usize,
        solid_states: u32,
    ) -> Result<WorldSolid, String> {
        if rows == 0 || columns == 0 {
            return Err("WorldSolid: rows and columns must be positive.".into());
        }
        // The odd-q torus only closes on an even column count, the same constraint the simulating
        // engines carry. A stack whose adjacency disagreed with its source engine's would produce a
        // plausible-looking but wrong object.
        if columns % 2 != 0 {
            return Err("WorldSolid: columns must be even to close the torus.".into());
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

        let total_layers = base_plate
            .checked_add(ticks.checked_mul(1 + sub_layers).ok_or_else(overflow)?)
            .ok_or_else(overflow)?;
        let num_cells = rows.checked_mul(columns).ok_or_else(overflow)?;
        let voxels = (num_cells as u64)
            .checked_mul(total_layers as u64)
            .ok_or_else(overflow)?;
        if voxels > MAX_VOXELS {
            return Err(
                "WorldSolid: volume exceeds the 2^31-voxel ceiling; reduce ticks, subLayers, or the grid."
                    .into(),
            );
        }

        Ok(WorldSolid {
            rows,
            columns,
            num_cells,
            ticks,
            sub_layers,
            base_plate,
            solid_states,
            total_layers,
            neighbor_indices: compute_neighbor_indices(columns as i32, rows as i32, num_cells),
        })
    }

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

    /// Bytes the bit-packed volume will occupy once Phase 1 allocates it. Exposed now so a host can
    /// refuse an unprintable request before paying for it.
    #[wasm_bindgen(getter, js_name = volumeBytes)]
    pub fn volume_bytes(&self) -> usize {
        let bits = self.num_cells * self.total_layers;
        bits.div_ceil(8)
    }

    /// The linear index of `cell`'s neighbor in canonical `direction` 0..5 — the same table the
    /// lateral faces are culled against.
    ///
    /// Bounded and O(1): this is a geometry accessor for parity checks, never a data path. Layer
    /// data crosses the boundary in exactly one bulk copy per layer (§2), and it does not come
    /// through here.
    #[wasm_bindgen(js_name = neighborOf)]
    pub fn neighbor_of(&self, cell: usize, direction: usize) -> Result<u32, String> {
        if cell >= self.num_cells || direction >= 6 {
            return Err("WorldSolid.neighborOf: cell or direction out of range.".into());
        }
        Ok(self.neighbor_indices[cell * 6 + direction])
    }
}

/// Engine version for hosts recording a reproducible recipe.
#[wasm_bindgen]
pub fn solid_engine_version() -> u32 {
    SOLID_ENGINE_VERSION
}

fn overflow() -> String {
    "WorldSolid: geometry overflows the address space.".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stack(rows: usize, columns: usize, ticks: usize, sub: usize, plate: usize) -> WorldSolid {
        WorldSolid::new(rows, columns, ticks, sub, plate, 0b10).expect("valid geometry")
    }

    #[test]
    fn total_layers_counts_interpolation_and_the_base_plate() {
        let s = stack(30, 36, 100, 1, 2);
        assert_eq!(s.total_layers(), 2 + 100 * 2);
        assert_eq!(s.num_cells(), 1080);
        // 1080 cells x 202 layers = 218,160 bits.
        assert_eq!(s.volume_bytes(), 218_160_usize.div_ceil(8));

        let none = stack(30, 36, 100, 0, 0);
        assert_eq!(none.total_layers(), 100);
    }

    #[test]
    fn rejects_geometry_that_cannot_close_the_torus() {
        assert!(WorldSolid::new(6, 7, 4, 0, 0, 0b10).is_err());
        assert!(WorldSolid::new(0, 8, 4, 0, 0, 0b10).is_err());
        assert!(WorldSolid::new(6, 8, 0, 0, 0, 0b10).is_err());
    }

    #[test]
    fn rejects_unbounded_or_empty_requests() {
        assert!(WorldSolid::new(6, 8, 4, MAX_SUB_LAYERS + 1, 0, 0b10).is_err());
        assert!(WorldSolid::new(6, 8, 4, 0, MAX_BASE_PLATE + 1, 0b10).is_err());
        // A mask selecting nothing is a caller mistake, not an empty object.
        assert!(WorldSolid::new(6, 8, 4, 0, 0, 0).is_err());
        // 2^31-voxel ceiling.
        assert!(WorldSolid::new(4096, 4096, 1024, 0, 0, 0b10).is_err());
    }

    #[test]
    fn allocates_the_shared_neighbor_table_once_at_construction() {
        let s = stack(6, 8, 4, 0, 0);
        assert_eq!(s.neighbor_indices.len(), 48 * 6);
        // Every entry addresses a real cell: the table is toroidal, so no direction escapes.
        assert!(s.neighbor_indices.iter().all(|&n| (n as usize) < s.num_cells));
    }
}
