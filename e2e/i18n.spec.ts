import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('i18n', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('default language is English', async ({ page }) => {
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible()
  })

  test('switching to Spanish updates UI', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Change language to Spanish
    await page.selectOption('select', 'es')

    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Transacciones' })).toBeVisible()
  })

  test('Spanish persists across navigation', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Switch to Spanish
    await page.selectOption('select', 'es')

    // Navigate to transactions page
    await page.goto('/transactions')
    await page.waitForLoadState('networkidle')

    // Page heading should be in Spanish
    await expect(page.getByRole('heading', { level: 1, name: 'Transacciones' })).toBeVisible()
  })

  test('switching back to English works', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Switch to Spanish first
    await page.selectOption('select', 'es')
    await expect(page.getByRole('heading').first()).toContainText('Configuración')

    // Switch back to English
    await page.selectOption('select', 'en')
    await expect(page.getByRole('heading').first()).toContainText('Settings')
  })
})
