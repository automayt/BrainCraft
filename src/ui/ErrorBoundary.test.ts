import { describe, expect, it } from 'vitest'
import { isStaleApp } from './ErrorBoundary'

describe('a part of the app that can’t load', () => {
  it('is told apart from other errors: the app was updated since the tab opened', () => {
    // What Chrome, Firefox and Safari say when a piece of the app is gone.
    expect(isStaleApp(new TypeError('Failed to fetch dynamically imported module: http://x/assets/DrawingEditor-abc.js'))).toBe(true)
    expect(isStaleApp(new TypeError('error loading dynamically imported module: http://x/assets/a.js'))).toBe(true)
    expect(isStaleApp(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleApp(new Error('Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html"'))).toBe(true)
    expect(isStaleApp(new Error('Cannot read properties of undefined (reading x)'))).toBe(false)
  })
})
