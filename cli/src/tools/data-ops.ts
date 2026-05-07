import { readFile } from 'node:fs/promises'
import {
  z,
  query,
  transaction,
  toCentavos,
  boundedText,
  resolveAccountId,
  normalizeCurrencyCode,
  getJsonSetting,
  setJsonSetting,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'
import { transactionsTools } from './transactions.js'
import { backupDatabase, restoreDatabase } from '../database.js'
import { findTransactionDuplicate, type TransactionDuplicateMatch } from '../duplicate-detection.js'

type CsvRow = {
  lineNumber: number
  fields: string[]
}

type ParsedCsv = {
  rows: CsvRow[]
  errors: Array<{ lineNumber: number; message: string }>
}

type ImportTransactionInput = {
  amount: number
  type: 'expense' | 'income'
  description: string
  date: string
  accountId: string
  category?: string
  notes?: string
  status?: 'pending' | 'posted' | 'cleared'
  source?: string
  note?: string
  dryRun: boolean
}

type ImportDuplicateMatch =
  | { kind: 'duplicate'; id: string; matchType: 'external_id'; externalId: string }
  | {
      kind: 'exact_duplicate' | 'potential_duplicate'
      id: string
      match: TransactionDuplicateMatch
    }
  | null

type ExportTableSpec = {
  name: string
  columns: string[]
  orderBy: string
}

type SkippedExportTable = {
  name: string
  reason: 'missing_optional_table_or_column'
  message: string
}

type ReadExportTablesResult = {
  tables: Record<string, Array<Record<string, unknown>>>
  skippedTables: SkippedExportTable[]
}

const REQUIRED_IMPORT_COLUMNS = ['date', 'description', 'amount'] as const
const OPTIONAL_IMPORT_COLUMNS = [
  'type',
  'category',
  'notes',
  'status',
  'currency',
  'source',
  'note',
  'externalid',
] as const
const SUPPORTED_IMPORT_COLUMNS = new Set<string>([
  ...REQUIRED_IMPORT_COLUMNS,
  ...OPTIONAL_IMPORT_COLUMNS,
])

const addTransactionTool = transactionsTools.find((tool) => tool.name === 'add-transaction')

const EXPORT_TABLES: ExportTableSpec[] = [
  {
    name: '_migrations',
    columns: ['id', 'name', 'applied_at'],
    orderBy: 'id ASC',
  },
  {
    name: 'accounts',
    columns: [
      'id',
      'name',
      'type',
      'currency',
      'balance',
      'icon',
      'color',
      'is_archived',
      'is_primary',
      'credit_limit',
      'statement_closing_day',
      'payment_due_day',
      'created_at',
      'updated_at',
    ],
    orderBy: 'name ASC, id ASC',
  },
  {
    name: 'categories',
    columns: ['id', 'name', 'icon', 'color', 'type', 'sort_order', 'created_at'],
    orderBy: 'sort_order ASC, name ASC, id ASC',
  },
  {
    name: 'subcategories',
    columns: ['id', 'category_id', 'name', 'icon', 'sort_order', 'created_at'],
    orderBy: 'category_id ASC, sort_order ASC, name ASC, id ASC',
  },
  {
    name: 'transactions',
    columns: [
      'id',
      'account_id',
      'category_id',
      'subcategory_id',
      'type',
      'amount',
      'currency',
      'description',
      'notes',
      'date',
      'tags',
      'is_recurring',
      'transfer_to_account_id',
      'status',
      'source',
      'note',
      'recurring_rule_id',
      'created_at',
      'updated_at',
    ],
    orderBy: 'date ASC, created_at ASC, id ASC',
  },
  {
    name: 'subscriptions',
    columns: [
      'id',
      'account_id',
      'category_id',
      'name',
      'amount',
      'currency',
      'billing_cycle',
      'next_billing_date',
      'icon',
      'color',
      'url',
      'notes',
      'is_active',
      'created_at',
      'updated_at',
    ],
    orderBy: 'name ASC, id ASC',
  },
  {
    name: 'budgets',
    columns: [
      'id',
      'category_id',
      'name',
      'amount',
      'period',
      'is_active',
      'created_at',
      'updated_at',
    ],
    orderBy: 'name ASC, id ASC',
  },
  {
    name: 'budget_periods',
    columns: ['id', 'budget_id', 'start_date', 'end_date', 'spent', 'created_at'],
    orderBy: 'start_date ASC, budget_id ASC, id ASC',
  },
  {
    name: 'investments',
    columns: [
      'id',
      'account_id',
      'symbol',
      'name',
      'type',
      'shares',
      'avg_cost_basis',
      'currency',
      'notes',
      'created_at',
      'updated_at',
    ],
    orderBy: 'symbol ASC, id ASC',
  },
  {
    name: 'stock_prices',
    columns: ['id', 'symbol', 'price', 'currency', 'date', 'created_at'],
    orderBy: 'symbol ASC, date ASC, id ASC',
  },
  {
    name: 'exchange_rates',
    columns: ['id', 'from_currency', 'to_currency', 'rate', 'date', 'created_at'],
    orderBy: 'from_currency ASC, to_currency ASC, date ASC, id ASC',
  },
  {
    name: 'settings',
    columns: ['key', 'value', 'updated_at'],
    orderBy: 'key ASC',
  },
  {
    name: 'extension_data',
    columns: ['id', 'extension_id', 'key', 'value', 'created_at', 'updated_at'],
    orderBy: 'extension_id ASC, key ASC, id ASC',
  },
  {
    name: 'category_rules',
    columns: [
      'id',
      'pattern',
      'category_id',
      'subcategory_id',
      'confidence',
      'hit_count',
      'created_at',
      'updated_at',
    ],
    orderBy: 'pattern ASC, category_id ASC, id ASC',
  },
  {
    name: 'recurring_rules',
    columns: [
      'id',
      'description',
      'amount',
      'type',
      'frequency',
      'next_date',
      'end_date',
      'account_id',
      'to_account_id',
      'category_id',
      'subcategory_id',
      'tags',
      'notes',
      'active',
      'currency',
      'created_at',
      'updated_at',
    ],
    orderBy: 'next_date ASC, id ASC',
  },
  {
    name: 'goals',
    columns: [
      'id',
      'name',
      'target_amount',
      'current_amount',
      'deadline',
      'account_id',
      'icon',
      'color',
      'notes',
      'created_at',
      'updated_at',
    ],
    orderBy: 'deadline ASC, name ASC, id ASC',
  },
  {
    name: 'recaps',
    columns: [
      'id',
      'type',
      'period_start',
      'period_end',
      'title',
      'summary',
      'highlights_json',
      'generated_at',
    ],
    orderBy: 'generated_at ASC, id ASC',
  },
  {
    name: 'transaction_splits',
    columns: [
      'id',
      'transaction_id',
      'category_id',
      'subcategory_id',
      'amount',
      'notes',
      'created_at',
    ],
    orderBy: 'transaction_id ASC, id ASC',
  },
  {
    name: 'net_worth_snapshots',
    columns: [
      'id',
      'date',
      'total_assets',
      'total_liabilities',
      'net_worth',
      'total_investments',
      'breakdown_json',
      'created_at',
    ],
    orderBy: 'date ASC, id ASC',
  },
  {
    name: 'account_balance_history',
    columns: ['id', 'account_id', 'date', 'balance', 'created_at'],
    orderBy: 'account_id ASC, date ASC, id ASC',
  },
  {
    name: 'audit_log',
    columns: [
      'id',
      'entity',
      'entity_id',
      'action',
      'before_json',
      'after_json',
      'source',
      'note',
      'created_at',
    ],
    orderBy: 'created_at ASC, id ASC',
  },
  {
    name: 'cashflow_buckets',
    columns: [
      'id',
      'name',
      'description',
      'target_amount',
      'balance',
      'currency',
      'sort_order',
      'is_active',
      'created_at',
      'updated_at',
    ],
    orderBy: 'sort_order ASC, name ASC, id ASC',
  },
  {
    name: 'cashflow_bucket_allocations',
    columns: [
      'id',
      'bucket_id',
      'transaction_id',
      'amount',
      'currency',
      'allocation_date',
      'source',
      'note',
      'created_at',
    ],
    orderBy: 'allocation_date ASC, bucket_id ASC, id ASC',
  },
  {
    name: 'category_suggestions',
    columns: [
      'id',
      'transaction_id',
      'description',
      'suggested_category_id',
      'suggested_subcategory_id',
      'confidence',
      'status',
      'source',
      'note',
      'created_at',
      'reviewed_at',
    ],
    orderBy: 'created_at ASC, id ASC',
  },
  {
    name: 'credit_card_statements',
    columns: [
      'id',
      'account_id',
      'statement_start_date',
      'statement_end_date',
      'due_date',
      'statement_balance',
      'minimum_payment',
      'paid_amount',
      'currency',
      'status',
      'source',
      'note',
      'created_at',
      'updated_at',
    ],
    orderBy: 'statement_end_date ASC, account_id ASC, id ASC',
  },
]

const OPTIONAL_EXPORT_TABLES = new Set([
  'subscriptions',
  'budgets',
  'budget_periods',
  'investments',
  'stock_prices',
  'exchange_rates',
  'extension_data',
  'category_rules',
  'recurring_rules',
  'goals',
  'recaps',
  'transaction_splits',
  'net_worth_snapshots',
  'account_balance_history',
  'audit_log',
  'cashflow_buckets',
  'cashflow_bucket_allocations',
  'category_suggestions',
  'credit_card_statements',
])

const REDACTED_FIELD_PATTERN =
  /(?:account[_-]?number|routing[_-]?number|card[_-]?number|iban|swift|secret|token|password|private[_-]?key|notes?|description|url|value|summary|tags|source|before_json|after_json|pattern|highlights_json|breakdown_json)/i
const REDACTED_SETTINGS_VALUE_KEYS = new Set([FINANCE_PROFILE_SETTING_KEY, 'account_aliases'])

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableJsonValue(nested)])
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function deepMergeProfile(
  current: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const base = isPlainObject(current) ? current : {}
  const merged: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    merged[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? deepMergeProfile(base[key], value) : value
  }

  return stableJsonValue(merged) as Record<string, unknown>
}

