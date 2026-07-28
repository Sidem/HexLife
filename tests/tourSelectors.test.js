import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTours, TOUR_CATALOG } from '../src/ui/tourSteps.js';
import { OnboardingManager } from '../src/ui/OnboardingManager.js';
import { EVENTS } from '../src/services/EventBus.js';

/**
 * #36a — the tour-selector guard.
 *
 * `src/ui/tourSteps.js` carries ~100 selector sites, a third of them naming the
 * discover / library / explore / rail surfaces that the UI-restructuring block
 * (#29/#30/#32/#10/#34) rewrites. A step whose target never resolves does NOT
 * throw: `OnboardingManager._goToStep` logs a `console.warn` and silently jumps
 * to the next step, so a renamed id degrades a tour invisibly. This guard walks
 * every tour in `TOUR_CATALOG`, on both `isMobile()` branches, and fails loudly
 * when a selector is malformed or names an anchor (id / class / attribute value)
 * that no longer exists anywhere in the source.
 *
 * It is a *static* guard — there is no DOM here, so it cannot prove a target is
 * reachable at runtime; that is #36b's manual walk. What it does prove is that
 * every selector still refers to something the app actually builds.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Only files that can *build* DOM count: JS and HTML. Stylesheets are excluded
// on purpose — a class that survives solely in CSS is dead styling, and treating
// it as proof of existence is exactly how `.library-item` (renamed to
// `.library-card` in the 2026-06 library redesign) stayed green while its tour
// step silently auto-skipped. `src/core/wasm-engine` is generated glue.
const SOURCE_GLOB = ['.js', '.html'];
const SKIP_DIRS = new Set(['wasm-engine', 'node_modules']);
// tourSteps.js quotes every selector verbatim — leaving it in the corpus would
// make the whole guard vacuous (every anchor "found", in its own definition).
const SKIP_FILES = new Set([path.join('src', 'ui', 'tourSteps.js')]);

function collectSourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(full, out);
        } else if (SOURCE_GLOB.includes(path.extname(entry.name))) {
            if (!SKIP_FILES.has(path.relative(REPO_ROOT, full))) out.push(full);
        }
    }
    return out;
}

const SOURCE_TEXT = [...collectSourceFiles(path.join(REPO_ROOT, 'src')), path.join(REPO_ROOT, 'index.html')]
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');

/** kebab-case data attribute → the `dataset` property name the JS would use. */
const toDatasetProp = (attr) =>
    attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-token match, so `library-card-thumb` does not vouch for `library-card`.
 * Names are hyphen-joined, hence `[\w-]` (not `\b`) as the boundary class.
 */
