import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
  })

  test('renders page title', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  })

  test('language dropdown is present', async ({ page }) => {
    const languageSelect = page.locator('select').first()
    await expect(languageSelect).toBeVisible()

    // Should have English and Español options
    await expect(languageSelect.locator('option', { hasText: 'English' })).toBeAttached()
    await expect(languageSelect.locator('option', { hasText: 'Español' })).toBeAttached()
  })

  test('currency section is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Currency' })).toBeVisible()
    await expect(page.getByText('Preferred Currency')).toBeVisible()
    await expect(page.getByRole('button', { name: /Refresh Rates/i })).toBeVisible()
  })

  test('market data API section shows provider inputs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Market Data APIs' })).toBeVisible()
    await expect(page.getByText('Alpha Vantage')).toBeVisible()
    await expect(page.getByText('Finnhub').first()).toBeVisible()
    await expect(page.getByPlaceholder('Alpha Vantage API key')).toBeVisible()
    await expect(page.getByPlaceholder('Finnhub API key')).toBeVisible()
  })

  test('theme section is present', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Theme & Appearance' })).toBeVisible()
    await expect(page.getByText('Customize the visual appearance of Shikin')).toBeVisible()
  })

  test('data backup controls are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Export Data/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Import Data/i })).toBeVisible()
  })
})