function hasFinanceProfile(value: unknown): boolean {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
  )
}

function databaseOperationError(error: unknown, fallbackReason: string): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  const reasonByCode: Record<string, string> = {
    RESTORE_ACTIVE_HANDLES: 'restore_active_handles',
    RESTORE_UNSUPPORTED_PLATFORM: 'restore_unsupported_platform',
    RESTORE_SOURCE_IS_ACTIVE_DB: 'restore_source_is_active_database',
    RESTORE_LOCK_EXISTS: 'restore_lock_exists',
    RESTORE_SOURCE_HAS_SIDECARS: 'restore_source_has_sidecars',
  }
  const hintByCode: Record<string, string> = {
    RESTORE_ACTIVE_HANDLES:
      'Close Shikin, the browser data-server, MCP server, and other CLI sessions before retrying restore. Backup remains safe to run while the database is active.',
    RESTORE_UNSUPPORTED_PLATFORM:
      'Use the Shikin app restore flow on this platform, or stop all Shikin processes and replace the database manually after creating a backup.',
    RESTORE_SOURCE_IS_ACTIVE_DB:
      'Choose a backup file from the backups directory or another safe location; never restore from the active database file or its sidecars.',
    RESTORE_LOCK_EXISTS:
      'If no restore is running, remove the stale restore lock file after confirming no Shikin restore process is active.',
    RESTORE_SOURCE_HAS_SIDECARS:
      'Create a clean backup with shikin backup-database and restore that single backup file instead of a live SQLite database family.',
  }
  const fallbackCode = fallbackReason.toUpperCase().replace(/[^A-Z0-9]+/g, '_')

  return {
    success: false,
    reason: code ? (reasonByCode[code] ?? fallbackReason) : fallbackReason,
    message,
    code: code ?? fallbackCode,
    ...(error && typeof error === 'object' && 'activeHandles' in error
      ? { activeHandles: error.activeHandles }
      : {}),
    ...(error && typeof error === 'object' && 'sidecars' in error
      ? { sidecars: error.sidecars }
      : {}),
    ...(code && hintByCode[code] ? { hint: hintByCode[code] } : {}),
  }
}

