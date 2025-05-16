// Helper function (often part of Symmetry or general utils)
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
 * Example: 000001 (neighbor 0) -> 000010 (neighbor 1)
 * Bit order: 543210 (neighbor 5, neighbor 4, ..., neighbor 0)
 * @param {number} bitmask - The 6-bit integer representing neighbor states.
 * @returns {number} The rotated bitmask.
 */
export function rotateBitmaskClockwise(bitmask) {
    const N = 6;
    const msbSet = (bitmask >> (N - 1)) & 1; // Check if MSB (neighbor 5) is set
    let rotated = (bitmask << 1) & ((1 << N) - 1); // Shift left, mask to N bits
    if (msbSet) {
        rotated |= 1; // If MSB was set, set LSB (neighbor 0)
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
 */
export function precomputeSymmetryGroups() {
    const allCanonicalReps = new Map();
    const bitmaskToCanonical = new Map();
    const bitmaskToOrbitSize = new Map();

    for (let i = 0; i < 64; i++) { // For each of the 2^6 possible neighbor bitmasks
        const canonical = getCanonicalRepresentative(i);
        const orbit = getOrbitSize(i); // Orbit size of the current member 'i'
        bitmaskToCanonical.set(i, canonical);
        bitmaskToOrbitSize.set(i, orbit);

        if (!allCanonicalReps.has(canonical)) {
            // Store the orbit size of the canonical form itself
            allCanonicalReps.set(canonical, { representative: canonical, orbitSize: getOrbitSize(canonical), members: [] });
        }
        allCanonicalReps.get(canonical).members.push(i);
    }

    // Sort members within each group (optional, but nice for consistency)
    allCanonicalReps.forEach(group => group.members.sort((a, b) => a - b));

    // Convert map to array and sort by representative value
    const canonicalRepresentativesArray = Array.from(allCanonicalReps.values())
        .sort((a, b) => a.representative - b.representative);

    console.log(`Precomputed ${canonicalRepresentativesArray.length} canonical symmetry groups.`);

    return {
        canonicalRepresentatives: canonicalRepresentativesArray,
        bitmaskToCanonical,
        bitmaskToOrbitSize
    };
}