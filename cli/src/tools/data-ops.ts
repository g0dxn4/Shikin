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
import { executeAtomicImport, type AtomicImportRow } from '../import-transactions.js'
import type { ImportReviewDecision } from '@shikin/finance-core/imports'
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
  ledgerTreatment?: 'normal' | 'staged_no_balance_impact'
  reportingTreatment?: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
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

type ImportTransactionsExecutionInput = {
  file: string
  accountId?: string
  account?: string
  apply: boolean
  dryRun: boolean
  allowDuplicate: boolean
  source: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  previewToken?: string
  decisions?: ImportReviewDecision[]
}

type ResolvedImportAccount = {
  id: string
  currency: string
}

type ImportValidationIssue = {
  row: number | null
  lineNumber: number | null
  messages: string[]
}

type ImportRowOutput = Record<string, unknown>

type CsvImportPlan = {
  dataRows: CsvRow[]
  headers: string[]
  unsupportedHeaders: string[]
  errors: ImportValidationIssue[]
  previewRows: ImportRowOutput[]
}

type CsvImportPlanResult =
  | { kind: 'empty' }
  | {
      kind: 'plan'
      plan: CsvImportPlan
    }

type ImportRowPlan = {
  row: ImportRowOutput
  error?: ImportValidationIssue
}

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
      'account_mode',
      'valuation_mode',
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
      'is_placeholder',
      'placeholder_status',
      'resolved_at',
      'resolved_by_transaction_id',
      'placeholder_reason',
      'placeholder_parent_transaction_id',
      'ledger_treatment',
      'reporting_treatment',
      'transaction_kind',
      'staging_batch_id',
      'finalization_id',
      'import_source',
      'import_external_id',
      'import_fingerprint',
      'import_content_fingerprint',
      'reconciliation_id',
      'matched_transaction_id',
      'is_archived',
      'created_at',
      'updated_at',
    ],
    orderBy: 'date ASC, created_at ASC, id ASC',
  },
  {
    name: 'account_reconciliations',
    columns: [
      'id',
      'account_id',
      'reconciliation_date',
      'actual_balance',
      'stored_balance_before',
      'ledger_balance_before',
      'ledger_balance_after',
      'adjustment_amount',
      'adjustment_transaction_id',
      'staging_batch_id',
      'selection_mode',
      'statement_start_date',
      'statement_end_date',
      'source',
      'note',
      'created_at',
    ],
    orderBy: 'reconciliation_date ASC, account_id ASC, id ASC',
  },
  {
    name: 'receivables',
    columns: [
      'id',
      'payer',
      'amount',
      'received_amount',
      'currency',
      'due_date',
      'project_reference',
      'invoice_reference',
      'status',
      'account_id',
      'matched_transaction_id',
      'notes',
      'source',
      'note',
      'created_at',
      'updated_at',
    ],
    orderBy: 'due_date ASC, created_at ASC, id ASC',
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
      'quantity_decimal',
      'avg_cost_basis_decimal',
      'cost_basis_known',
      'instrument_key',
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
      'basis',
      'currency_scope',
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
      'reverses_allocation_id',
      'replaces_allocation_id',
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
      'unattributed_paid_amount',
      'currency',
      'status',
      'source',
      'note',
      'created_at',
      'updated_at',
    ],
    orderBy: 'statement_end_date ASC, account_id ASC, id ASC',
  },
  {
    name: 'instrument_prices',
    columns: [
      'id',
      'instrument_key',
      'asset_type',
      'provider',
      'instrument_id',
      'exchange',
      'quote_currency',
      'unit_price_decimal',
      'quote_date',
      'created_at',
    ],
    orderBy: 'instrument_key ASC, quote_date ASC, id ASC',
  },
  {
    name: 'transaction_consumption_classifications',
    columns: [
      'id',
      'transaction_id',
      'split_id',
      'role',
      'referenced_purchase_id',
      'created_at',
      'updated_at',
    ],
    orderBy: 'transaction_id ASC, split_id ASC, id ASC',
  },
  {
    name: 'source_coverage',
    columns: [
      'id',
      'account_id',
      'source_namespace',
      'period_start',
      'period_end',
      'status',
      'zero_rows',
      'document_ref',
      'source',
      'note',
      'created_at',
      'updated_at',
    ],
    orderBy: 'account_id ASC, source_namespace ASC, period_start ASC, id ASC',
  },
  {
    name: 'reconciliation_corrections',
    columns: [
      'id',
      'original_reconciliation_id',
      'original_bridge_id',
      'successor_reconciliation_id',
      'successor_bridge_id',
      'replacement_transaction_ids_json',
      'source',
      'note',
      'created_at',
    ],
    orderBy: 'created_at ASC, id ASC',
  },
  {
    name: 'transfer_match_provenance',
    columns: [
      'id',
      'source_transaction_id',
      'mirror_transaction_id',
      'source_before_json',
      'mirror_before_json',
      'matched_at',
      'unmatched_at',
    ],
    orderBy: 'matched_at ASC, id ASC',
  },
  {
    name: 'duplicate_review_decisions',
    columns: [
      'id',
      'account_id',
      'existing_transaction_id',
      'candidate_identity_key',
      'candidate_content_fingerprint',
      'existing_evidence_fingerprint',
      'decision',
      'source',
      'note',
      'created_at',
    ],
    orderBy: 'created_at ASC, id ASC',
  },
  {
    name: 'card_statement_payment_links',
    columns: [
      'id',
      'original_statement_id',
      'original_transaction_id',
      'statement_id',
      'transaction_id',
      'amount',
      'mode',
      'source',
      'note',
      'created_at',
      'voided_at',
    ],
    orderBy: 'created_at ASC, id ASC',
  },
  {
    name: 'app_data_state',
    columns: ['id', 'database_id', 'data_revision', 'last_financial_write_at'],
    orderBy: 'id ASC',
  },
]