function parseCsv(text: string): ParsedCsv {
  const rows: CsvRow[] = []
  const errors: Array<{ lineNumber: number; message: string }> = []
  let field = ''
  let fields: string[] = []
  let inQuotes = false
  let lineNumber = 1
  let rowStartLine = 1
  const source = text.replace(/^\uFEFF/, '')

  const pushField = () => {
    fields.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    if (!(fields.length === 1 && fields[0].trim() === '')) {
      rows.push({ lineNumber: rowStartLine, fields })
    }
    fields = []
    rowStartLine = lineNumber + 1
  }

  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        field += '"'
        index++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      pushField()
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      pushRow()
      if (char === '\r' && source[index + 1] === '\n') index++
      lineNumber++
      rowStartLine = lineNumber
      continue
    }

    if (char === '\n') lineNumber++
    field += char
  }

  if (inQuotes) errors.push({ lineNumber: rowStartLine, message: 'Unclosed quoted CSV field.' })
  if (field.length > 0 || fields.length > 0) pushRow()

  return { rows, errors }
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/^\uFEFF/, '')
    .toLowerCase()
}

function parseMoneyCell(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const isParenthesizedNegative = trimmed.startsWith('(') && trimmed.endsWith(')')
  const unsigned = isParenthesizedNegative ? trimmed.slice(1, -1) : trimmed
  const token = unsigned.replace(/[$€£¥\s]/g, '')
  const lastComma = token.lastIndexOf(',')
  const lastDot = token.lastIndexOf('.')
  const decimalSeparator = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : null
  let normalized = token

  if (lastComma !== -1 && lastDot !== -1 && decimalSeparator) {
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = token.split(thousandsSeparator).join('').replace(decimalSeparator, '.')
  } else if (decimalSeparator) {
    const separatorIndex = decimalSeparator === ',' ? lastComma : lastDot
    const decimals = token.length - separatorIndex - 1
    const looksLikeThousands = decimals === 3 && /^-?\d{1,3}([,.]\d{3})+$/.test(token)
    normalized = looksLikeThousands
      ? token.split(decimalSeparator).join('')
      : token.replace(decimalSeparator, '.')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return isParenthesizedNegative ? -parsed : parsed
}

function normalizeOptionalCell(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function buildImportRowInput({
  row,
  headers,
  accountId,
  accountCurrency,
  defaultSource,
}: {
  row: CsvRow
  headers: string[]
  accountId: string
  accountCurrency: string
  defaultSource: string
}):
  | { success: true; input: ImportTransactionInput; externalId: string | null }
  | { success: false; errors: string[] } {
  const errors: string[] = []
  const values = Object.fromEntries(
    headers.map((header, index) => [header, row.fields[index] ?? ''])
  )

  for (const requiredColumn of REQUIRED_IMPORT_COLUMNS) {
    if (!values[requiredColumn]?.trim())
      errors.push(`Missing required column value: ${requiredColumn}.`)
  }
  if (row.fields.length > headers.length) {
    errors.push(`Row has ${row.fields.length} cells but header has ${headers.length}.`)
  }

  const amount = parseMoneyCell(values.amount ?? '')
  if (amount === null) errors.push('amount must be a finite number.')
  if (amount === 0) errors.push('amount must be non-zero.')

  const rawType = normalizeOptionalCell(values.type)?.toLowerCase()
  let type: 'expense' | 'income' | null = null
  if (rawType) {
    if (rawType === 'expense' || rawType === 'income') {
      type = rawType
    } else {
      errors.push('type must be expense or income when provided.')
    }
  } else if (amount !== null) {
    type = amount < 0 ? 'expense' : 'income'
  }

  const rawStatus = normalizeOptionalCell(values.status)?.toLowerCase()
  const status = rawStatus as 'pending' | 'posted' | 'cleared' | undefined
  if (rawStatus && !['pending', 'posted', 'cleared'].includes(rawStatus)) {
    errors.push('status must be pending, posted, or cleared when provided.')
  }

  const rowCurrency = normalizeOptionalCell(values.currency)
  if (
    rowCurrency &&
    normalizeCurrencyCode(rowCurrency) !== normalizeCurrencyCode(accountCurrency)
  ) {
    errors.push(`currency ${rowCurrency} does not match account currency ${accountCurrency}.`)
  }

  if (errors.length > 0 || amount === null || type === null) return { success: false, errors }

  const externalId = normalizeOptionalCell(values.externalid) ?? null
  const noteParts = [
    normalizeOptionalCell(values.note),
    externalId ? `externalId=${externalId}` : null,
  ].filter((value): value is string => Boolean(value))
  const input: ImportTransactionInput = {
    amount: Math.abs(amount),
    type,
    description: values.description.trim(),
    date: values.date.trim(),
    accountId,
    dryRun: true,
  }
  const category = normalizeOptionalCell(values.category)
  const notes = normalizeOptionalCell(values.notes)
  const source = normalizeOptionalCell(values.source) ?? defaultSource
  const note = noteParts.join('; ')

  if (category) input.category = category
  if (notes) input.notes = notes
  if (status) input.status = status
  if (source) input.source = source
  if (note) input.note = note

  return { success: true, input, externalId }
}

function extractExternalIds(note: string | null | undefined): string[] {
  if (!note) return []

  return note
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('externalId='))
    .map((part) => part.slice('externalId='.length).trim())
    .filter(Boolean)
}

function findDuplicateImportTransaction(
  input: ImportTransactionInput,
  externalId: string | null
): ImportDuplicateMatch {
  if (externalId) {
    const rows =
      query<{ id: string; note: string | null }>(
        `SELECT id, note FROM transactions
         WHERE account_id = $1
           AND instr(COALESCE(note, ''), $2) > 0
         ORDER BY date DESC, created_at DESC, id DESC`,
        [input.accountId, 'externalId=']
      ) ?? []
    const exactExternalIdMatch = rows.find((row) =>
      extractExternalIds(row.note).includes(externalId)
    )
    if (exactExternalIdMatch) {
      return {
        kind: 'duplicate',
        id: exactExternalIdMatch.id,
        matchType: 'external_id',
        externalId,
      }
    }
  }

  const duplicateCheck = findTransactionDuplicate({
    accountId: input.accountId,
    date: input.date,
    amountCentavos: toCentavos(input.amount),
    type: input.type,
    status: input.status,
    description: input.description,
  })
  return duplicateCheck.match
    ? {
        kind: duplicateCheck.match.kind,
        id: duplicateCheck.match.existingTransactionId,
        match: duplicateCheck.match,
      }
    : null
}

function importInputForOutput(input: ImportTransactionInput): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input }
  delete output.dryRun
  delete output.allowDuplicate
  return output
}

