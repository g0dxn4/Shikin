import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyAppearance, applyNativeAppearance, loadAppearancePreference } from './lib/theme'
import { isTauri } from './lib/runtime'

// Establish a native palette synchronously, then resolve persisted appearance before first render.
applyNativeAppearance('native-light')
document.documentElement.classList.toggle('tauri-runtime', isTauri)

async function mount() {
  const preference = await loadAppearancePreference()
  applyAppearance(preference)

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void mount()
