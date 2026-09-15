import { expect, test } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

const PREFIX = 'PRESERVE-P2B'
const BRIDGE_TOKEN = process.env.SHIKIN_DATA_SERVER_BRIDGE_TOKEN || 'shikin-e2e-bridge-token'
const IDS = {
  checking: `${PREFIX}-account-checking`,
  savings: `${PREFIX}-account-savings`,
  euro: `${PREFIX}-account-euro`,
  expenseCategory: `${PREFIX}-category-expense`,
  incomeCategory: `${PREFIX}-category-income`,
  splitTransaction: `${PREFIX}-transaction-split`,
  recurring: `${PREFIX}-recurring-future`,
  rate: `${PREFIX}-rate`,
}
const PROTECTED_TABLES = [
  'accounts',
  'categories',
  'subcategories',
  'transactions',
  'transaction_splits',
  'recurring_rules',
  'subscriptions',
  'budgets',
  'budget_periods',
  'goals',
  'investments',
  'receivables',
  'category_rules',
  'category_suggestions',
  'cashflow_buckets',
  'cashflow_bucket_allocations',
  'credit_card_statements',
  'account_reconciliations',
] as const

function dataServerUrl() {
  return (
    process.env.VITE_DATA_SERVER_URL ||
    process.env.SHIKIN_DATA_SERVER_URL ||
    `http://localhost:${process.env.SHIKIN_DATA_SERVER_PORT || '1480'}`
  ).replace(/\/+$/, '')
}

