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

    const links = sidebar.getByRole('link')
    await expect(links).toHaveCount(10)

    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Transactions' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Accounts' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Budgets' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Goals' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Investments' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Subscriptions' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Debt Payoff' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Forecast' })).toBeVisible()
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
    await page.getByRole('link', { name: 'Transactions' }).click()
    await page.waitForURL('/transactions')
    expect(page.url()).toContain('/transactions')
  })

  test('clicking Accounts navigates to /accounts', async ({ page }) => {
    await page.getByRole('link', { name: 'Accounts' }).click()
    await page.waitForURL('/accounts')
    expect(page.url()).toContain('/accounts')
  })

  test('clicking Budgets navigates to /budgets', async ({ page }) => {
    await page.getByRole('link', { name: 'Budgets' }).click()
    await page.waitForURL('/budgets')
    expect(page.url()).toContain('/budgets')
  })

  test('clicking Investments navigates to /investments', async ({ page }) => {
    await page.getByRole('link', { name: 'Investments' }).click()
    await page.waitForURL('/investments')
    expect(page.url()).toContain('/investments')
  })

  test('clicking Subscriptions navigates to /subscriptions', async ({ page }) => {
    await page.getByRole('link', { name: 'Subscriptions' }).click()
    await page.waitForURL('/subscriptions')
    expect(page.url()).toContain('/subscriptions')
  })

  test('clicking Settings navigates to /settings', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.waitForURL('/settings')
    expect(page.url()).toContain('/settings')
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

  test('bottom nav renders 5 items', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')
    await expect(bottomNav).toBeVisible()

    const links = bottomNav.getByRole('link')
    await expect(links).toHaveCount(5)

    await expect(bottomNav.getByText('Dashboard')).toBeVisible()
    await expect(bottomNav.getByText('Transactions')).toBeVisible()
    await expect(bottomNav.getByText('Accounts')).toBeVisible()
    await expect(bottomNav.getByText('Investments')).toBeVisible()
    await expect(bottomNav.getByText('Settings')).toBeVisible()
  })

  test('clicking Transactions navigates to /transactions', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')
    await bottomNav.getByText('Transactions').click()
    await page.waitForURL('/transactions')
    expect(page.url()).toContain('/transactions')
  })

  test('clicking Accounts navigates to /accounts', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')
    await bottomNav.getByText('Accounts').click()
    await page.waitForURL('/accounts')
    expect(page.url()).toContain('/accounts')
  })

  test('clicking Investments navigates to /investments', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')
    await bottomNav.getByText('Investments').click()
    await page.waitForURL('/investments')
    expect(page.url()).toContain('/investments')
  })

  test('clicking Settings navigates to /settings', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')
    await bottomNav.getByText('Settings').click()
    await page.waitForURL('/settings')
    expect(page.url()).toContain('/settings')
  })

  test('active bottom nav item is highlighted', async ({ page }) => {
    // Dashboard should be active by default (at /)
    const bottomNav = page.locator('nav.fixed')
    const dashboardLink = bottomNav.getByRole('link').first()
    await expect(dashboardLink).toHaveClass(/text-accent/)
  })
})
