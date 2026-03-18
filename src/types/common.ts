/** Integer centavos/cents — never use floats for money */
export type Money = number

/** ISO 8601 date string (YYYY-MM-DD) */
export type DateStr = string

/** ISO 8601 datetime string */
export type DateTimeStr = string

/** ULID string identifier */
export type ULID = string

/** Currency code (ISO 4217) */
export type CurrencyCode = string

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit_card'
  | 'cash'
  | 'investment'
  | 'crypto'
  | 'other'

export type TransactionType = 'expense' | 'income' | 'transfer'

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly'

export type InvestmentType = 'stock' | 'etf' | 'crypto' | 'bond' | 'mutual_fund' | 'other'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type MemoryCategory = 'preference' | 'fact' | 'goal' | 'behavior' | 'context'

export type RecurringFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
