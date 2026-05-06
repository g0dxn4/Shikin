import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('renders page title', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Good evening' })).toBeVisible()
  })

  test('shows local-first hero when no data', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Your money is calm, current, and completely local.')).toBeVisible()
    await expect(page.getByRole('button', { name: /Add Transaction/i }).first()).toBeVisible()
  })

  test('shows metric cards', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Net Worth')).toBeVisible()
    await expect(page.getByText('Monthly Income')).toBeVisible()
    await expect(page.getByText('Monthly Expenses')).toBeVisible()
    await expect(page.getByText(/savings rate/i)).toBeVisible()
  })

  test('metric cards display values', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('$0.00').first()).toBeVisible()
  })

  test('has correct page structure', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.page-content')).toBeVisible()
    await expect(page.locator('.liquid-hero')).toBeVisible()
  })
})
