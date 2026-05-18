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

async function executeE2eSql(sql: string, params: unknown[] = []) {
  let lastError: unknown

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(`${getDataServerUrl()}/api/db/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:1420',
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
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible()
    // The add button contains "+ Add Transaction" text
    await expect(page.getByRole('button', { name: /Add Transaction/i }).first()).toBeVisible()
  })

  test('shows empty state without data', async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('No transactions yet')).toBeVisible()
    await expect(page.getByText(/Add your first transaction/)).toBeVisible()
  })

  test('filter controls are present', async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    await expect(page.getByPlaceholder(/Search/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Expense' })).toBeVisible()
    await expect(page.getByRole('button', { name: /No category/i })).toBeVisible()
  })

  test('page structure has correct layout', async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    // Page should have the animate-fade-in-up wrapper
    await expect(page.locator('.animate-fade-in-up')).toBeVisible()

    // Should have the page-content structure
    await expect(page.locator('.page-content')).toBeVisible()
  })

  test('creates, edits, and persists an expense transaction', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')

    await page
      .getByRole('button', { name: /Add Account/i })
      .first()
      .click()

    const accountDialog = page.getByRole('dialog')
    await accountDialog.getByLabel('Account Name').fill(qaName('Checking'))
    await accountDialog.getByLabel('Current Balance').fill('100')
    await accountDialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(qaName('Checking')).first()).toBeVisible()

    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')
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

    await page.getByLabel(`Edit ${qaName('Lunch')}`).click()

    const editDialog = page.getByRole('dialog', { name: /Edit Transaction/i })
    await editDialog.getByLabel('Description').fill(qaName('Lunch Edited'))
    await editDialog.getByLabel('Amount').fill('45.67')
    await editDialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText(qaName('Lunch Edited'))).toBeVisible()
    await expect(page.getByText('-$45.67')).toBeVisible()

    await page.reload()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(qaName('Lunch Edited'))).toBeVisible()
    await expect(page.getByText('-$45.67')).toBeVisible()
  })
})
