/**
 * Excalidraw loads its hand-drawn fonts from a base address; this app ships them itself (the build
 * copies them to `excalidraw/`), so drawings never fetch anything from elsewhere. Imported before
 * Excalidraw is.
 */

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = new URL('excalidraw/', document.baseURI).href

export {}
