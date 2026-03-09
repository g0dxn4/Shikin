import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Accounts', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('renders page title and add button', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Add Account/i }).first()).toBeVisible()
  })

  test('shows empty state without data', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('No accounts yet')).toBeVisible()
    await expect(page.getByText(/Add your first account/)).toBeVisible()
  })

  test('empty state has add account action', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')

    // There should be an add button in the empty state card
    const emptyStateCard = page.locator('.glass-card').filter({ hasText: 'No accounts yet' })
    await expect(emptyStateCard).toBeVisible()
    await expect(emptyStateCard.getByRole('button', { name: /Add Account/i })).toBeVisible()
  })

  test('page has correct structure', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.page-content')).toBeVisible()
    await expect(page.locator('.page-header')).toBeVisible()
  })
})
