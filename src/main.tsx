import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { loadSavedTheme, applyTheme, defaultTheme } from './lib/theme'
import { isTauri } from './lib/runtime'

// Apply default theme synchronously, then override with saved theme once loaded
applyTheme(defaultTheme)
document.documentElement.classList.toggle('tauri-runtime', isTauri)
loadSavedTheme().then((theme) => applyTheme(theme))

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
