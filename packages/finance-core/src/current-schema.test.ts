// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  CURRENT_SHIKIN_MIGRATIONS,
  CURRENT_SHIKIN_SCHEMA,
  assertSupportedSchemaVersion,
  classificationTypesStatements,
  datedFxStatements,
} from './index.js'

const expectedMigrations = [
  '001_core_tables',
  '003_credit_cards',
  '004_category_rules',
  '005_recurring_rules',
  '006_goals',
  '007_recaps',
  '010_transaction_splits',
  '011_net_worth_snapshots',
  '012_account_balance_history',
  '013_recurring_rules_currency',
  '014_recurring_rules_currency_backfill',
  '015_primary_account',
  '016_cli_qol_foundation',
  '017_investment_type_cetes',
  '018_placeholder_transactions',
  '019_financial_semantics',
  '020_quote_recurrence_import_identity',
  '021_backend_remediation_foundation',
  '022_dated_fx',
  '023_classification_types',
  '024_scoped_budgets',
]
const expectedColumns = {
  _migrations: ['id', 'name', 'applied_at'],
  accounts: [
    'id',
    'name',
    'type',
    'currency',
    'balance',
    'is_archived',
    'is_primary',
    'credit_limit',
    'statement_closing_day',
    'payment_due_day',
    'account_mode',
  ],
  categories: ['id', 'name', 'type', 'sort_order'],
  subcategories: ['id', 'category_id', 'name'],
  transactions: [
    'id',
    'account_id',
    'type',
    'amount',
    'date',
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
    'reconciliation_id',
    'matched_transaction_id',
    'is_archived',
    'import_source',
    'import_external_id',
    'import_fingerprint',
  ],
  subscriptions: ['id', 'name', 'amount', 'billing_cycle', 'next_billing_date'],
  budgets: ['id', 'name', 'amount', 'period', 'currency', 'scope_json', 'basis'],
  budget_periods: ['id', 'budget_id', 'start_date', 'end_date', 'spent'],
  investments: ['id', 'symbol', 'name', 'type', 'shares'],
  stock_prices: ['id', 'symbol', 'price', 'currency', 'quote_currency', 'date'],
  exchange_rates: ['id', 'from_currency', 'to_currency', 'rate', 'date'],
  settings: ['key', 'value', 'updated_at'],
  extension_data: ['id', 'extension_id', 'key', 'value'],
  category_rules: ['id', 'pattern', 'category_id'],
  recurring_rules: [
    'id',
    'description',
    'amount',
    'currency',
    'account_id',
    'next_date',
    'anchor_kind',
    'anchor_day',
  ],
  goals: ['id', 'name', 'target_amount', 'current_amount'],
  recaps: ['id', 'type', 'period_start', 'period_end', 'summary'],
  transaction_splits: ['id', 'transaction_id', 'amount'],
  net_worth_snapshots: ['id', 'date', 'net_worth', 'currency'],
  account_balance_history: ['id', 'account_id', 'date', 'balance'],
  audit_log: [
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
  cashflow_buckets: [
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
  cashflow_bucket_allocations: [
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
  category_suggestions: [
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
  credit_card_statements: [
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
  account_reconciliations: [
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
    'statement_start_date',
    'statement_end_date',
    'source',
    'note',
    'created_at',
  ],
  receivables: [
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
}

const futureSchemaMessage =
  'Database schema is newer than this application supports. Upgrade the app, CLI and MCP together.'

describe('current schema contract', () => {
  it('pins ordered migration markers and the supported version', () => {
    expect(CURRENT_SHIKIN_MIGRATIONS).toEqual(expectedMigrations)
    expect(Number.parseInt(CURRENT_SHIKIN_MIGRATIONS.at(-1)!, 10)).toBe(24)
    expect(CURRENT_SCHEMA_VERSION).toBe(24)
  })

  it('pins the shared readiness table and column order', () => {
    expect(Object.entries(CURRENT_SHIKIN_SCHEMA)).toEqual(Object.entries(expectedColumns))
  })

  it.each(
    [
      [],
      [{ id: 24, name: '024_scoped_budgets' }],
      [{ id: 19, name: '019_financial_semantics' }],
      [{ name: '024_scoped_budgets' }],
      [{ id: 0, name: 'not-a-version' }],
    ].map((rows) => ({ rows }))
  )('accepts current/legacy migration evidence without imposing readiness: $rows', ({ rows }) => {
    expect(() => assertSupportedSchemaVersion(rows)).not.toThrow()
  })

  it.each(
    [
      [{ id: 25, name: '024_scoped_budgets' }],
      [{ id: 24, name: '025_future' }],
      [{ name: '025_future' }],
      [
        { id: 24, name: '024_scoped_budgets' },
        { id: 99, name: '099_future' },
      ],
    ].map((rows) => ({ rows }))
  )('retains the exact future-schema error for $rows', ({ rows }) => {
    expect(() => assertSupportedSchemaVersion(rows)).toThrowError(new Error(futureSchemaMessage))
  })

  it('keeps the native runtime schema literals aligned without a runtime loader', () => {
    const rust = readFileSync(
      new URL('../../../src-tauri/src/runtime_identity.rs', import.meta.url),
      'utf8'
    )
    expect(rust.match(/const CURRENT_SCHEMA_VERSION: i64 = (\d+);/)?.[1]).toBe(
      String(CURRENT_SCHEMA_VERSION)
    )
    expect(rust.match(/const CURRENT_SCHEMA_MIGRATION: &str = "([^"]+)";/)?.[1]).toBe(
      CURRENT_SHIKIN_MIGRATIONS.at(-1)
    )
  })
})

// Golden SHA-256 of the ordered JSON statement arrays captures every SQL byte, including
// whitespace and historical CHECK vocabularies. Recorded before moving or pinning code.
function statementDigest(statements: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(statements)).digest('hex')
}

describe('historical migration statement bytes', () => {
  it('pins 022 SQL for empty column maps', () => {
    const statements = datedFxStatements({})
    expect(statements).toHaveLength(23)
    expect(statementDigest(statements)).toBe(
      'a2ff76747b4807efc4f8c1c2ccdf0d4bd6503be1cf84200201921ec7d008a266'
    )
  })

  it('pins 022 SQL when both currency columns already exist', () => {
    const statements = datedFxStatements({ budgets: ['id', 'currency'], goals: ['id', 'currency'] })
    expect(statements).toHaveLength(21)
    expect(statementDigest(statements)).toBe(
      'b2382fc4b4bcee6b5834b7be5854e0c4ca442c57b847a1b9cf8ef19eaaff1986'
    )
  })

  it('pins the unconditional 023 rebuild SQL for empty or populated schemas', () => {
    // 023 deliberately takes no column map; populated graph preservation is covered in
    // backend-foundation-migration.test.ts against real SQLite and all three adapters.
    const statements = classificationTypesStatements()
    expect(statements).toHaveLength(34)
    expect(statementDigest(statements)).toBe(
      '39fca83d4b00b14edca5e31d81654204945db7288c75cf571995b6c512c732e0'
    )
  })
})
