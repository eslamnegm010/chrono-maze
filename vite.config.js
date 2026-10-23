import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, itch.io, a CDN folder…).
  base: './',
  build: {
    target: 'es2020',
    sourcemap: true,
    // three.js alone is ~500 kB minified (~125 kB gzip); that's expected.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep three.js in its own long-cached chunk; game code changes won't invalidate it.
        manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
