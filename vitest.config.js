import { defineConfig } from 'vitest/config';

// Vitest config kept separate from vite.config.js so the GitHub Pages `base` and build options
// don't leak into the test run. Tests are pure-logic (no DOM) and live under tests/.
export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        environment: 'node',
    },
});
