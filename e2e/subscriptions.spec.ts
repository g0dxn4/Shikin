import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Subscriptions', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await page.goto('/subscriptions')
    await page.waitForLoadState('networkidle')
  })

  test('renders title and disconnected banner', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Subscriptions' })).toBeVisible()
    await expect(page.getByText(/Subby not connected/i)).toBeVisible()
  })

  test('shows setup guide when disconnected', async ({ page }) => {
    await expect(page.getByText('Connect to Subby')).toBeVisible()
  })
})
