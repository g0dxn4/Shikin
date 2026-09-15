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
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Add Budget/i }).first()).toBeVisible()
  })

  test('shows empty state', async ({ page }) => {
    await expect(page.getByText('No budgets yet')).toBeVisible()
  })
  test('retains period filtering and the real budget form', async ({ page }) => {
    const period = page.getByRole('combobox', { name: /Period/ })
    await period.selectOption('weekly')
    await expect(period).toHaveValue('weekly')
    await page
      .getByRole('button', { name: /Add Budget/i })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox', { name: 'Budget Name' })).toBeVisible()
    await expect(dialog.getByRole('spinbutton', { name: 'Budget Amount (USD)' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible()
  })
})
