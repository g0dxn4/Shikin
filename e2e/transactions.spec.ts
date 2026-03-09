import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Transactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
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

  test('filter button is present', async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    // Filter button should be visible in the header
    await expect(page.getByRole('button', { name: /Filter/i })).toBeVisible()
  })

  test('page structure has correct layout', async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    // Page should have the animate-fade-in-up wrapper
    await expect(page.locator('.animate-fade-in-up')).toBeVisible()

    // Should have the page-content structure
    await expect(page.locator('.page-content')).toBeVisible()
  })
})