function importDuplicateDetails(duplicate: ImportDuplicateMatch): Record<string, unknown> | null {
  if (!duplicate) return null
  if (duplicate.kind === 'duplicate') {
    return {
      kind: duplicate.kind,
      matchType: duplicate.matchType,
      externalId: duplicate.externalId,
      existingTransactionId: duplicate.id,
    }
  }

  return {
    kind: duplicate.kind,
    existingTransactionId: duplicate.id,
    match: duplicate.match,
  }
}

function importDuplicateOverride(duplicate: ImportDuplicateMatch): Record<string, unknown> | null {
  const details = importDuplicateDetails(duplicate)
  if (!details) return null
  return {
    allowed: true,
    reason: 'allow_duplicate',
    duplicate: details,
  }
}

function potentialDuplicateFields(duplicate: ImportDuplicateMatch): Record<string, unknown> {
  if (duplicate?.kind !== 'potential_duplicate') return {}
  return {
    reason: 'potential_duplicate',
    potentialDuplicate: {
      existingTransactionId: duplicate.id,
      match: duplicate.match,
    },
    message:
      'Potential matching transaction exists; row is not skipped automatically unless an externalId duplicate is found.',
  }
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const rawText = String(value)
  const text = typeof value === 'string' && /^[=+\-@]/.test(rawText) ? `\t${rawText}` : rawText
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function rowsToCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  return [
    columns.map(escapeCsvValue).join(','),
    ...rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(',')),
  ].join('\n')
}

function escapeMarkdownCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function tableToMarkdown(spec: ExportTableSpec, rows: Array<Record<string, unknown>>): string {
  const header = `| ${spec.columns.join(' | ')} |`
  const separator = `| ${spec.columns.map(() => '---').join(' | ')} |`
  const body = rows.map(
    (row) => `| ${spec.columns.map((column) => escapeMarkdownCell(row[column])).join(' | ')} |`
  )

  return [`## ${spec.name}`, '', header, separator, ...body].join('\n')
}

function redactExportRow(tableName: string, row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const isSensitiveSettingValue =
        tableName === 'settings' &&
        key === 'value' &&
        REDACTED_SETTINGS_VALUE_KEYS.has(String(row.key ?? ''))
      return [
        key,
        (isSensitiveSettingValue || REDACTED_FIELD_PATTERN.test(key)) &&
        value !== null &&
        value !== undefined
          ? '[REDACTED]'
          : value,
      ]
    })
  )
}

function isMissingExportTableOrColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /no such (table|column)/i.test(error.message)
}

function readExportTables(redacted: boolean): ReadExportTablesResult {
  const skippedTables: SkippedExportTable[] = []
  const tables = transaction(
    () =>
      Object.fromEntries(
        EXPORT_TABLES.map((spec) => {
          let rows: Array<Record<string, unknown>>
          try {
            rows = query<Record<string, unknown>>(
              `SELECT ${spec.columns.join(', ')} FROM ${spec.name} ORDER BY ${spec.orderBy}`
            )
          } catch (error) {
            if (
              !OPTIONAL_EXPORT_TABLES.has(spec.name) ||
              !isMissingExportTableOrColumnError(error)
            ) {
              throw error
            }
            skippedTables.push({
              name: spec.name,
              reason: 'missing_optional_table_or_column',
              message: error instanceof Error ? error.message : String(error),
            })
            rows = []
          }
          return [spec.name, redacted ? rows.map((row) => redactExportRow(spec.name, row)) : rows]
        })
      ) as Record<string, Array<Record<string, unknown>>>
  )
  return { tables, skippedTables }
}

const backupDatabaseTool: ToolDefinition = {
  name: 'backup-database',
  description:
    'Create a consistent manual SQLite database backup under the Shikin app data backups directory.',
  schema: z.object({}),
  execute: async () => {
    try {
      const backup = await backupDatabase()
      return {
        success: true,
        path: backup.path,
        backup,
        message: `Created database backup at ${backup.path}.`,
      }
    } catch (error) {
      return databaseOperationError(error, 'database_backup_failed')
    }
  },
}

const restoreDatabaseTool: ToolDefinition = {
  name: 'restore-database',
  description:
    'Validate and restore a Shikin SQLite database backup, creating a rollback backup before replacement. Apply mode requires Linux /proc handle checks; dry-run validation is safe on all platforms.',
  schema: z.object({
    file: boundedText(
      'Database backup file',
      'Path to a Shikin SQLite backup file to restore',
      4096
    ),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate the backup without replacing the active database'),
  }),
  execute: async ({ file, dryRun }) => {
    try {
      const restore = await restoreDatabase({ sourcePath: file, dryRun })
      const rollbackPath = !restore.dryRun ? restore.rollbackPath : undefined
      return {
        success: true,
        dryRun: restore.dryRun,
        sourcePath: restore.sourcePath,
        ...(rollbackPath ? { rollbackPath } : {}),
        restore,
        message: restore.dryRun
          ? `Validated database backup ${restore.sourcePath}; no restore was applied.`
          : `Restored database from ${restore.sourcePath}. Rollback backup: ${restore.rollbackPath ?? 'none'}.`,
      }
    } catch (error) {
      return databaseOperationError(error, 'database_restore_failed')
    }
  },
}

