import { defineConfig } from 'vite'
import { licenses } from './vite.licenses.ts'

// Bundles the MCP server and the board code it shares into one dependency-free Node script.
export default defineConfig({
  plugins: [licenses()],
  build: {
    ssr: 'mcp/server.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'braincraft-mcp.mjs', banner: '#!/usr/bin/env node' } },
  },
  ssr: { noExternal: true },
})
