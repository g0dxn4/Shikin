import {
  z,
  query,
  transaction,
  FINANCE_PROFILE_SETTING_KEY,
  type ToolDefinition,
} from './shared.js'
import { REDACTED_FIELD_PATTERN } from '../data-output.js'

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
      'currency',
      'category_id',
      'scope_json',
      'basis',
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
      'currency',
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
    name: 'classification_types',
    columns: ['id', 'current_revision_id', 'archived', 'created_at', 'updated_at'],
    orderBy: 'id ASC',
  },
  {
    name: 'classification_type_revisions',
    columns: ['id', 'type_id', 'version', 'name', 'financial_treatment', 'created_at'],
    orderBy: 'type_id ASC, version ASC, id ASC',
  },
  {
    name: 'transaction_consumption_classifications',
    columns: [
      'id',
      'transaction_id',
      'split_id',
      'role',
      'referenced_purchase_id',
      'type_revision_id',
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
    name: 'manual_exchange_rates',
    columns: [
      'id',
      'from_currency',
      'to_currency',
      'rate_decimal',
      'effective_from',
      'supersedes_rate_id',
      'source_note',
      'created_at',
    ],
    orderBy: 'effective_from ASC, created_at ASC, id ASC',
  },
  {
    name: 'transaction_fx_evidence',
    columns: [
      'id',
      'transaction_id',
      'original_transaction_id',
      'original_account_id',
      'transaction_type',
      'status',
      'ledger_treatment',
      'input_amount_centavos',
      'input_currency',
      'account_amount_centavos',
      'account_currency',
      'account_balance_delta_centavos',
      'transaction_date',
      'rate_id',
      'rate_decimal',
      'created_at',
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
  'classification_types',
  'classification_type_revisions',
  'source_coverage',
  'reconciliation_corrections',
  'transfer_match_provenance',
  'duplicate_review_decisions',
  'card_statement_payment_links',
  'app_data_state',
])

const REDACTED_SETTINGS_VALUE_KEYS = new Set([FINANCE_PROFILE_SETTING_KEY, 'account_aliases'])

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

export const exportData: ToolDefinition = {
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
