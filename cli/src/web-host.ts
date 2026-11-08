import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { startDataServer } from '../../scripts/data-server-runtime.mjs'

export const WEB_DEFAULT_PORT = 8480
const WEB_MIN_PORT = 1024
const WEB_MAX_PORT = 65535

export function validateWebPort(value: unknown): number {
  const normalized = String(value ?? '').trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `Invalid web port "${value}". Use an integer from ${WEB_MIN_PORT} to ${WEB_MAX_PORT}.`
    )
  }

  const port = Number(normalized)
  if (!Number.isSafeInteger(port) || port < WEB_MIN_PORT || port > WEB_MAX_PORT) {
    throw new Error(
      `Invalid web port "${value}". Use an integer from ${WEB_MIN_PORT} to ${WEB_MAX_PORT}.`
    )
  }

  return port
}

export function getPackagedWebRoot(moduleUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '../web')
}

let pendingStartup: Parameters<typeof startDataServer>[0]

export async function startWebHost(portOption: unknown = WEB_DEFAULT_PORT): Promise<void> {
  const port = validateWebPort(portOption)
  const staticRoot = getPackagedWebRoot()
  const indexPath = resolve(staticRoot, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(`Hosted web assets are missing at ${indexPath}. Rebuild Shikin CLI support.`)
  }

  // Concurrent calls used the last validated configuration before module loading
  // completed. Retain that ordering without using env as the startup transport.
  pendingStartup = { port, hostedMode: true, staticRoot, storageEnvironment: process.env }

  // Load only after CLI validation: loading the runtime also reads package metadata.
  // tsup follows this local import and bundles the runtime and its helpers.
  const { startDataServer } = await import('../../scripts/data-server-runtime.mjs')
  startDataServer(pendingStartup)
}
