import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

export async function startWebHost(portOption: unknown = WEB_DEFAULT_PORT): Promise<void> {
  const port = validateWebPort(portOption)
  const staticRoot = getPackagedWebRoot()
  const indexPath = resolve(staticRoot, 'index.html')

  if (!existsSync(indexPath)) {
    throw new Error(`Hosted web assets are missing at ${indexPath}. Rebuild Shikin CLI support.`)
  }

  process.env.SHIKIN_DATA_SERVER_PORT = String(port)
  process.env.SHIKIN_WEB_HOSTED = '1'
  process.env.SHIKIN_WEB_STATIC_ROOT = staticRoot

  // Keep the server in this process. tsup follows this local dynamic import and
  // bundles the data server with its local helpers into the CLI distribution.
  await import('../../scripts/data-server.mjs')
}
