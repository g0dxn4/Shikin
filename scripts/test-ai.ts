/**
 * CLI test for the AI agent with real LLM calls + mocked DB.
 *
 * Usage:
 *   pnpm test:ai "list my accounts"
 *   pnpm test:ai "add a $12.50 coffee expense"
 *   PROVIDER=openai API_KEY=sk-... MODEL=gpt-4o-mini pnpm test:ai "hello"
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

// unused — tools are defined inline with mock data
// import { createAgent } from '../src/ai/agent.js'

// ── Mock the database layer before anything imports it ──────────────────
// The tools import @/lib/database which needs Tauri. We intercept at the
// module level so every tool gets our fake data.

const MOCK_ACCOUNTS = [
  { id: 'acc-001', name: 'Chase Checking', type: 'checking', currency: 'USD', balance: 285043, is_archived: 0, icon: null, color: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
  { id: 'acc-002', name: 'Savings', type: 'savings', currency: 'USD', balance: 1250000, is_archived: 0, icon: null, color: null, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-06-01T00:00:00Z' },
]

const MOCK_CATEGORIES = [
  { id: 'cat-001', name: 'Food & Dining', type: 'expense', color: '#FF5722', icon: null, sort_order: 1, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-002', name: 'Transportation', type: 'expense', color: '#2196F3', icon: null, sort_order: 2, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-003', name: 'Shopping', type: 'expense', color: '#9C27B0', icon: null, sort_order: 3, created_at: '2024-01-01T00:00:00Z' },
  { id: 'cat-004', name: 'Salary', type: 'income', color: '#4CAF50', icon: null, sort_order: 4, created_at: '2024-01-01T00:00:00Z' },
]

const MOCK_TRANSACTIONS = [
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

// ── Register the mock via Node module hook ──────────────────────────────
// We use import.meta so tsx can resolve @/lib/database to our mock.

import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, next) {
  if (specifier === '@/lib/database' || specifier.endsWith('/lib/database')) {
    return { url: 'mock://database', shortCircuit: true }
  }
  if (specifier === '@/lib/ulid' || specifier.endsWith('/lib/ulid')) {
    return { url: 'mock://ulid', shortCircuit: true }
  }
  if (specifier === '@/lib/money' || specifier.endsWith('/lib/money')) {
    return { url: 'mock://money', shortCircuit: true }
  }
  return next(specifier, context)
}

export function load(url, context, next) {
  if (url === 'mock://database') {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export async function query() { return [] } export async function execute() { return { rowsAffected: 1, lastInsertId: 0 } }',
    }
  }
  if (url === 'mock://ulid') {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export function generateId() { return "01" + Math.random().toString(36).slice(2, 28).padEnd(24, "0") }',
    }
  }
  if (url === 'mock://money') {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export function toCentavos(n) { return Math.round(n * 100) } export function fromCentavos(n) { return n / 100 }',
    }
  }
  return next(url, context)
}
`), import.meta.url)

// ── The above won't apply to already-cached modules, so we also need
// a simpler approach: patch globalThis and use a wrapper. ────────────────
// Actually, tsx with register hooks is tricky. Let's just build a
// standalone agent that doesn't import the tool files.

// Instead, let's build a clean agent using AI SDK directly, defining
// tools inline with the same schemas but mock execute functions.

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText, tool, stepCountIs } from 'ai'
import { z } from 'zod'

// ── Config ──────────────────────────────────────────────────────────────

const provider = (process.env.PROVIDER || 'openrouter') as 'openrouter' | 'openai' | 'anthropic' | 'ollama'
const apiKey = process.env.API_KEY || process.env.OPENROUTER_API_KEY || ''
const modelId = process.env.MODEL || ''
const userMessage = process.argv[2] || 'List my accounts and give me a balance overview'

if (!apiKey && provider !== 'ollama') {
  console.error('❌ API_KEY env var required. Usage:')
  console.error('   API_KEY=sk-or-... pnpm test:ai "list my accounts"')
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

// ── Mock tool implementations (same schemas as real tools) ──────────────

function fromCentavos(n: number) { return n / 100 }
function toCentavos(n: number) { return Math.round(n * 100) }

const tools = {
  addTransaction: tool({
    description: 'Add a new financial transaction (expense, income, or transfer).',
    parameters: z.object({
      amount: z.number().positive().describe('Amount in main currency unit'),
      type: z.enum(['expense', 'income', 'transfer']),
      description: z.string(),
      category: z.string().optional(),
      date: z.string().optional(),
      notes: z.string().optional(),
    }),
    execute: async ({ amount, type, description, category, date }) => {
      const id = 'tx-new-' + Date.now()
      const txDate = date || '2026-02-26'
      const cat = MOCK_CATEGORIES.find(c => c.name.toLowerCase().includes((category || '').toLowerCase()))
      console.log(`  🔧 addTransaction: $${amount} ${type} "${description}" [${cat?.name || 'Uncategorized'}]`)
      MOCK_TRANSACTIONS.push({ id, account_id: 'acc-001', category_id: cat?.id || null, subcategory_id: null, type, amount: toCentavos(amount), currency: 'USD', description, notes: null, date: txDate, tags: '', is_recurring: 0, transfer_to_account_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return { success: true, transaction: { id, amount, type, description, category: cat?.name || 'Uncategorized', date: txDate }, message: `Added ${type}: $${amount.toFixed(2)} for "${description}"` }
    },
  }),

  getSpendingSummary: tool({
    description: 'Get spending by category for a time period.',
    parameters: z.object({
      period: z.enum(['week', 'month', 'year', 'custom']).optional().default('month'),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }),
    execute: async ({ period }) => {
      console.log(`  🔧 getSpendingSummary: period=${period}`)
      const expenses = MOCK_TRANSACTIONS.filter(t => t.type === 'expense')
      const totalExp = expenses.reduce((s, t) => s + t.amount, 0)
      const income = MOCK_TRANSACTIONS.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      return { period: { start: '2026-02-01', end: '2026-02-28' }, totalExpenses: fromCentavos(totalExp), totalIncome: fromCentavos(income), netSavings: fromCentavos(income - totalExp), byCategory: [], message: `Total spending: $${fromCentavos(totalExp).toFixed(2)}` }
    },
  }),

  updateTransaction: tool({
    description: 'Update an existing transaction.',
    parameters: z.object({
      transactionId: z.string(),
      amount: z.number().positive().optional(),
      type: z.enum(['expense', 'income', 'transfer']).optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      date: z.string().optional(),
      notes: z.string().optional(),
      accountId: z.string().optional(),
    }),
    execute: async ({ transactionId, amount, description }) => {
      console.log(`  🔧 updateTransaction: ${transactionId} → amount=${amount}, desc=${description}`)
      const tx = MOCK_TRANSACTIONS.find(t => t.id === transactionId)
      if (!tx) return { success: false, message: `Transaction ${transactionId} not found.` }
      if (amount !== undefined) tx.amount = toCentavos(amount)
      if (description !== undefined) tx.description = description
      return { success: true, transaction: { id: tx.id, amount: fromCentavos(tx.amount), type: tx.type, description: tx.description, date: tx.date }, message: `Updated transaction ${transactionId}` }
    },
  }),

  deleteTransaction: tool({
    description: 'Delete a transaction.',
    parameters: z.object({ transactionId: z.string() }),
    execute: async ({ transactionId }) => {
      console.log(`  🔧 deleteTransaction: ${transactionId}`)
      const idx = MOCK_TRANSACTIONS.findIndex(t => t.id === transactionId)
      if (idx === -1) return { success: false, message: `Transaction ${transactionId} not found.` }
      const [tx] = MOCK_TRANSACTIONS.splice(idx, 1)
      return { success: true, message: `Deleted ${tx.type}: $${fromCentavos(tx.amount).toFixed(2)} "${tx.description}"` }
    },
  }),

  queryTransactions: tool({
    description: 'Search and filter transactions.',
    parameters: z.object({
      accountId: z.string().optional(),
      categoryId: z.string().optional(),
      type: z.enum(['expense', 'income', 'transfer']).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    }),
    execute: async ({ type, startDate, endDate, search, limit }) => {
      console.log(`  🔧 queryTransactions: type=${type} search=${search} range=${startDate}..${endDate}`)
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
    parameters: z.object({ type: z.enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other']).optional() }),
    execute: async ({ type }) => {
      console.log(`  🔧 listAccounts: type=${type}`)
      let accs = MOCK_ACCOUNTS.filter(a => !a.is_archived)
      if (type) accs = accs.filter(a => a.type === type)
      return { accounts: accs.map(a => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, balance: fromCentavos(a.balance) })), message: `Found ${accs.length} account(s).` }
    },
  }),

  createAccount: tool({
    description: 'Create a new financial account.',
    parameters: z.object({
      name: z.string(),
      type: z.enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other']).optional().default('checking'),
      currency: z.string().optional().default('USD'),
      balance: z.number().optional().default(0),
    }),
    execute: async ({ name, type, currency, balance }) => {
      console.log(`  🔧 createAccount: "${name}" type=${type} balance=$${balance}`)
      const id = 'acc-new-' + Date.now()
      MOCK_ACCOUNTS.push({ id, name, type: type as any, currency, balance: toCentavos(balance), is_archived: 0, icon: null, color: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return { success: true, account: { id, name, type, currency, balance }, message: `Created ${type} account "${name}" with balance $${balance.toFixed(2)}` }
    },
  }),

  listCategories: tool({
    description: 'List available transaction categories.',
    parameters: z.object({ type: z.enum(['expense', 'income', 'transfer']).optional() }),
    execute: async ({ type }) => {
      console.log(`  🔧 listCategories: type=${type}`)
      let cats = [...MOCK_CATEGORIES]
      if (type) cats = cats.filter(c => c.type === type)
      return { categories: cats.map(c => ({ id: c.id, name: c.name, type: c.type, color: c.color })), message: `Found ${cats.length} categor${cats.length !== 1 ? 'ies' : 'y'}.` }
    },
  }),

  getBalanceOverview: tool({
    description: 'Get balance overview with month-over-month trends.',
    parameters: z.object({}),
    execute: async () => {
      console.log(`  🔧 getBalanceOverview`)
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
    parameters: z.object({ months: z.number().int().min(2).max(12).optional().default(3) }),
    execute: async ({ months }) => {
      console.log(`  🔧 analyzeSpendingTrends: months=${months}`)
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
}

// ── System prompt (same as agent.ts) ────────────────────────────────────

const SYSTEM_PROMPT = `You are Val, Valute's AI financial assistant. You help users manage their personal finances.

Personality:
- Casual but competent — you're a knowledgeable friend who happens to be great with money
- Bilingual — respond in the same language the user writes in (English or Spanish)
- Confirm actions after completing them with a brief summary
- When uncertain, ask clarifying questions before taking action

Capabilities:
- Add, update, and delete transactions (expenses, income, transfers)
- Search and filter transactions by date, category, account, or description
- Create and list accounts
- List categories
- Get a balance overview with month-over-month trends
- Analyze spending trends over multiple months with category breakdowns

Guidelines:
- All amounts are in the user's default currency unless specified
- Always confirm what you did after using a tool
- Be concise but helpful
- When the user mentions amounts, interpret them as the main currency unit (dollars, euros, etc.)
- If a date isn't specified, assume today
- Always query before answering data questions — never guess
- When deleting, confirm the item details before proceeding`

// ── Run ─────────────────────────────────────────────────────────────────

async function main() {
  const model = createModel()

  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log(`║  Valute AI CLI Test                                         ║`)
  console.log(`║  Provider: ${(provider + ' / ' + (modelId || 'default')).padEnd(48)}║`)
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log()
  console.log(`👤 User: ${userMessage}`)
  console.log()
  console.log('─── Tool calls ───')

  try {
    const result = await generateText({
      model,
      tools,
      system: SYSTEM_PROMPT,
      prompt: userMessage,
      stopWhen: stepCountIs(5),
      temperature: 0.7,
    })

    // Show step-by-step trace
    if (result.steps && result.steps.length > 0) {
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i]
        if (step.toolCalls && step.toolCalls.length > 0) {
          for (const tc of step.toolCalls) {
            const args = (tc as any).args || (tc as any).input || (tc as any).arguments || {}
            console.log(`  Step ${i + 1}: ${tc.toolName}(${JSON.stringify(args)})`)
          }
        }
        if (step.toolResults && step.toolResults.length > 0) {
          for (const tr of step.toolResults) {
            const resultStr = JSON.stringify(tr.result || tr) || '(empty)'
            console.log(`    → ${resultStr.slice(0, 200)}${resultStr.length > 200 ? '...' : ''}`)
          }
        } else if (step.toolCalls && step.toolCalls.length > 0) {
          console.log(`    → (no tool results in this step — finishReason: ${step.finishReason})`)
        }
      }
    }

    console.log()
    console.log('─── Response ───')
    console.log(`🤖 Val: ${result.text || '(no text response)'}`)
    console.log()
    console.log('─── Metadata ───')
    console.log(`  Finish reason: ${result.finishReason}`)
    console.log(`  Steps: ${result.steps?.length || 0}`)
    console.log(`  Tokens: ${result.usage?.totalTokens || '?'}`)

    // Debug: dump step finish reasons
    if (result.steps) {
      for (let i = 0; i < result.steps.length; i++) {
        const s = result.steps[i]
        console.log(`  Step ${i + 1} finishReason: ${s.finishReason}, toolCalls: ${s.toolCalls?.length || 0}, text: ${(s.text || '').slice(0, 50)}`)
      }
    }
  } catch (err: any) {
    console.error()
    console.error('❌ Error:', err.message)
    if (err.cause) console.error('  Cause:', err.cause?.message || err.cause)
    if (err.responseBody) console.error('  Body:', JSON.stringify(err.responseBody).slice(0, 300))
    if (err.statusCode) console.error('  Status:', err.statusCode)
    if (err.data) console.error('  Data:', JSON.stringify(err.data).slice(0, 300))
    process.exit(1)
  }
}

main()
