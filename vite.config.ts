import react from '@vitejs/plugin-react'
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { type Plugin, defineConfig } from 'vite'
import { EXTRA_CREDITS, SHIPPED_FONTS, licenses } from './vite.licenses.ts'

/** Excalidraw's hand-drawn fonts, shipped with the app so drawings never fetch them from elsewhere. */
const FONTS = resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')

function excalidrawFonts(): Plugin {
  return {
    name: 'braincraft-excalidraw-fonts',
    // In development, served straight from the package.
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts', (req, res, next) => {
        const file = normalize(join(FONTS, decodeURIComponent((req.url ?? '').split('?')[0])))
        const family = file.slice(FONTS.length + 1).split(sep)[0]
        if (!file.startsWith(FONTS + sep) || !SHIPPED_FONTS.includes(family) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('content-type', 'font/woff2')
        createReadStream(file).pipe(res)
      })
    },
    // In the build, copied beside the app: dist/excalidraw/fonts/…
    writeBundle(options) {
      // Only the fonts whose licences are confirmed (see vite.licenses.ts).
      if (options.dir) for (const family of SHIPPED_FONTS) cpSync(join(FONTS, family), join(options.dir, 'excalidraw', 'fonts', family), { recursive: true })
    },
  }
}

// A relative base lets the build be served from any path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [react(), excalidrawFonts(), licenses(EXTRA_CREDITS)],
})