const hasToken = (name) => new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`).test(SOURCE_TEXT);

/** True when `name` is produced somewhere in the source (literally or via dataset). */
function isDefinedInSource(name) {
    if (hasToken(name)) return true;
    // `data-foo-bar` may only ever be written as `el.dataset.fooBar`.
    return name.startsWith('data-') && SOURCE_TEXT.includes(`dataset.${toDatasetProp(name)}`);
}

/**
 * The mobile bottom bar is a closed set of four tabs (index.html). Attribute
 * *values* are too generic for the corpus check to police — "more", "rules" and
 * "worlds" all appear in the source as ordinary words — which is how a dozen
 * tour steps went on pointing at pre-#16 tabs that no longer exist. Read the
 * real set and check it exactly.
 */
const MOBILE_TABS = new Set(
    [...fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8').matchAll(/class="tab-bar-button[^"]*"\s+data-view="([^"]+)"/g)].map(
        (m) => m[1]
    )
);

// Bare type selectors the tours legitimately use. Anything else is a typo.
const KNOWN_TAGS = new Set(['body', 'div', 'span', 'button', 'input', 'label', 'canvas', 'a', 'li', 'ul']);

/**
 * Tokenize a CSS selector into the anchors we can verify statically. Throws on
 * anything it cannot account for — an unparsable selector is itself a failure,
 * since `document.querySelector` would throw at runtime.
 */
function tokenizeSelector(selector) {
    const RULES = [
        ['combinator', /^\s*[>+~,]\s*|^\s+/],
        ['attribute', /^\[\s*([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))\s*)?\]/],
        ['id', /^#([\w-]+)/],
        ['class', /^\.([\w-]+)/],
        ['pseudo', /^::?[\w-]+(?:\([^)]*\))?/],
        ['tag', /^\*|^[a-zA-Z][\w-]*/],
    ];
    const tokens = [];
    let rest = selector;
    while (rest.length) {
        const before = rest.length;
        for (const [type, re] of RULES) {
            const m = re.exec(rest);
            if (!m) continue;
            if (type === 'attribute') tokens.push({ type, name: m[1], value: m[3] ?? m[4] ?? m[5] });
            else if (type === 'id' || type === 'class') tokens.push({ type, name: m[1] });
            else if (type === 'tag') tokens.push({ type, name: m[0] });
            rest = rest.slice(m[0].length);
            break;
        }
        if (rest.length === before) {
            throw new Error(`unparsable at "${rest}" (in "${selector}")`);
        }
    }
    return tokens;
}

/**
 * Audit one selector. Returns a list of human-readable problems — empty when the
 * selector parses and every anchor it names is still produced by the source.
 */
function auditSelector(selector) {
    let tokens;
    try {
        tokens = tokenizeSelector(selector);
    } catch (err) {
        return [err.message];
    }

    const problems = [];
    for (const [, tab] of selector.matchAll(/\.tab-bar-button\[data-view="([^"]+)"\]/g)) {
        if (!MOBILE_TABS.has(tab)) {
            problems.push(
                `no bottom-bar tab "${tab}" — the mobile tabs are ${[...MOBILE_TABS].join(' / ')} ("${selector}")`
            );
        }
    }
    for (const token of tokens) {
        if (token.type === 'tag') {
            if (token.name !== '*' && !KNOWN_TAGS.has(token.name)) {
                problems.push(`unknown type selector "${token.name}" in "${selector}"`);
            }
        } else if (token.type === 'attribute') {
            if (!isDefinedInSource(token.name)) {
                problems.push(`no source defines the attribute "${token.name}" ("${selector}")`);
            }
            if (token.value !== undefined && !isDefinedInSource(token.value)) {
                problems.push(`nothing in source produces [${token.name}="${token.value}"] ("${selector}")`);
            }
        } else if (!isDefinedInSource(token.name)) {
            problems.push(`no source defines ${token.type === 'id' ? '#' : '.'}${token.name} ("${selector}")`);
        }
    }
    return problems;
}

/**
 * Minimal `appContext` — only what the `element` / `condition` thunks touch when
 * a selector is resolved. Deliberately not a full app: this test is about the
 * selector strings, and a fatter stub would just rot.
 */
const makeAppContext = (isMobile, torusEnabled = false) => ({
    uiManager: { isMobile: () => isMobile, activeMobileViewName: null },
    torusView: { getState: () => ({ enabled: torusEnabled }) },
});

const VIEWPORTS = [
    { name: 'desktop', isMobile: false },
    { name: 'mobile', isMobile: true },
];

/** The steps a given viewport actually walks, per `TOUR_CATALOG.platform`. */
function walkableTours(isMobile) {
    const tours = getTours(makeAppContext(isMobile));
    return TOUR_CATALOG.filter((entry) => !(isMobile && entry.platform === 'desktopOnly')).map((entry) => ({
        ...entry,
        steps: tours[entry.id],
    }));
}

describe('the guard itself has teeth', () => {
    it('indexed a real corpus', () => {
        // A mis-resolved REPO_ROOT would empty the corpus and fail everything;
        // an over-broad one (e.g. re-including tourSteps.js) makes it vacuous.
        expect(SOURCE_TEXT.length).toBeGreaterThan(100_000);
        expect(SOURCE_TEXT).not.toContain('GLIDERS_LOAD_BTN');
    });

    it('accepts anchors the app really builds', () => {
        expect(auditSelector('#minimap-guide')).toEqual([]);
        expect(auditSelector('body')).toEqual([]);
        expect(auditSelector('[data-tour-id="play-pause-button"]')).toEqual([]);
        expect(auditSelector('#world-setup-config-grid .world-config-cell:nth-child(5)')).toEqual([]);
        expect(auditSelector('.tab-bar-button[data-view="build"]')).toEqual([]);
    });

    it('rejects renamed anchors and malformed selectors', () => {
        expect(auditSelector('#minimap-guide-renamed')).not.toEqual([]);
        expect(auditSelector('.world-config-cell-renamed')).not.toEqual([]);
        expect(auditSelector('[data-tour-id="no-such-button"]')).not.toEqual([]);
        expect(auditSelector('[data-no-such-attribute="x"]')).not.toEqual([]);
        expect(auditSelector('#unclosed[attr')).not.toEqual([]);
        // The pre-#16 tabs the mobile redesign removed.
        expect(auditSelector('.tab-bar-button[data-view="more"]')).not.toEqual([]);
        expect(auditSelector('.tab-bar-button[data-view="rules"]')).not.toEqual([]);
    });

    it('read the real bottom-bar tab set', () => {
        expect([...MOBILE_TABS].sort()).toEqual(['build', 'discover', 'library', 'watch']);
    });
});

describe('TOUR_CATALOG ↔ tour registry', () => {
    it('every catalogued tour is registered and non-empty', () => {
        const tours = getTours(makeAppContext(false));
        for (const { id, name } of TOUR_CATALOG) {
            expect(Array.isArray(tours[id]), `TOUR_CATALOG lists "${id}" (${name}) but no such tour is registered`).toBe(true);
            expect(tours[id].length, `tour "${id}" has no steps`).toBeGreaterThan(0);
        }
    });

    it('every registered tour is catalogued (or it never reaches the Learning Hub)', () => {
        const catalogued = new Set(TOUR_CATALOG.map((t) => t.id));
        const orphans = Object.keys(getTours(makeAppContext(false))).filter((id) => !catalogued.has(id));
        expect(orphans, `registered but missing from TOUR_CATALOG: ${orphans.join(', ')}`).toEqual([]);
    });

    it('ids are unique', () => {
        const ids = TOUR_CATALOG.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('tour interaction semantics', () => {
    it('the segmented mobile Build view emits the same open transition as other views', () => {
        const buildViewSource = fs.readFileSync(
            path.join(REPO_ROOT, 'src', 'ui', 'views', 'BuildView.js'),
            'utf8',
        );
        expect(buildViewSource).toMatch(
            /_mountActiveSegment[\s\S]*EventBus\.dispatch\(EVENTS\.VIEW_SHOWN,[\s\S]*contentComponentType:\s*segment\.componentType/,
        );
    });

    it('event-gated steps never render a fake navigation action', () => {
        const failures = [];
        for (const isMobile of [false, true]) {
            const tours = getTours(makeAppContext(isMobile));
            for (const [tourId, steps] of Object.entries(tours)) {
                steps.forEach((step, index) => {
                    if (step.advanceOn?.type === 'event' && step.primaryAction?.text) {
                        failures.push(`${isMobile ? 'mobile' : 'desktop'} ${tourId}[${index}] "${step.title}"`);
                    }
                });
            }
        }
        expect(failures, `event-gated steps with dead primary buttons:\n${failures.join('\n')}`).toEqual([]);
    });

    it('the manager only treats click-advanced steps as primary-button navigation', () => {
        const hasPrimary = OnboardingManager.prototype._hasPrimaryAction;
        expect(hasPrimary({ advanceOn: { type: 'click' }, primaryAction: { text: 'Next' } })).toBe(true);
        expect(hasPrimary({ advanceOn: { type: 'event' }, primaryAction: { text: 'Dead button' } })).toBe(false);
        expect(hasPrimary({ advanceOn: { type: 'event' } })).toBe(false);
    });

    it('the non-obvious hands-on gates have a working Show me escape hatch', () => {
        const tours = getTours(makeAppContext(false));
        const required = [
            ['core', 'The Flow of Time'],
            ['core', 'The Observation Deck'],
            ['core', 'Draw on the Grid'],
            ['evolutionLoop', 'Step 1: Mutate'],
            ['evolutionLoop', 'Step 2: Observe & Select'],
            ['evolutionLoop', 'Step 3: Repeat'],
            ['sparkOfLife', 'Step 1: Seed a Spark'],
            ['sparkOfLife', 'Step 2: Start Time'],
            ['appliedEvolution', 'Step 14: Observe and Select'],
            ['appliedEvolution', 'Step 15: Evolve Again!'],
        ];
        for (const [tourId, title] of required) {
            const step = tours[tourId].find((candidate) => candidate.title === title);
            expect(typeof step?.showMe?.action, `${tourId}: ${title}`).toBe('function');
        }
    });

    it('requires flat view immediately before the core drawing step when torus view is active', () => {
        const flatContext = makeAppContext(false, false);
        const torusContext = makeAppContext(false, true);
        const core = getTours(torusContext).core;
        const flatStepIndex = core.findIndex((step) => step.title === 'Switch to Flat View');
        const drawStepIndex = core.findIndex((step) => step.title === 'Draw on the Grid');
        const flatStep = core[flatStepIndex];

        expect(flatStepIndex).toBe(drawStepIndex - 1);
        expect(flatStep.condition(flatContext)).toBe(false);
        expect(flatStep.condition(torusContext)).toBe(true);
        expect(flatStep.advanceOn.eventName).toBe(EVENTS.TORUS_VIEW_CHANGED);
        expect(flatStep.advanceOn.condition({ enabled: true })).toBe(false);
        expect(flatStep.advanceOn.condition({ enabled: false })).toBe(true);
        expect(typeof flatStep.showMe.action).toBe('function');
    });
});

describe.each(VIEWPORTS)('tour selectors resolve ($name)', ({ isMobile }) => {
    const tours = walkableTours(isMobile);

    it.each(tours)('$id', ({ id, steps }) => {
        const failures = [];

        steps.forEach((step, index) => {
            const where = `${id}[${index}] "${step.title}"`;

            let selector;
            try {
                selector = typeof step.element === 'function' ? step.element() : step.element;
            } catch (err) {
                failures.push(`${where}: element() threw — ${err.message}`);
                return;
            }

            if (typeof selector !== 'string' || !selector.trim()) {
                failures.push(`${where}: element resolved to ${JSON.stringify(selector)}, expected a non-empty selector`);
                return;
            }

            for (const problem of auditSelector(selector)) failures.push(`${where}: ${problem}`);
        });

        expect(failures, `\n  ${failures.join('\n  ')}\n`).toEqual([]);
    });
});
