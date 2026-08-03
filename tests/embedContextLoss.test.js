import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * WebGL context loss on `<hexlife-world>` (see `packages/hexlife-embed/README.md` § Losing the GPU).
 *
 * Same approach as `embedTorus.test.js`: the element needs a DOM + WebGL2 + wasm, and a *lost*
 * context needs a driver that has decided to take one away, so the contract is pinned from source
 * text instead. That is worth more here than almost anywhere else in the embed, because every
 * invariant below is one whose absence is completely silent — a GL call on a lost context is a
 * no-op that does not throw, so the failure mode this file guards is a blank canvas that still
 * reports itself as a healthy, playing world.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

/**
 * The source of one method, from its signature to the closing brace at method indentation.
 *
 * Worth the four lines: a bare `toMatch(/_drawOnce\(\) \{[\s\S]*_contextLost/)` passes as long as
 * the flag appears *anywhere* later in a 1700-line file, which is not the claim any of these tests
 * mean to make. Line endings are normalized because this repo carries both.
 */
function methodBody(source, signature) {
    const start = source.indexOf(signature);
    if (start === -1) throw new Error(`no ${signature} in source`);
    const rest = source.slice(start).replace(/\r\n/g, '\n');
    const end = rest.indexOf('\n    }');
    return end === -1 ? rest : rest.slice(0, end);
}

describe('context loss is noticed at all', () => {
    it('listens on the canvas rather than trusting a GL call to throw', () => {
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toContain("this._canvas.addEventListener('webglcontextlost', this._onContextLost)");
        expect(element).toContain("this._canvas.addEventListener('webglcontextrestored', this._onContextRestored)");
    });

    it('binds those in the constructor, so a rebuild cannot open a deaf window', () => {
        // `_teardown` unbinds the wheel/touch/pointer listeners and `_boot` rebinds them. If the
        // context listeners lived there too, a loss during a rebuild would land on nothing and the
        // element would sit blank forever.
        const teardownBody = methodBody(read('src/embed/HexLifeElement.js'), '    _teardown() {');
        expect(teardownBody).not.toContain('webglcontextlost');
        expect(teardownBody).not.toContain('webglcontextrestored');
    });
});