const financeProfile: ToolDefinition = {
  name: 'finance-profile',
  description:
    'Get, set, or clear stable assistant finance profile preferences stored in settings.',
  schema: z.object({
    action: z.enum(['get', 'set', 'clear']).optional().default('get'),
    profile: z
      .object({})
      .passthrough()
      .optional()
      .describe('Profile JSON object to store when action is set'),
    merge: z.boolean().optional().default(true).describe('Merge profile keys when setting'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview profile writes without storing them'),
  }),
  execute: async ({ action, profile, merge, dryRun }) => {
    const current = getJsonSetting<unknown>(FINANCE_PROFILE_SETTING_KEY, {})

    if (action === 'get') {
      return {
        success: true,
        action: 'read' as const,
        present: hasFinanceProfile(current),
        profile: stableJsonValue(current),
        message: hasFinanceProfile(current)
          ? 'Finance profile is configured.'
          : 'Finance profile is not configured.',
      }
    }

    if (action === 'clear') {
      if (dryRun) {
        return {
          success: true,
          action: 'cleared' as const,
          dryRun: true,
          before: stableJsonValue(current),
          after: {},
          message: 'Dry run: finance profile would be cleared.',
        }
      }

      setJsonSetting(FINANCE_PROFILE_SETTING_KEY, {})
      return {
        success: true,
        action: 'cleared' as const,
        present: false,
        profile: {},
        message: 'Finance profile cleared.',
      }
    }

    if (!profile) {
      return { success: false, message: 'profile is required when action is set.' }
    }

    const nextProfile = merge ? deepMergeProfile(current, profile) : stableJsonValue(profile)
    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        before: stableJsonValue(current),
        after: nextProfile,
        message: 'Dry run: finance profile would be updated.',
      }
    }

    setJsonSetting(FINANCE_PROFILE_SETTING_KEY, nextProfile)
    return {
      success: true,
      action: 'updated' as const,
      present: hasFinanceProfile(nextProfile),
      profile: nextProfile,
      message: 'Finance profile updated.',
    }
  },
}

