import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A relative base lets the build be served from any path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [react()],
})
