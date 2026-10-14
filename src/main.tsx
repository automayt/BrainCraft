import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './ui/App'
import { applyTheme, storedTheme } from './ui/theme'

// Apply the saved theme before the first paint so there is no flash.
applyTheme(storedTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
