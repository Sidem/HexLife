// @ts-check

/**
 * Deterministic two-word mnemonic for a 32-char ruleset hex (e.g. "Cobalt Lattice").
 * Pure — no config/DOM. Safe for the embed graph and Devvit webview.
 *
 * Word arrays are **append-only**: reordering or removing renames every existing ruleset.
 */

// 64×64 = 4096 combinations — enough for a UI label without colliding constantly.
const RULESET_NAME_ADJECTIVES = [
    'Amber', 'Arctic', 'Ashen', 'Astral', 'Azure', 'Blazing', 'Bold', 'Bramble',
    'Bright', 'Cinder', 'Cobalt', 'Coral', 'Cosmic', 'Crimson', 'Crystal', 'Dappled',
    'Dawn', 'Dusk', 'Eager', 'Ember', 'Feral', 'Frosted', 'Gilded', 'Glacial',
    'Gleaming', 'Hidden', 'Hollow', 'Humble', 'Ivory', 'Jade', 'Lunar', 'Mellow',
    'Misty', 'Molten', 'Mossy', 'Noble', 'Nimble', 'Onyx', 'Pale', 'Prismatic',
    'Quiet', 'Radiant', 'Restless', 'Rugged', 'Rustic', 'Sable', 'Scarlet', 'Shaded',
    'Silent', 'Silver', 'Solar', 'Stormy', 'Sunlit', 'Tangled', 'Tidal', 'Twilight',
    'Velvet', 'Verdant', 'Vivid', 'Wandering', 'Wild', 'Winter', 'Woven', 'Zephyr',
];
const RULESET_NAME_NOUNS = [
    'Aurora', 'Basin', 'Beacon', 'Bloom', 'Bramble', 'Canyon', 'Cascade', 'Cipher',
    'Cluster', 'Comet', 'Coral', 'Crest', 'Current', 'Delta', 'Drift', 'Echo',
    'Ember', 'Eddy', 'Fern', 'Flare', 'Fractal', 'Glade', 'Glyph', 'Grove',
    'Harbor', 'Haven', 'Hollow', 'Lantern', 'Lattice', 'Loom', 'Marsh', 'Meadow',
    'Mesa', 'Mirage', 'Nebula', 'Nexus', 'Oasis', 'Orbit', 'Petal', 'Pinnacle',
    'Prism', 'Quartz', 'Quasar', 'Ravine', 'Reef', 'Ridge', 'Ripple', 'Spiral',
    'Spire', 'Sprout', 'Strand', 'Summit', 'Tangle', 'Tempest', 'Thicket', 'Tide',
    'Tundra', 'Vale', 'Vapor', 'Vertex', 'Vortex', 'Warren', 'Willow', 'Zenith',
];

/**
 * @param {string} hexCode 32-char hex ruleset (case-insensitive).
 * @returns {string} Two-word name, or the original input if invalid.
 */
export function rulesetName(hexCode) {
    if (!hexCode || typeof hexCode !== 'string' || !/^[0-9a-fA-F]{32}$/.test(hexCode)) {
        return hexCode;
    }
    const norm = hexCode.toUpperCase();
    // FNV-1a 32-bit over the normalized hex.
    let hash = 0x811c9dc5;
    for (let i = 0; i < norm.length; i++) {
        hash ^= norm.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    hash >>>= 0;
    const adjIndex = hash % RULESET_NAME_ADJECTIVES.length;
    const nounIndex = Math.floor(hash / RULESET_NAME_ADJECTIVES.length) % RULESET_NAME_NOUNS.length;
    return `${RULESET_NAME_ADJECTIVES[adjIndex]} ${RULESET_NAME_NOUNS[nounIndex]}`;
}
