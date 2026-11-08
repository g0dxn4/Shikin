import type { Server } from 'node:http'

/** Starts once; later calls return the same server or throw the original failure.
 * Completion precedes listening. Shutdown retains foreground process exit.
 */
export function startDataServer(options: {
  port: number
  hostedMode: boolean
  staticRoot: string | null | undefined
  storageEnvironment: NodeJS.ProcessEnv
}): {
  server: Server
  shutdown(signal: NodeJS.Signals): Promise<void>
}
