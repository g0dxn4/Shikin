/**
 * CLI test suite for Ivy (Valute AI) with real LLM calls + mocked DB.
 *
 * Usage:
 *   pnpm test:ai                              # run all 8 scenarios
 *   pnpm test:ai "list my accounts"            # ad-hoc single prompt
 *   PROVIDER=anthropic API_KEY=sk-... pnpm test:ai
 *
 * Env vars:
 *   PROVIDER  — openrouter | openai | anthropic | ollama (default: openrouter)
 *   API_KEY   — your API key (required unless ollama)
 *   MODEL     — model id (optional, uses provider default)
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load .env file
try {
  const envPath = resolve(import.meta.dirname, '..', '.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const val = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* no .env file, that's fine */ }

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, tool, zodSchema, stepCountIs } from 'ai'
import { z } from 'zod'

// ── Config ──────────────────────────────────────────────────────────────

const provider = (process.env.PROVIDER || 'openrouter') as 'openrouter' | 'openai' | 'anthropic' | 'ollama'
const apiKey = process.env.API_KEY || process.env.OPENROUTER_API_KEY || ''
const modelId = process.env.MODEL || ''

if (!apiKey && provider !== 'ollama') {
  console.error('API_KEY env var required. Usage:')
  console.error('  API_KEY=sk-or-... pnpm test:ai "list my accounts"')
  process.exit(1)
}

// ── Create language model ───────────────────────────────────────────────

function createModel() {
  switch (provider) {
    case 'openrouter': {
      const or = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey, compatibility: 'compatible' })
      return or.chat(modelId || 'anthropic/claude-sonnet-4')
    }
    case 'openai': {
      const oai = createOpenAI({ apiKey })
      return oai(modelId || 'gpt-4o-mini')
    }
    case 'anthropic': {
      const ant = createAnthropic({ apiKey })
      return ant(modelId || 'claude-sonnet-4-20250514')
    }
    case 'ollama': {
      const oll = createOpenAI({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' })
      return oll(modelId || 'llama3.2')
    }
  }
}

// ── Mock data (shared across scenarios, state accumulates) ──────────────

