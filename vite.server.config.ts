import { defineConfig } from 'vite'

// Bundles the BrainCraft server (with ws and the board code it shares) into one Node script.
export default defineConfig({
  build: {
    ssr: 'server/server.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'braincraft-server.mjs', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true },
})
