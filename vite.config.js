import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * The release version, single-sourced from package.json — `npm version` bumps it and tags the
 * commit in one step, so the tag, the CHANGELOG heading and the string in the app can't disagree.
 */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Build identity: release version + git short SHA + commit date.
 *
 * The version alone is not enough — Pages deploys on every push to main, so most builds sit
 * *between* tags, and "v1.0.0" on a build twelve commits past the tag would be a lie. The SHA is
 * what actually distinguishes a fresh deploy from a stale cached one; the version is what a
 * bug report can be filed against.
 */
function buildIdentity() {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    const date = execSync('git log -1 --format=%cs').toString().trim();
    return `v${version} · ${sha} · ${date}`;
  } catch {
    return `v${version}`;
  }
}

export default defineConfig(({ command }) => ({
  base: '/HexLife/',
  define: {
    __APP_VERSION__: JSON.stringify(
      command === 'serve' ? `${buildIdentity()} (dev)` : buildIdentity(),
    ),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      /**
       * Vite builds only `index.html` unless told otherwise, so every root demo page was a
       * dev-server-only artifact — `embed-demo.html` has never existed on the deployed site.
       *
       * `totalistic-256.html` is a *showcase* for the published `@hexlife/embed` package rather
       * than a scratch page, and a showcase reachable only on localhost is not one. Listing it
       * here builds and hashes its module graph like any other entry.
       *
       * **`index.html` must stay in this list.** Naming any input replaces Vite's default instead
       * of adding to it, so dropping it here silently ships a Pages deploy with no app in it.
       */
      input: {
        index: 'index.html',
        totalistic: 'totalistic-256.html',
        /**
         * `public/coffee-percolation.html` is deliberately NOT here.
         *
         * It consumes the *published* `@hexlife/embed` from a CDN through a browser import map, and
         * Vite resolves bare specifiers in inline module scripts itself, at transform time — so
         * listing it as an input fails the build on `@hexlife/embed/ca` before a browser ever sees
         * the map. Living in `public/` gets it copied to the deploy verbatim at the same URL, which
         * is also the only way it stays an honest test that the shipped package works.
         */
      },
    },
  },
}));
