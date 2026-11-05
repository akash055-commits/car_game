import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the build works from any folder (GitHub Pages, Netlify, S3, ...)
  base: './',
  build: {
    // Rapier ships its physics engine as inlined WebAssembly, so one large chunk is expected
    chunkSizeWarningLimit: 6000,
  },
})
