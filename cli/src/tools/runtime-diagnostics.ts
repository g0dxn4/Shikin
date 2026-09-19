import { getRuntimeDiagnostics } from '../runtime-diagnostics.js'
import { z, type ToolDefinition } from './shared.js'

const getRuntimeDiagnosticsTool: ToolDefinition = {
  name: 'get-runtime-diagnostics',
  description:
    'Read build, schema, database lineage, local-instance identity, revision, and last financial write diagnostics without changing storage.',
  schema: z.object({}),
  effects: { readOnly: true, idempotent: true },
  execute: async () => getRuntimeDiagnostics(),
}

/** Parent integration registers this domain-owned tool in the global catalog. */
export const runtimeDiagnosticsTools: ToolDefinition[] = [getRuntimeDiagnosticsTool]
