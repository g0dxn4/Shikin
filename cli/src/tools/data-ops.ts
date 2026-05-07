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
  | { kind: 'duplicate'; id: string }
  | { kind: 'potential_duplicate'; id: string }
  | null

type ExportTableSpec = {
  name: string
  columns: string[]
  orderBy: string
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
  const params: unknown[] = [
    input.accountId,
    input.date,
    toCentavos(input.amount),
    input.type,
    input.description,
  ]
  let sql = `SELECT id FROM transactions
             WHERE account_id = $1
               AND date = $2
               AND amount = $3
               AND type = $4
               AND description = $5`
  sql += ' LIMIT 1'

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
    return exactExternalIdMatch ? { kind: 'duplicate', id: exactExternalIdMatch.id } : null
  }

  const potentialDuplicate = (query<{ id: string }>(sql, params) ?? [])[0]
  return potentialDuplicate ? { kind: 'potential_duplicate', id: potentialDuplicate.id } : null
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

function readExportTables(redacted: boolean) {
  return transaction(
    () =>
      Object.fromEntries(
        EXPORT_TABLES.map((spec) => {
          const rows = query<Record<string, unknown>>(
            `SELECT ${spec.columns.join(', ')} FROM ${spec.name} ORDER BY ${spec.orderBy}`
          )
          return [spec.name, redacted ? rows.map((row) => redactExportRow(spec.name, row)) : rows]
        })
      ) as Record<string, Array<Record<string, unknown>>>
  )
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
    source: boundedText('Source', 'Default source label for imported rows', 120)
      .optional()
      .default('csv-import'),
  }),
  execute: async ({ file, accountId, account, apply, dryRun, source }) => {
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
        if (duplicate?.kind === 'duplicate') {
          previewRows.push({
            row: rowNumber,
            lineNumber: row.lineNumber,
            status: 'skipped',
            reason: 'duplicate',
            externalId: built.externalId,
            existingTransactionId: duplicate.id,
            input: { ...built.input, dryRun: undefined },
            message: 'Matching transaction already exists; row would be skipped.',
          })
          continue
        }

        const dryRunResult = await addTransactionTool.execute(validatedInput)
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
          input: { ...built.input, dryRun: undefined },
          ...(duplicate?.kind === 'potential_duplicate'
            ? {
                reason: 'potential_duplicate',
                potentialDuplicate: { existingTransactionId: duplicate.id },
                message:
                  'Potential matching transaction exists, but no externalId was provided; row will not be skipped automatically.',
              }
            : {}),
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
          message: 'Matching transaction already exists; row was skipped.',
        })
        continue
      }

      const input = previewRow.input as ImportTransactionInput
      const externalId = typeof previewRow.externalId === 'string' ? previewRow.externalId : null
      const duplicate = findDuplicateImportTransaction(input, externalId)
      if (duplicate?.kind === 'duplicate') {
        appliedRows.push({
          row: previewRow.row,
          lineNumber: previewRow.lineNumber,
          status: 'skipped',
          reason: 'duplicate',
          externalId,
          existingTransactionId: duplicate.id,
          message: 'Matching transaction already exists; row was skipped.',
        })
        continue
      }

      const result = await addTransactionTool.execute({ ...input, dryRun: false })
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
        ...(duplicate?.kind === 'potential_duplicate'
          ? {
              reason: 'potential_duplicate',
              potentialDuplicate: { existingTransactionId: duplicate.id },
            }
          : {}),
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
    const tables = readExportTables(redacted)
    const tableSummaries = EXPORT_TABLES.map((spec) => ({
      name: spec.name,
      columns: spec.columns,
      rowCount: tables[spec.name]?.length ?? 0,
    }))

    if (format === 'json') {
      return {
        success: true,
        format,
        redacted,
        tables: tableSummaries,
        data: tables,
        message: `Exported ${tableSummaries.length} table(s) as JSON.`,
      }
    }

    if (format === 'csv') {
      return {
        success: true,
        format,
        redacted,
        tables: tableSummaries,
        files: Object.fromEntries(
          EXPORT_TABLES.map((spec) => [spec.name, rowsToCsv(spec.columns, tables[spec.name] ?? [])])
        ),
        message: `Exported ${tableSummaries.length} table(s) as CSV strings.`,
      }
    }

    return {
      success: true,
      format,
      redacted,
      tables: tableSummaries,
      content: [
        '# Shikin Data Export',
        '',
        ...EXPORT_TABLES.map((spec) => tableToMarkdown(spec, tables[spec.name] ?? [])),
      ].join('\n\n'),
      message: `Exported ${tableSummaries.length} table(s) as Markdown.`,
    }
  },
}

export const dataOpsTools: ToolDefinition[] = [financeProfile, importTransactions, exportData]
