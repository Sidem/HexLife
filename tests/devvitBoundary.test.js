import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The `devvit/` ↔ main-app import boundary (#26).
 *
 * The Devvit app is bundled from this source tree rather than from a published package — that is
 * how a Reddit post and the Explorer stay one engine with one determinism contract. The cost is
 * that *any* file under `src/` is physically reachable from `devvit/`, and a reach that isn't
 * declared is a landmine: renaming an internal in the main app breaks the Reddit app, and nothing
 * in the main app's build tells you, because `devvit/` has its own toolchain and its own CI step.
 *
 * So the boundary is declared — `src/embed/api.js` (host-agnostic) and `src/embed/index.js` (the
 * browser entry that registers the element) — and this test is what makes it a boundary rather than
 * a convention. If it fails, the fix is almost never to widen the check: it is to re-export the
 * symbol from `src/embed/api.js` and give it a line in `api.d.ts`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devvitSrc = path.join(repoRoot, 'devvit', 'src');
const embedDir = path.join(repoRoot, 'src', 'embed');

/** `import x from '…'`, `import '…'`, `export … from '…'`, `import('…')`. */
const IMPORT_RE = /(?:^|[\s;])(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gm;

function tsFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return tsFiles(full);
        return entry.name.endsWith('.ts') ? [full] : [];
    });
}

/** Every relative import in `devvit/src`, resolved to an absolute path. */
function resolvedImports() {
    return tsFiles(devvitSrc).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(IMPORT_RE)]
            .map((m) => m[1])
            .filter((spec) => spec.startsWith('.'))
            .map((spec) => ({
                file: path.relative(repoRoot, file).replaceAll('\\', '/'),
                spec,
                resolved: path.resolve(path.dirname(file), spec),
            }));
    });
}

const isInside = (dir, target) => !path.relative(dir, target).startsWith('..');

describe('devvit → main app import boundary', () => {
    it('finds devvit sources to check (guards against a silently empty scan)', () => {
        expect(tsFiles(devvitSrc).length).toBeGreaterThan(5);
        expect(resolvedImports().length).toBeGreaterThan(5);
    });

    it('reaches into the main app only through src/embed/', () => {
        const escapes = resolvedImports()
            .filter(({ resolved }) => !isInside(devvitSrc, resolved))
            .filter(({ resolved }) => !isInside(embedDir, resolved))
            .map(({ file, spec }) => `${file} → ${spec}`);

        // Re-export what you need from src/embed/api.js instead of deepening the reach.
        expect(escapes).toEqual([]);
    });

    it('keeps the browser entry out of the server bundle', () => {
        // `src/embed/index.js` registers a custom element and pulls in the sim + GL renderer.
        // Bundling that into the Node server is a build-time landmine, not a runtime one.
        const serverDir = path.join(devvitSrc, 'server');
        const leaks = resolvedImports()
            .filter(({ file }) => file.startsWith('devvit/src/server/'))
            .filter(({ resolved }) => resolved === path.join(embedDir, 'index.js'))
            .map(({ file }) => file);

        expect(isInside(devvitSrc, serverDir)).toBe(true);
        expect(leaks).toEqual([]);
    });
});
