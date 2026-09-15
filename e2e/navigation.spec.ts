import { expect, test } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

const ALL_ROUTES = [
  '/',
  '/transactions',
  '/categories',
  '/accounts',
  '/investments',
  '/receivables',
  '/budgets',
  '/goals',
  '/bills',
  '/bill-calendar',
  '/debt-payoff',
  '/forecast',
  '/insights',
  '/reports',
  '/net-worth',
  '/spending-insights',
  '/spending-heatmap',
  '/settings',
  '/extensions',
]

test.beforeEach(async ({ page }) => {
  await mockTauri(page)
  await page.goto('/')
})

test.describe('desktop native navigation', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop sidebar is hidden on mobile')

  test('shows six groups and contextual section tabs', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
    await expect(sidebar.getByRole('link')).toHaveCount(6)
    for (const label of [
      'Overview',
      'Transactions',
      'Accounts',
      'Planning',
      'Insights',
      'Settings',
    ]) {
      await expect(sidebar.getByRole('link', { name: label })).toBeVisible()
    }

    await sidebar.getByRole('link', { name: 'Transactions' }).click()
    await page.waitForURL('/transactions')
    const tabs = page.getByRole('navigation', { name: 'Transactions section navigation' })
    await tabs.getByRole('link', { name: 'Categories' }).click()
    await page.waitForURL('/categories')
    await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('all 19 routes expose the shell title and browser history remains functional', async ({
    page,
  }) => {
    for (const route of ALL_ROUTES) {
      await page.goto(route)
      await expect(page.locator('[data-startup-state]')).toHaveAttribute(
        'data-startup-state',
        /ready|error/
      )
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    }

    await page.goto('/transactions')
    await page.goto('/accounts')
    await page.goBack()
    await expect(page).toHaveURL(/\/transactions$/)
  })
})

test.describe('mobile native navigation', () => {
  test.skip(({ isMobile }) => !isMobile, 'Mobile navigation is hidden on desktop')

  test('keeps primary groups active on their contextual pages', async ({ page }) => {
    const bottomNav = page.getByRole('navigation', { name: 'Mobile primary navigation' })
    for (const [path, group] of [
      ['/categories', 'Transactions'],
      ['/investments', 'Accounts'],
      ['/receivables', 'Accounts'],
    ]) {
      await page.goto(path)
      await expect(bottomNav.getByRole('link', { name: group })).toHaveAttribute(
        'aria-current',
        'page'
      )
      await expect(bottomNav.getByRole('button', { name: 'More pages' })).not.toHaveClass(
        /bottom-nav-link-active/
      )
    }
  })

  test('shows three primary destinations and grouped More with all routes', async ({ page }) => {
    const bottomNav = page.getByRole('navigation', { name: 'Mobile primary navigation' })
    await expect(bottomNav.getByRole('link')).toHaveCount(3)
    await expect(bottomNav.getByRole('link', { name: 'Overview' })).toBeVisible()
    await expect(bottomNav.getByRole('link', { name: 'Transactions' })).toBeVisible()
    await expect(bottomNav.getByRole('link', { name: 'Accounts' })).toBeVisible()

    await bottomNav.getByRole('button', { name: 'More pages' }).click()
    const more = page.getByRole('dialog')
    await expect(more.getByRole('link')).toHaveCount(19)
    for (const group of [
      'Overview',
      'Transactions',
      'Accounts',
      'Planning',
      'Insights',
      'Settings',
    ]) {
      await expect(more.getByRole('heading', { name: group })).toBeVisible()
    }

    await more.getByRole('link', { name: 'Extensions' }).click()
    await page.waitForURL('/extensions')
    await expect(page.getByRole('heading', { level: 1, name: 'Extensions' })).toBeVisible()
    await expect(bottomNav.getByRole('button', { name: 'More pages' })).toHaveClass(
      /bottom-nav-link-active/
    )
  })
})
