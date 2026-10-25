import '@fontsource-variable/inter'
// Wiki pages read in Literata, with optical sizes (see docs/DESIGN.md).
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { Root } from './ui/App'
import { FormPage } from './ui/FormPage'
import { formOfSearch } from './store/formLink'
import { applyTheme, storedTheme } from './ui/theme'
import { installHandFont } from './ui/handFont'

// Apply the saved theme before the first paint so there is no flash.
applyTheme(storedTheme())
// The handwriting of hand-drawn objects (fetched only when one is on screen).
installHandFont()

// A shared form's link opens just the form.
const form = formOfSearch(location.search)

createRoot(document.getElementById('root')!).render(<StrictMode>{form ? <FormPage board={form.board} item={form.item} /> : <Root />}</StrictMode>)
