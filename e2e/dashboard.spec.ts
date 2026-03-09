import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('renders page title', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('shows empty state when no data', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Your finances, your way')).toBeVisible()
    await expect(page.getByRole('button', { name: /Add Account/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ask Val/i })).toBeVisible()
  })

  test('shows metric cards', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Metric card labels should be present (they show even with $0 data)
    await expect(page.getByText('TOTAL BALANCE')).toBeVisible()
    await expect(page.getByText('MONTHLY INCOME')).toBeVisible()
    await expect(page.getByText('MONTHLY EXPENSES')).toBeVisible()
    await expect(page.getByText('SAVINGS RATE')).toBeVisible()

    // Should render metric-card elements
    const metricCards = page.locator('.metric-card')
    await expect(metricCards).toHaveCount(4)
  })

  test('metric cards display values', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Even with no data, cards show $0.00 values
    const metricCards = page.locator('.metric-card')
    await expect(metricCards.first()).toContainText('$0.00')
  })

  test('has correct page structure', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.page-content')).toBeVisible()
    await expect(page.locator('.animate-fade-in-up')).toBeVisible()
  })
})
