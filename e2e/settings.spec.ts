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
    const languageSelect = page.locator('select')
    await expect(languageSelect).toBeVisible()

    // Should have English and Español options
    await expect(languageSelect.locator('option', { hasText: 'English' })).toBeAttached()
    await expect(languageSelect.locator('option', { hasText: 'Español' })).toBeAttached()
  })

  test('AI provider grid shows providers', async ({ page }) => {
    // Provider names should be visible in the grid
    // Use the provider grid section to scope selectors
    const providerGrid = page.locator('.grid').first()
    await expect(page.getByRole('heading', { name: 'AI Provider' })).toBeVisible()
    await expect(page.getByText('Anthropic')).toBeVisible()
    await expect(page.getByText('Google Gemini')).toBeVisible()
    await expect(page.getByText('Groq')).toBeVisible()
    await expect(page.getByText('Ollama')).toBeVisible()
    await expect(page.getByText('OpenRouter')).toBeVisible()
  })

  test('clicking a provider shows config panel', async ({ page }) => {
    // Click the Anthropic provider card (less ambiguous than OpenAI which is selected by default)
    await page.getByText('Anthropic').click()

    // Config panel should show the provider name and API key input
    await expect(page.locator('input[type="password"]').first()).toBeVisible()
  })

  test('config panel has save button', async ({ page }) => {
    // Config panel should already show (OpenAI selected by default)
    const saveButtons = page.getByRole('button', { name: /save/i })
    await expect(saveButtons.first()).toBeVisible()
  })

  test('data APIs section is present', async ({ page }) => {
    await expect(page.getByText('Alpha Vantage')).toBeVisible()
    await expect(page.getByText('Finnhub').first()).toBeVisible()
  })

  test('data backup controls are present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Export Data/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Import Data/i })).toBeVisible()
  })
})