describe('asking for the context back', () => {
    it('cancels the lost event, which is the only thing that earns a restore', () => {
        // Per spec `webglcontextrestored` fires only for a cancelled `webglcontextlost`. Drop the
        // preventDefault and the recovery path below becomes unreachable dead code.
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toMatch(/_onContextLost\(event\) \{[\s\S]*event\.preventDefault\(\);/);
    });

    it('stops both animation loops before waiting', () => {
        // A rAF against a dead context is invisible work on a device that just said it is out of
        // resources — and `_spinRafId` is a second loop that `_stopLoop` does not touch.
        const element = read('src/embed/HexLifeElement.js');
        const body = methodBody(element, '    _onContextLost(event) {');
        expect(body).toContain('this._stopLoop();');
        expect(body).toContain('cancelAnimationFrame(this._spinRafId)');
    });

    it('gives up rather than leaving a blank canvas waiting forever', () => {
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toMatch(/const CONTEXT_RESTORE_TIMEOUT_MS = \d+;/);
        expect(element).toMatch(
            /setTimeout\(\(\) => \{[\s\S]*this\._fail\([\s\S]*\}, CONTEXT_RESTORE_TIMEOUT_MS\)/,
        );
    });
});

describe('recovering', () => {
    it('rebuilds from scratch instead of drawing into the new blank context', () => {
        // A restored context keeps nothing: every buffer, texture, VAO and program died with the
        // old one. Reusing `this.renderer` would draw the same blank canvas, minus the event that
        // explained it.
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toMatch(
            /_onContextRestored\(\) \{[\s\S]*this\._generation\+\+;[\s\S]*this\._teardown\(\);[\s\S]*this\._boot\(this\._generation\)/,
        );
    });

    it('refuses to rebuild a world nothing is showing', () => {
        const body = methodBody(read('src/embed/HexLifeElement.js'), '    _onContextRestored() {');
        expect(body).toContain('if (!this.isConnected) return;');
    });

    it('stops after a loss that the previous recovery evidently caused', () => {
        // The loop this guards: a torus world too big for the device drops the context, we rebuild
        // it, `_syncTorus` puts it straight back on the torus, and it drops again — each turn
        // paying for a wasm world and a shader compile.
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toMatch(/const CONTEXT_LOSS_LOOP_MS = [\d_]+;/);
        expect(element).toMatch(/this\._contextRestoredAt[\s\S]*CONTEXT_LOSS_LOOP_MS/);
    });

    it('stamps the restore time before rebuilding, so a boot-time loss still counts', () => {
        // A torus world that dies *during* `_boot` never reaches the far side of it. Stamping
        // afterwards would leave that case looking like a first loss, forever.
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toMatch(
            /this\._contextRestoredAt = performance\.now\(\);[\s\S]{0,200}this\._boot\(this\._generation\)/,
        );
    });
});

describe('nothing draws while the context is away', () => {
    it('gates the draw, resize and playback paths on the flag', () => {
        const element = read('src/embed/HexLifeElement.js');
        expect(methodBody(element, '    _drawOnce() {')).toContain('!this._contextLost');
        expect(methodBody(element, '    _resize() {')).toContain('this._contextLost) return;');
        // The early return, not merely a mention: `_syncPlayback` is what would otherwise restart
        // the loop on the next scroll or visibility flip, seconds after everything else stopped.
        expect(methodBody(element, '    _syncPlayback() {'))
            .toMatch(/this\._contextLost\) \{ this\._stopLoop\(\); return; \}/);
    });

    it('keeps the spin loop off too', () => {
        // The camera's rAF has its own gate list and is the one loop that runs on a *paused* world,
        // so it would otherwise keep drawing after everything else stopped.
        expect(methodBody(read('src/embed/HexLifeElement.js'), '    _syncSpinLoop() {'))
            .toContain('&& !this._contextLost;');
    });
});

describe('what the host is told', () => {
    it('announces both edges, escaping the shadow root like every other event', () => {
        const element = read('src/embed/HexLifeElement.js');
        for (const name of ['hexlife-contextlost', 'hexlife-contextrestored']) {
            expect(element).toContain(`new CustomEvent('${name}', { bubbles: true, composed: true })`);
        }
    });

    it('declares them, and torusEnabled, on the typed surface hosts compile against', () => {
        // The .d.ts is the only machine-checkable statement of this element's API (the runtime is
        // plain JS), and the Devvit host compiles against exactly this file.
        const types = read('src/embed/hexlife-world.d.ts');
        expect(types).toContain("'hexlife-contextlost': CustomEvent<HexLifeContextDetail>;");
        expect(types).toContain("'hexlife-contextrestored': CustomEvent<HexLifeContextDetail>;");
        expect(types).toContain('readonly torusEnabled: boolean;');
    });

    it('does not call a recoverable loss an error', () => {
        // `error` is the element's "this will never run" state and hosts hide their transport bar
        // for it. A context we have asked for and expect back is not that.
        const element = read('src/embed/HexLifeElement.js');
        const body = methodBody(element, '    _onContextLost(event) {');
        // The two `_fail` calls in here are the give-up paths; neither is on the recovery path.
        expect(body).not.toMatch(/this\.error = /);
    });
});

describe('torusEnabled', () => {
    it('reports what is being drawn, not what was asked for', () => {
        const element = read('src/embed/HexLifeElement.js');
        expect(element).toContain('get torusEnabled() { return this._torusActive(); }');
        // `_torusActive` is the conjunction that matters: the attribute *and* a renderer that
        // actually built the program. Reading the attribute alone is the bug this getter exists for.
        expect(methodBody(element, '    _torusActive() {')).toContain(
            "return this.hasAttribute('torus') && !!this.renderer && this.renderer.torusEnabled;",
        );
    });
});
