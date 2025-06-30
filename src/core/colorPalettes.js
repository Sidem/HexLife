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
    },
    oceanic: {
        name: 'Oceanic',
        gradient: ['#0052D4', '#4364F7', '#6FB1FC'],
        offGradient: ['#001a44', '#15224f', '#243b52']
    },
    forest: {
        name: 'Forest',
        gradient: ['#134E5E', '#71B280', '#C3D6A2'],
        offGradient: ['#05181e', '#2a4a30', '#4c543f']
    },
    sunrise: {
        name: 'Sunrise',
        gradient: ['#FF512F', '#F09819', '#FFD200'],
        offGradient: ['#4d180e', '#5c3808', '#665300']
    },
    amethyst: {
        name: 'Amethyst',
        gradient: ['#673AB7', '#B39DDB', '#E1BEE7'],
        offGradient: ['#21123a', '#433c57', '#5a495c']
    },
    neighborGradient: {
        name: 'Neighbor Gradient',
        logic: 'neighbor_count', // Special key to identify this as a logic-based preset
        gradient: ['#4A00E0', '#8E2DE2', '#C968A9', '#F8A589'],
        offColor: '#1A1A1A'
    },
    symmetryGradient: {
        name: 'Symmetry Gradient',
        logic: 'symmetry', // Special key to identify this as a logic-based preset
        gradient: ['#009FFF', '#36D1DC', '#6EFA7D', '#B4FF64'],
        offColor: '#1A1A1A'
    }
}; 