import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { toast } from 'sonner'
import { getErrorMessage } from './errors'
import { isTauri } from './runtime'

export type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>

export async function getCurrentAppVersion() {
  if (!isTauri) return null

  return getVersion()
}

export async function getAvailableUpdate() {
  if (!isTauri) return null

  const update = await check()
  if (!update?.available) return null

  return update as AvailableUpdate
}

export async function checkForUpdates() {
  if (!isTauri) return null

  try {
    const update = await getAvailableUpdate()
    if (!update) return null

    toast(`Update available: v${update.version}`, {
      description: 'Open Settings and check for updates to download and install.',
      duration: 10000,
      id: 'app-update',
    })

    return update
  } catch (error) {
    console.error('Update check failed:', getErrorMessage(error))
    return null
  }
}

export async function installUpdate(
  update: AvailableUpdate,
  onProgress?: Parameters<AvailableUpdate['downloadAndInstall']>[0]
) {
  await update.downloadAndInstall(onProgress)
}

export async function relaunchToApplyUpdate() {
  if (!isTauri) return

  await relaunch()
}
