import { defineConfig } from 'vite'
import { licenses } from './vite.licenses.ts'

// Bundles the BrainCraft server (with ws and the board code it shares) into one Node script.
export default defineConfig({
  plugins: [licenses()],
  build: {
    ssr: 'server/server.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    // The speaker-recognition library is native and optional: found in node_modules when installed.
    rollupOptions: { external: ['sherpa-onnx-node'], output: { entryFileNames: 'braincraft-server.mjs', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true },
})
