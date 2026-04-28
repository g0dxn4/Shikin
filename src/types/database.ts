import type {
  ULID,
  Money,
  DateStr,
  DateTimeStr,
  CurrencyCode,
  AccountType,
  TransactionType,
  BillingCycle,
  BudgetPeriod,
  InvestmentType,
  RecurringFrequency,
} from './common'

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

export interface Subcategory {
  id: ULID
  category_id: ULID
  name: string
  icon: string | null
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

export interface Subscription {
  id: ULID
  account_id: ULID | null
  category_id: ULID | null
  name: string
  amount: Money
  currency: CurrencyCode
  billing_cycle: BillingCycle
  next_billing_date: DateStr
  icon: string | null
  color: string | null
  url: string | null
  notes: string | null
  is_active: number
  created_at: DateTimeStr
  updated_at: DateTimeStr
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

export interface BudgetPeriodRecord {
  id: ULID
  budget_id: ULID
  start_date: DateStr
  end_date: DateStr
  spent: Money
  created_at: DateTimeStr
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

export interface ExchangeRate {
  id: ULID
  from_currency: CurrencyCode
  to_currency: CurrencyCode
  rate: number
  date: DateStr
  created_at: DateTimeStr
}

export interface Setting {
  key: string
  value: string
  updated_at: DateTimeStr
}

export interface ExtensionData {
  id: ULID
  extension_id: string
  key: string
  value: string
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
