import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { toast } from 'sonner'
import { isTauri } from './runtime'

export async function checkForUpdates() {
  if (!isTauri) return

  try {
    const update = await check()
    if (!update?.available) return

    toast(`Update available: v${update.version}`, {
      description: 'Downloading and installing...',
      duration: Infinity,
      id: 'app-update',
    })

    await update.downloadAndInstall()

    toast.success('Update installed!', {
      description: 'Restart to apply the update.',
      id: 'app-update',
      duration: Infinity,
      action: {
        label: 'Restart',
        onClick: () => relaunch(),
      },
    })
  } catch (error) {
    console.error('Update check failed:', error)
  }
}
