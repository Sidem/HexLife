import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

/** Build identity: git short SHA + commit date (the deploy builds straight from a commit). */
function gitVersion() {
  try {
    const sha = execSync('git rev-parse --short HEAD').toString().trim();
    const date = execSync('git log -1 --format=%cs').toString().trim();
    return `${sha} · ${date}`;
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ command }) => ({
  base: '/HexLife/',
  define: {
    __APP_VERSION__: JSON.stringify(command === 'serve' ? `${gitVersion()} (dev)` : gitVersion()),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
