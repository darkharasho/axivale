import React from 'react'
import ReactDOM from 'react-dom/client'
// Order matters: axi.css declares the tokens, accents.css overrides --axi-accent
// per [data-axi-accent], and theme.css (imported by App) aliases onto both and
// must come last to win at :root.
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import App from './App'
import { applyTheme, readAccent } from './themes/applyTheme'

// Synchronous, from the mirror — the store reconciles in Settings once IPC
// answers. This runs before render so the first paint is already correct.
applyTheme(readAccent())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
