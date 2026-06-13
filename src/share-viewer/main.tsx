// src/share-viewer/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/src/theme.css'
import '@axiapps/forge-render/forge-render.css'
import './viewer.css'
import ShareApp from './ShareApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ShareApp />
  </StrictMode>
)
