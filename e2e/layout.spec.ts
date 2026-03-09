import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.beforeEach(async ({ page }) => {
  await mockTauri(page)
  await page.goto('/')
})

test.describe('desktop layout', () => {
  test.skip(({ isMobile }) => isMobile, 'Sidebar layout tests require desktop viewport')

  test('app shell renders sidebar, main content, and AI panel toggle', async ({ page }) => {
    const sidebar = page.locator('aside').first()
    await expect(sidebar).toBeVisible()

    const main = page.locator('main')
    await expect(main).toBeVisible()

    const aiButton = sidebar.getByText('AI Assistant')
    await expect(aiButton).toBeVisible()
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

  test('AI panel can be toggled', async ({ page }) => {
    const sidebar = page.locator('aside').first()

    await sidebar.getByText('AI Assistant').click()

    const aiPanel = page.locator('aside').nth(1)
    await expect(aiPanel).toBeVisible()

    const panelHeader = aiPanel.locator('.border-b').first()
    const xButton = panelHeader.locator('button').last()
    await xButton.click()

    await expect(aiPanel).not.toBeVisible()
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
    const contentWrapper = page.locator('.mx-auto.max-w-7xl')
    await expect(contentWrapper).toBeVisible()
    await expect(contentWrapper).toHaveClass(/pb-16/)
  })
})
