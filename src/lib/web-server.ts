export interface WebServerSettings {
  enabled: boolean
  port: number
}

export interface WebServerStatus {
  running: boolean
  port: number | null
  error: string | null
}

interface TauriCoreModule {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = (await import('@tauri-apps/api/core')) as TauriCoreModule
  return invoke<T>(command, args)
}

export function getWebServerStatus(): Promise<WebServerStatus> {
  return invokeTauri<WebServerStatus>('get_web_server_status')
}

export function applyWebServerSettings(settings: WebServerSettings): Promise<WebServerStatus> {
  return invokeTauri<WebServerStatus>('apply_web_server_settings', {
    enabled: settings.enabled,
    port: settings.port,
  })
}
