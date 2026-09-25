import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
  })

  test('shows one page of preferences instead of tab-swapped panels', async ({ page }) => {
    await expect(page.getByRole('tablist')).toHaveCount(0)
    for (const name of ['General', 'Money', 'App & data', 'Integrations & diagnostics']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByLabel('Language')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Theme & Appearance' })).toBeVisible()
    await expect(page.getByLabel('Main currency')).toBeVisible()
    await expect(page.getByRole('button', { name: /Export Data/i })).toBeVisible()
  })

  test('language selector offers English and Español', async ({ page }) => {
    const select = page.getByLabel('Language')
    await expect(select.locator('option', { hasText: 'English' })).toBeAttached()
    await expect(select.locator('option', { hasText: 'Español' })).toBeAttached()
  })

  test('manual rates open from a canonical link and keep an unsaved draft when closed', async ({
    page,
  }) => {
    await page.goto('/settings?section=money#manual-rates')
    await expect(page.locator('#manual-rates')).toHaveAttribute('open', '')
    await expect(page.locator('#manual-fx-form')).toBeVisible()
    await page.getByLabel('Exact decimal rate').fill('17.25')
    await page.locator('#manual-rates > summary').click()
    await expect(page.locator('#manual-rates')).not.toHaveAttribute('open', '')
    await page.locator('#manual-rates > summary').click()
    await expect(page.getByLabel('Exact decimal rate')).toHaveValue('17.25')
    await expect(page.getByRole('heading', { name: 'Theme & Appearance' })).toBeVisible()
  })

  test('provider keys and diagnostics open via canonical links', async ({ page }) => {
    await page.goto('/settings?section=integrations#market-data')
    await expect(page.locator('#market-data')).toHaveAttribute('open', '')
    await expect(page.getByPlaceholder('Alpha Vantage API key')).toBeVisible()
    await expect(page.getByPlaceholder('Finnhub API key')).toBeVisible()
    await page.getByPlaceholder('Alpha Vantage API key').fill('unsaved')
    await page.locator('#market-data > summary').click()
    await page.locator('#market-data > summary').click()
    await expect(page.getByPlaceholder('Alpha Vantage API key')).toHaveValue('unsaved')

    await page.goto('/settings?section=integrations#data-identity')
    await expect(page.locator('#data-identity')).toHaveAttribute('open', '')
    await expect(page.getByRole('heading', { name: 'Data identity' }).last()).toBeVisible()
  })

  test('backup and main currency anchors remain accessible', async ({ page }) => {
    await page.goto('/settings?section=data#backups')
    await expect(page.getByRole('button', { name: /Import Data/i })).toBeVisible()
    await page.goto('/settings?section=money#main-currency')
    await expect(page.getByLabel('Main currency')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save main currency' })).toBeVisible()
  })
})
