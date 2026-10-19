import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { type Plugin, defineConfig } from 'vite'

/** Excalidraw's hand-drawn fonts, shipped with the app so drawings never fetch them from elsewhere. */
const FONTS = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')

function excalidrawFonts(): Plugin {
  return {
    name: 'braincraft-excalidraw-fonts',
    // In development, served straight from the package.
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts', (req, res, next) => {
        const file = normalize(join(FONTS, decodeURIComponent((req.url ?? '').split('?')[0])))
        if (!file.startsWith(FONTS + sep) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('content-type', 'font/woff2')
        createReadStream(file).pipe(res)
      })
    },
    // In the build, copied beside the app: dist/excalidraw/fonts/…
    writeBundle(options) {
      if (options.dir) cpSync(FONTS, join(options.dir, 'excalidraw', 'fonts'), { recursive: true })
    },
  }
}

// A relative base lets the build be served from any path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [react(), excalidrawFonts()],
})
