export const PRESET_PALETTES = {
    default: {
        name: 'Default Spectrum',
        // Special case handled in ruleVizUtils.js
    },
    volcanic: {
        name: 'Volcanic',
        gradient: ['#FF4500', '#FFD700', '#FFFFFF'],
        offGradient: ['#6a1a00', '#8B4513', '#a9a9a9']
    },
    bioluminescent: {
        name: 'Bio-Luminescent',
        gradient: ['#008080', '#46f0f0', '#aaffc3'],
        offGradient: ['#003333', '#006464', '#00a073']
    },
    monochrome: {
        name: 'Monochrome',
        gradient: ['#FFFFFF'],
        offGradient: ['#333333']
    },
    synthwave: {
        name: 'Synthwave',
        gradient: ['#FF00C1', '#00F0FF', '#FFFFFF'],
        offGradient: ['#60004d', '#006066', '#a9a9a9']
    }
}; 