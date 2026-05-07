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
export type CategorySuggestionStatus = 'pending' | 'approved' | 'rejected'
export type CreditCardStatementStatus = 'open' | 'partial' | 'paid' | 'overdue'

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

export interface AuditLog {
  id: ULID
  entity: string
  entity_id: string | null
  action: string
  before_json: string | null
  after_json: string | null
  source: string | null
  note: string | null
  created_at: DateTimeStr
}

export interface CashflowBucket {
  id: ULID
  name: string
  description: string | null
  target_amount: Money | null
  balance: Money
  currency: CurrencyCode
  sort_order: number
  is_active: number
  created_at: DateTimeStr
  updated_at: DateTimeStr
}

export interface CashflowBucketAllocation {
  id: ULID
  bucket_id: ULID
  transaction_id: ULID | null
  amount: Money
  currency: CurrencyCode
  allocation_date: DateStr
  source: string | null
  note: string | null
  created_at: DateTimeStr
}

export interface CategorySuggestion {
  id: ULID
  transaction_id: ULID | null
  description: string
  suggested_category_id: ULID | null
  suggested_subcategory_id: ULID | null
  confidence: number
  status: CategorySuggestionStatus
  source: string | null
  note: string | null
  created_at: DateTimeStr
  reviewed_at: DateTimeStr | null
}

export interface CreditCardStatement {
  id: ULID
  account_id: ULID
  statement_start_date: DateStr | null
  statement_end_date: DateStr
  due_date: DateStr
  statement_balance: Money
  minimum_payment: Money
  paid_amount: Money
  currency: CurrencyCode
  status: CreditCardStatementStatus
  source: string | null
  note: string | null
  created_at: DateTimeStr
  updated_at: DateTimeStr
}
