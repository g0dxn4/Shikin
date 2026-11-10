import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

const TEST_PREFIX = 'QA E2E'
const BRIDGE_TOKEN = process.env.SHIKIN_DATA_SERVER_BRIDGE_TOKEN || 'shikin-e2e-bridge-token'

function getDataServerUrl() {
  const configuredUrl = process.env.VITE_DATA_SERVER_URL || process.env.SHIKIN_DATA_SERVER_URL
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '')
  }

  return `http://localhost:${process.env.SHIKIN_DATA_SERVER_PORT || '1480'}`
}

async function queryE2eSql<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const response = await fetch(`${getDataServerUrl()}/api/db/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: process.env.SHIKIN_E2E_ORIGIN || 'http://localhost:1420',
      'X-Shikin-Bridge': BRIDGE_TOKEN,
    },
    body: JSON.stringify({ sql, params }),
  })
  if (!response.ok) {
    throw new Error(`E2E query failed (${response.status}): ${await response.text()}`)
  }
  return response.json() as Promise<T[]>
}

async function executeE2eSql(sql: string, params: unknown[] = []) {
  let lastError: unknown

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(`${getDataServerUrl()}/api/db/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: process.env.SHIKIN_E2E_ORIGIN || 'http://localhost:1420',
          'X-Shikin-Bridge': BRIDGE_TOKEN,
        },
        body: JSON.stringify({ sql, params }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`E2E cleanup failed (${response.status}): ${body}`)
      }

      return
    } catch (error) {
      lastError = error
      if (error instanceof Error && error.message.startsWith('E2E cleanup failed')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('E2E cleanup failed')
}

async function clearTransactionTestData() {
  const accountSelector = `SELECT id FROM accounts WHERE name LIKE ?`
  const transactionSelector = `
    SELECT id
    FROM transactions
    WHERE description LIKE ? OR account_id IN (${accountSelector})
  `
  const params = [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`]

  await executeE2eSql(
    `DELETE FROM transaction_splits WHERE transaction_id IN (${transactionSelector})`,
    params
  )
  await executeE2eSql(
    `UPDATE transactions SET reconciliation_id = NULL WHERE account_id IN (${accountSelector})`,
    [`${TEST_PREFIX}%`]
  )
  await executeE2eSql(
    `DELETE FROM account_reconciliations WHERE account_id IN (${accountSelector})`,
    [`${TEST_PREFIX}%`]
  )
  await executeE2eSql(
    `DELETE FROM transactions WHERE description LIKE ? OR account_id IN (${accountSelector})`,
    params
  )
  await executeE2eSql(
    `DELETE FROM account_balance_history WHERE account_id IN (${accountSelector})`,
    [`${TEST_PREFIX}%`]
  )
  await executeE2eSql('DELETE FROM accounts WHERE name LIKE ?', [`${TEST_PREFIX}%`])
}

function qaName(value: string) {
  return `${TEST_PREFIX} ${value}`
}

test.describe('Transactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await clearTransactionTestData()
  })

  test.afterEach(async () => {
    await clearTransactionTestData()
  })

  test('renders page title and add button', async ({ page }) => {
    await page.goto('/transactions')
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()

    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible()
    // The add button contains "+ Add Transaction" text
    await expect(page.getByRole('button', { name: /Add Transaction/i }).first()).toBeVisible()
  })

  test('shows empty state without data', async ({ page }) => {
    await page.goto('/transactions')
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()

    await expect(page.getByText('No transactions yet')).toBeVisible()
    await expect(page.getByText(/Add your first transaction/)).toBeVisible()
  })

  test('multi-view and filter controls are present', async ({ page }) => {
    await page.goto('/transactions')
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()

    await expect(page.getByPlaceholder(/Search/i)).toBeVisible()
    const views = page.getByRole('tablist', { name: 'Transaction views' })
    await expect(views).toBeVisible()
    await expect(views.getByRole('tab', { name: 'Timeline' })).toBeVisible()
    await expect(views.getByRole('tab', { name: 'Ledger' })).toBeVisible()
    await expect(views.getByRole('tab', { name: 'Review' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Expense' })).toBeVisible()
    const dateRange = page.getByRole('combobox', { name: 'Date range', exact: true })
    await expect(dateRange).toBeVisible()
    for (const [value, label] of [
      ['this-month', 'This month'],
      ['three-months', '3 months'],
      ['six-months', '6 months'],
      ['this-year', 'This year'],
      ['all', 'All time'],
    ]) {
      await expect(dateRange.locator(`option[value="${value}"]`)).toHaveText(label)
    }
    await dateRange.selectOption('three-months')
    const dateRangeChip = page.getByRole('button', {
      name: 'Remove filter Date range: 3 months',
      exact: true,
    })
    await expect(dateRangeChip).toBeVisible()
    const start = await page.evaluate(() => {
      const now = new Date()
      const date = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
    })
    await expect.poll(() => new URL(page.url()).searchParams.get('dateFrom')).toBe(start)
    await dateRange.selectOption('all')
    await expect.poll(() => new URL(page.url()).searchParams.has('dateFrom')).toBe(false)
    await expect(dateRangeChip).not.toBeVisible()
    if ((page.viewportSize()?.width ?? 0) < 768) {
      await page.getByRole('button', { name: 'Advanced filters' }).click()
    }
    await expect(page.getByLabel('Account', { exact: true })).toBeVisible()
  })

  test('page structure has correct layout', async ({ page }) => {
    await page.goto('/transactions')
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()

    // Page should have the animate-fade-in-up wrapper
    await expect(page.locator('.animate-fade-in-up')).toBeVisible()

    // Should have the page-content structure
    await expect(page.locator('.page-content')).toBeVisible()
  })

  test('creates, edits, and persists an expense transaction', async ({ page }) => {
    await page.goto('/accounts')
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()

    await page
      .getByRole('button', { name: /Add Account/i })
      .first()
      .click()

    const accountDialog = page.getByRole('dialog')
    await accountDialog.getByLabel('Account Name').fill(qaName('Checking'))
    await accountDialog.getByLabel('Observed balance').fill('100')
    await accountDialog.getByRole('button', { name: 'Save' }).click()

    await expect(accountDialog).not.toBeVisible()
    await expect(page.getByRole('article', { name: qaName('Checking'), exact: true })).toBeVisible()

    await page.goto('/transactions')
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()
    await page
      .getByRole('button', { name: /Add Transaction/i })
      .first()
      .click()

    const addDialog = page.getByRole('dialog')
    await addDialog.getByLabel('Amount').fill('12.34')
    await addDialog.getByLabel('Description').fill(qaName('Lunch'))
    await addDialog.getByLabel('Account').click()
    await page.getByRole('option', { name: qaName('Checking') }).click()
    await addDialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(qaName('Lunch'))).toBeVisible()
    await expect(page.getByText('-$12.34')).toBeVisible()

    await page
      .getByRole('button', { name: new RegExp(qaName('Lunch')) })
      .first()
      .click()
    const rowDialog = page.getByRole('dialog', { name: /Edit Transaction/i })
    await expect(rowDialog.getByLabel('Description')).toHaveValue(qaName('Lunch'))
    await rowDialog.getByText('Details and evidence').click()
    await expect(rowDialog.getByText('Reference')).toBeVisible()
    await rowDialog.getByRole('button', { name: 'Close' }).click()
    await page.getByLabel(`Edit ${qaName('Lunch')}`).click()

    const editDialog = page.getByRole('dialog', { name: /Edit Transaction/i })
    await editDialog.getByLabel('Description').fill(qaName('Lunch Edited'))
    await editDialog.getByLabel('Amount').fill('45.67')
    await editDialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(qaName('Lunch Edited'))).toBeVisible()
    await expect(page.getByText('-$45.67')).toBeVisible()

    const accountId = (
      await queryE2eSql<{ id: string }>('SELECT id FROM accounts WHERE name = ?', [
        qaName('Checking'),
      ])
    )[0]?.id
    expect(accountId).toBeTruthy()
    await expect
      .poll(
        async () =>
          (
            await queryE2eSql<{ balance: number }>('SELECT balance FROM accounts WHERE id = ?', [
              accountId,
            ])
          )[0]?.balance
      )
      .toBe(5433)

    await page.reload()
    await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()
    await expect(page.getByText(qaName('Lunch Edited'))).toBeVisible()
    await expect(page.getByText('-$45.67')).toBeVisible()

    await page
      .getByRole('button', { name: new RegExp(qaName('Lunch Edited')) })
      .first()
      .click()
    await page
      .getByRole('dialog', { name: /Edit Transaction/i })
      .getByText('Details and evidence')
      .click()
    await page
      .getByRole('dialog', { name: /Edit Transaction/i })
      .getByRole('button', { name: 'Delete Transaction' })
      .click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await expect(page.getByText(qaName('Lunch Edited'))).not.toBeVisible()
    await expect
      .poll(
        async () =>
          (
            await queryE2eSql<{ balance: number }>('SELECT balance FROM accounts WHERE id = ?', [
              accountId,
            ])
          )[0]?.balance
      )
      .toBe(10000)
  })
  for (const closeDuringRefresh of [false, true]) {
    test(`committed imports stay successful through a failed refresh (closed=${closeDuringRefresh})`, async ({
      page,
    }) => {
      await executeE2eSql(
        'INSERT INTO accounts (id, name, type, currency, balance) VALUES (?, ?, ?, ?, ?)',
        ['qa-refresh-account', qaName('Refresh Checking'), 'checking', 'USD', 10000]
      )
      await page.goto('/transactions')
      await expect(page.locator('[data-startup-state="ready"]')).toBeVisible()
      await page.getByRole('button', { name: 'More actions', exact: true }).click()
      await page.getByRole('button', { name: 'Import Statement', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Import Bank Statement' })
      await dialog.getByLabel('Import to Account', { exact: true }).click()
      await page.getByRole('option', { name: qaName('Refresh Checking'), exact: true }).click()
      const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
      await dialog.locator('input[type="file"]').setInputFiles({
        name: 'refresh.ofx',
        mimeType: 'application/x-ofx',
        buffer: Buffer.from(`<OFX><STMTRS><CURDEF>USD
<STMTTRN><DTPOSTED>${date}<TRNAMT>-10.00<FITID>refresh-row<NAME>${qaName('Refresh Import')}</STMTTRN>
</STMTRS></OFX>`),
      })
      await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
      await expect(
        dialog.getByRole('button', { name: 'Import Transactions', exact: true })
      ).toBeEnabled()
      await page.evaluate(() => {
        window.addEventListener('shikin:transaction-page-invalidate', (event) => {
          if ((event as CustomEvent).detail === 'import') {
            document.documentElement.dataset.importCommitted = 'true'
          }
        })
      })
      let release!: () => void
      const heldRead = new Promise<void>((resolve) => {
        release = resolve
      })
      let readStarted = false
      let committedBeforeRead = false
      await page.route('**/api/db/query', async (route) => {
        const body = route.request().postDataJSON() as { sql?: string }
        if (!readStarted && body.sql?.includes('ORDER BY t.date DESC, t.created_at DESC')) {
          committedBeforeRead = await page.evaluate(
            () => document.documentElement.dataset.importCommitted === 'true'
          )
          readStarted = true
          await heldRead
          await route.fulfill({ status: 500, json: { error: 'Presentation read unavailable' } })
        } else await route.continue()
      })
      try {
        await dialog.getByRole('button', { name: 'Import Transactions', exact: true }).click()
        await expect.poll(() => readStarted).toBe(true)
        // The event is immediate; the serialized database queue can still delay page reads.
        expect(committedBeforeRead).toBe(true)
        if (closeDuringRefresh)
          await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      } finally {
        release()
      }
      await expect(
        page.getByText(
          'The import was saved, but some views could not be refreshed. Reload the view; do not import the file again.',
          { exact: true }
        )
      ).toBeVisible()
      await expect(dialog).not.toBeVisible()
      await expect(page.getByText('Import failed', { exact: true })).not.toBeVisible()
      await expect(page.locator(`[aria-label="Edit ${qaName('Refresh Import')}"]`)).toBeVisible()
      expect(
        await queryE2eSql('SELECT amount FROM transactions WHERE account_id = ?', [
          'qa-refresh-account',
        ])
      ).toEqual([{ amount: 1000 }])
      expect(
        await queryE2eSql('SELECT balance FROM accounts WHERE id = ?', ['qa-refresh-account'])
      ).toEqual([{ balance: 9000 }])
      await page.unrouteAll({ behavior: 'wait' })
    })
  }
})
