import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getAppDataDir, PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from './app-data-dir.js'
import {
  execute,
  fromCentavos,
  generateId,
  query,
  safeJsonParse,
  safeJsonStringify,
  writeAuditLog,
  z,
  type ToolDefinition,
} from './tools/shared.js'

const PLUGIN_STATE_FILE = 'plugin-state.json'
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const PLUGIN_TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const PLUGIN_HANDLER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const PLUGIN_PERMISSION_PATTERN =
  /^(read|write):(accounts|transactions|categories|statements|audit|extension_data)$/
const SUPPORTED_PLUGIN_MAIN_EXTENSIONS = new Set(['.js', '.mjs'])

export const PLUGIN_ENABLEMENT_STATE_VERSION = 1

const pluginPermissionSchema = z
  .string()
  .trim()
  .regex(PLUGIN_PERMISSION_PATTERN, 'Unsupported plugin permission')

const pluginInputFieldSchema = z
  .object({
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
    description: z.string().trim().optional(),
    required: z.boolean().optional().default(false),
    default: z.unknown().optional(),
    enum: z.array(z.string().trim().min(1)).min(1).optional(),
  })
  .strict()

const pluginToolManifestSchema = z
  .object({
    name: z.string().trim().regex(PLUGIN_TOOL_NAME_PATTERN, 'Plugin tool names must be kebab-case'),
    description: z.string().trim().min(1),
    handler: z
      .string()
      .trim()
      .regex(PLUGIN_HANDLER_PATTERN, 'Plugin handler must be a JavaScript export name'),
    input: z.record(pluginInputFieldSchema).optional().default({}),
  })
  .passthrough()

const pluginManifestSchema = z
  .object({
    id: z.string().trim().regex(PLUGIN_ID_PATTERN, 'Plugin id must be kebab-case'),
    name: z.string().trim().min(1),
    version: z.string().trim().min(1),
    description: z.string().trim().optional(),
    author: z.string().trim().optional(),
    minShikinVersion: z.string().trim().optional(),
    main: z.string().trim().min(1),
    mode: z.literal('trusted-local').optional().default('trusted-local'),
    permissions: z.array(pluginPermissionSchema).optional().default([]),
    tools: z.array(pluginToolManifestSchema).optional().default([]),
  })
  .passthrough()

type PluginInputField = z.infer<typeof pluginInputFieldSchema>
type PluginToolManifest = z.infer<typeof pluginToolManifestSchema>
export type PluginManifest = z.infer<typeof pluginManifestSchema>

export type PluginEnablementEntry = {
  enabled: boolean
  mode: 'trusted-local'
  approvedPermissions: string[]
  approvedAt?: string
  disabledAt?: string
  manifestVersion?: string
}

export type PluginEnablementState = {
  version: typeof PLUGIN_ENABLEMENT_STATE_VERSION
  plugins: Record<string, PluginEnablementEntry>
}

export type DiscoveredPlugin =
  | {
      status: 'valid'
      directoryName: string
      directoryPath: string
      manifestPath: string
      manifest: PluginManifest
      issues: []
    }
  | {
      status: 'invalid'
      directoryName: string
      directoryPath: string
      manifestPath: string
      manifest: null
      issues: string[]
    }

export type PluginSummary = {
  id: string
  name: string | null
  version: string | null
  description: string | null
  directoryName: string | null
  directoryPath: string | null
  manifestPath: string | null
  main: string | null
  permissions: string[]
  approvedPermissions: string[]
  tools: Array<{ name: string; publicName: string; description: string }>
  enabled: boolean
  mode: 'trusted-local' | null
  status: 'enabled' | 'disabled' | 'permission-review-required' | 'invalid' | 'missing'
  loadable: boolean
  issues: string[]
}

