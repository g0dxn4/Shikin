import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('i18n', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('default language is English', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Page heading should be in English
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  })

  test('switching to Spanish updates UI', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Change language to Spanish
    await page.selectOption('select', 'es')

    // Navigate to dashboard
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Page heading should now be in Spanish
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('Inicio')
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
