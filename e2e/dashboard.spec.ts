import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  test('renders page title', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  })

  test('keeps the Overview top area focused on finance views', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Good evening' })).toHaveCount(0)
    await expect(page.locator('.page-toolbar')).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('switches between numbers, net-worth history, and account comparison', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Net worth').first()).toBeVisible()
    await expect(page.getByText('Income').first()).toBeVisible()
    await expect(page.getByText('Spent').first()).toBeVisible()
    await expect(page.getByRole('img', { name: 'Net worth over time' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('Net worth history')).toBeVisible()

    await page.getByRole('tab', { name: 'Compare accounts' }).click()
    await expect(page.getByLabel('First account')).toBeVisible()
    await expect(page.getByLabel('Second account')).toBeVisible()
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
    await expect(page.locator('.native-panel').first()).toBeVisible()
  })
})
