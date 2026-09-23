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

  test('shows six groups with expandable children and no shell tabs', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
    await expect(sidebar.getByRole('link', { name: 'Overview' })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Transactions' })).toBeVisible()
    for (const label of ['Accounts', 'Planning', 'Insights', 'Settings']) {
      await expect(sidebar.getByRole('button', { name: label })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    }

    const settings = sidebar.getByRole('button', { name: 'Settings' })
    await settings.press('Enter')
    await expect(settings).toHaveAttribute('aria-expanded', 'true')
    await sidebar.getByRole('link', { name: 'Categories' }).click()
    await page.waitForURL('/categories')

    const heading = page.getByRole('heading', { level: 1, name: 'Categories' })
    await expect(heading).toHaveClass(/sr-only/)
    await expect(page.locator('.native-subnav')).toHaveCount(0)
    await expect(settings).toHaveClass(/sidebar-group-active/)
    await expect(sidebar.getByRole('link', { name: 'Categories' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  test('a collapsed rail expands before opening multi-route destinations', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
    await sidebar.getByRole('button', { name: 'Collapse sidebar' }).click()

    const planning = sidebar.getByRole('button', { name: 'Planning' })
    await expect(planning).toHaveAttribute('aria-expanded', 'false')
    await planning.click()

    await expect(sidebar.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
    await expect(sidebar.getByRole('button', { name: 'Planning' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(sidebar.getByRole('link', { name: 'Budgets' })).toBeVisible()
  })

  test('all 18 visible routes expose the shell title and browser history remains functional', async ({
    page,
  }) => {
    for (const route of ALL_ROUTES) {
      await page.goto(route)
      await expect(page.locator('[data-startup-state]')).toHaveAttribute(
        'data-startup-state',
        /ready|error/
      )
      const heading = page.getByRole('heading', { level: 1 })
      await expect(heading).toHaveCount(1)
      await expect(heading).toHaveClass(/sr-only/)
      await expect(page.locator('.native-topbar')).toHaveCount(0)
    }

    await page.goto('/insights')
    await page.waitForURL('/reports')
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toHaveClass(/sr-only/)

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
    await expect(more.getByRole('link')).toHaveCount(18)
    await expect(more.getByRole('link', { name: 'Insights' })).toHaveCount(0)
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

    const settingsGroup = more.getByRole('region', { name: 'Settings' })
    await expect(settingsGroup.getByRole('link', { name: 'Categories' })).toHaveAttribute(
      'href',
      '/categories'
    )

    await more.getByRole('link', { name: 'Extensions' }).click()
    await page.waitForURL('/extensions')
    await expect(page.locator('.native-topbar')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Extensions' })).toHaveClass(/sr-only/)
    await expect(bottomNav.getByRole('button', { name: 'More pages' })).toHaveClass(
      /bottom-nav-link-active/
    )
  })
})