type PluginContext = {
  plugin: {
    id: string
    name: string
    version: string
    mode: 'trusted-local'
    permissions: string[]
  }
  data: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
    list: () => Promise<Array<{ key: string; value: unknown; updatedAt: string | null }>>
  }
  finance: {
    listAccounts: () => Promise<Array<Record<string, unknown>>>
    getAccount: (id: string) => Promise<Record<string, unknown> | null>
    listCategories: () => Promise<Array<Record<string, unknown>>>
    listTransactions: (input?: {
      accountId?: string
      limit?: number
    }) => Promise<Array<Record<string, unknown>>>
    listCreditCardStatements: (input?: {
      accountId?: string
      limit?: number
    }) => Promise<Array<Record<string, unknown>>>
  }
  audit: {
    write: (input: {
      entity: string
      entityId?: string | null
      action: string
      before?: unknown
      after?: unknown
      note?: string | null
    }) => Promise<{ id: string; createdAt: string }>
  }
}

class PluginPermissionError extends Error {
  constructor(
    public readonly permission: string,
    public readonly pluginId: string
  ) {
    super(`Plugin ${pluginId} requires permission ${permission}.`)
    this.name = 'PluginPermissionError'
  }
}

export function getExtensionsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.SHIKIN_EXTENSIONS_DIR?.trim()
  return override ? resolve(override) : join(getAppDataDir(env), 'extensions')
}

function pluginStatePath(extensionsDir = getExtensionsDirectory()): string {
  return join(extensionsDir, PLUGIN_STATE_FILE)
}

function defaultPluginState(): PluginEnablementState {
  return { version: PLUGIN_ENABLEMENT_STATE_VERSION, plugins: {} }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((permission): permission is string => typeof permission === 'string')
        .map((permission) => permission.trim())
        .filter(Boolean)
    )
  ).sort()
}

export function readPluginEnablementState(
  extensionsDir = getExtensionsDirectory()
): PluginEnablementState {
  const statePath = pluginStatePath(extensionsDir)
  if (!existsSync(statePath)) return defaultPluginState()

  try {
    const parsed = safeJsonParse<unknown>(readFileSync(statePath, 'utf8'), null)
    if (!isObjectRecord(parsed) || !isObjectRecord(parsed.plugins)) return defaultPluginState()

    const plugins = Object.fromEntries(
      Object.entries(parsed.plugins).flatMap(([pluginId, rawEntry]) => {
        if (!PLUGIN_ID_PATTERN.test(pluginId) || !isObjectRecord(rawEntry)) return []
        const mode = rawEntry.mode === 'trusted-local' ? 'trusted-local' : null
        if (!mode) return []
        return [
          [
            pluginId,
            {
              enabled: rawEntry.enabled === true,
              mode,
              approvedPermissions: normalizePermissionList(rawEntry.approvedPermissions),
              approvedAt: typeof rawEntry.approvedAt === 'string' ? rawEntry.approvedAt : undefined,
              disabledAt: typeof rawEntry.disabledAt === 'string' ? rawEntry.disabledAt : undefined,
              manifestVersion:
                typeof rawEntry.manifestVersion === 'string' ? rawEntry.manifestVersion : undefined,
            } satisfies PluginEnablementEntry,
          ],
        ]
      })
    )

    return { version: PLUGIN_ENABLEMENT_STATE_VERSION, plugins }
  } catch {
    return defaultPluginState()
  }
}

