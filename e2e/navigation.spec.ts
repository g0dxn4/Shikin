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
    await expect(sidebar.getByRole('link', { name: 'Bills' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Reports' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Extensions' })).toBeVisible()
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

  test('clicking Bills navigates to /bills', async ({ page }) => {
    await page.getByRole('link', { name: 'Bills' }).click()
    await page.waitForURL('/bills')
    expect(page.url()).toContain('/bills')
  })

  test('clicking Reports navigates to /reports', async ({ page }) => {
    await page.getByRole('link', { name: 'Reports' }).click()
    await page.waitForURL('/reports')
    expect(page.url()).toContain('/reports')
  })

  test('clicking Settings navigates to /settings', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.waitForURL('/settings')
    expect(page.url()).toContain('/settings')
  })

  test('clicking Extensions navigates to /extensions', async ({ page }) => {
    await page.getByRole('link', { name: 'Extensions' }).click()
    await page.waitForURL('/extensions')
    expect(page.url()).toContain('/extensions')
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
    await expect(bottomNav.getByText('Budgets')).toBeVisible()
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

  test('clicking Budgets navigates to /budgets', async ({ page }) => {
    const bottomNav = page.getByRole('navigation').filter({ hasText: 'Dashboard' })
    await bottomNav.getByText('Budgets').click()
    await page.waitForURL('/budgets')
    expect(page.url()).toContain('/budgets')
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
