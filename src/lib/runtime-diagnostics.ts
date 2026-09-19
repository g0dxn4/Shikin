import { DATA_SERVER_URL, isTauri, withDataServerHeaders } from './runtime'

export type RuntimeIdentityStatus =
  | { status: 'available'; id: string }
  | { status: 'unavailable'; reason: 'missing' | 'invalid' | 'unsafe' | 'unreadable' }

export type RuntimeDiagnostics = {
  success: true
  build: 'desktop' | 'hosted-web' | 'browser-development'
  version: string
  schemaVersion: number
  schemaMigration: string
  databaseLineageId: string
  localInstance: RuntimeIdentityStatus
  dataRevision: number
  lastFinancialWriteAt: string | null
}

function isRuntimeDiagnostics(value: unknown): value is RuntimeDiagnostics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  const identity = result.localInstance
  const validIdentity =
    Boolean(identity && typeof identity === 'object' && !Array.isArray(identity)) &&
    (((identity as Record<string, unknown>).status === 'available' &&
      typeof (identity as Record<string, unknown>).id === 'string') ||
      ((identity as Record<string, unknown>).status === 'unavailable' &&
        ['missing', 'invalid', 'unsafe', 'unreadable'].includes(
          String((identity as Record<string, unknown>).reason)
        )))

  return (
    result.success === true &&
    ['desktop', 'hosted-web', 'browser-development'].includes(String(result.build)) &&
    typeof result.version === 'string' &&
    Number.isSafeInteger(result.schemaVersion) &&
    typeof result.schemaMigration === 'string' &&
    typeof result.databaseLineageId === 'string' &&
    validIdentity &&
    Number.isSafeInteger(result.dataRevision) &&
    (result.lastFinancialWriteAt === null || typeof result.lastFinancialWriteAt === 'string')
  )
}

function validateDiagnostics(value: unknown): RuntimeDiagnostics {
  if (!isRuntimeDiagnostics(value)) {
    throw new Error('Runtime diagnostics response is invalid.')
  }
  return value
}

/** Read-only: neither backend creates, migrates, or repairs storage for this request. */
export async function getRuntimeDiagnostics(): Promise<RuntimeDiagnostics> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    return validateDiagnostics(await invoke<unknown>('read_runtime_diagnostics'))
  }

  const response = await fetch(`${DATA_SERVER_URL}/api/runtime/diagnostics`, {
    method: 'GET',
    headers: withDataServerHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Runtime diagnostics request failed (${response.status}).`)
  }
  return validateDiagnostics(await response.json())
}