export function writePluginEnablementState(
  state: PluginEnablementState,
  extensionsDir = getExtensionsDirectory()
): void {
  mkdirSync(extensionsDir, { recursive: true, mode: PRIVATE_DIR_MODE })
  const statePath = pluginStatePath(extensionsDir)
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`

  try {
    writeFileSync(tempPath, `${safeJsonStringify(state)}\n`, { mode: PRIVATE_FILE_MODE })
    chmodSync(tempPath, PRIVATE_FILE_MODE)
    renameSync(tempPath, statePath)
    chmodSync(statePath, PRIVATE_FILE_MODE)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

function withPluginStateLock<T>(extensionsDir: string, callback: () => T): T {
  mkdirSync(extensionsDir, { recursive: true, mode: PRIVATE_DIR_MODE })
  const lockPath = `${pluginStatePath(extensionsDir)}.lock`
  let fd: number | null = null

  try {
    fd = openSync(lockPath, 'wx', PRIVATE_FILE_MODE)
    return callback()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Plugin state is locked by another Shikin process. Try again shortly.', {
        cause: error,
      })
    }
    throw error
  } finally {
    if (fd !== null) {
      closeSync(fd)
      rmSync(lockPath, { force: true })
    }
  }
}

function isSafeRelativePluginPath(value: string): boolean {
  if (!value || value.startsWith('/') || value.startsWith('\\')) return false
  const parts = value.replace(/\\/g, '/').split('/')
  return !parts.includes('..') && !parts.includes('')
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
    return `${path}${issue.message}`
  })
}

function readPluginManifest(directoryName: string, directoryPath: string): DiscoveredPlugin | null {
  const manifestPath = join(directoryPath, 'manifest.json')
  if (!existsSync(manifestPath)) return null

  try {
    const parsedJson = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
    const parsed = pluginManifestSchema.safeParse(parsedJson)
    if (!parsed.success) {
      return {
        status: 'invalid',
        directoryName,
        directoryPath,
        manifestPath,
        manifest: null,
        issues: formatZodIssues(parsed.error),
      }
    }

    const issues: string[] = []
    if (parsed.data.id !== directoryName) {
      issues.push('Manifest id must match the extension directory name.')
    }
    if (!isSafeRelativePluginPath(parsed.data.main)) {
      issues.push('Manifest main must be a relative path inside the plugin directory.')
    }

    if (issues.length > 0) {
      return {
        status: 'invalid',
        directoryName,
        directoryPath,
        manifestPath,
        manifest: null,
        issues,
      }
    }

    return {
      status: 'valid',
      directoryName,
      directoryPath,
      manifestPath,
      manifest: parsed.data,
      issues: [],
    }
  } catch (error) {
    return {
      status: 'invalid',
      directoryName,
      directoryPath,
      manifestPath,
      manifest: null,
      issues: [error instanceof Error ? error.message : String(error)],
    }
  }
}

export function discoverPluginManifests(
  extensionsDir = getExtensionsDirectory()
): DiscoveredPlugin[] {
  if (!existsSync(extensionsDir)) return []

  return readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readPluginManifest(entry.name, join(extensionsDir, entry.name)))
    .filter((plugin): plugin is DiscoveredPlugin => plugin !== null)
    .sort((left, right) => left.directoryName.localeCompare(right.directoryName))
}

function pluginPublicToolName(pluginId: string, toolName: string): string {
  return `plugin-${pluginId}-${toolName}`
}

function approvedPermissionsCover(
  manifest: PluginManifest,
  entry: PluginEnablementEntry | undefined
) {
  if (!entry?.enabled || entry.mode !== 'trusted-local') return false
  const approved = new Set(entry.approvedPermissions)
  return manifest.permissions.every((permission) => approved.has(permission))
}

function pluginMainPath(plugin: Extract<DiscoveredPlugin, { status: 'valid' }>): string {
  return resolve(plugin.directoryPath, plugin.manifest.main)
}

function pathInsideDirectory(path: string, directory: string): boolean {
  const resolvedPath = resolve(path)
  const resolvedDirectory = resolve(directory)
  return resolvedPath === resolvedDirectory || resolvedPath.startsWith(`${resolvedDirectory}${sep}`)
}

function pluginMainUnavailableMessage(
  plugin: Extract<DiscoveredPlugin, { status: 'valid' }>
): string | null {
  const mainPath = pluginMainPath(plugin)
  if (!pathInsideDirectory(mainPath, plugin.directoryPath)) {
    return `Plugin ${plugin.manifest.id} main file must stay inside its plugin directory.`
  }
  if (!SUPPORTED_PLUGIN_MAIN_EXTENSIONS.has(extname(mainPath))) {
    return `Plugin ${plugin.manifest.id} main file must be built JavaScript (.js or .mjs) for the CLI/MCP plugin MVP.`
  }
  if (!existsSync(mainPath) || !statSync(mainPath).isFile()) {
    return `Plugin ${plugin.manifest.id} main file was not found at ${plugin.manifest.main}.`
  }
  return null
}

function buildPluginInputSchema(
  tool: PluginToolManifest
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, field] of Object.entries(tool.input)) {
    let schema = zodSchemaForPluginField(field)
    if (field.description) schema = schema.describe(field.description)
    if (field.default !== undefined) schema = schema.default(field.default)
    if (!field.required && field.default === undefined) schema = schema.optional()
    shape[key] = schema
  }

  return z.object(shape)
}

function zodSchemaForPluginField(field: PluginInputField): z.ZodTypeAny {
  if (field.type === 'string' && field.enum) {
    const [first, ...rest] = field.enum
    return z.enum([first, ...rest])
  }

  switch (field.type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number().finite()
    case 'boolean':
      return z.boolean()
    case 'object':
      return z.object({}).passthrough()
    case 'array':
      return z.array(z.unknown())
  }
}

function normalizePluginToolResult(result: unknown): Record<string, unknown> {
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    if ('success' in result) return result as Record<string, unknown>
    return { success: true, ...(result as Record<string, unknown>) }
  }

  return { success: true, result }
}

async function executePluginTool(
  pluginId: string,
  toolName: string,
  extensionsDir: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const current = currentPluginToolForExecution(pluginId, toolName, extensionsDir)
  if (!current.success) return current.result

  const { plugin, tool, stateEntry } = current
  const unavailable = pluginMainUnavailableMessage(plugin)
  if (unavailable) {
    return { success: false, reason: 'plugin_unavailable', message: unavailable }
  }

  try {
    const module = await import(pathToFileURL(pluginMainPath(plugin)).href)
    const defaultExport = isObjectRecord(module.default) ? module.default : null
    const handler = module[tool.handler] ?? defaultExport?.[tool.handler]

    if (typeof handler !== 'function') {
      return {
        success: false,
        reason: 'plugin_handler_not_found',
        message: `Plugin ${plugin.manifest.id} does not export handler ${tool.handler}.`,
      }
    }

    const result = await handler(input, createPluginContext(plugin.manifest, stateEntry))
    return normalizePluginToolResult(result)
  } catch (error) {
    if (error instanceof PluginPermissionError) {
      return {
        success: false,
        reason: 'plugin_permission_denied',
        permission: error.permission,
        message: error.message,
      }
    }

    return {
      success: false,
      reason: 'plugin_execution_failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function currentPluginToolForExecution(
  pluginId: string,
  toolName: string,
  extensionsDir: string
):
  | {
      success: true
      plugin: Extract<DiscoveredPlugin, { status: 'valid' }>
      tool: PluginToolManifest
      stateEntry: PluginEnablementEntry
    }
  | { success: false; result: Record<string, unknown> } {
  const plugin = discoverPluginManifests(extensionsDir).find(
    (candidate) => candidate.directoryName === pluginId
  )
  if (!plugin) {
    return {
      success: false,
      result: {
        success: false,
        reason: 'plugin_not_found',
        message: `Plugin ${pluginId} is no longer installed.`,
      },
    }
  }
  if (plugin.status === 'invalid') {
    return {
      success: false,
      result: {
        success: false,
        reason: 'invalid_plugin_manifest',
        issues: plugin.issues,
        message: `Plugin ${pluginId} manifest is no longer valid.`,
      },
    }
  }

  const stateEntry = readPluginEnablementState(extensionsDir).plugins[plugin.manifest.id]
  if (!stateEntry?.enabled) {
    return {
      success: false,
      result: {
        success: false,
        reason: 'plugin_disabled',
        message: `Plugin ${plugin.manifest.id} is disabled. Restart long-running clients to remove its old tool entries.`,
      },
    }
  }
  if (!approvedPermissionsCover(plugin.manifest, stateEntry)) {
    return {
      success: false,
      result: {
        success: false,
        reason: 'plugin_permission_review_required',
        requestedPermissions: [...plugin.manifest.permissions].sort(),
        approvedPermissions: stateEntry.approvedPermissions,
        message: `Plugin ${plugin.manifest.id} permissions changed and must be approved again before execution.`,
      },
    }
  }

  const tool = plugin.manifest.tools.find((candidate) => candidate.name === toolName)
  if (!tool) {
    return {
      success: false,
      result: {
        success: false,
        reason: 'plugin_tool_unavailable',
        message: `Plugin ${plugin.manifest.id} no longer declares tool ${toolName}.`,
      },
    }
  }

  return { success: true, plugin, tool, stateEntry }
}

function createPluginContext(
  manifest: PluginManifest,
  stateEntry: PluginEnablementEntry
): PluginContext {
  const approvedPermissions = new Set(stateEntry.approvedPermissions)
  const declaredPermissions = new Set(manifest.permissions)
  const requirePermission = (permission: string) => {
    if (!declaredPermissions.has(permission) || !approvedPermissions.has(permission)) {
      throw new PluginPermissionError(permission, manifest.id)
    }
  }

  const parseStoredValue = (value: string) => safeJsonParse<unknown>(value, value)

  return {
    plugin: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      mode: 'trusted-local',
      permissions: [...manifest.permissions],
    },
    data: {
      async get(key: string) {
        requirePermission('read:extension_data')
        const row = query<{ value: string }>(
          'SELECT value FROM extension_data WHERE extension_id = $1 AND key = $2 LIMIT 1',
          [manifest.id, key]
        )[0]
        return row ? parseStoredValue(row.value) : null
      },
      async set(key: string, value: unknown) {
        requirePermission('write:extension_data')
        execute(
          `INSERT INTO extension_data (id, extension_id, key, value, created_at, updated_at)
           VALUES ($1, $2, $3, $4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(extension_id, key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
          [generateId(), manifest.id, key, safeJsonStringify(value)]
        )
      },
      async delete(key: string) {
        requirePermission('write:extension_data')
        execute('DELETE FROM extension_data WHERE extension_id = $1 AND key = $2', [
          manifest.id,
          key,
        ])
      },
      async list() {
        requirePermission('read:extension_data')
        return query<{ key: string; value: string; updated_at: string | null }>(
          `SELECT key, value, updated_at
           FROM extension_data
           WHERE extension_id = $1
           ORDER BY key ASC`,
          [manifest.id]
        ).map((row) => ({
          key: row.key,
          value: parseStoredValue(row.value),
          updatedAt: row.updated_at,
        }))
      },
    },
    finance: {
      async listAccounts() {
        requirePermission('read:accounts')
        return query<Record<string, unknown>>(
          `SELECT id, name, type, currency, balance, is_archived as isArchived
           FROM accounts
           WHERE is_archived = 0
           ORDER BY name ASC, id ASC`
        ).map((account) => ({
          ...account,
          balance:
            typeof account.balance === 'number' ? fromCentavos(account.balance) : account.balance,
        }))
      },
      async getAccount(id: string) {
        requirePermission('read:accounts')
        const row = query<Record<string, unknown>>(
          `SELECT id, name, type, currency, balance, is_archived as isArchived
           FROM accounts
           WHERE id = $1
           LIMIT 1`,
          [id]
        )[0]
        if (!row) return null
        return {
          ...row,
          balance: typeof row.balance === 'number' ? fromCentavos(row.balance) : row.balance,
        }
      },
      async listCategories() {
        requirePermission('read:categories')
        return query<Record<string, unknown>>(
          'SELECT id, name, type, color FROM categories ORDER BY type ASC, name ASC, id ASC'
        )
      },
      async listTransactions(input = {}) {
        requirePermission('read:transactions')
        const limit = clampPluginLimit(input.limit)
        const params: unknown[] = []
        const accountCondition = input.accountId ? 'WHERE t.account_id = $1' : ''
        if (input.accountId) params.push(input.accountId)
        params.push(limit)
        return query<Record<string, unknown>>(
          `SELECT t.id, t.account_id as accountId, t.category_id as categoryId, t.type,
                  t.amount, t.currency, t.description, t.date, t.status, t.source,
                  t.tags, t.is_placeholder as isPlaceholder, t.placeholder_status as placeholderStatus
           FROM transactions t
           ${accountCondition}
           ORDER BY t.date DESC, t.created_at DESC
           LIMIT $${params.length}`,
          params
        ).map((transaction) => ({
          ...transaction,
          amount:
            typeof transaction.amount === 'number'
              ? fromCentavos(transaction.amount)
              : transaction.amount,
        }))
      },
      async listCreditCardStatements(input = {}) {
        requirePermission('read:statements')
        const limit = clampPluginLimit(input.limit)
        const params: unknown[] = []
        const accountCondition = input.accountId ? 'WHERE account_id = $1' : ''
        if (input.accountId) params.push(input.accountId)
        params.push(limit)
        return query<Record<string, unknown>>(
          `SELECT id, account_id as accountId, statement_start_date as statementStartDate,
                  statement_end_date as statementEndDate, due_date as dueDate,
                  statement_balance as statementBalanceCentavos, minimum_payment as minimumPaymentCentavos,
                  paid_amount as paidAmountCentavos, currency, status, source, note,
                  created_at as createdAt, updated_at as updatedAt
           FROM credit_card_statements
           ${accountCondition}
           ORDER BY statement_end_date DESC, created_at DESC
           LIMIT $${params.length}`,
          params
        ).map((statement) => ({
          ...statement,
          statementBalance:
            typeof statement.statementBalanceCentavos === 'number'
              ? fromCentavos(statement.statementBalanceCentavos)
              : null,
          minimumPayment:
            typeof statement.minimumPaymentCentavos === 'number'
              ? fromCentavos(statement.minimumPaymentCentavos)
              : null,
          paidAmount:
            typeof statement.paidAmountCentavos === 'number'
              ? fromCentavos(statement.paidAmountCentavos)
              : null,
        }))
      },
    },
    audit: {
      async write(input) {
        requirePermission('write:audit')
        return writeAuditLog({
          entity: input.entity,
          entityId: input.entityId,
          action: input.action,
          before: input.before,
          after: input.after,
          source: `plugin:${manifest.id}`,
          note: input.note,
        })
      },
    },
  }
}

function clampPluginLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50
  return Math.max(1, Math.min(100, Math.trunc(value)))
}

export function loadEnabledPluginToolDefinitions(
  builtInTools: readonly ToolDefinition[],
  extensionsDir = getExtensionsDirectory()
): ToolDefinition[] {
  const state = readPluginEnablementState(extensionsDir)
  const occupiedNames = new Set(builtInTools.map((tool) => tool.name))
  const definitions: ToolDefinition[] = []

  for (const plugin of discoverPluginManifests(extensionsDir)) {
    if (plugin.status !== 'valid') continue
    const stateEntry = state.plugins[plugin.manifest.id]
    if (!approvedPermissionsCover(plugin.manifest, stateEntry)) continue

    const unavailableMessage = pluginMainUnavailableMessage(plugin)
    for (const pluginTool of plugin.manifest.tools) {
      const publicName = pluginPublicToolName(plugin.manifest.id, pluginTool.name)
      if (occupiedNames.has(publicName)) continue
      occupiedNames.add(publicName)

      definitions.push({
        name: publicName,
        description: `[Plugin: ${plugin.manifest.name}] ${pluginTool.description}`,
        schema: buildPluginInputSchema(pluginTool),
        ...(unavailableMessage
          ? { cliUnavailableMessage: unavailableMessage, mcpUnavailableMessage: unavailableMessage }
          : {}),
        execute: (input) =>
          executePluginTool(plugin.manifest.id, pluginTool.name, extensionsDir, input),
      })
    }
  }

  return definitions
}