const MOCK_ACCOUNTS: Array<{
  id: string; name: string; type: string; currency: string; balance: number; is_archived: number
  icon: string | null; color: string | null; created_at: string; updated_at: string
  credit_limit: number | null; statement_closing_day: number | null; payment_due_day: number | null
}> = [
  { id: 'acc-001', name: 'Chase Checking', type: 'checking', currency: 'USD', balance: 285043, is_archived: 0, icon: null, color: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z', credit_limit: null, statement_closing_day: null, payment_due_day: null },
  { id: 'acc-002', name: 'Savings', type: 'savings', currency: 'USD', balance: 1250000, is_archived: 0, icon: null, color: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z', credit_limit: null, statement_closing_day: null, payment_due_day: null },
  { id: 'acc-003', name: 'BBVA Platinum', type: 'credit_card', currency: 'MXN', balance: -850000, is_archived: 0, icon: null, color: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z', credit_limit: 3000000, statement_closing_day: 15, payment_due_day: 5 },
]

const MOCK_CATEGORIES = [
  { id: 'cat-001', name: 'Food & Dining', type: 'expense', color: '#FF5722', icon: null, sort_order: 1, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-002', name: 'Transportation', type: 'expense', color: '#2196F3', icon: null, sort_order: 2, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-003', name: 'Shopping', type: 'expense', color: '#9C27B0', icon: null, sort_order: 3, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-004', name: 'Salary', type: 'income', color: '#4CAF50', icon: null, sort_order: 4, created_at: '2024-01-01T00:00:00Z' },
]

const MOCK_TRANSACTIONS: Array<{
  id: string; account_id: string; category_id: string | null; subcategory_id: null
  type: string; amount: number; currency: string; description: string; notes: string | null
  date: string; tags: string; is_recurring: number; transfer_to_account_id: null
  created_at: string; updated_at: string
}> = [
  { id: 'tx-001', account_id: 'acc-001', category_id: 'cat-001', subcategory_id: null, type: 'expense', amount: 1250, currency: 'USD', description: 'Morning Coffee', notes: null, date: '2026-02-25', tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: '2026-02-25T08:00:00Z', updated_at: '2026-02-25T08:00:00Z' },
  { id: 'tx-002', account_id: 'acc-001', category_id: 'cat-002', subcategory_id: null, type: 'expense', amount: 3500, currency: 'USD', description: 'Uber ride', notes: null, date: '2026-02-24', tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: '2026-02-24T09:00:00Z', updated_at: '2026-02-24T09:00:00Z' },
  { id: 'tx-003', account_id: 'acc-001', category_id: 'cat-004', subcategory_id: null, type: 'income', amount: 500000, currency: 'USD', description: 'Monthly Salary', notes: null, date: '2026-02-01', tags: '', is_recurring: 1, transfer_to_account_id: null, created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
  { id: 'tx-004', account_id: 'acc-001', category_id: 'cat-003', subcategory_id: null, type: 'expense', amount: 8999, currency: 'USD', description: 'Amazon order', notes: 'Headphones', date: '2026-02-20', tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: '2026-02-20T14:00:00Z', updated_at: '2026-02-20T14:00:00Z' },
  { id: 'tx-005', account_id: 'acc-001', category_id: 'cat-001', subcategory_id: null, type: 'expense', amount: 4200, currency: 'USD', description: 'Lunch at Chipotle', notes: null, date: '2026-02-23', tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: '2026-02-23T12:00:00Z', updated_at: '2026-02-23T12:00:00Z' },
  // Previous month data for trends
  { id: 'tx-006', account_id: 'acc-001', category_id: 'cat-001', subcategory_id: null, type: 'expense', amount: 9800, currency: 'USD', description: 'Groceries', notes: null, date: '2026-01-15', tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: '2026-01-15T00:00:00Z', updated_at: '2026-01-15T00:00:00Z' },
  { id: 'tx-007', account_id: 'acc-001', category_id: 'cat-002', subcategory_id: null, type: 'expense', amount: 5000, currency: 'USD', description: 'Gas', notes: null, date: '2026-01-10', tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: 'tx-008', account_id: 'acc-001', category_id: 'cat-004', subcategory_id: null, type: 'income', amount: 500000, currency: 'USD', description: 'Monthly Salary', notes: null, date: '2026-01-01', tags: '', is_recurring: 1, transfer_to_account_id: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
]

const MOCK_MEMORIES: Array<{
  id: string; category: string; content: string; importance: number
  created_at: string; updated_at: string
}> = []

const MOCK_BUDGETS: Array<{
  id: string; category_id: string | null; name: string; amount: number; period: string; is_active: number
  created_at: string; updated_at: string
}> = [
  { id: 'bud-001', category_id: 'cat-001', name: 'Food & Dining Budget', amount: 50000, period: 'monthly', is_active: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
]

const MOCK_INVESTMENTS: Array<{
  id: string; account_id: string | null; symbol: string; name: string; type: string
  shares: number; avg_cost_basis: number; currency: string; notes: string | null
  created_at: string; updated_at: string
}> = [
  { id: 'inv-001', account_id: null, symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', shares: 10, avg_cost_basis: 15000, currency: 'USD', notes: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
  { id: 'inv-002', account_id: null, symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'etf', shares: 5, avg_cost_basis: 45000, currency: 'USD', notes: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
]

const MOCK_SUBSCRIPTIONS = [
  { id: 'sub-001', name: 'Netflix', amount: 15.99, currency: 'USD', billing_cycle: 'monthly', next_payment_date: '2026-03-15', category: 'Entertainment', status: 'active' },
  { id: 'sub-002', name: 'Spotify', amount: 10.99, currency: 'USD', billing_cycle: 'monthly', next_payment_date: '2026-03-01', category: 'Entertainment', status: 'active' },
  { id: 'sub-003', name: 'iCloud+', amount: 2.99, currency: 'USD', billing_cycle: 'monthly', next_payment_date: '2026-03-10', category: 'Cloud Storage', status: 'active' },
]

// ── Helpers ─────────────────────────────────────────────────────────────

function fromCentavos(n: number) { return n / 100 }
function toCentavos(n: number) { return Math.round(n * 100) }
let mockIdCounter = 0
function mockId(prefix: string) { return `${prefix}-${Date.now()}-${++mockIdCounter}` }

// ── Tools (AI SDK v6 — inputSchema + zodSchema) ────────────────────────

const tools = {
  addTransaction: tool({
    description: 'Add a new financial transaction (expense, income, or transfer).',
    inputSchema: zodSchema(z.object({
      amount: z.number().positive().describe('Amount in main currency unit'),
      type: z.enum(['expense', 'income', 'transfer']),
      description: z.string(),
      category: z.string().optional().describe('Category name to match'),
      date: z.string().optional().describe('ISO date string (YYYY-MM-DD)'),
      notes: z.string().optional(),
    })),
    execute: async ({ amount, type, description, category, date }) => {
      const id = mockId('tx')
      const txDate = date || '2026-02-26'
      const cat = MOCK_CATEGORIES.find(c => c.name.toLowerCase().includes((category || '').toLowerCase()))
      MOCK_TRANSACTIONS.push({ id, account_id: 'acc-001', category_id: cat?.id || null, subcategory_id: null, type, amount: toCentavos(amount), currency: 'USD', description, notes: null, date: txDate, tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return { success: true, transaction: { id, amount, type, description, category: cat?.name || 'Uncategorized', date: txDate }, message: `Added ${type}: $${amount.toFixed(2)} for "${description}"` }
    },
  }),

  getSpendingSummary: tool({
    description: 'Get spending by category for a time period.',
    inputSchema: zodSchema(z.object({
      period: z.enum(['week', 'month', 'year', 'custom']).optional().default('month'),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    })),
    execute: async ({ period }) => {
      const expenses = MOCK_TRANSACTIONS.filter(t => t.type === 'expense')
      const totalExp = expenses.reduce((s, t) => s + t.amount, 0)
      const income = MOCK_TRANSACTIONS.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const byCategory = MOCK_CATEGORIES.map(c => {
        const catExp = expenses.filter(t => t.category_id === c.id).reduce((s, t) => s + t.amount, 0)
        return { category: c.name, amount: fromCentavos(catExp), percentage: totalExp > 0 ? Math.round(catExp / totalExp * 100) : 0 }
      }).filter(c => c.amount > 0)
      return { period: { start: '2026-02-01', end: '2026-02-28', label: period }, totalExpenses: fromCentavos(totalExp), totalIncome: fromCentavos(income), netSavings: fromCentavos(income - totalExp), byCategory, message: `Total spending: $${fromCentavos(totalExp).toFixed(2)}` }
    },
  }),

  updateTransaction: tool({
    description: 'Update an existing transaction.',
    inputSchema: zodSchema(z.object({
      transactionId: z.string(),
      amount: z.number().positive().optional(),
      type: z.enum(['expense', 'income', 'transfer']).optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      date: z.string().optional(),
      notes: z.string().optional(),
      accountId: z.string().optional(),
    })),
    execute: async ({ transactionId, amount, description }) => {
      const tx = MOCK_TRANSACTIONS.find(t => t.id === transactionId)
      if (!tx) return { success: false, message: `Transaction ${transactionId} not found.` }
      if (amount !== undefined) tx.amount = toCentavos(amount)
      if (description !== undefined) tx.description = description
      return { success: true, transaction: { id: tx.id, amount: fromCentavos(tx.amount), type: tx.type, description: tx.description, date: tx.date }, message: `Updated transaction ${transactionId}` }
    },
  }),

  deleteTransaction: tool({
    description: 'Delete a transaction.',
    inputSchema: zodSchema(z.object({
      transactionId: z.string(),
    })),
    execute: async ({ transactionId }) => {
      const idx = MOCK_TRANSACTIONS.findIndex(t => t.id === transactionId)
      if (idx === -1) return { success: false, message: `Transaction ${transactionId} not found.` }
      const [tx] = MOCK_TRANSACTIONS.splice(idx, 1)
      return { success: true, message: `Deleted ${tx.type}: $${fromCentavos(tx.amount).toFixed(2)} "${tx.description}"` }
    },
  }),

  queryTransactions: tool({
    description: 'Search and filter transactions.',
    inputSchema: zodSchema(z.object({
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      type: z.enum(['expense', 'income', 'transfer']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    })),
    execute: async ({ type, startDate, endDate, search, limit }) => {
      let results = [...MOCK_TRANSACTIONS]
      if (type) results = results.filter(t => t.type === type)
      if (startDate) results = results.filter(t => t.date >= startDate)
      if (endDate) results = results.filter(t => t.date <= endDate)
      if (search) results = results.filter(t => t.description.toLowerCase().includes(search.toLowerCase()))
      results = results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
      return {
        transactions: results.map(t => ({ id: t.id, description: t.description, amount: fromCentavos(t.amount), type: t.type, category: MOCK_CATEGORIES.find(c => c.id === t.category_id)?.name || 'Uncategorized', account: MOCK_ACCOUNTS.find(a => a.id === t.account_id)?.name || 'Unknown', date: t.date, notes: t.notes })),
        count: results.length, totalMatched: results.length,
        message: results.length === 0 ? 'No transactions found.' : `Found ${results.length} transaction(s).`,
      }
    },
  }),

  listAccounts: tool({
    description: 'List all active accounts.',
    inputSchema: zodSchema(z.object({
      type: z.enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other']).optional(),
    })),
    execute: async ({ type }) => {
      let accs = MOCK_ACCOUNTS.filter(a => !a.is_archived)
      if (type) accs = accs.filter(a => a.type === type)
      return { accounts: accs.map(a => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: fromCentavos(a.balance) })), message: `Found ${accs.length} account(s).` }
    },
  }),

  createAccount: tool({
    description: 'Create a new financial account.',
    inputSchema: zodSchema(z.object({
      name: z.string(),
      type: z.enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other']).optional().default('checking'),
      currency: z.string().optional().default('USD'),
      balance: z.number().optional().default(0),
    })),
    execute: async ({ name, type, currency, balance }) => {
      const id = mockId('acc')
      MOCK_ACCOUNTS.push({ id, name, type: type as any, currency, balance: toCentavos(balance), is_archived: 0, icon: null, color: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return { success: true, account: { id, name, type, currency, balance }, message: `Created ${type} account "${name}" with balance $${balance.toFixed(2)}` }
    },
  }),

  listCategories: tool({
    description: 'List available transaction categories.',
    inputSchema: zodSchema(z.object({
      type: z.enum(['expense', 'income', 'transfer']).optional(),
    })),
    execute: async ({ type }) => {
      let cats = [...MOCK_CATEGORIES]
      if (type) cats = cats.filter(c => c.type === type)
      return { categories: cats.map(c => ({ id: c.id, name: c.name, type: c.type, color: c.color })), message: `Found ${cats.length} categor${cats.length !== 1 ? 'ies' : 'y'}.` }
    },
  }),

  getBalanceOverview: tool({
    description: 'Get balance overview with month-over-month trends.',
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      const total = MOCK_ACCOUNTS.reduce((s, a) => s + a.balance, 0)
      const currentExpenses = MOCK_TRANSACTIONS.filter(t => t.type === 'expense' && t.date >= '2026-02-01').reduce((s, t) => s + t.amount, 0)
      const currentIncome = MOCK_TRANSACTIONS.filter(t => t.type === 'income' && t.date >= '2026-02-01').reduce((s, t) => s + t.amount, 0)
      const prevExpenses = MOCK_TRANSACTIONS.filter(t => t.type === 'expense' && t.date >= '2026-01-01' && t.date < '2026-02-01').reduce((s, t) => s + t.amount, 0)
      const prevIncome = MOCK_TRANSACTIONS.filter(t => t.type === 'income' && t.date >= '2026-01-01' && t.date < '2026-02-01').reduce((s, t) => s + t.amount, 0)
      const currentNet = currentIncome - currentExpenses
      const prevNet = prevIncome - prevExpenses
      return {
        totalBalance: fromCentavos(total),
        accounts: MOCK_ACCOUNTS.map(a => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: fromCentavos(a.balance) })),
        monthlyChange: { current: fromCentavos(currentNet), previous: fromCentavos(prevNet), trend: currentNet > prevNet ? 'up' : currentNet < prevNet ? 'down' : 'stable' },
        message: `Total balance: $${fromCentavos(total).toFixed(2)} across ${MOCK_ACCOUNTS.length} accounts.`,
      }
    },
  }),

  analyzeSpendingTrends: tool({
    description: 'Analyze spending trends over multiple months.',
    inputSchema: zodSchema(z.object({
      months: z.number().int().min(2).max(12).optional().default(3),
    })),
    execute: async ({ months }) => {
      void months
      return {
        months: [
          { month: '2026-01', totalExpenses: fromCentavos(14800), totalIncome: fromCentavos(500000), net: fromCentavos(485200), topCategories: [{ category: 'Food & Dining', amount: fromCentavos(9800) }, { category: 'Transportation', amount: fromCentavos(5000) }] },
          { month: '2026-02', totalExpenses: fromCentavos(17951), totalIncome: fromCentavos(500000), net: fromCentavos(482049), topCategories: [{ category: 'Shopping', amount: fromCentavos(8999) }, { category: 'Food & Dining', amount: fromCentavos(5450) }, { category: 'Transportation', amount: fromCentavos(3500) }] },
        ],
        trends: [
          { category: 'Food & Dining', direction: 'down', changePercent: 44 },
          { category: 'Transportation', direction: 'down', changePercent: 30 },
        ],
        message: 'Analyzed 2 months of spending data.',
      }
    },
  }),

  // ── Memory tools ────────────────────────────────────────────────────────

  saveMemory: tool({
    description: 'Save or update a memory about the user. Use this to remember preferences, facts, goals, behaviors, or context across conversations.',
    inputSchema: zodSchema(z.object({
      content: z.string().describe('The memory content to save'),
      category: z.enum(['preference', 'fact', 'goal', 'behavior', 'context']).describe('Memory category'),
      importance: z.number().int().min(1).max(10).optional().default(5).describe('Importance level 1-10'),
      existingMemoryId: z.string().optional().describe('If updating an existing memory, pass its ID here'),
    })),
    execute: async ({ content, category, importance, existingMemoryId }) => {
      if (existingMemoryId) {
        const existing = MOCK_MEMORIES.find(m => m.id === existingMemoryId)
        if (!existing) return { success: false, message: `Memory with ID ${existingMemoryId} not found.` }
        existing.content = content
        existing.category = category
        existing.importance = importance
        existing.updated_at = new Date().toISOString()
        return { success: true, memoryId: existingMemoryId, action: 'updated' as const, message: `Updated memory: "${content}"` }
      }
      const id = mockId('mem')
      const now = new Date().toISOString()
      MOCK_MEMORIES.push({ id, category, content, importance, created_at: now, updated_at: now })
      return { success: true, memoryId: id, action: 'created' as const, message: `Saved new memory: "${content}"` }
    },
  }),

  recallMemories: tool({
    description: 'Search and retrieve saved memories about the user. Use this to recall preferences, facts, goals, or other stored information.',
    inputSchema: zodSchema(z.object({
      search: z.string().optional().describe('Search term to filter memories by content'),
      category: z.enum(['preference', 'fact', 'goal', 'behavior', 'context']).optional().describe('Filter by memory category'),
      limit: z.number().int().min(1).max(50).optional().default(20).describe('Maximum number of memories to return'),
    })),
    execute: async ({ search, category, limit }) => {
      let results = [...MOCK_MEMORIES]
      if (search) results = results.filter(m => m.content.toLowerCase().includes(search.toLowerCase()))
      if (category) results = results.filter(m => m.category === category)
      results = results.sort((a, b) => b.importance - a.importance).slice(0, limit)
      return {
        memories: results.map(m => ({ id: m.id, category: m.category, content: m.content, importance: m.importance })),
        count: results.length,
        message: results.length === 0 ? 'No memories found.' : `Found ${results.length} memory${results.length !== 1 ? 'ies' : ''}.`,
      }
    },
  }),

  forgetMemory: tool({
    description: 'Delete a specific memory. Use this when the user asks you to forget something.',
    inputSchema: zodSchema(z.object({
      memoryId: z.string().describe('The ID of the memory to delete'),
    })),
    execute: async ({ memoryId }) => {
      const idx = MOCK_MEMORIES.findIndex(m => m.id === memoryId)
      if (idx === -1) return { success: false, message: `Memory with ID ${memoryId} not found.` }
      const [mem] = MOCK_MEMORIES.splice(idx, 1)
      return { success: true, message: `Forgot memory: "${mem.content}"` }
    },
  }),

  // ── New tools ────────────────────────────────────────────────────────

  updateAccount: tool({
    description: 'Update an existing account.',
    inputSchema: zodSchema(z.object({
      accountId: z.string(),
      name: z.string().optional(),
      type: z.enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other']).optional(),
      currency: z.string().optional(),
      balance: z.number().optional(),
      creditLimit: z.number().optional(),
      statementClosingDay: z.number().int().min(1).max(31).optional(),
      paymentDueDay: z.number().int().min(1).max(31).optional(),
    })),
    execute: async ({ accountId, name, balance, creditLimit, statementClosingDay, paymentDueDay }) => {
      const acc = MOCK_ACCOUNTS.find(a => a.id === accountId)
      if (!acc) return { success: false, message: `Account ${accountId} not found.` }
      if (name !== undefined) acc.name = name
      if (balance !== undefined) acc.balance = toCentavos(balance)
      if (creditLimit !== undefined) acc.credit_limit = toCentavos(creditLimit)
      if (statementClosingDay !== undefined) acc.statement_closing_day = statementClosingDay
      if (paymentDueDay !== undefined) acc.payment_due_day = paymentDueDay
      return { success: true, message: `Updated account "${acc.name}".` }
    },
  }),

  deleteAccount: tool({
    description: 'Delete or archive an account.',
    inputSchema: zodSchema(z.object({
      accountId: z.string(),
    })),
    execute: async ({ accountId }) => {
      const idx = MOCK_ACCOUNTS.findIndex(a => a.id === accountId)
      if (idx === -1) return { success: false, message: `Account ${accountId} not found.` }
      const hasTx = MOCK_TRANSACTIONS.some(t => t.account_id === accountId)
      if (hasTx) {
        MOCK_ACCOUNTS[idx].is_archived = 1
        return { success: true, action: 'archived' as const, message: `Archived account "${MOCK_ACCOUNTS[idx].name}".` }
      }
      const [acc] = MOCK_ACCOUNTS.splice(idx, 1)
      return { success: true, action: 'deleted' as const, message: `Deleted account "${acc.name}".` }
    },
  }),

  getCreditCardStatus: tool({
    description: 'Get credit card status including balance, limit, utilization, and upcoming dates.',
    inputSchema: zodSchema(z.object({
      accountId: z.string().optional(),
    })),
    execute: async ({ accountId }) => {
      let cards = MOCK_ACCOUNTS.filter(a => a.type === 'credit_card' && !a.is_archived)
      if (accountId) cards = cards.filter(a => a.id === accountId)
      if (cards.length === 0) return { success: false, message: 'No credit cards found.' }
      const statuses = cards.map(c => ({
        id: c.id, name: c.name, currency: c.currency,
        currentBalance: fromCentavos(Math.abs(c.balance)),
        creditLimit: c.credit_limit ? fromCentavos(c.credit_limit) : null,
        availableCredit: c.credit_limit ? fromCentavos(c.credit_limit - Math.abs(c.balance)) : null,
        utilizationPercent: c.credit_limit ? Math.round(Math.abs(c.balance) / c.credit_limit * 100) : null,
        statementClosingDay: c.statement_closing_day,
        paymentDueDay: c.payment_due_day,
      }))
      return { success: true, cards: statuses, message: `${statuses.length} credit card(s) found.` }
    },
  }),

  createBudget: tool({
    description: 'Create a budget for a spending category.',
    inputSchema: zodSchema(z.object({
      categoryId: z.string().optional(),
      categoryName: z.string().optional(),
      amount: z.number().positive(),
      period: z.enum(['weekly', 'monthly', 'yearly']).optional().default('monthly'),
      name: z.string().optional(),
    })),
    execute: async ({ categoryName, amount, period, name }) => {
      const id = mockId('bud')
      const cat = MOCK_CATEGORIES.find(c => c.name.toLowerCase().includes((categoryName || '').toLowerCase()))
      const budgetName = name || (cat ? `${cat.name} Budget` : 'Budget')
      MOCK_BUDGETS.push({ id, category_id: cat?.id || null, name: budgetName, amount: toCentavos(amount), period, is_active: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return { success: true, budget: { id, name: budgetName, amount, period }, message: `Created ${period} budget "${budgetName}" for $${amount.toFixed(2)}.` }
    },
  }),

  getBudgetStatus: tool({
    description: 'Get budget status showing spending vs budget amount.',
    inputSchema: zodSchema(z.object({
      categoryId: z.string().optional(),
    })),
    execute: async ({ categoryId }) => {
      let budgets = MOCK_BUDGETS.filter(b => b.is_active)
      if (categoryId) budgets = budgets.filter(b => b.category_id === categoryId)
      const statuses = budgets.map(b => {
        const spent = MOCK_TRANSACTIONS.filter(t => t.type === 'expense' && t.category_id === b.category_id && t.date >= '2026-02-01').reduce((s, t) => s + t.amount, 0)
        return { id: b.id, name: b.name, budgetAmount: fromCentavos(b.amount), spentAmount: fromCentavos(spent), remaining: fromCentavos(b.amount - spent), percentUsed: b.amount > 0 ? Math.round(spent / b.amount * 100) : 0, period: b.period }
      })
      return { success: true, budgets: statuses, message: `${statuses.length} budget(s) found.` }
    },
  }),

  deleteBudget: tool({
    description: 'Delete a budget.',
    inputSchema: zodSchema(z.object({ budgetId: z.string() })),
    execute: async ({ budgetId }) => {
      const idx = MOCK_BUDGETS.findIndex(b => b.id === budgetId)
      if (idx === -1) return { success: false, message: `Budget ${budgetId} not found.` }
      const [b] = MOCK_BUDGETS.splice(idx, 1)
      return { success: true, message: `Deleted budget "${b.name}".` }
    },
  }),

  listSubscriptions: tool({
    description: 'List subscriptions from Subby.',
    inputSchema: zodSchema(z.object({
      activeOnly: z.boolean().optional().default(true),
    })),
    execute: async ({ activeOnly }) => {
      let subs = [...MOCK_SUBSCRIPTIONS]
      if (activeOnly) subs = subs.filter(s => s.status === 'active')
      const totalMonthly = subs.reduce((s, sub) => s + sub.amount, 0)
      return { success: true, subscriptions: subs, summary: { count: subs.length, estimatedMonthly: totalMonthly, estimatedYearly: totalMonthly * 12 }, message: `${subs.length} subscription(s). Monthly: $${totalMonthly.toFixed(2)}.` }
    },
  }),

  getSubscriptionSpending: tool({
    description: 'Analyze subscription spending grouped by category.',
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      const totalMonthly = MOCK_SUBSCRIPTIONS.reduce((s, sub) => s + sub.amount, 0)
      return { success: true, totals: { monthly: totalMonthly, yearly: totalMonthly * 12, subscriptionCount: MOCK_SUBSCRIPTIONS.length }, message: `${MOCK_SUBSCRIPTIONS.length} subscriptions. Monthly: $${totalMonthly.toFixed(2)}.` }
    },
  }),

  getNetWorth: tool({
    description: 'Calculate total net worth from accounts and investments.',
    inputSchema: zodSchema(z.object({})),
    execute: async () => {
      const assets = MOCK_ACCOUNTS.filter(a => a.type !== 'credit_card' && !a.is_archived).reduce((s, a) => s + a.balance, 0)
      const liabilities = MOCK_ACCOUNTS.filter(a => a.type === 'credit_card' && !a.is_archived).reduce((s, a) => s + Math.abs(a.balance), 0)
      const investments = MOCK_INVESTMENTS.reduce((s, i) => s + i.shares * fromCentavos(i.avg_cost_basis), 0)
      const netWorth = fromCentavos(assets) - fromCentavos(liabilities) + investments
      return { success: true, netWorth, totalAssets: fromCentavos(assets) + investments, totalLiabilities: fromCentavos(liabilities), message: `Net worth: $${netWorth.toFixed(2)}.` }
    },
  }),

  manageInvestment: tool({
    description: 'Add, update, or delete investments.',
    inputSchema: zodSchema(z.object({
      action: z.enum(['add', 'update', 'delete']),
      investmentId: z.string().optional(),
      name: z.string().optional(),
      symbol: z.string().optional(),
      type: z.enum(['stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'other']).optional(),
      shares: z.number().optional(),
      avgCost: z.number().optional(),
      currentPrice: z.number().optional(),
      currency: z.string().optional().default('USD'),
      accountId: z.string().optional(),
      notes: z.string().optional(),
    })),
    execute: async ({ action, investmentId, name, symbol, type, shares, avgCost }) => {
      if (action === 'add') {
        if (!name || !symbol) return { success: false, message: 'Name and symbol required.' }
        const id = mockId('inv')
        MOCK_INVESTMENTS.push({ id, account_id: null, symbol: symbol.toUpperCase(), name, type: type || 'stock', shares: shares || 0, avg_cost_basis: avgCost ? toCentavos(avgCost) : 0, currency: 'USD', notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        return { success: true, investment: { id, name, symbol }, message: `Added investment: ${name} (${symbol}).` }
      }
      if (action === 'delete' && investmentId) {
        const idx = MOCK_INVESTMENTS.findIndex(i => i.id === investmentId)
        if (idx === -1) return { success: false, message: `Investment ${investmentId} not found.` }
        const [inv] = MOCK_INVESTMENTS.splice(idx, 1)
        return { success: true, message: `Deleted investment "${inv.name}".` }
      }
      return { success: false, message: 'Invalid action or missing parameters.' }
    },
  }),

  getUpcomingBills: tool({
    description: 'Get upcoming bills from credit cards, subscriptions, and recurring expenses.',
    inputSchema: zodSchema(z.object({
      daysAhead: z.number().int().min(1).max(90).optional().default(30),
    })),
    execute: async ({ daysAhead }) => {
      const bills: Array<{ name: string; amount: number; dueDate: string; source: string; daysUntilDue: number }> = []
      // Credit card payments
      for (const acc of MOCK_ACCOUNTS.filter(a => a.type === 'credit_card' && a.payment_due_day)) {
        bills.push({ name: `${acc.name} payment`, amount: fromCentavos(Math.abs(acc.balance)), dueDate: `2026-03-${String(acc.payment_due_day!).padStart(2, '0')}`, source: 'credit_card', daysUntilDue: acc.payment_due_day! })
      }
      // Subscriptions
      for (const sub of MOCK_SUBSCRIPTIONS) {
        if (sub.next_payment_date) bills.push({ name: sub.name, amount: sub.amount, dueDate: sub.next_payment_date, source: 'subscription', daysUntilDue: 15 })
      }
      const totalDue = bills.reduce((s, b) => s + b.amount, 0)
      return { success: true, bills, summary: { count: bills.length, totalAmount: totalDue, daysAhead }, message: `${bills.length} upcoming bill(s), total: $${totalDue.toFixed(2)}.` }
    },
  }),
}

// ── System prompt (synced with src/ai/agent.ts) ─────────────────────────

const SYSTEM_PROMPT = `You are Ivy, Valute's AI financial assistant. You help users manage their personal finances.

Personality:
- Casual but competent — you're a knowledgeable friend who happens to be great with money
- Bilingual — respond in the same language the user writes in (English or Spanish)
- Confirm actions after completing them with a brief summary
- When uncertain, ask clarifying questions before taking action

Capabilities:
- Add, update, and delete transactions (expenses, income, transfers)
- Search and filter transactions by date, category, account, or description
- Create, update, and delete accounts
- List categories
- Get a balance overview with month-over-month trends
- Analyze spending trends over multiple months with category breakdowns
- Remember and recall user preferences, facts, goals, and context across conversations
- Credit card management: track limits, statement closing dates, payment due dates, utilization
- Budget tracking: create budgets per category, monitor spending vs budget
- Subscription tracking: view subscriptions from Subby, analyze subscription costs
- Net worth: calculate total net worth including investments
- Investment management: add, update, and delete investment holdings
- Bill reminders: see upcoming bills from credit cards, subscriptions, and recurring expenses

Memory Management (IMPORTANT — you are a persistent assistant with personal memory):
- You MUST actively maintain a personal memory log about the user. This is core to who you are as Ivy.
- After EVERY meaningful interaction, save what you learned: preferences, habits, financial details, life context, goals, decisions, recurring patterns, and anything that would help you be a better financial assistant next time.
- Examples of things to ALWAYS save: currency preferences, income sources, spending habits, account names, financial goals, family/life context that affects finances, recurring expenses, preferred categories, budgeting style, risk tolerance.
- Use recallMemories at the START of conversations or when context would help — don't wait to be asked.
- Use forgetMemory when the user explicitly asks you to forget something.
- When updating a memory, use the existingMemoryId parameter to update rather than creating duplicates.
- Assign higher importance (7-10) to preferences, goals, and recurring patterns. Use lower importance (3-5) for one-off context.
- Think of your memory as your personal journal about this user — the more you know, the better you serve them.

Guidelines:
- All amounts are in the user's default currency unless specified
- Always confirm what you did after using a tool
- Be concise but helpful
- When the user mentions amounts, interpret them as the main currency unit (dollars, euros, etc.)
- If a date isn't specified, assume today
- Always query before answering data questions — never guess
- When deleting, confirm the item details before proceeding`

// ── Test scenarios ──────────────────────────────────────────────────────

interface Scenario {
  name: string
  prompt: string
  expectedTools: string[]
}

const SCENARIOS: Scenario[] = [
  {
    name: 'Account overview',
    prompt: 'List my accounts and give a balance overview',
    expectedTools: ['listAccounts', 'getBalanceOverview'],
  },
  {
    name: 'Add transaction',
    prompt: 'Add a $15.50 lunch expense at Chipotle',
    expectedTools: ['addTransaction'],
  },
  {
    name: 'Spending query',
    prompt: 'How much did I spend on food this month?',
    expectedTools: ['queryTransactions', 'getSpendingSummary'],
  },
  {
    name: 'Save memory',
    prompt: 'Remember that I prefer MXN and I live in Mexico',
    expectedTools: ['saveMemory'],
  },
  {
    name: 'Recall memory (currency)',
    prompt: 'What currency do I prefer?',
    expectedTools: ['recallMemories'],
  },
  {
    name: 'Recall memory (all)',
    prompt: 'Show all my memories',
    expectedTools: ['recallMemories'],
  },
  {
    name: 'Create account',
    prompt: 'Create a BBVA checking account with 5000 pesos',
    expectedTools: ['createAccount'],
  },
  {
    name: 'Spending trends',
    prompt: 'Analyze my spending trends',
    expectedTools: ['analyzeSpendingTrends'],
  },
  {
    name: 'Credit card status',
    prompt: "What's my credit card utilization?",
    expectedTools: ['getCreditCardStatus'],
  },
  {
    name: 'Create budget',
    prompt: 'Create a $500 monthly food budget',
    expectedTools: ['createBudget'],
  },
  {
    name: 'Net worth',
    prompt: "What's my net worth?",
    expectedTools: ['getNetWorth'],
  },
  {
    name: 'Upcoming bills',
    prompt: 'What bills do I have coming up?',
    expectedTools: ['getUpcomingBills'],
  },
]

// ── Runner ──────────────────────────────────────────────────────────────

/** Collect all tool names called during a generateText run */
function collectToolCalls(steps: Array<{ toolCalls?: Array<{ toolName: string }> }>): string[] {
  const names: string[] = []
  for (const step of steps) {
    if (step.toolCalls) {
      for (const tc of step.toolCalls) names.push(tc.toolName)
    }
  }
  return names
}

async function runPrompt(model: ReturnType<typeof createModel>, prompt: string) {
  const result = await generateText({
    model,
    tools,
    system: SYSTEM_PROMPT,
    prompt,
    stopWhen: stepCountIs(8),
    temperature: 0.7,
  })

  const toolsCalled = collectToolCalls(result.steps || [])
  return { text: result.text || '', toolsCalled, steps: result.steps || [], usage: result.usage }
}

function checkPass(toolsCalled: string[], expectedTools: string[]): boolean {
  // Pass if at least one of the expected tools was called
  return expectedTools.some(t => toolsCalled.includes(t))
}

async function runScenario(model: ReturnType<typeof createModel>, scenario: Scenario, index: number): Promise<boolean> {
  console.log(`\n┌─ Scenario ${index + 1}/${SCENARIOS.length}: ${scenario.name} ${'─'.repeat(Math.max(0, 46 - scenario.name.length))}┐`)
  console.log(`│  Prompt: "${scenario.prompt}"`)
  console.log(`│  Expected: ${scenario.expectedTools.join(' | ')}`)

  try {
    const { text, toolsCalled, usage } = await runPrompt(model, scenario.prompt)
    const passed = checkPass(toolsCalled, scenario.expectedTools)

    console.log(`│  Tools called: ${toolsCalled.length > 0 ? toolsCalled.join(', ') : '(none)'}`)
    console.log(`│  Tokens: ${usage?.totalTokens || '?'}`)
    console.log(`│  Response: ${text.slice(0, 120)}${text.length > 120 ? '...' : ''}`)
    console.log(`└─ ${passed ? 'PASS' : 'FAIL'} ${'─'.repeat(57)}┘`)

    return passed
  } catch (err: any) {
    console.log(`│  Error: ${err.message}`)
    console.log(`└─ FAIL (error) ${'─'.repeat(50)}┘`)
    return false
  }
}

async function runSuite() {
  const model = createModel()

  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log(`║  Valute AI Test Suite — ${String(SCENARIOS.length).padEnd(2)} scenarios${' '.repeat(33)}║`)
  console.log(`║  Provider: ${(provider + ' / ' + (modelId || 'default')).padEnd(52)}║`)
  console.log('╚══════════════════════════════════════════════════════════════════╝')

  const results: boolean[] = []
  for (let i = 0; i < SCENARIOS.length; i++) {
    const passed = await runScenario(model, SCENARIOS[i], i)
    results.push(passed)
  }

  // Summary
  const passed = results.filter(Boolean).length
  const total = results.length
  console.log('\n═══════════════════════════════════════════════════════════════════')
  console.log(`  Results: ${passed}/${total} passed`)
  console.log()
  for (let i = 0; i < SCENARIOS.length; i++) {
    console.log(`  ${results[i] ? 'PASS' : 'FAIL'}  ${i + 1}. ${SCENARIOS[i].name}`)
  }
  console.log('═══════════════════════════════════════════════════════════════════')

  // Mock state summary
  console.log(`\n  Mock state: ${MOCK_ACCOUNTS.length} accounts, ${MOCK_TRANSACTIONS.length} transactions, ${MOCK_MEMORIES.length} memories, ${MOCK_BUDGETS.length} budgets, ${MOCK_INVESTMENTS.length} investments`)
  if (MOCK_MEMORIES.length > 0) {
    console.log('  Memories:')
    for (const m of MOCK_MEMORIES) {
      console.log(`    [${m.category}] "${m.content}" (importance: ${m.importance})`)
    }
  }

  process.exit(passed === total ? 0 : 1)
}

async function runAdHoc(prompt: string) {
  const model = createModel()

  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log(`║  Valute AI CLI Test (ad-hoc)${' '.repeat(36)}║`)
  console.log(`║  Provider: ${(provider + ' / ' + (modelId || 'default')).padEnd(52)}║`)
  console.log('╚══════════════════════════════════════════════════════════════════╝')
  console.log()
  console.log(`User: ${prompt}`)
  console.log()

  try {
    const { text, toolsCalled, steps, usage } = await runPrompt(model, prompt)

    // Show step-by-step trace
    if (steps.length > 0) {
      console.log('--- Tool calls ---')
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const tc of step.toolCalls) {
            const args = (tc as any).args || (tc as any).input || {}
            console.log(`  Step ${i + 1}: ${tc.toolName}(${JSON.stringify(args)})`)
          }
        }
        if (step.toolResults && step.toolResults.length > 0) {
          for (const tr of step.toolResults) {
            const resultStr = JSON.stringify((tr as any).result || tr) || '(empty)'
            console.log(`    -> ${resultStr.slice(0, 200)}${resultStr.length > 200 ? '...' : ''}`)
          }
        }
      }
      console.log()
    }

    console.log('--- Response ---')
    console.log(`Ivy: ${text}`)
    console.log()
    console.log(`--- Metadata ---`)
    console.log(`  Tools: ${toolsCalled.join(', ') || '(none)'}`)
    console.log(`  Steps: ${steps.length}`)
    console.log(`  Tokens: ${usage?.totalTokens || '?'}`)
  } catch (err: any) {
    console.error()
    console.error('Error:', err.message)
    if (err.cause) console.error('  Cause:', err.cause?.message || err.cause)
    if (err.statusCode) console.error('  Status:', err.statusCode)
    process.exit(1)
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const userArg = process.argv[2]

if (userArg) {
  runAdHoc(userArg)
} else {
  runSuite()
}
