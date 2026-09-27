import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages sub-paths and Firebase Hosting alike.
export default defineConfig({
  base: './',
  server: { port: 5188, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
});
