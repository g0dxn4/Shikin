// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import dayjs from 'dayjs'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as InsightsModule from './insights.js'
import type * as OsModule from 'node:os'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'

const tempDirs = new Set<string>()
const cleanupCallbacks = new Set<() => void>()

function cents(amount: number): number {
  return Math.round(amount * 100)
}

function createTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shikin-insights-sqlite-'))
  tempDirs.add(dir)
  return dir
}

function getDbPath(tempHome: string): string {
  return join(tempHome, '.local', 'share', 'com.asf.shikin', 'shikin.db')
}

function seedDatabase(tempHome: string, seed: (db: Database.Database) => void): string {
  const dbPath = getDbPath(tempHome)
  mkdirSync(join(tempHome, '.local', 'share', 'com.asf.shikin'), { recursive: true })

  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other')),
      currency TEXT NOT NULL DEFAULT 'USD',
      balance INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      credit_limit INTEGER,
      statement_closing_day INTEGER,
      payment_due_day INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      icon TEXT,
      color TEXT,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      subcategory_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      description TEXT NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      transfer_to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE subscriptions (
      id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('weekly', 'monthly', 'quarterly', 'yearly')),
      next_billing_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE budgets (
      id TEXT PRIMARY KEY,
      category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      amount INTEGER NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'yearly')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE recaps (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('weekly', 'monthly')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      highlights_json TEXT NOT NULL DEFAULT '[]',
      generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `)

  for (const migration of CLI_DATABASE_MIGRATIONS) {
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(
      Number(migration.slice(0, 3)),
      migration
    )
  }
  seed(db)
  db.close()

  return dbPath
}

async function loadInsights(tempHome: string): Promise<typeof InsightsModule> {
  vi.resetModules()
  vi.stubEnv('HOME', tempHome)
  vi.stubEnv('XDG_DATA_HOME', '')
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof OsModule>('node:os')
    return {
      ...actual,
      homedir: () => tempHome,
    }
  })

  const insightsModule = await import('./insights.js')
  const databaseModule = await import('./database.js')
  cleanupCallbacks.add(() => databaseModule.close())
  return insightsModule
}

afterEach(() => {
  for (const cleanup of cleanupCallbacks) cleanup()
  cleanupCallbacks.clear()

  vi.doUnmock('node:os')
  vi.unstubAllEnvs()
  vi.resetModules()

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('insights summaries with a real temporary SQLite database', () => {
  it('detectSpendingAnomaliesSummary evaluates large thresholds per transaction currency', async () => {
    const tempHome = createTempHome()
    seedDatabase(tempHome, (db) => {
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('acct-usd', 'USD Checking', 'checking', 'USD', cents(1_500), 0)
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('acct-brl', 'BRL Cash', 'cash', 'BRL', cents(2_000), 0)

      db.prepare(`INSERT INTO categories (id, name, type) VALUES (?, ?, ?)`).run(
        'cat-food',
        'Food & Dining',
        'expense'
      )

      db.prepare(
        `INSERT INTO transactions
          (id, account_id, category_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, 'expense', ?, ?, ?, ?)`
      ).run(
        'tx-usd-large',
        'acct-usd',
        'cat-food',
        cents(150),
        'USD',
        'Flight booking',
        dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      )

      db.prepare(
        `INSERT INTO transactions
          (id, account_id, category_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, 'expense', ?, ?, ?, ?)`
      ).run(
        'tx-brl-small',
        'acct-brl',
        'cat-food',
        cents(80),
        'BRL',
        'Taxi home',
        dayjs().subtract(2, 'day').format('YYYY-MM-DD')
      )
    })

    const insights = await loadInsights(tempHome)
    const result = await insights.detectSpendingAnomaliesSummary(100)

    expect(result.success).toBe(true)
    expect(result.largeTransactionThresholdCurrencyMode).toBe('per_transaction_currency')
    expect(result.message).toContain('independently within each currency')

    const largeTransactionAnomalies = result.anomalies.filter(
      (anomaly) => anomaly.type === 'large_transaction'
    )
    expect(largeTransactionAnomalies).toEqual([
      expect.objectContaining({
        transactionId: 'tx-usd-large',
        severity: 'medium',
        title: 'Large transaction: Flight booking',
        amount: 150,
      }),
    ])
  })

  it('generateCashFlowForecastSummary returns per-currency forecasts with mixed ledgers', async () => {
    const tempHome = createTempHome()
    seedDatabase(tempHome, (db) => {
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('acct-usd', 'USD Checking', 'checking', 'USD', cents(1_000), 0)
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('acct-brl', 'BRL Savings', 'savings', 'BRL', cents(800), 0)

      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'tx-usd-income',
        'acct-usd',
        'income',
        cents(900),
        'USD',
        'Payroll',
        dayjs().subtract(10, 'day').format('YYYY-MM-DD')
      )
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'tx-usd-expense',
        'acct-usd',
        'expense',
        cents(300),
        'USD',
        'Rent',
        dayjs().subtract(5, 'day').format('YYYY-MM-DD')
      )
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'tx-brl-income',
        'acct-brl',
        'income',
        cents(500),
        'BRL',
        'Client payment',
        dayjs().subtract(12, 'day').format('YYYY-MM-DD')
      )
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'tx-brl-expense',
        'acct-brl',
        'expense',
        cents(450),
        'BRL',
        'Groceries',
        dayjs().subtract(4, 'day').format('YYYY-MM-DD')
      )

      db.prepare(
        `INSERT INTO subscriptions
          (id, account_id, name, amount, currency, billing_cycle, next_billing_date, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'sub-usd',
        'acct-usd',
        'Cloud storage',
        cents(20),
        'USD',
        'monthly',
        dayjs().add(5, 'day').format('YYYY-MM-DD'),
        1
      )
      db.prepare(
        `INSERT INTO subscriptions
          (id, account_id, name, amount, currency, billing_cycle, next_billing_date, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'sub-brl',
        'acct-brl',
        'Streaming',
        cents(35),
        'BRL',
        'monthly',
        dayjs().add(7, 'day').format('YYYY-MM-DD'),
        1
      )
    })

    const insights = await loadInsights(tempHome)
    const result = await insights.generateCashFlowForecastSummary(10)
    const forecasts = result.forecastsByCurrency ?? []

    expect(result.success).toBe(true)
    expect(result.forecast).toBeNull()
    expect(forecasts).toHaveLength(2)
    expect(result.message).toContain('no FX conversion was applied')
    expect(forecasts.map((forecast) => forecast.currency).sort()).toEqual(['BRL', 'USD'])
    expect(forecasts).toEqual([
      expect.objectContaining({
        currency: 'BRL',
        currentBalance: 800,
        dailyIncome: 5.56,
        dailyBurnRate: 5,
        minBalance: { amount: 800, date: dayjs().format('YYYY-MM-DD') },
        dangerDates: [],
        points: expect.arrayContaining([
          expect.objectContaining({ date: dayjs().format('YYYY-MM-DD'), projected: 800 }),
          expect.objectContaining({
            date: dayjs().add(10, 'day').format('YYYY-MM-DD'),
            projected: 805.56,
          }),
        ]),
      }),
      expect.objectContaining({
        currency: 'USD',
        currentBalance: 1000,
        dailyIncome: 10,
        dailyBurnRate: 3.33,
        minBalance: { amount: 1000, date: dayjs().format('YYYY-MM-DD') },
        dangerDates: [],
        points: expect.arrayContaining([
          expect.objectContaining({ date: dayjs().format('YYYY-MM-DD'), projected: 1000 }),
          expect.objectContaining({
            date: dayjs().add(10, 'day').format('YYYY-MM-DD'),
            projected: 1066.67,
          }),
        ]),
      }),
    ])
  })

  it('calculateFinancialHealthScoreSummary reports mixed-currency scores explicitly', async () => {
    const tempHome = createTempHome()
    seedDatabase(tempHome, (db) => {
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('sav-usd', 'USD Savings', 'savings', 'USD', cents(3_000), 0)
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('sav-brl', 'BRL Savings', 'savings', 'BRL', cents(1_200), 0)
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('cc-usd', 'USD Credit Card', 'credit_card', 'USD', -cents(400), 0)

      const thisMonth = dayjs().format('YYYY-MM-DD')
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('tx-usd-inc', 'sav-usd', 'income', cents(2_000), 'USD', 'Salary', thisMonth)
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('tx-usd-exp', 'sav-usd', 'expense', cents(800), 'USD', 'Rent', thisMonth)
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('tx-brl-inc', 'sav-brl', 'income', cents(1_200), 'BRL', 'Freelance', thisMonth)
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run('tx-brl-exp', 'sav-brl', 'expense', cents(700), 'BRL', 'Bills', thisMonth)
    })

    const insights = await loadInsights(tempHome)
    const result = await insights.calculateFinancialHealthScoreSummary()
    const scoresByCurrency = result.score.scoresByCurrency ?? []

    expect(result.success).toBe(true)
    expect(result.score.mixedCurrency).toBe(true)
    expect(result.score.overall).toBeNull()
    expect(result.score.omittedSubscores).toContain('Budget Adherence')
    expect(scoresByCurrency).toHaveLength(2)
    expect(scoresByCurrency).toEqual([
      expect.objectContaining({
        currency: 'BRL',
        overall: 91,
        grade: 'A',
        omittedSubscores: ['Budget Adherence'],
        subscores: expect.arrayContaining([
          expect.objectContaining({ name: 'Savings Rate', score: 100 }),
          expect.objectContaining({ name: 'Debt-to-Income', score: 100 }),
          expect.objectContaining({ name: 'Emergency Fund', score: 100 }),
          expect.objectContaining({ name: 'Spending Consistency', score: 50 }),
        ]),
      }),
      expect.objectContaining({
        currency: 'USD',
        overall: 81,
        grade: 'B',
        omittedSubscores: ['Budget Adherence'],
        subscores: expect.arrayContaining([
          expect.objectContaining({ name: 'Savings Rate', score: 100 }),
          expect.objectContaining({ name: 'Debt-to-Income', score: 60 }),
          expect.objectContaining({ name: 'Emergency Fund', score: 100 }),
          expect.objectContaining({ name: 'Spending Consistency', score: 50 }),
        ]),
      }),
    ])
    expect(result.message).toContain('Budget adherence is omitted')
  })

  it('generateSpendingRecapSummary stores a mixed-currency weekly recap record', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase(tempHome, (db) => {
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('acct-usd', 'USD Checking', 'checking', 'USD', cents(2_500), 0)
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('acct-brl', 'BRL Checking', 'checking', 'BRL', cents(2_500), 0)
      db.prepare(`INSERT INTO categories (id, name, type) VALUES (?, ?, ?)`).run(
        'cat-food',
        'Food & Dining',
        'expense'
      )

      db.prepare(
        `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'wk-usd-exp',
        'acct-usd',
        'cat-food',
        'expense',
        cents(120),
        'USD',
        'Market',
        dayjs().subtract(2, 'day').format('YYYY-MM-DD')
      )
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'wk-usd-inc',
        'acct-usd',
        'income',
        cents(900),
        'USD',
        'Payroll',
        dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      )
      db.prepare(
        `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'wk-brl-exp',
        'acct-brl',
        'cat-food',
        'expense',
        cents(80),
        'BRL',
        'Feira',
        dayjs().subtract(3, 'day').format('YYYY-MM-DD')
      )
      db.prepare(
        `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        'wk-brl-inc',
        'acct-brl',
        'income',
        cents(400),
        'BRL',
        'Consulting',
        dayjs().subtract(1, 'day').format('YYYY-MM-DD')
      )
    })

    const insights = await loadInsights(tempHome)
    const result = (await insights.generateSpendingRecapSummary(
      'weekly',
      dayjs().format('YYYY-MM-DD')
    )) as { success: boolean; totalsByCurrency: Array<{ currency: string }>; message: string }

    expect(result.success).toBe(true)
    expect(result.totalsByCurrency).toHaveLength(2)
    expect(result.message).toContain('no FX conversion was applied')

    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const recapCount = db.prepare('SELECT COUNT(*) AS total FROM recaps').get() as {
        total: number
      }
      expect(recapCount.total).toBe(1)

      const recap = db.prepare('SELECT type, title, summary FROM recaps LIMIT 1').get() as {
        type: string
        title: string
        summary: string
      }
      expect(recap.type).toBe('weekly')
      expect(recap.title).toContain('Weekly Recap')
      expect(recap.summary).toContain('spans 2 currencies')
      expect(recap.summary).toContain('USD: spent $120.00 and earned $900.00.')
      expect(recap.summary).toContain('BRL: spent R$80.00 and earned R$400.00.')

      const persisted = db
        .prepare('SELECT period_start, period_end, highlights_json FROM recaps LIMIT 1')
        .get() as {
        period_start: string
        period_end: string
        highlights_json: string
      }
      expect(persisted.period_start).toBe(dayjs().subtract(6, 'day').format('YYYY-MM-DD'))
      expect(persisted.period_end).toBe(dayjs().format('YYYY-MM-DD'))
      expect(JSON.parse(persisted.highlights_json)).toEqual([
        { label: 'BRL Spent', value: 'R$80.00', change: '+100%' },
        { label: 'BRL Earned', value: 'R$400.00', change: '+100%' },
        { label: 'USD Spent', value: '$120.00', change: '+100%' },
        { label: 'USD Earned', value: '$900.00', change: '+100%' },
      ])
    } finally {
      db.close()
    }
  })
})