const OPTIONAL_EXPORT_TABLES = new Set([
  'account_reconciliations',
  'receivables',
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
  'instrument_prices',
  'transaction_consumption_classifications',
  'source_coverage',
  'reconciliation_corrections',
  'transfer_match_provenance',
  'duplicate_review_decisions',
  'card_statement_payment_links',
  'app_data_state',
])

const REDACTED_FIELD_PATTERN =
  /(?:account[_-]?number|routing[_-]?number|card[_-]?number|iban|swift|secret|token|password|private[_-]?key|payer|project[_-]?reference|invoice[_-]?reference|notes?|description|url|value|summary|tags|source|reason|import[_-]?external[_-]?id|import[_-]?fingerprint|before_json|after_json|pattern|highlights_json|breakdown_json|document_ref|replacement_transaction_ids_json|source_before_json|mirror_before_json)/i
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

function redactStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStableJsonValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [
        key,
        REDACTED_FIELD_PATTERN.test(key) ? '[REDACTED]' : redactStableJsonValue(nested),
      ])
  )
}

function financeProfileOutput(value: unknown, redacted: boolean): unknown {
  const stable = stableJsonValue(value)
  return redacted ? redactStableJsonValue(stable) : stable
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
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
}: {
  row: CsvRow
  headers: string[]
  accountId: string
  accountCurrency: string
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
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

  const externalId =
    values.externalid === undefined || values.externalid.length === 0 ? null : values.externalid
  const noteParts = [normalizeOptionalCell(values.note)].filter((value): value is string =>
    Boolean(value)
  )
  const input: ImportTransactionInput = {
    amount: Math.abs(amount),
    type,
    description: values.description.trim(),
    date: values.date.trim(),
    accountId,
    dryRun: true,
    ledgerTreatment,
    reportingTreatment,
  }
  if (stagingBatchId) input.stagingBatchId = stagingBatchId
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
    source: input.source,
    note: input.note,
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

function validateImportTransactionsRequest({
  apply,
  dryRun,
  ledgerTreatment,
  stagingBatchId,
}: Pick<
  ImportTransactionsExecutionInput,
  'apply' | 'dryRun' | 'ledgerTreatment' | 'stagingBatchId'
>) {
  if (apply && dryRun) {
    return {
      success: false as const,
      reason: 'import_flag_conflict',
      message: 'Use either apply or dryRun, not both.',
    }
  }

  if (ledgerTreatment === 'staged_no_balance_impact' && !stagingBatchId) {
    return {
      success: false as const,
      reason: 'staging_batch_required',
      message: 'stagingBatchId is required when importing staged statement history.',
    }
  }

  return null
}

function importSupportedColumns() {
  return {
    required: [...REQUIRED_IMPORT_COLUMNS],
    optional: ['type', 'category', 'notes', 'status', 'currency', 'source', 'note', 'externalId'],
  }
}

function importAccountOutput(account: ResolvedImportAccount) {
  return { id: account.id, currency: account.currency }
}

async function readCsvImportFile(
  file: string
): Promise<{ success: true; text: string } | { success: false; result: Record<string, unknown> }> {
  try {
    return { success: true, text: await readFile(file, 'utf8') }
  } catch (error) {
    return {
      success: false,
      result: {
        success: false,
        reason: 'csv_file_read_failed',
        file,
        message: `Could not read CSV file "${file}".`,
        error: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function createCsvImportPlan(text: string): CsvImportPlanResult {
  const parsedCsv = parseCsv(text)
  if (parsedCsv.rows.length === 0) return { kind: 'empty' }

  const [headerRow, ...dataRows] = parsedCsv.rows
  const headers = headerRow.fields.map(normalizeHeader)
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index)
  const missingRequired = REQUIRED_IMPORT_COLUMNS.filter((column) => !headers.includes(column))
  const unsupportedHeaders = headers.filter(
    (header) => header && !SUPPORTED_IMPORT_COLUMNS.has(header)
  )
  const errors: ImportValidationIssue[] = parsedCsv.errors.map((error) => ({
    row: null,
    lineNumber: error.lineNumber,
    messages: [error.message],
  }))

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

  return {
    kind: 'plan',
    plan: { dataRows, headers, unsupportedHeaders, errors, previewRows: [] },
  }
}

async function planCsvImportRow({
  row,
  rowNumber,
  headers,
  account,
  defaultSource,
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
  allowDuplicate,
  importTool,
}: {
  row: CsvRow
  rowNumber: number
  headers: string[]
  account: ResolvedImportAccount
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  allowDuplicate: boolean
  importTool: ToolDefinition
}): Promise<ImportRowPlan> {
  const built = buildImportRowInput({
    row,
    headers,
    accountId: account.id,
    accountCurrency: account.currency,
    defaultSource,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId,
  })
  if (!built.success) {
    const error = { row: rowNumber, lineNumber: row.lineNumber, messages: built.errors }
    return {
      error,
      row: {
        row: rowNumber,
        lineNumber: row.lineNumber,
        status: 'invalid',
        errors: built.errors,
      },
    }
  }

  const parsedInput = importTool.schema.safeParse(built.input)
  if (!parsedInput.success) {
    const messages = parsedInput.error.issues.map((issue) => issue.message)
    const error = { row: rowNumber, lineNumber: row.lineNumber, messages }
    return {
      error,
      row: {
        row: rowNumber,
        lineNumber: row.lineNumber,
        status: 'invalid',
        errors: messages,
      },
    }
  }

  const validatedInput = parsedInput.data as ImportTransactionInput
  const duplicate = findDuplicateImportTransaction(validatedInput, built.externalId)
  if (duplicate && !allowDuplicate) {
    return {
      row: {
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
      },
    }
  }

  const dryRunResult = await importTool.execute({
    ...validatedInput,
    allowDuplicate: allowDuplicate ? true : undefined,
  })
  if (dryRunResult?.success === false) {
    const messages = [String(dryRunResult.message ?? 'Row failed validation.')]
    const error = { row: rowNumber, lineNumber: row.lineNumber, messages }
    return {
      error,
      row: {
        row: rowNumber,
        lineNumber: row.lineNumber,
        status: 'invalid',
        errors: messages,
      },
    }
  }

  return {
    row: {
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
    },
  }
}

async function planCsvImportRows({
  dataRows,
  headers,
  account,
  defaultSource,
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
  allowDuplicate,
  importTool,
}: {
  dataRows: CsvRow[]
  headers: string[]
  account: ResolvedImportAccount
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  allowDuplicate: boolean
  importTool: ToolDefinition
}): Promise<{ previewRows: ImportRowOutput[]; errors: ImportValidationIssue[] }> {
  const previewRows: ImportRowOutput[] = []
  const errors: ImportValidationIssue[] = []

  for (const [index, row] of dataRows.entries()) {
    const plannedRow = await planCsvImportRow({
      row,
      rowNumber: index + 2,
      headers,
      account,
      defaultSource,
      ledgerTreatment,
      reportingTreatment,
      stagingBatchId,
      allowDuplicate,
      importTool,
    })
    previewRows.push(plannedRow.row)
    if (plannedRow.error) errors.push(plannedRow.error)
  }

  return { previewRows, errors }
}

async function planCsvImport({
  text,
  account,
  defaultSource,
  ledgerTreatment,
  reportingTreatment,
  stagingBatchId,
  allowDuplicate,
  importTool,
}: {
  text: string
  account: ResolvedImportAccount
  defaultSource: string
  ledgerTreatment: 'normal' | 'staged_no_balance_impact'
  reportingTreatment: 'normal' | 'exclude_from_cashflow'
  stagingBatchId?: string
  allowDuplicate: boolean
  importTool: ToolDefinition
}): Promise<CsvImportPlanResult> {
  const planResult = createCsvImportPlan(text)
  if (planResult.kind === 'empty' || planResult.plan.errors.length > 0) return planResult

  const plannedRows = await planCsvImportRows({
    dataRows: planResult.plan.dataRows,
    headers: planResult.plan.headers,
    account,
    defaultSource,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId,
    allowDuplicate,
    importTool,
  })
  planResult.plan.previewRows.push(...plannedRows.previewRows)
  planResult.plan.errors.push(...plannedRows.errors)
  return planResult
}

function previewImportSummary(plan: CsvImportPlan) {
  return {
    totalRows: plan.dataRows.length,
    validRows: plan.previewRows.filter((row) => row.status === 'valid').length,
    invalidRows: plan.errors.filter((error) => error.row !== null).length,
    skippedRows: plan.previewRows.filter((row) => row.status === 'skipped').length,
    importedRows: 0,
  }
}

function formatCsvValidationFailure({
  previewOnly,
  apply,
  file,
  account,
  plan,
}: {
  previewOnly: boolean
  apply: boolean
  file: string
  account: ResolvedImportAccount
  plan: CsvImportPlan
}) {
  return {
    success: false,
    reason: 'csv_validation_failed',
    dryRun: previewOnly,
    applyRequested: Boolean(apply),
    file,
    account: importAccountOutput(account),
    supportedColumns: importSupportedColumns(),
    ignoredColumns: plan.unsupportedHeaders,
    summary: previewImportSummary(plan),
    rows: plan.previewRows,
    errors: plan.errors,
    message: `CSV import has ${plan.errors.length} validation error(s). No rows were imported.`,
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
    'Preview a Shikin SQLite restore by default. Pass apply:true to restore after validation and create a rollback backup.',
  schema: z.object({
    file: boundedText(
      'Database backup file',
      'Path to a Shikin SQLite backup file to restore',
      4096
    ),
    apply: z.boolean().optional().describe('Apply the restore after validation'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Legacy preview flag. Explicit false still applies for one compatibility cycle.'),
  }),
  execute: async ({ file, apply, dryRun }) => {
    if (apply === true && dryRun === true) {
      return {
        success: false,
        reason: 'restore_apply_conflict',
        message: 'Use either apply:true or dryRun:true, not both.',
      }
    }

    const legacyApply = apply !== true && dryRun === false
    const shouldApply = apply === true || legacyApply

    try {
      const restore = await restoreDatabase({ sourcePath: file, dryRun: !shouldApply })
      const rollbackPath = !restore.dryRun ? restore.rollbackPath : undefined
      return {
        success: true,
        dryRun: restore.dryRun,
        requiresApply: restore.dryRun,
        sourcePath: restore.sourcePath,
        ...(rollbackPath ? { rollbackPath } : {}),
        ...(legacyApply
          ? { warning: 'dryRun:false is deprecated; use apply:true for future restores.' }
          : {}),
        restore,
        message: restore.dryRun
          ? `Validated database backup ${restore.sourcePath}; no restore was applied. Re-run with apply:true to restore it.`
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
    'Get, set, or clear stable automation finance profile preferences stored in settings.',
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
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact sensitive free-text finance profile fields in the response'),
  }),
  execute: async ({ action, profile, merge, dryRun, redacted }) => {
    const current = getJsonSetting<unknown>(FINANCE_PROFILE_SETTING_KEY, {})

    if (action === 'get') {
      return {
        success: true,
        action: 'read' as const,
        present: hasFinanceProfile(current),
        profile: financeProfileOutput(current, redacted),
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
          before: financeProfileOutput(current, redacted),
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
        before: financeProfileOutput(current, redacted),
        after: financeProfileOutput(nextProfile, redacted),
        message: 'Dry run: finance profile would be updated.',
      }
    }

    setJsonSetting(FINANCE_PROFILE_SETTING_KEY, nextProfile)
    return {
      success: true,
      action: 'updated' as const,
      present: hasFinanceProfile(nextProfile),
      profile: financeProfileOutput(nextProfile, redacted),
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
      .describe(
        'Legacy compatibility flag. It never bypasses identity conflicts or candidate review.'
      ),
    previewToken: boundedText(
      'Preview token',
      'Token returned by a preview of this exact file, options, decisions, and database revision',
      128
    ).optional(),
    decisions: z
      .array(
        z.object({
          candidateIdentityKey: boundedText(
            'Candidate identity key',
            'Preview candidate identity',
            128
          ),
          candidateContentFingerprint: boundedText(
            'Candidate content fingerprint',
            'Preview candidate financial content',
            128
          ),
          existingTransactionId: boundedText(
            'Existing transaction ID',
            'Candidate existing transaction',
            128
          ),
          existingEvidenceFingerprint: boundedText(
            'Existing evidence fingerprint',
            'Bound existing evidence',
            128
          ),
          decision: z.enum(['distinct', 'keep_existing']),
        })
      )
      .optional()
      .default([]),
    source: boundedText('Source', 'Default source label for imported rows', 120)
      .optional()
      .default('csv-import'),
    ledgerTreatment: z
      .enum(['normal', 'staged_no_balance_impact'])
      .optional()
      .default('normal')
      .describe('Import incomplete history as staged rows without changing balances'),
    reportingTreatment: z
      .enum(['normal', 'exclude_from_cashflow'])
      .optional()
      .default('normal')
      .describe('Default reporting treatment for imported rows'),
    stagingBatchId: boundedText(
      'Staging batch ID',
      'Required when importing staged_no_balance_impact history',
      128
    ).optional(),
  }),
  effects: {
    writesTo: [
      'accounts',
      'transactions',
      'duplicate_review_decisions',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input: ImportTransactionsExecutionInput) => {
    const {
      file,
      accountId,
      account,
      apply,
      dryRun,
      allowDuplicate,
      source,
      ledgerTreatment,
      reportingTreatment,
      stagingBatchId,
      previewToken,
      decisions,
    } = input
    const requestFailure = validateImportTransactionsRequest({
      apply,
      dryRun,
      ledgerTreatment,
      stagingBatchId,
    })
    if (requestFailure) return requestFailure

    if (!addTransactionTool) {
      return {
        success: false,
        reason: 'import_tool_unavailable',
        message: 'add-transaction tool is unavailable.',
      }
    }

    const resolvedAccount = resolveAccountId(accountId, account)
    if (!resolvedAccount.success) return resolvedAccount

    const fileContents = await readCsvImportFile(file)
    if (!fileContents.success) return fileContents.result

    const planResult = await planCsvImport({
      text: fileContents.text,
      account: resolvedAccount,
      defaultSource: source,
      ledgerTreatment,
      reportingTreatment,
      stagingBatchId,
      allowDuplicate: true,
      importTool: addTransactionTool,
    })
    if (planResult.kind === 'empty') {
      return {
        success: false,
        reason: 'csv_empty',
        message: 'CSV file is empty or has no header row.',
      }
    }

    const { plan } = planResult
    const previewOnly = !apply || dryRun
    if (plan.errors.length > 0) {
      return formatCsvValidationFailure({
        previewOnly,
        apply,
        file,
        account: resolvedAccount,
        plan,
      })
    }
    const atomicRows: AtomicImportRow[] = plan.previewRows.map((previewRow) => {
      const plannedInput = previewRow.input as ImportTransactionInput
      return {
        row: previewRow.row as number,
        lineNumber: previewRow.lineNumber as number,
        externalId: typeof previewRow.externalId === 'string' ? previewRow.externalId : null,
        input: {
          accountId: plannedInput.accountId,
          amountCentavos: toCentavos(plannedInput.amount),
          type: plannedInput.type,
          description: plannedInput.description,
          category: plannedInput.category,
          date: plannedInput.date,
          notes: plannedInput.notes,
          status: plannedInput.status,
          source: plannedInput.source,
          note: plannedInput.note,
          ledgerTreatment: plannedInput.ledgerTreatment,
          reportingTreatment: plannedInput.reportingTreatment,
          stagingBatchId: plannedInput.stagingBatchId,
        },
      }
    })
    try {
      const atomicResult = executeAtomicImport({
        rawContent: fileContents.text,
        rows: atomicRows,
        options: {
          accountId: resolvedAccount.id,
          accountCurrency: resolvedAccount.currency,
          sourceNamespace: source,
          ledgerTreatment,
          reportingTreatment,
          stagingBatchId,
        },
        decisions,
        previewToken,
        apply: !previewOnly,
      })
      return {
        ...atomicResult,
        dryRun: previewOnly,
        applyRequired: previewOnly,
        file,
        account: importAccountOutput(resolvedAccount),
        supportedColumns: importSupportedColumns(),
        ignoredColumns: plan.unsupportedHeaders,
        ...(allowDuplicate
          ? {
              warning:
                'allowDuplicate is legacy-only and did not bypass conflicts. Submit candidate-specific decisions from requiredDecisions and preview again.',
            }
          : {}),
      }
    } catch (error) {
      return {
        success: false,
        reason: previewToken ? 'import_preview_stale_or_apply_failed' : 'csv_apply_failed',
        mode: previewToken ? 'reviewed_atomic' : 'unreviewed_atomic',
        file,
        account: importAccountOutput(resolvedAccount),
        message: error instanceof Error ? error.message : String(error),
      }
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
