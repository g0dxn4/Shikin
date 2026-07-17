import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
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
