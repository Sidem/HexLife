import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest config kept separate from vite.config.js so the GitHub Pages `base` and build options
// don't leak into the test run. Tests are pure-logic (no DOM) and live under tests/.
//
// The aliases exist so a public demo module can import the same bare package specifier its page's
// import map resolves on jsDelivr. Without them the differential tests would have to keep a second
// copy of every demo rule, which is exactly the drift those tests are meant to catch.
const local = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@hexlife/embed/stochastic': local('./src/embed/stochastic.js'),
            '@hexlife/embed/ca': local('./src/embed/ca.js'),
            '@hexlife/embed/api': local('./src/embed/api.js'),
        },
    },
    test: {
        include: ['tests/**/*.test.js'],
        environment: 'node',
    },
});
