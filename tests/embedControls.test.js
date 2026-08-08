import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listPresetPalettes, PRESET_PALETTES } from '../src/core/colorPalettes.js';
import { clampBrushSize, MAX_BRUSH_SIZE } from '../src/core/hexBrush.js';

/**
 * The host-control surface added to `<hexlife-world>` in `@hexlife/embed@1.1.0`: `brush`, `zoom`,
 * `clear()`, and live palette override.
 *
 * The element needs a DOM + WebGL2 + wasm, so its behavior is verified in the browser and the
 * *contracts* are pinned here. Two of them are worth the source-text pinning because breaking them
 * is silent and destructive rather than loud: an attribute that falls out of `LIVE_ATTRS` re-boots
 * the world on every change (throwing away whatever the viewer drew), and a `worldCode` that reads
 * the decoded palette while the renderer is drawing another one posts colors nobody ever saw.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

describe('listPresetPalettes', () => {
    it('offers every preset the `palette` attribute accepts, in declaration order', () => {
        expect(listPresetPalettes().map(p => p.key)).toEqual(Object.keys(PRESET_PALETTES));
    });

    it('carries a human label for each, falling back to the key', () => {
        for (const preset of listPresetPalettes()) {
            expect(preset.name).toBeTruthy();
            expect(typeof preset.name).toBe('string');
        }
        expect(listPresetPalettes().find(p => p.key === 'bioluminescent').name)
            .toBe('Bio-Luminescent');
    });

    it('marks the two structure presets, which color by rule rather than by taste', () => {
        const logic = listPresetPalettes().filter(p => p.logic).map(p => p.key);
        expect(logic).toEqual(['neighborGradient', 'symmetryGradient']);
    });

    it('marks the colorblind-safe ramps — an accessibility option, not a decorative one', () => {
        expect(listPresetPalettes().filter(p => p.cvdSafe).map(p => p.key))
            .toEqual(['viridis', 'cividis']);
    });

    it('exposes keys and labels but never the gradient stops', () => {
        // Handing hosts the ramps would make every stop in every preset a compatibility surface.
        for (const preset of listPresetPalettes()) {
            expect(preset).not.toHaveProperty('gradient');
            expect(preset).not.toHaveProperty('offGradient');
        }
    });

    it('is reachable across the host boundary', () => {
        // Devvit builds with `allowJs: false`, so an export without a declaration is unusable.
        expect(read('src/embed/api.js')).toContain('listPresetPalettes');
        expect(read('src/embed/api.d.ts')).toContain('listPresetPalettes');
        // …and the declaration has to be copied into the published package, or the host sees `any`.
        expect(read('scripts/prepare-embed-package.mjs')).toContain('src/core/colorPalettes.d.ts');
    });
});

describe('brush attribute', () => {
    it('clamps rather than rejecting, like every other attribute', () => {
        expect(clampBrushSize('6')).toBe(6);
        expect(clampBrushSize('999')).toBe(MAX_BRUSH_SIZE);
        expect(clampBrushSize('-4')).toBe(0);
        expect(clampBrushSize('banana')).toBe(2);
    });

    it('lets a code supply the default but never the override', () => {
        const element = read('src/embed/HexLifeElement.js');
        // Brush size is a *tool* setting: it never touches the tick sequence, so unlike every
        // world-defining attribute the code loses to an explicit `brush`. A host rendering its own
        // brush control has to be able to make that control tell the truth.
        expect(element).toMatch(
            /_readBrushSize\(\)\s*\{[\s\S]*getAttribute\('brush'\)[\s\S]*if \(raw !== ''\) return clampBrushSize\(raw\);[\s\S]*this\._world \? clampBrushSize\(this\._world\.brushSize\)/,
        );
    });

    it('treats a valueless `brush` as absent, not as a single-cell brush', () => {
        // `clampBrushSize('')` is a legitimate 0, so the empty check above is load-bearing:
        // silently handing someone a 1-cell brush for writing a bare attribute is a bad surprise.
        expect(clampBrushSize('')).toBe(0);
    });
});

describe('live-reconfigurable attributes', () => {
    const element = read('src/embed/HexLifeElement.js');
    const liveAttrs = element.slice(
        element.indexOf('const LIVE_ATTRS = new Set(['),
        element.indexOf('const RULESET_RE'),
    );

    it('exempts everything that is not part of the world from the re-boot guard', () => {
        // A re-boot re-decodes the code and replays tick 0. Anything here that stopped being
        // exempt would silently discard the viewer's drawing every time it changed.
        for (const attr of ['brush', 'zoom', 'palette', 'palette-on', 'palette-off', 'hue-shift', 'flicker-proof',
            'torus', 'speed', 'draw', 'paused', 'preview', 'wheel-zoom', 'link', 'max-dpr']) {
            expect(liveAttrs).toContain(`'${attr}'`);
        }
    });

    it('never exempts an attribute that defines the world', () => {
        for (const attr of ['ruleset', 'seed', 'density', 'rows', 'code']) {
            expect(liveAttrs).not.toContain(`'${attr}'`);
        }
        expect(element).toContain("if (name === 'code' || (this._world && !LIVE_ATTRS.has(name)))");
    });

    it('threads hue-shift through both public elements without rebuilding their sims', () => {
        const grid = read('src/embed/HexLifeGridElement.js');
        const renderer = read('src/embed/EmbedRenderer.js');
        for (const source of [element, grid]) {
            expect(source).toContain("'hue-shift'");
            expect(source).toContain("readHueShift(this.getAttribute('hue-shift'))");
            expect(source).toMatch(/case 'hue-shift':\s*\n\s*case 'flicker-proof':/);
        }
        expect(renderer).toMatch(/constructor\(canvas, \{[^}]*hueShift = null[^}]*\}\)/);
        expect(renderer).toContain('_setupLUT({ palette, customGradient, colorSettings, lut, flickerProof, hueShift })');
    });
});

describe('palette override', () => {
    const element = read('src/embed/HexLifeElement.js');

    it('decides precedence in one place, so boot and live change cannot disagree', () => {
        // The boot used to pass the decoded colors directly; if it drifts back, a world booted with
        // a `palette` attribute shows something different from the same world given one a second later.
        expect(element).toMatch(/new EmbedRenderer\(this\._canvas, \{[\s\S]*\.\.\.this\._paletteOptions\(\)/);
        // Every color-bearing attribute falls through to the same one call. Adding one to the group
        // and forgetting it here is the drift this pin exists to catch.
        expect(element).toMatch(
            /case 'palette':\s*\n\s*case 'palette-on':\s*\n\s*case 'palette-off':\s*\n\s*case 'hue-shift':\s*\n\s*case 'flicker-proof':\s*\n\s*this\.renderer\.setPalette\(this\._paletteOptions\(\)\)/,
        );
    });

    it('treats presence, not value, as the override — so removing it is a real undo', () => {
        // A decoded world's colors have no preset name, so without an explicit un-set there is no
        // way back to how the author meant a post to look.
        expect(element).toMatch(
            /_paletteOverridden\(\)\s*\{\s*return \(this\.getAttribute\('palette'\) \|\| ''\)\.trim\(\) !== ''/,
        );
        expect(element).toMatch(/const world = override \? null : this\._world;/);
    });

    it('posts the colors on screen, not the ones the code arrived with', () => {
        // "What you see is what posts" covers the palette exactly as much as it covers painted cells.
        const worldCode = element.slice(
            element.indexOf('async worldCode()'),
            element.indexOf('get tickCount()'),
        );
        expect(worldCode).toContain("this._paletteOverridden() || this.hasAttribute('hue-shift')");
        expect(worldCode).toContain('colorSettings: source ? source.colorSettings : null');
    });
});

describe('clear', () => {
    it('wipes the rule indices, not just the cells', () => {
        // fragment.glsl keys the *off* color off a_instance_rule_index as well as the state, so
        // leaving the indices behind clears the world into a faint image of what used to be there.
        expect(read('src/embed/EmbedSim.js')).toMatch(
            /clear\(\)\s*\{[\s\S]*this\.state\.fill\(0\);[\s\S]*this\.ruleIndices\.fill\(RULE_INDEX_INITIAL\);[\s\S]*this\.activeCount = 0;/,
        );
    });

    it('does not rewind — it is an empty canvas, not a reset', () => {
        const element = read('src/embed/HexLifeElement.js');
        const clear = element.slice(element.indexOf('    clear() {'), element.indexOf('    tick(n = 1)'));
        expect(clear).toContain('this.sim.clear()');
        expect(clear).not.toContain('reset');
        expect(clear).not.toContain('tickCount');
    });
});

describe('declarations', () => {
    const declaration = read('src/embed/hexlife-world.d.ts');

    it('declares the new element surface for `allowJs: false` hosts', () => {
        expect(declaration).toContain('clear(): void;');
        expect(declaration).toContain('setZoom(zoom: number): void;');
        expect(declaration).toContain('readonly zoom: number;');
    });

    it('declares activeCount, which the runtime has always had', () => {
        // The demo page has read `sim.activeCount` since Phase 2; it was simply never declared, so
        // a TypeScript host could not use the one number that says how alive a world is.
        expect(declaration).toContain('readonly activeCount: number;');
        expect(read('src/embed/EmbedSim.js')).toContain('this.activeCount');
    });
});

describe('totalistic showcase navigation and palette controls', () => {
    it('offers the rule atlas from both Explorer menus', () => {
        const index = read('index.html');
        expect(index).toContain('href="totalistic-256.html"');
        expect(index).toContain('class="app-menu-chevron"');
        expect(index).toContain('aria-controls="appMenuPopout"');
        expect(read('src/ui/views/MoreView.js')).toContain('href="totalistic-256.html"');
    });

    it('offers the coffee extraction lab from both Explorer menus', () => {
        expect(read('index.html')).toContain('href="coffee-percolation.html"');
        expect(read('src/ui/views/MoreView.js')).toContain('href="coffee-percolation.html"');
    });

    it('ships the coffee lab from public/ rather than as a Vite input', () => {
        // The page consumes the PUBLISHED package through a browser import map, and Vite resolves
        // bare specifiers in inline module scripts at transform time — so listing it as a build
        // input would fail on `@hexlife/embed/ca` before a browser ever saw the map. `public/` is
        // copied verbatim, which is what keeps the deployed page an honest test of the real package.
        const config = read('vite.config.js');
        expect(config).not.toMatch(/input:[\s\S]*coffee-percolation\.html'/);
        const page = read('public/coffee-percolation.html');
        expect(page).toContain('<script type="importmap">');
        // Pinned, never `@latest`: jsDelivr caches that alias for hours after a publish, and it
        // would go on resolving to a version where `/ca-element` does not exist.
        expect(page).toMatch(/@hexlife\/embed@\d+\.\d+\.\d+\/ca\/\+esm/);
        expect(page).toMatch(/@hexlife\/embed@\d+\.\d+\.\d+\/ca-element\/\+esm/);
        expect(page).not.toContain('@hexlife/embed@latest');
    });

    it('keeps every grid size the lab offers legal for the block partition', () => {
        // Block mode needs `rows % 3 == 0` or the 3-phase triangular partition has a seam at the
        // row wrap, and the element throws rather than rounding. A size preset that violated it
        // would put the page into its error box the moment somebody picked it.
        const page = read('public/coffee-percolation.html');
        const options = [...page.matchAll(/<option value="(\d+)"[^>]*>\s*\d+ × \d+/g)].map((m) => Number(m[1]));
        expect(options.length).toBeGreaterThanOrEqual(4);
        for (const rows of options) expect(rows % 3).toBe(0);
    });

    it('labels structure-aware palettes and applies the live hue attribute to grid and detail', () => {
        const showcase = read('totalistic-256.html');
        expect(showcase).toContain("label: 'Rule-aware'");
        expect(showcase).toContain('id="hueShift"');
        expect(showcase).toContain("grid.setAttribute('hue-shift', hueShiftInput.value)");
        expect(showcase).toContain("detailWorld()?.setAttribute('hue-shift', hueShiftInput.value)");
    });

    it('sizes the map to the room left below the controls, not to the column width', () => {
        const showcase = read('totalistic-256.html');
        // A `width: 100%` square in an 1180px column is 1180px tall, and almost no viewport is —
        // which made a page whose whole premise is "see the class at once" demand scrolling.
        expect(showcase).toContain('width: min(100%, var(--stage-max-w, var(--shell)))');
        // On the root element: the workspace grid reads the same number to decide how wide it may
        // grow, and a custom property set on the stage would never reach its own parent.
        expect(showcase).toContain("root.setProperty('--stage-max-w'");
        // Synchronous on purpose: rAF never runs in a tab that loads in the background, and a
        // deferred fit would leave the map at its unfitted size until the viewer switched to it.
        expect(showcase).toMatch(/function fitStage\(\) \{\n\s+const top = stage\.getBoundingClientRect\(\)\.top;/);
        expect(showcase).toContain('new ResizeObserver(fitStage)');
        expect(showcase).toContain("window.addEventListener('resize', fitStage)");
    });

    it('puts the controls beside the map, so opening one cannot shrink it', () => {
        const showcase = read('totalistic-256.html');
        // The rail caps itself at the map's own height and scrolls: nine cluster sliders used to
        // push the map down the page, which is what made the worlds tiny.
        expect(showcase).toContain('max-height: var(--panel-max-h, none)');
        expect(showcase).toContain('overflow-y: auto');
        expect(showcase).toContain("root.setProperty('--panel-max-h'");
        // Below the rail width they stack *under* the map — never above it.
        expect(showcase).toMatch(/<div class="workspace">[\s\S]*<div class="stage">[\s\S]*<aside class="panel"/);
        expect(showcase).toContain('body.no-panel .panel { display: none; }');
    });

    it('keeps a collapsed section readable and actually collapsed', () => {
        const showcase = read('totalistic-256.html');
        // `<details>` hides its children with a *UA* display rule that any author `display` outranks
        // — `.fold-body` is a flex row, so without this the folds render permanently open while
        // looking closed. Same failure as the Explorer's Scoring disclosure (#29).
        expect(showcase).toContain('.fold:not([open]) > .fold-body { display: none; }');
        // A fold you must open to read is a fold nobody closes, so each summary states its setting.
        expect(showcase).toContain('function syncHints()');
        for (const id of ['hintRules', 'hintIC', 'hintLook']) {
            expect(showcase).toContain(`id="${id}"`);
        }
        // Every class needs the short form the summary uses, or the hint reads "undefined".
        expect(showcase.match(/chip: '/g) || []).toHaveLength(5);
    });

    it('re-tiles the map on demand, and stops claiming to be complete when it is not', () => {
        const showcase = read('totalistic-256.html');
        expect(showcase).toContain('id="gridCols"');
        expect(showcase).toContain('id="gridRows"');
        // `layout` is a live attribute, so the box reshapes without a rebuild; the tile *count*
        // changes the ruleset list length, which is what rebuilds the worlds.
        expect(showcase).toContain("grid.setAttribute('layout', `${layoutCols}x${layoutRows}`)");
        expect(showcase).toContain('aspect-ratio: var(--tile-cols, 16) / var(--tile-rows, 16)');
        // "The whole class is on screen" is now a fact about the class *and* the grid: 256
        // totalistic rules are the complete map at 16×16 and a sample of it at 8×8, and the bias
        // and reroll controls have to switch on with it.
        expect(showcase).toContain('const isExhaustive = () => classSize(currentClass()) <= tileCount()');
        expect(showcase).toContain('const exhaustive = isExhaustive();');
        expect(showcase).toContain('drawSample(cls, sampleSeed, bias, tileCount())');
        // A shared link has to reproduce the view, and the default is now whatever the screen that
        // opened it could draw.
        expect(showcase).toContain("p.set('g', `${layoutCols}x${layoutRows}`)");
    });

    it('ships a reproducible single-file offline build', () => {
        const packageJson = JSON.parse(read('package.json'));
        const config = read('vite.totalistic-standalone.config.js');
        const inliner = read('scripts/inline-totalistic-standalone.mjs');
        const showcase = read('totalistic-256.html');

        expect(packageJson.scripts['build:standalone']).toContain('vite.totalistic-standalone.config.js');
        expect(packageJson.scripts.build).toContain('npm run build:standalone');
        expect(config).toContain('assetsInlineLimit: Number.MAX_SAFE_INTEGER');
        expect(config).toContain('inlineDynamicImports: true');
        expect(inliner).toContain("data:application/wasm;base64,");
        expect(inliner).toContain('Standalone HTML still references runtime assets');
        expect(showcase).toContain('href="totalistic-256-standalone.html" download');
    });
});