export function listPluginSummaries(extensionsDir = getExtensionsDirectory()): {
  extensionsDir: string
  plugins: PluginSummary[]
} {
  const state = readPluginEnablementState(extensionsDir)
  const discovered = discoverPluginManifests(extensionsDir)
  const summaries = discovered.map((plugin) =>
    pluginSummary(plugin, state.plugins[plugin.directoryName])
  )
  const discoveredIds = new Set(
    discovered
      .filter(
        (plugin): plugin is Extract<DiscoveredPlugin, { status: 'valid' }> =>
          plugin.status === 'valid'
      )
      .map((plugin) => plugin.manifest.id)
  )

  for (const [pluginId, entry] of Object.entries(state.plugins)) {
    if (discoveredIds.has(pluginId) || !entry.enabled) continue
    summaries.push({
      id: pluginId,
      name: null,
      version: entry.manifestVersion ?? null,
      description: null,
      directoryName: null,
      directoryPath: null,
      manifestPath: null,
      main: null,
      permissions: [],
      approvedPermissions: entry.approvedPermissions,
      tools: [],
      enabled: entry.enabled,
      mode: entry.mode,
      status: 'missing',
      loadable: false,
      issues: ['Plugin is enabled in local state but no matching manifest was found.'],
    })
  }

  return {
    extensionsDir,
    plugins: summaries.sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function pluginSummary(
  plugin: DiscoveredPlugin,
  entry: PluginEnablementEntry | undefined
): PluginSummary {
  if (plugin.status === 'invalid') {
    return {
      id: plugin.directoryName,
      name: null,
      version: null,
      description: null,
      directoryName: plugin.directoryName,
      directoryPath: plugin.directoryPath,
      manifestPath: plugin.manifestPath,
      main: null,
      permissions: [],
      approvedPermissions: entry?.approvedPermissions ?? [],
      tools: [],
      enabled: entry?.enabled === true,
      mode: entry?.mode ?? null,
      status: 'invalid',
      loadable: false,
      issues: plugin.issues,
    }
  }

  const permissionApproved = approvedPermissionsCover(plugin.manifest, entry)
  const enabled = entry?.enabled === true
  const mainIssue = pluginMainUnavailableMessage(plugin)
  const issues = [...plugin.issues, ...(mainIssue ? [mainIssue] : [])]

  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    description: plugin.manifest.description ?? null,
    directoryName: plugin.directoryName,
    directoryPath: plugin.directoryPath,
    manifestPath: plugin.manifestPath,
    main: plugin.manifest.main,
    permissions: [...plugin.manifest.permissions].sort(),
    approvedPermissions: entry?.approvedPermissions ?? [],
    tools: plugin.manifest.tools.map((tool) => ({
      name: tool.name,
      publicName: pluginPublicToolName(plugin.manifest.id, tool.name),
      description: tool.description,
    })),
    enabled,
    mode: entry?.mode ?? null,
    status: !enabled ? 'disabled' : permissionApproved ? 'enabled' : 'permission-review-required',
    loadable: enabled && permissionApproved && !mainIssue,
    issues,
  }
}

export function enableTrustedLocalPlugin(input: {
  pluginId: string
  trustedLocal: boolean
  approvePermissions: boolean
  dryRun?: boolean
  source?: string | null
  note?: string | null
  extensionsDir?: string
}): Record<string, unknown> {
  const extensionsDir = input.extensionsDir ?? getExtensionsDirectory()
  const plugin = discoverPluginManifests(extensionsDir).find(
    (candidate) => candidate.directoryName === input.pluginId
  )
  if (!plugin) {
    return {
      success: false,
      reason: 'plugin_not_found',
      message: `Plugin ${input.pluginId} was not found under ${extensionsDir}.`,
    }
  }
  if (plugin.status === 'invalid') {
    return {
      success: false,
      reason: 'invalid_plugin_manifest',
      issues: plugin.issues,
      message: `Plugin ${input.pluginId} manifest is invalid.`,
    }
  }
  if (!input.trustedLocal) {
    return {
      success: false,
      reason: 'trusted_local_required',
      message:
        'Local plugins execute JavaScript in the Shikin CLI/MCP process. Re-run with trustedLocal=true only for code you trust.',
      requestedPermissions: [...plugin.manifest.permissions].sort(),
    }
  }
  if (!input.approvePermissions) {
    return {
      success: false,
      reason: 'plugin_permission_approval_required',
      message: 'Plugin permissions must be explicitly approved before enabling this plugin.',
      requestedPermissions: [...plugin.manifest.permissions].sort(),
    }
  }

  let before = readPluginEnablementState(extensionsDir).plugins[plugin.manifest.id] ?? null
  const after: PluginEnablementEntry = {
    enabled: true,
    mode: 'trusted-local',
    approvedPermissions: [...plugin.manifest.permissions].sort(),
    approvedAt: new Date().toISOString(),
    manifestVersion: plugin.manifest.version,
  }

  if (input.dryRun) {
    return {
      success: true,
      dryRun: true,
      wouldEnable: pluginSummary(plugin, after),
      before,
      message: `Would enable plugin ${plugin.manifest.id}.`,
    }
  }

  withPluginStateLock(extensionsDir, () => {
    const state = readPluginEnablementState(extensionsDir)
    before = state.plugins[plugin.manifest.id] ?? null
    state.plugins[plugin.manifest.id] = after
    writePluginEnablementState(state, extensionsDir)
  })
  const auditWarning = writePluginAuditBestEffort({
    pluginId: plugin.manifest.id,
    action: 'enable',
    before,
    after,
    source: input.source,
    note: input.note,
  })

  return {
    success: true,
    plugin: pluginSummary(plugin, after),
    ...(auditWarning ? { auditWarning } : {}),
    message: `Enabled plugin ${plugin.manifest.id}. Restart long-running MCP clients to refresh plugin tools.`,
  }
}

export function disablePlugin(input: {
  pluginId: string
  dryRun?: boolean
  source?: string | null
  note?: string | null
  extensionsDir?: string
}): Record<string, unknown> {
  const extensionsDir = input.extensionsDir ?? getExtensionsDirectory()
  let before = readPluginEnablementState(extensionsDir).plugins[input.pluginId] ?? null

  if (!before) {
    return {
      success: false,
      reason: 'plugin_not_enabled',
      message: `Plugin ${input.pluginId} is not enabled.`,
    }
  }

  let after: PluginEnablementEntry = {
    ...before,
    enabled: false,
    disabledAt: new Date().toISOString(),
  }

  if (input.dryRun) {
    return {
      success: true,
      dryRun: true,
      wouldDisable: { pluginId: input.pluginId, before, after },
      message: `Would disable plugin ${input.pluginId}.`,
    }
  }

  withPluginStateLock(extensionsDir, () => {
    const state = readPluginEnablementState(extensionsDir)
    before = state.plugins[input.pluginId] ?? null
    if (!before) {
      throw new Error(`Plugin ${input.pluginId} is not enabled.`)
    }
    after = {
      ...before,
      enabled: false,
      disabledAt: new Date().toISOString(),
    }
    state.plugins[input.pluginId] = after
    writePluginEnablementState(state, extensionsDir)
  })
  const auditWarning = writePluginAuditBestEffort({
    pluginId: input.pluginId,
    action: 'disable',
    before,
    after,
    source: input.source,
    note: input.note,
  })

  return {
    success: true,
    pluginId: input.pluginId,
    enabled: false,
    ...(auditWarning ? { auditWarning } : {}),
    message: `Disabled plugin ${input.pluginId}. Restart long-running MCP clients to refresh plugin tools.`,
  }
}

function writePluginAuditBestEffort(input: {
  pluginId: string
  action: 'enable' | 'disable'
  before: unknown
  after: unknown
  source?: string | null
  note?: string | null
}): string | null {
  try {
    writeAuditLog({
      entity: 'plugin',
      entityId: input.pluginId,
      action: input.action,
      before: input.before,
      after: input.after,
      source: input.source ?? 'plugin-manager',
      note: input.note,
    })
    return null
  } catch (error) {
    return `Plugin state changed, but audit logging failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
