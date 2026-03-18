import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Budgets', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await page.goto('/budgets')
    await page.waitForLoadState('networkidle')
  })

  test('renders title and add button', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Add Budget/i }).first()).toBeVisible()
  })

  test('shows empty state', async ({ page }) => {
    await expect(page.getByText('No budgets yet')).toBeVisible()
  })
})
