/**
 * Rotates a 6-bit neighborhood mask one step clockwise.
 * Example: 000001 (neighbor 0) -> 000010 (neighbor 1)
 * Bit order: 543210 (neighbor 5, neighbor 4, ..., neighbor 0)
 * @param {number} bitmask - The 6-bit integer representing neighbor states.
 * @returns {number} The rotated bitmask.
 */
export function rotateBitmaskClockwise(bitmask) {
    const N = 6;
    const msbSet = (bitmask >> (N - 1)) & 1;
    let rotated = (bitmask << 1) & ((1 << N) - 1); 
    if (msbSet) {
        rotated |= 1;
    }
    return rotated;
}


/**
 * Calculates all 6 unique rotations of a given 6-bit neighborhood mask.
 * @param {number} bitmask - The 6-bit integer.
 * @returns {number[]} An array of all 6 rotated bitmasks.
 */
export function getAllRotations(bitmask) {
    let rotations = [];
    let currentMask = bitmask;
    for (let i = 0; i < 6; i++) {
        rotations.push(currentMask);
        currentMask = rotateBitmaskClockwise(currentMask);
    }
    return rotations;
}

/**
 * Finds the canonical representative for a 6-bit neighborhood mask.
 * The canonical representative is the smallest numerical value among all its unique rotations.
 * @param {number} bitmask - The 6-bit integer.
 * @returns {number} The canonical representative bitmask.
 */
export function getCanonicalRepresentative(bitmask) {
    const rotations = getAllRotations(bitmask);
    return Math.min(...rotations);
}

/**
 * Determines the orbit size (number of unique patterns in its rotational group) for a 6-bit mask.
 * @param {number} bitmask - The 6-bit integer.
 * @returns {number} The orbit size (1, 2, 3, or 6).
 */
export function getOrbitSize(bitmask) {
    const rotations = getAllRotations(bitmask);
    const uniqueRotations = new Set(rotations);
    return uniqueRotations.size;
}

/**
 * Precomputes symmetry groups for all 64 possible 6-bit neighbor configurations.
 * Groups bitmasks by their canonical representative.
 * @returns {{
 * canonicalRepresentatives: Array<{representative: number, orbitSize: number, members: number[]}>,
 * bitmaskToCanonical: Map<number, number>,
 * bitmaskToOrbitSize: Map<number, number>
 * }}
 * - `canonicalRepresentatives`: An array of objects, each containing the canonical bitmask,
 * its orbit size, and an array of all bitmasks that reduce to this canonical form.
 * - `bitmaskToCanonical`: A map from any bitmask to its canonical representative.
 * - `bitmaskToOrbitSize`: A map from any bitmask to its orbit size.
 */
export function precomputeSymmetryGroups() {
    const allCanonicalReps = new Map(); 
    const bitmaskToCanonical = new Map();
    const bitmaskToOrbitSize = new Map();

    for (let i = 0; i < 64; i++) { 
        const canonical = getCanonicalRepresentative(i);
        const orbit = getOrbitSize(i);
        bitmaskToCanonical.set(i, canonical);
        bitmaskToOrbitSize.set(i, orbit);

        if (!allCanonicalReps.has(canonical)) {
            allCanonicalReps.set(canonical, { representative: canonical, orbitSize: orbit, members: [] });
        }
        
        if (allCanonicalReps.get(canonical).orbitSize !== orbit) {
            console.warn(`Orbit size mismatch for canonical ${canonical}. Existing: ${allCanonicalReps.get(canonical).orbitSize}, New for member ${i}: ${orbit}. Using the one from canonical itself.`);
            allCanonicalReps.get(canonical).orbitSize = getOrbitSize(canonical);
        }
        allCanonicalReps.get(canonical).members.push(i);
    }

    allCanonicalReps.forEach(group => group.members.sort((a, b) => a - b));
    const canonicalRepresentativesArray = Array.from(allCanonicalReps.values())
        .sort((a, b) => a.representative - b.representative);

    console.log(`Precomputed ${canonicalRepresentativesArray.length} canonical symmetry groups.`);
    

    return {
        canonicalRepresentatives: canonicalRepresentativesArray,
        bitmaskToCanonical,
        bitmaskToOrbitSize
    };
}