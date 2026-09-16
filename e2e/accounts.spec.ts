import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Accounts', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('renders page title and add button', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.native-topbar')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toHaveClass(/sr-only/)
    await expect(page.getByRole('button', { name: /Add Account/i }).first()).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Accounts section navigation' })
    ).toBeVisible()
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

    const emptyStateCard = page.locator('.native-panel').filter({ hasText: 'No accounts yet' })
    await expect(emptyStateCard).toBeVisible()
    await expect(emptyStateCard.getByRole('button', { name: /Add Account/i })).toBeVisible()
  })

  test('page has correct structure', async ({ page }) => {
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.page-content')).toBeVisible()
    await expect(page.locator('.page-toolbar')).toBeVisible()
  })
})
