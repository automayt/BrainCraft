import '@fontsource-variable/inter'
// Wiki pages read in Literata, with optical sizes (see docs/DESIGN.md).
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Root } from './ui/App'
import { applyTheme, storedTheme } from './ui/theme'
import { installHandFont } from './ui/handFont'

// Apply the saved theme before the first paint so there is no flash.
applyTheme(storedTheme())
// The handwriting of hand-drawn objects (fetched only when one is on screen).
installHandFont()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
