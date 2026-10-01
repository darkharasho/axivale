// src/share-viewer/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The viewer is a standalone web page with no Electron IPC and no accent
// picker, so it imports the design language directly and pins the default
// accent on <html> rather than calling applyTheme(). theme.css aliases onto
// these tokens and must be imported after them.
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import '../renderer/src/theme.css'
import '@axiapps/forge-render/forge-render.css'
import './viewer.css'
import ShareApp from './ShareApp'

document.documentElement.setAttribute('data-axi-accent', 'crimson-red')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShareApp />
  </StrictMode>
)