const importTransactions: ToolDefinition = {
  name: 'import-transactions',
  description:
    'Preview or apply a UTF-8 CSV import. Required columns: date, description, amount. Optional: type, category, notes, status, currency, source, note, externalId.',
  schema: z.object({
    file: boundedText('CSV file', 'Path to a UTF-8 CSV file with a header row', 4096),
    accountId: boundedText('Account ID', 'Account ID to import transactions into', 128).optional(),
    account: boundedText(
      'Account reference',
      'Account alias, exact account ID, or exact account name to import transactions into',
      128
    ).optional(),
    apply: z.boolean().optional().default(false).describe('Apply the import. Omit for preview.'),
    dryRun: z.boolean().optional().default(false).describe('Force preview mode without writes'),
    allowDuplicate: z
      .boolean()
      .optional()
      .default(false)
      .describe('Import rows even when an external-ID or likely duplicate is detected'),
    source: boundedText('Source', 'Default source label for imported rows', 120)
      .optional()
      .default('csv-import'),
  }),
  execute: async ({ file, accountId, account, apply, dryRun, allowDuplicate, source }) => {
    if (apply && dryRun) {
      return {
        success: false,
        reason: 'import_flag_conflict',
        message: 'Use either apply or dryRun, not both.',
      }
    }

    if (!addTransactionTool) {
      return {
        success: false,
        reason: 'import_tool_unavailable',
        message: 'add-transaction tool is unavailable.',
      }
    }

    const resolvedAccount = resolveAccountId(accountId, account)
    if (!resolvedAccount.success) return resolvedAccount

    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      return {
        success: false,
        reason: 'csv_file_read_failed',
        file,
        message: `Could not read CSV file "${file}".`,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    const parsedCsv = parseCsv(text)
    if (parsedCsv.rows.length === 0) {
      return {
        success: false,
        reason: 'csv_empty',
        message: 'CSV file is empty or has no header row.',
      }
    }

    const [headerRow, ...dataRows] = parsedCsv.rows
    const headers = headerRow.fields.map(normalizeHeader)
    const headerErrors = parsedCsv.errors.map((error) => ({ ...error, row: null }))
    const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index)
    const missingRequired = REQUIRED_IMPORT_COLUMNS.filter((column) => !headers.includes(column))
    const unsupportedHeaders = headers.filter(
      (header) => header && !SUPPORTED_IMPORT_COLUMNS.has(header)
    )
    const errors: Array<{ row: number | null; lineNumber: number | null; messages: string[] }> = [
      ...headerErrors.map((error) => ({
        row: error.row,
        lineNumber: error.lineNumber,
        messages: [error.message],
      })),
    ]

    if (missingRequired.length > 0) {
      errors.push({
        row: null,
        lineNumber: headerRow.lineNumber,
        messages: [`Missing required CSV columns: ${missingRequired.join(', ')}.`],
      })
    }
    if (duplicateHeaders.length > 0) {
      errors.push({
        row: null,
        lineNumber: headerRow.lineNumber,
        messages: [`Duplicate CSV columns: ${[...new Set(duplicateHeaders)].join(', ')}.`],
      })
    }

    const previewRows: Array<Record<string, unknown>> = []
    if (errors.length === 0) {
      for (const [index, row] of dataRows.entries()) {
        const rowNumber = index + 2
        const built = buildImportRowInput({
          row,
          headers,
          accountId: resolvedAccount.id,
          accountCurrency: resolvedAccount.currency,
          defaultSource: source,
        })
        if (!built.success) {
          errors.push({ row: rowNumber, lineNumber: row.lineNumber, messages: built.errors })
          previewRows.push({
            row: rowNumber,
            lineNumber: row.lineNumber,
            status: 'invalid',
            errors: built.errors,
          })
          continue
        }

        const parsedInput = addTransactionTool.schema.safeParse(built.input)
        if (!parsedInput.success) {
          const messages = parsedInput.error.issues.map((issue) => issue.message)
          errors.push({ row: rowNumber, lineNumber: row.lineNumber, messages })
          previewRows.push({
            row: rowNumber,
            lineNumber: row.lineNumber,
            status: 'invalid',
            errors: messages,
          })
          continue
        }

        const validatedInput = parsedInput.data as ImportTransactionInput
        const duplicate = findDuplicateImportTransaction(validatedInput, built.externalId)
        if (duplicate && !allowDuplicate) {
          previewRows.push({
            row: rowNumber,
            lineNumber: row.lineNumber,
            status: 'skipped',
            reason: duplicate.kind === 'duplicate' ? 'duplicate' : duplicate.kind,
            externalId: built.externalId,
            existingTransactionId: duplicate.id,
            duplicate: importDuplicateDetails(duplicate),
            input: importInputForOutput(validatedInput),
            message:
              duplicate.kind === 'duplicate' || duplicate.kind === 'exact_duplicate'
                ? 'Matching transaction already exists; row would be skipped.'
                : 'Potential matching transaction exists; row would be skipped unless allowDuplicate is true.',
          })
          continue
        }

        const dryRunResult = await addTransactionTool.execute({
          ...validatedInput,
          allowDuplicate: allowDuplicate ? true : undefined,
        })
        if (dryRunResult?.success === false) {
          const messages = [String(dryRunResult.message ?? 'Row failed validation.')]
          errors.push({ row: rowNumber, lineNumber: row.lineNumber, messages })
          previewRows.push({
            row: rowNumber,
            lineNumber: row.lineNumber,
            status: 'invalid',
            errors: messages,
          })
          continue
        }

        previewRows.push({
          row: rowNumber,
          lineNumber: row.lineNumber,
          status: 'valid',
          externalId: built.externalId,
          input: importInputForOutput(validatedInput),
          ...(allowDuplicate && duplicate
            ? {
                reason: 'duplicate_override',
                duplicateOverride: importDuplicateOverride(duplicate),
              }
            : potentialDuplicateFields(duplicate)),
          preview: dryRunResult.wouldCreate ?? dryRunResult,
        })
      }
    }

    const previewOnly = !apply || dryRun
    if (errors.length > 0) {
      return {
        success: false,
        reason: 'csv_validation_failed',
        dryRun: previewOnly,
        applyRequested: Boolean(apply),
        file,
        account: { id: resolvedAccount.id, currency: resolvedAccount.currency },
        supportedColumns: {
          required: [...REQUIRED_IMPORT_COLUMNS],
          optional: [
            'type',
            'category',
            'notes',
            'status',
            'currency',
            'source',
            'note',
            'externalId',
          ],
        },
        ignoredColumns: unsupportedHeaders,
        summary: {
          totalRows: dataRows.length,
          validRows: previewRows.filter((row) => row.status === 'valid').length,
          invalidRows: errors.filter((error) => error.row !== null).length,
          skippedRows: previewRows.filter((row) => row.status === 'skipped').length,
          importedRows: 0,
        },
        rows: previewRows,
        errors,
        message: `CSV import has ${errors.length} validation error(s). No rows were imported.`,
      }
    }

    if (previewOnly) {
      return {
        success: true,
        dryRun: true,
        applyRequired: true,
        file,
        account: { id: resolvedAccount.id, currency: resolvedAccount.currency },
        supportedColumns: {
          required: [...REQUIRED_IMPORT_COLUMNS],
          optional: [
            'type',
            'category',
            'notes',
            'status',
            'currency',
            'source',
            'note',
            'externalId',
          ],
        },
        ignoredColumns: unsupportedHeaders,
        summary: {
          totalRows: dataRows.length,
          validRows: previewRows.filter((row) => row.status === 'valid').length,
          invalidRows: 0,
          skippedRows: previewRows.filter((row) => row.status === 'skipped').length,
          importedRows: 0,
        },
        rows: previewRows,
        message: `Previewed ${previewRows.length} transaction row(s). Re-run with --apply to import.`,
      }
    }

    const appliedRows: Array<Record<string, unknown>> = []
    const applyErrors: Array<{
      row: number | null
      lineNumber: number | null
      messages: string[]
    }> = []
    for (const previewRow of previewRows) {
      if (previewRow.status === 'skipped') {
        appliedRows.push({
          row: previewRow.row,
          lineNumber: previewRow.lineNumber,
          status: 'skipped',
          reason: previewRow.reason ?? 'duplicate',
          externalId: previewRow.externalId ?? null,
          existingTransactionId: previewRow.existingTransactionId,
          duplicate: previewRow.duplicate,
          message: 'Matching transaction already exists; row was skipped.',
        })
        continue
      }

      const input = previewRow.input as ImportTransactionInput
      const externalId = typeof previewRow.externalId === 'string' ? previewRow.externalId : null
      const duplicate = findDuplicateImportTransaction(input, externalId)
      if (duplicate && !allowDuplicate) {
        appliedRows.push({
          row: previewRow.row,
          lineNumber: previewRow.lineNumber,
          status: 'skipped',
          reason: duplicate.kind === 'duplicate' ? 'duplicate' : duplicate.kind,
          externalId,
          existingTransactionId: duplicate.id,
          duplicate: importDuplicateDetails(duplicate),
          message:
            duplicate.kind === 'duplicate' || duplicate.kind === 'exact_duplicate'
              ? 'Matching transaction already exists; row was skipped.'
              : 'Potential matching transaction exists; row was skipped because allowDuplicate is false.',
        })
        continue
      }

      const result = await addTransactionTool.execute({
        ...input,
        dryRun: false,
        allowDuplicate: allowDuplicate ? true : undefined,
      })
      if (result?.success === false) {
        applyErrors.push({
          row: previewRow.row as number,
          lineNumber: previewRow.lineNumber as number,
          messages: [String(result.message ?? 'Row failed during import.')],
        })
        continue
      }
      appliedRows.push({
        row: previewRow.row,
        lineNumber: previewRow.lineNumber,
        externalId: previewRow.externalId,
        status: 'imported',
        ...(allowDuplicate && duplicate
          ? {
              reason: 'duplicate_override',
              duplicateOverride: importDuplicateOverride(duplicate),
            }
          : potentialDuplicateFields(duplicate)),
        transaction: result.transaction ?? result,
      })
    }

    return {
      success: applyErrors.length === 0,
      ...(applyErrors.length > 0 ? { reason: 'csv_apply_failed' } : {}),
      dryRun: false,
      file,
      account: { id: resolvedAccount.id, currency: resolvedAccount.currency },
      summary: {
        totalRows: dataRows.length,
        validRows: previewRows.filter((row) => row.status === 'valid').length,
        invalidRows: applyErrors.length,
        skippedRows: appliedRows.filter((row) => row.status === 'skipped').length,
        importedRows: appliedRows.filter((row) => row.status === 'imported').length,
      },
      rows: appliedRows,
      errors: applyErrors,
      message:
        applyErrors.length === 0
          ? `Imported ${appliedRows.filter((row) => row.status === 'imported').length} transaction row(s).`
          : `Imported ${appliedRows.filter((row) => row.status === 'imported').length} transaction row(s); ${applyErrors.length} row(s) failed during apply.`,
    }
  },
}

