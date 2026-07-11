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
        offGradient: ['#111111']
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
    // Perceptually-uniform, colorblind-safe ramps (matplotlib's viridis / cividis families).
    // Rule identity is the app's primary information channel, so these are correctness options,
    // not decoration: luminance rises monotonically along the ramp, which every class of color
    // vision reads the same way. `cvdSafe` drives the badge in the Chroma Lab preset cards.
    viridis: {
        name: 'Viridis',
        cvdSafe: true,
        gradient: ['#440154', '#414487', '#2A788E', '#22A884', '#7AD151', '#FDE725'],
        offGradient: ['#12000f', '#101322', '#0b2229', '#0a2f26', '#233d18', '#4a430b']
    },
    cividis: {
        name: 'Cividis',
        cvdSafe: true,
        gradient: ['#00224E', '#35456C', '#666970', '#948E77', '#C8B866', '#FEE838'],
        offGradient: ['#000a18', '#0f1420', '#1e1f21', '#2b2a23', '#3b371e', '#4c4511']
    },
    neighborGradient: {
        name: 'Neighbor Counts',
        logic: 'neighbor_count', // Special key to identify this as a logic-based preset
        gradient: ['#4A00E0', '#8E2DE2', '#C968A9', '#F8A589'],
        offColor: '#1A1A1A'
    },
    symmetryGradient: {
        name: 'Symmetry Groups',
        logic: 'symmetry', // Special key to identify this as a logic-based preset
        gradient: ['#009FFF', '#36D1DC', '#6EFA7D', '#B4FF64'],
        offColor: '#1A1A1A'
    }
}; 