export function countSetBits(n) {
    let count = 0;
    while (n > 0) {
        n &= (n - 1);
        count++;
    }
    return count;
}

/**
 * Rotates a 6-bit neighborhood mask one step clockwise.
 * Bit mapping: 0=SW, 1=NW, 2=N, 3=NE, 4=SE, 5=S
 * Clockwise rotation: SW->NW->N->NE->SE->S->SW
 * @param {number} bitmask - The 6-bit integer representing neighbor states.
 * @returns {number} The rotated bitmask.
 */
export function rotateBitmaskClockwise(bitmask) {
    // Extract each bit: 0=SW, 1=NW, 2=N, 3=NE, 4=SE, 5=S
    const sw = (bitmask >> 0) & 1;
    const nw = (bitmask >> 1) & 1;
    const n = (bitmask >> 2) & 1;
    const ne = (bitmask >> 3) & 1;
    const se = (bitmask >> 4) & 1;
    const s = (bitmask >> 5) & 1;
    
    // Clockwise rotation: SW->NW->N->NE->SE->S->SW
    // So: new_NW = old_SW, new_N = old_NW, new_NE = old_N, new_SE = old_NE, new_S = old_SE, new_SW = old_S
    return (s << 0) |     // new SW = old S
           (sw << 1) |    // new NW = old SW
           (nw << 2) |    // new N = old NW
           (n << 3) |     // new NE = old N
           (ne << 4) |    // new SE = old NE
           (se << 5);     // new S = old SE
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
            
            allCanonicalReps.set(canonical, { representative: canonical, orbitSize: getOrbitSize(canonical), members: [] });
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