const exportData: ToolDefinition = {
  name: 'export-data',
  description:
    'Export core Shikin tables plus CLI QOL tables as deterministic JSON, CSV file map, or Markdown.',
  schema: z.object({
    format: z.enum(['json', 'csv', 'markdown']).optional().default('json'),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact sensitive free-text fields in the exported data'),
  }),
  execute: async ({ format, redacted }) => {
    const exportResult = readExportTables(redacted)
    const { tables, skippedTables } = exportResult
    const tableSummaries = EXPORT_TABLES.map((spec) => ({
      name: spec.name,
      columns: spec.columns,
      rowCount: tables[spec.name]?.length ?? 0,
      skipped: skippedTables.some((skippedTable) => skippedTable.name === spec.name),
    }))

    if (format === 'json') {
      return {
        success: true,
        format,
        redacted,
        tables: tableSummaries,
        skippedTables,
        data: tables,
        message: `Exported ${tableSummaries.length} table(s) as JSON${
          skippedTables.length ? `; skipped ${skippedTables.length} optional table(s).` : '.'
        }`,
      }
    }

    if (format === 'csv') {
      return {
        success: true,
        format,
        redacted,
        tables: tableSummaries,
        skippedTables,
        files: Object.fromEntries(
          EXPORT_TABLES.map((spec) => [spec.name, rowsToCsv(spec.columns, tables[spec.name] ?? [])])
        ),
        message: `Exported ${tableSummaries.length} table(s) as CSV strings${
          skippedTables.length ? `; skipped ${skippedTables.length} optional table(s).` : '.'
        }`,
      }
    }

    return {
      success: true,
      format,
      redacted,
      tables: tableSummaries,
      skippedTables,
      content: [
        '# Shikin Data Export',
        '',
        ...EXPORT_TABLES.map((spec) => tableToMarkdown(spec, tables[spec.name] ?? [])),
      ].join('\n\n'),
      message: `Exported ${tableSummaries.length} table(s) as Markdown${
        skippedTables.length ? `; skipped ${skippedTables.length} optional table(s).` : '.'
      }`,
    }
  },
}

export const dataOpsTools: ToolDefinition[] = [
  backupDatabaseTool,
  restoreDatabaseTool,
  financeProfile,
  importTransactions,
  exportData,
]
