import type {
  ULID,
  Money,
  DateStr,
  DateTimeStr,
  CurrencyCode,
  AccountType,
  TransactionType,
  BudgetPeriod,
  InvestmentType,
  RecurringFrequency,
} from './common'

export type TransactionStatus = 'pending' | 'posted' | 'cleared'
export type AccountMode = 'transactional' | 'snapshot_only'
export type LedgerTreatment = 'normal' | 'staged_no_balance_impact'
export type ReportingTreatment = 'normal' | 'exclude_from_cashflow'
export type TransactionKind = 'standard' | 'reconciliation_bridge' | 'archived_transfer_mirror'
export type PlaceholderTransactionStatus = 'unresolved' | 'resolved' | 'split' | 'cancelled'

export interface Account {
  id: ULID
  name: string
  type: AccountType
  currency: CurrencyCode
  balance: Money
  icon: string | null
  color: string | null
  is_archived: number
  is_primary?: number
  account_mode?: AccountMode
  credit_limit?: number
  statement_closing_day?: number
  payment_due_day?: number
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface Category {
  id: ULID
  name: string
  icon: string | null
  color: string | null
  type: TransactionType
  sort_order: number
  created_at: DateTimeStr
}

export interface Transaction {
  id: ULID
  account_id: ULID
  category_id: ULID | null
  subcategory_id: ULID | null
  type: TransactionType
  amount: Money
  currency: CurrencyCode
  description: string
  notes: string | null
  date: DateStr
  tags: string
  is_recurring: number
  transfer_to_account_id: ULID | null
  status?: TransactionStatus
  source?: string | null
  note?: string | null
  recurring_rule_id?: ULID | null
  ledger_treatment?: LedgerTreatment
  reporting_treatment?: ReportingTreatment
  transaction_kind?: TransactionKind
  staging_batch_id?: string | null
  reconciliation_id?: ULID | null
  matched_transaction_id?: ULID | null
  is_archived?: number
  is_placeholder?: number
  placeholder_status?: PlaceholderTransactionStatus | null
  resolved_at?: DateTimeStr | null
  resolved_by_transaction_id?: ULID | null
  placeholder_reason?: string | null
  placeholder_parent_transaction_id?: ULID | null
  import_source?: string | null
  import_external_id?: string | null
  import_fingerprint?: string | null
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface Receivable {
  id: ULID
  payer: string
  amount: Money
  received_amount: Money
  currency: CurrencyCode
  due_date: DateStr
  project_reference: string | null
  invoice_reference: string | null
  status: 'open' | 'partial' | 'received' | 'cancelled'
  account_id: ULID | null
  matched_transaction_id: ULID | null
  notes: string | null
  source: string | null
  note: string | null
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface TransactionSplit {
  id: ULID
  transaction_id: ULID
  category_id: ULID
  subcategory_id: ULID | null
  amount: Money
  notes: string | null
  created_at: DateTimeStr
}

export interface TransactionSplitWithCategory extends TransactionSplit {
  category_name: string
  category_color: string | null
  subcategory_name: string | null
}

export interface Budget {
  id: ULID
  category_id: ULID | null
  name: string
  amount: Money
  period: BudgetPeriod
  is_active: number
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface Investment {
  id: ULID
  account_id: ULID | null
  symbol: string
  name: string
  type: InvestmentType
  shares: number
  avg_cost_basis: Money
  currency: CurrencyCode
  notes: string | null
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface StockPrice {
  id: ULID
  symbol: string
  price: Money
  currency: CurrencyCode
  quote_currency: CurrencyCode
  date: DateStr
  created_at: DateTimeStr
}

export interface RecurringRule {
  id: ULID
  description: string
  amount: Money
  currency: CurrencyCode | null
  type: TransactionType
  frequency: RecurringFrequency
  next_date: DateStr
  end_date: DateStr | null
  account_id: ULID
  to_account_id: ULID | null
  category_id: ULID | null
  subcategory_id: ULID | null
  tags: string
  notes: string | null
  active: number
  anchor_kind: 'fixed_day' | 'end_of_month' | null
  anchor_day: number | null
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface Goal {
  id: ULID
  name: string
  target_amount: Money
  current_amount: Money
  deadline: DateStr | null
  account_id: ULID | null
  icon: string | null
  color: string | null
  notes: string | null
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface CategoryRule {
  id: ULID
  pattern: string
  category_id: ULID
  subcategory_id: ULID | null
  confidence: number
  hit_count: number
  created_at: DateTimeStr
  updated_at: DateTimeStr
}
