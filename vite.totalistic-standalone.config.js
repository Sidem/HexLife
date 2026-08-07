import {defineConfig} from 'vite'

/**
 * Build the rule-space sampler as a single offline HTML file.
 *
 * Vite first bundles the page's module graph and inlines the Wasm as a data URI. The follow-up
 * script replaces the one generated script reference with that bundle and moves the resulting
 * document to `dist/totalistic-256-standalone.html`.
 */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    emptyOutDir: true,
    outDir: 'dist/totalistic-standalone-build',
    rollupOptions: {
      input: 'totalistic-256.html',
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/totalistic-256.js',
      },
    },
    sourcemap: false,
    target: 'es2023',
  },
})
