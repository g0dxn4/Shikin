import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.beforeEach(async ({ page }) => {
  await mockTauri(page)
  await page.goto('/')
})

test.describe('desktop sidebar navigation', () => {
  test.skip(({ isMobile }) => isMobile, 'Sidebar not visible on mobile')

  test('sidebar renders all navigation items', async ({ page }) => {
    const sidebar = page.locator('aside').first()

    await expect(sidebar.getByRole('link')).not.toHaveCount(0)

    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Transactions' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Accounts' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Budgets' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Categories' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Goals' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Insights' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible()
  })

  test('clicking Dashboard navigates to /', async ({ page }) => {
    await page.getByRole('link', { name: 'Transactions' }).click()
    await page.waitForURL('/transactions')

    await page.getByRole('link', { name: 'Dashboard' }).click()
    await page.waitForURL('/')

    expect(page.url()).toContain('/')
  })

  test('clicking Transactions navigates to /transactions', async ({ page }) => {
    await page.locator('aside').first().getByRole('link', { name: 'Transactions' }).click()
    await page.waitForURL('/transactions')
    expect(page.url()).toContain('/transactions')
  })

  test('clicking Accounts navigates to /accounts', async ({ page }) => {
    await page.locator('aside').first().getByRole('link', { name: 'Accounts' }).click()
    await page.waitForURL('/accounts')
    expect(page.url()).toContain('/accounts')
  })

  test('clicking Budgets navigates to /budgets', async ({ page }) => {
    await page.locator('aside').first().getByRole('link', { name: 'Budgets' }).click()
    await page.waitForURL('/budgets')
    expect(page.url()).toContain('/budgets')
  })

  test('clicking Categories navigates to /categories', async ({ page }) => {
    await page.locator('aside').first().getByRole('link', { name: 'Categories' }).click()
    await page.waitForURL('/categories')
    expect(page.url()).toContain('/categories')
  })

  test('clicking Goals navigates to /goals', async ({ page }) => {
    await page.locator('aside').first().getByRole('link', { name: 'Goals' }).click()
    await page.waitForURL('/goals')
    expect(page.url()).toContain('/goals')
  })

  test('clicking Settings navigates to /settings', async ({ page }) => {
    await page.locator('aside').first().getByRole('link', { name: 'Settings' }).click()
    await page.waitForURL('/settings')
    expect(page.url()).toContain('/settings')
  })

  test('clicking Insights navigates to /insights', async ({ page }) => {
    await page.locator('aside').first().getByRole('link', { name: 'Insights' }).click()
    await page.waitForURL('/insights')
    expect(page.url()).toContain('/insights')
  })

  test('active nav link is highlighted', async ({ page }) => {
    await page.getByRole('link', { name: 'Accounts' }).click()
    await page.waitForURL('/accounts')

    const accountsLink = page.getByRole('link', { name: 'Accounts' })
    await expect(accountsLink).toHaveClass(/sidebar-link-active/)
  })
})

test.describe('mobile bottom nav navigation', () => {
  test.skip(({ isMobile }) => !isMobile, 'Bottom nav only visible on mobile')

  test('bottom nav renders primary items and More menu', async ({ page }) => {
    const bottomNav = page.getByRole('navigation').filter({ hasText: 'Dashboard' })
    await expect(bottomNav).toBeVisible()

    const links = bottomNav.getByRole('link')
    await expect(links).toHaveCount(4)

    await expect(bottomNav.getByText('Dashboard')).toBeVisible()
    await expect(bottomNav.getByText('Transactions')).toBeVisible()
    await expect(bottomNav.getByText('Accounts')).toBeVisible()
    await expect(bottomNav.getByText('Insights')).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'More pages' })).toBeVisible()
  })

  test('clicking Transactions navigates to /transactions', async ({ page }) => {
    const bottomNav = page.getByRole('navigation').filter({ hasText: 'Dashboard' })
    await bottomNav.getByText('Transactions').click()
    await page.waitForURL('/transactions')
    expect(page.url()).toContain('/transactions')
  })

  test('clicking Accounts navigates to /accounts', async ({ page }) => {
    const bottomNav = page.getByRole('navigation').filter({ hasText: 'Dashboard' })
    await bottomNav.getByText('Accounts').click()
    await page.waitForURL('/accounts')
    expect(page.url()).toContain('/accounts')
  })

  test('clicking Insights navigates to /insights', async ({ page }) => {
    const bottomNav = page.getByRole('navigation').filter({ hasText: 'Dashboard' })
    await bottomNav.getByText('Insights').click()
    await page.waitForURL('/insights')
    expect(page.url()).toContain('/insights')
  })

  test('clicking Settings navigates to /settings', async ({ page }) => {
    const bottomNav = page.getByRole('navigation').filter({ hasText: 'Dashboard' })
    await bottomNav.getByRole('button', { name: 'More pages' }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.waitForURL('/settings')
    expect(page.url()).toContain('/settings')
  })

  test('active bottom nav item is highlighted', async ({ page }) => {
    // Dashboard should be active by default (at /)
    const bottomNav = page.getByRole('navigation').filter({ hasText: 'Dashboard' })
    const dashboardLink = bottomNav.getByRole('link').first()
    await expect(dashboardLink).toHaveClass(/text-accent/)
  })
})
