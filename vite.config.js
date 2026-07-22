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
  },
}));
