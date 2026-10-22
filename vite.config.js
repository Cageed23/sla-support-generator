import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works from any sub-folder (GitHub Pages, local file server).
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
});
