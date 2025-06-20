import { EventBus, EVENTS } from '../services/EventBus.js';

const PALETTE = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8',
    '#f58231', '#911eb4', '#46f0f0', '#f032e6',
    '#bcf60c', '#fabebe', '#008080', '#e6beff',
    '#9a6324', '#fffac8', '#800000', '#aaffc3'
];

function hexToBinary(hex) {
    if (!hex || typeof hex !== 'string' || hex.length !== 32) return ''.padStart(128, '0');
    return hex.split('').
        map(h => parseInt(h, 16).toString(2).padStart(4, '0')).
        join('');
}

function createSVG(w, h, viewBox) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    if (viewBox) {
        svg.setAttribute('viewBox', viewBox);
    }
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return svg;
}

class RulesetVisualizer {
    constructor(initialVizType = 'binary') {
        this.vizType = initialVizType;
        // Listen for changes after initialization
        EventBus.subscribe(EVENTS.RULESET_VISUALIZATION_CHANGED, () => {
             // We get the new type from the controller that dispatched the event,
             // but for simplicity, we assume the controller will update us via setVisualizationType.
             // The main goal is to remove the initial read from persistence.
        });
    }

    setVisualizationType(type) {
        if (type === 'binary' || type === 'color') {
            if (this.vizType === type) return; // Prevent unnecessary event dispatches
            this.vizType = type;
            // The controller now handles persistence. This just updates internal state and broadcasts.
            EventBus.dispatch(EVENTS.RULESET_VISUALIZATION_CHANGED); 
        }
    }

    getVisualizationType() {
        return this.vizType;
    }

    createRulesetSVG(hex, options = {}) {
        const { width = '100%', height = '100%' } = options;
        if (this.vizType === 'color') {
            return this._drawColorGridSVG(hex, width, height);
        }
        return this._drawBinaryMapSVG(hex, width, height);
    }

    createDiffSVG(baseHex, compareHex, options = {}) {
        const { width = '100%', height = '100%' } = options;
        if (!baseHex || !compareHex) return document.createElement('div'); 
        if (this.vizType === 'color') {
            return this._drawColorDiffSVG(baseHex, compareHex, width, height);
        }
        return this._drawBinaryDiffSVG(baseHex, compareHex, width, height);
    }

    _drawColorGridSVG(hex, width, height) {
        const cols = 4, rows = 8, cell = 10;
        const svg = createSVG(width, height, `0 0 ${cols * cell} ${rows * cell}`);
        for (let i = 0; i < 32; i++) {
            const val = parseInt(hex[i], 16);
            const x = (i % cols) * cell;
            const y = Math.floor(i / cols) * cell;
            const rect = document.createElementNS(svg.namespaceURI, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', cell);
            rect.setAttribute('height', cell);
            rect.setAttribute('fill', PALETTE[val]);
            svg.appendChild(rect);
        }
        return svg;
    }

    _drawBinaryMapSVG(hex, width, height) {
        const bits = hexToBinary(hex);
        const cols = 8, rows = 16, cell = 10;
        const svg = createSVG(width, height, `0 0 ${cols * cell} ${rows * cell}`);
        for (let i = 0; i < bits.length; i++) {
            const x = (i % cols) * cell;
            const y = Math.floor(i / cols) * cell;
            const rect = document.createElementNS(svg.namespaceURI, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', cell);
            rect.setAttribute('height', cell);
            rect.setAttribute('fill', bits[i] === '1' ? '#FFFFFF' : '#000000');
            svg.appendChild(rect);
        }
        return svg;
    }

    _drawColorDiffSVG(a, b, width, height) {
        const cols = 4, rows = 8, cell = 10;
        const svg = createSVG(width, height, `0 0 ${cols * cell} ${rows * cell}`);
        for (let i = 0; i < 32; i++) {
            const nibA = parseInt(a[i], 16);
            const nibB = parseInt(b[i], 16);
            let xor = nibA ^ nibB;
            let diffBits = 0;
            while (xor) { diffBits += xor & 1; xor >>= 1; }
            const shade = Math.round(255 * (1 - diffBits / 4));
            const x = (i % cols) * cell;
            const y = Math.floor(i / cols) * cell;
            const rect = document.createElementNS(svg.namespaceURI, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', cell);
            rect.setAttribute('height', cell);
            rect.setAttribute('fill', `rgb(${shade},${shade},${shade})`);
            svg.appendChild(rect);
        }
        return svg;
    }

    _drawBinaryDiffSVG(a, b, width, height) {
        const binA = hexToBinary(a);
        const binB = hexToBinary(b);
        const cols = 8, rows = 16, cell = 10;
        const svg = createSVG(width, height, `0 0 ${cols * cell} ${rows * cell}`);
        for (let i = 0; i < binA.length; i++) {
            const bitA = parseInt(binA[i], 10);
            const bitB = parseInt(binB[i], 10);
            const diff = bitB - bitA; 
            const color = diff > 0 ? '#4ade80' /* green-400 */ : diff < 0 ? '#f87171' /* red-400 */ : '#18181b' /* zinc-900 */;
            const x = (i % cols) * cell;
            const y = Math.floor(i / cols) * cell;
            const rect = document.createElementNS(svg.namespaceURI, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', y);
            rect.setAttribute('width', cell);
            rect.setAttribute('height', cell);
            rect.setAttribute('fill', color);
            svg.appendChild(rect);
        }
        return svg;
    }
}


export let rulesetVisualizer; // a placeholder
export function initRulesetVisualizer(initialType) {
    if (!rulesetVisualizer) {
        rulesetVisualizer = new RulesetVisualizer(initialType);
    }
    return rulesetVisualizer;
} 