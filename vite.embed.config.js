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
        // The ray-marched history volume. Separate from `render` because it is a second program,
        // two more shaders and a texture ring, and a host drawing a flat world must not carry them.
        spacetime: 'src/embed/spacetime.js',
        ca: 'src/embed/ca.js',
        // Isolated artifact boundary: no other entry imports this module or its Wasm URL.
        stochastic: 'src/embed/stochastic.js',
        // The third isolated artifact, on the same terms. DOM-free and registers nothing, so it
        // stays out of "sideEffects".
        solid: 'src/embed/solid.js',
        // Separate from `ca` on purpose: `ca.js` is DOM-free and outside "sideEffects", so the
        // `customElements.define` for <hexlife-ca> cannot live there. See ca-element.js.
        'ca-element': 'src/embed/ca-element.js',
        // Same argument one step stronger: registering <hexlife-stochastic> anywhere else would
        // weld the isolated stochastic artifact into a bundle that must not contain it.
        'stochastic-element': 'src/embed/stochastic-element.js',
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
