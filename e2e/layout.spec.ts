import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.beforeEach(async ({ page }) => {
  await mockTauri(page)
  await page.goto('/')
})

test.describe('desktop layout', () => {
  test.skip(({ isMobile }) => isMobile, 'Sidebar layout tests require desktop viewport')

  test('app shell renders sidebar and main content', async ({ page }) => {
    const sidebar = page.locator('aside').first()
    await expect(sidebar).toBeVisible()

    const main = page.locator('main')
    await expect(main).toBeVisible()

    await expect(sidebar.getByText('Shikin')).toBeVisible()
  })

  test('sidebar collapse toggle works', async ({ page }) => {
    const sidebar = page.locator('aside').first()

    await expect(sidebar.getByText('Dashboard')).toBeVisible()

    const collapseButton = sidebar.locator('button').first()
    await collapseButton.click()

    await expect(sidebar.getByText('Dashboard')).not.toBeVisible()
  })

  test('sidebar expand restores labels', async ({ page }) => {
    const sidebar = page.locator('aside').first()
    const toggleButton = sidebar.locator('button').first()

    await toggleButton.click()
    await expect(sidebar.getByText('Dashboard')).not.toBeVisible()

    await toggleButton.click()
    await expect(sidebar.getByText('Dashboard')).toBeVisible()
    await expect(sidebar.getByText('Transactions')).toBeVisible()
  })

  test('settings link is available in sidebar', async ({ page }) => {
    const sidebar = page.locator('aside').first()

    await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible()
  })

  test('page content renders in scrollable main area', async ({ page }) => {
    const main = page.locator('main')
    await expect(main).toBeVisible()
    await expect(main).toHaveClass(/overflow-y-auto/)
  })
})

test.describe('mobile layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'Mobile layout tests require mobile viewport')

  test('sidebar is hidden on mobile', async ({ page }) => {
    const sidebar = page.locator('aside')
    await expect(sidebar).not.toBeVisible()
  })

  test('bottom nav is visible on mobile', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')
    await expect(bottomNav).toBeVisible()
  })

  test('main content area is present', async ({ page }) => {
    const main = page.locator('main')
    await expect(main).toBeVisible()
  })

  test('content has bottom padding for nav bar', async ({ page }) => {
    const contentWrapper = page.locator('main > div')
    await expect(contentWrapper).toBeVisible()
    await expect(contentWrapper).toHaveClass(/pb-24/)
  })
})