async function dbRequest<T>(
  route: 'query' | 'execute',
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const response = await fetch(`${dataServerUrl()}/api/db/${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:1420',
      'X-Shikin-Bridge': BRIDGE_TOKEN,
    },
    body: JSON.stringify({ sql, params }),
  })
  if (!response.ok)
    throw new Error(`E2E database ${route} failed (${response.status}): ${await response.text()}`)
  return response.json() as Promise<T>
}

const execute = (sql: string, params: unknown[] = []) => dbRequest('execute', sql, params)
const query = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  dbRequest<T[]>('query', sql, params)

async function cleanup() {
  await execute('DELETE FROM transaction_splits WHERE id LIKE ?', [`${PREFIX}%`])
  await execute('DELETE FROM transactions WHERE id LIKE ? OR description LIKE ?', [
    `${PREFIX}%`,
    `${PREFIX}%`,
  ])
  await execute('DELETE FROM recurring_rules WHERE id LIKE ?', [`${PREFIX}%`])
  await execute('DELETE FROM account_balance_history WHERE account_id LIKE ?', [`${PREFIX}%`])
  await execute('DELETE FROM accounts WHERE id LIKE ? OR name LIKE ?', [`${PREFIX}%`, `${PREFIX}%`])
  await execute('DELETE FROM categories WHERE id LIKE ? OR name LIKE ?', [
    `${PREFIX}%`,
    `${PREFIX}%`,
  ])
  await execute('DELETE FROM exchange_rates WHERE id LIKE ?', [`${PREFIX}%`])
}

async function seedPreservationFixtures() {
  const now = '2026-03-01T12:00:00.000Z'
  await execute(
    `INSERT INTO accounts (id, name, type, currency, balance, icon, color, is_archived, is_primary, account_mode, created_at, updated_at)
     VALUES (?, ?, 'checking', 'USD', 987654, NULL, '#276fd6', 0, 0, 'transactional', ?, ?),
            (?, ?, 'savings', 'USD', 321000, NULL, '#18783c', 0, 0, 'transactional', ?, ?),
            (?, ?, 'checking', 'EUR', 222000, NULL, '#73777e', 0, 0, 'transactional', ?, ?)`,
    [
      IDS.checking,
      `${PREFIX} Checking`,
      now,
      now,
      IDS.savings,
      `${PREFIX} Savings`,
      now,
      now,
      IDS.euro,
      `${PREFIX} Euro`,
      now,
      now,
    ]
  )
  await execute(
    `INSERT INTO categories (id, name, icon, color, type, sort_order, created_at)
     VALUES (?, ?, 'utensils', '#f97316', 'expense', 901, ?),
            (?, ?, 'banknote', '#22c55e', 'income', 902, ?)`,
    [IDS.expenseCategory, `${PREFIX} Expense`, now, IDS.incomeCategory, `${PREFIX} Income`, now]
  )
  for (let index = 0; index < 55; index += 1) {
    const id = `${PREFIX}-transaction-${String(index).padStart(3, '0')}`
    const status = index % 3 === 0 ? 'pending' : index % 3 === 1 ? 'posted' : 'cleared'
    const type = index % 4 === 0 ? 'income' : 'expense'
    await execute(
      `INSERT INTO transactions (
        id, account_id, category_id, type, amount, currency, description, notes, status, source,
        date, tags, is_recurring, is_archived, ledger_treatment, reporting_treatment,
        transaction_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?, 'preservation-e2e', ?, '[]', 0, 0, 'normal', 'normal', 'standard', ?, ?)`,
      [
        id,
        IDS.checking,
        type === 'income' ? IDS.incomeCategory : IDS.expenseCategory,
        type,
        1000 + index,
        `${PREFIX} Ledger ${String(index).padStart(3, '0')}`,
        `${PREFIX} note ${index}`,
        status,
        `2026-02-${String((index % 27) + 1).padStart(2, '0')}`,
        now,
        now,
      ]
    )
  }
  await execute(
    `INSERT INTO transactions (
      id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source,
      date, tags, is_recurring, is_archived, ledger_treatment, reporting_treatment,
      transaction_kind, created_at, updated_at
    ) VALUES (?, ?, NULL, NULL, 'expense', 7777, 'USD', ?, ?, 'posted', 'preservation-e2e',
      '2026-02-14', '[]', 0, 0, 'normal', 'normal', 'standard', ?, ?),
      (?, ?, NULL, ?, 'transfer', 5555, 'USD', ?, NULL, 'posted', 'preservation-e2e',
      '2026-02-15', '[]', 0, 0, 'normal', 'exclude_from_cashflow', 'standard', ?, ?),
      (?, ?, ?, NULL, 'expense', 1999, 'EUR', ?, NULL, 'posted', 'preservation-e2e',
      '2026-02-16', '[]', 0, 0, 'normal', 'normal', 'standard', ?, ?)`,
    [
      IDS.splitTransaction,
      IDS.checking,
      `${PREFIX} Split Ledger`,
      `${PREFIX} split note`,
      now,
      now,
      `${PREFIX}-transaction-transfer`,
      IDS.checking,
      IDS.savings,
      `${PREFIX} Transfer Ledger`,
      now,
      now,
      `${PREFIX}-transaction-eur`,
      IDS.euro,
      IDS.expenseCategory,
      `${PREFIX} EUR Ledger`,
      now,
      now,
    ]
  )
  await execute(
    `INSERT INTO transaction_splits (id, transaction_id, category_id, amount, notes, created_at)
     VALUES (?, ?, ?, 3000, ?, ?), (?, ?, ?, 4777, ?, ?)`,
    [
      `${PREFIX}-split-a`,
      IDS.splitTransaction,
      IDS.expenseCategory,
      `${PREFIX} first`,
      now,
      `${PREFIX}-split-b`,
      IDS.splitTransaction,
      IDS.expenseCategory,
      `${PREFIX} second`,
      now,
    ]
  )
  await execute(
    `INSERT INTO recurring_rules (
      id, description, amount, currency, type, frequency, next_date, end_date, account_id,
      category_id, tags, notes, active, anchor_kind, anchor_day, created_at, updated_at
    ) VALUES (?, ?, 2500, 'USD', 'expense', 'monthly', '2099-12-15', NULL, ?, ?, '', ?, 1, 'fixed_day', 15, ?, ?)`,
    [
      IDS.recurring,
      `${PREFIX} Future Rule`,
      IDS.checking,
      IDS.expenseCategory,
      `${PREFIX} future only`,
      now,
      now,
    ]
  )
  await execute(
    `INSERT INTO exchange_rates (id, from_currency, to_currency, rate, date, created_at)
     VALUES (?, 'USD', 'EUR', 0.91, '2099-12-15', ?)`,
    [IDS.rate, now]
  )
}

async function captureProtectedState() {
  const counts = Object.fromEntries(
    await Promise.all(
      PROTECTED_TABLES.map(async (table) => {
        const rows = await query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
        return [table, Number(rows[0]?.count ?? -1)]
      })
    )
  )
  const fixtures = {
    accounts: await query('SELECT * FROM accounts WHERE id LIKE ? ORDER BY id', [`${PREFIX}%`]),
    categories: await query('SELECT * FROM categories WHERE id LIKE ? ORDER BY id', [`${PREFIX}%`]),
    transactions: await query('SELECT * FROM transactions WHERE id LIKE ? ORDER BY id', [
      `${PREFIX}%`,
    ]),
    splits: await query('SELECT * FROM transaction_splits WHERE id LIKE ? ORDER BY id', [
      `${PREFIX}%`,
    ]),
    recurring: await query('SELECT * FROM recurring_rules WHERE id LIKE ? ORDER BY id', [
      `${PREFIX}%`,
    ]),
  }
  return { counts, fixtures }
}

test.describe('read-only app data preservation', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await cleanup()
    await seedPreservationFixtures()
  })
  test.afterEach(async () => cleanup())

  test('full app reads, transaction paging, reload, and appearance changes preserve finance rows exactly', async ({
    page,
  }) => {
    test.setTimeout(60000)
    const before = await captureProtectedState()

    await page.goto('/transactions?search=PRESERVE-P2B&view=ledger&sort=description&direction=asc')
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()
    await expect(
      page.getByRole('button', { name: new RegExp(`^${PREFIX} Ledger 001(?: |$)`) })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(
      page.getByRole('button', { name: new RegExp(`^${PREFIX} Split Ledger(?: |$)`) })
    ).toBeVisible()
    await page.getByRole('tab', { name: 'Timeline' }).click()
    await page.getByRole('tab', { name: 'Ledger' }).click()
    await page.getByLabel('Account').selectOption(IDS.savings)
    await expect(
      page.getByRole('button', { name: new RegExp(`^${PREFIX} Transfer Ledger(?: |$)`) })
    ).toBeVisible()
    await page.getByLabel('Currency').selectOption('USD')
    await page.getByLabel('Account').selectOption('all')
    await page.getByLabel('Status').selectOption('pending')
    await page.getByRole('tab', { name: 'Review' }).click()

    for (const path of [
      '/',
      '/transactions',
      '/categories',
      '/accounts',
      '/investments',
      '/receivables',
      '/budgets',
      '/goals',
      '/bills',
      '/bill-calendar',
      '/debt-payoff',
      '/forecast',
      '/insights',
      '/reports',
      '/net-worth',
      '/spending-insights',
      '/spending-heatmap',
      '/settings',
      '/extensions',
      '/transactions',
    ]) {
      await page.goto(path)
      await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()
    }

    if ((page.viewportSize()?.width ?? 0) >= 768) {
      await page.getByRole('button', { name: /Switch to (dark|light)/i }).click()
      await page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/i }).click()
    } else {
      await page.goto('/settings')
      const darkAppearance = page.getByRole('radio', { name: /^Dark / })
      const wasDark = (await darkAppearance.getAttribute('aria-checked')) === 'true'
      await page.getByRole('radio', { name: wasDark ? /^Light / : /^Dark / }).click()
      await expect(page.locator('html')).toHaveAttribute(
        'data-appearance',
        wasDark ? 'native-light' : 'native-dark'
      )
    }
    await page.reload()
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()

    const after = await captureProtectedState()
    expect(after.counts).toEqual(before.counts)
    expect(after.fixtures).toEqual(before.fixtures)
  })
})
