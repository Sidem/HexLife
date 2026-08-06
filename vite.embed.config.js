import {defineConfig} from 'vite'

/**
 * Publishable host boundary for consumers that do not live in this repository.
 *
 * The browser entry deliberately inlines Wasm: Reddit webviews have a strict CSP and the current
 * production path cannot rely on fetching a side-car asset. The API entry is a separate bundle so
 * Node hosts can validate world codes without evaluating the custom element, Wasm, or WebGL code.
 */
export default defineConfig({
  publicDir: false,
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    emptyOutDir: true,
    lib: {
      entry: {
        index: 'src/embed/index.js',
        api: 'src/embed/api.js',
        sim: 'src/embed/sim.js',
        render: 'src/embed/render.js',
      },
      formats: ['es'],
    },
    minify: true,
    outDir: 'dist/embed-package/src/embed',
    rollupOptions: {
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name].js',
      },
    },
    sourcemap: true,
    target: 'es2023',
  },
})
