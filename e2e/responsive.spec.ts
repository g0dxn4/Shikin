import { test, expect } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await page.goto('/')
  })

  test('mobile: sidebar is hidden', async ({ page }) => {
    const sidebar = page.locator('aside').first()
    await expect(sidebar).not.toBeVisible()
  })

  test('mobile: bottom nav is visible with 5 items', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')
    await expect(bottomNav).toBeVisible()

    const navLinks = bottomNav.getByRole('link')
    await expect(navLinks).toHaveCount(5)

    await expect(bottomNav.getByText('Dashboard')).toBeVisible()
    await expect(bottomNav.getByText('Transactions')).toBeVisible()
    await expect(bottomNav.getByText('Accounts')).toBeVisible()
    await expect(bottomNav.getByText('Investments')).toBeVisible()
    await expect(bottomNav.getByText('Settings')).toBeVisible()
  })

  test('mobile: bottom nav navigation works', async ({ page }) => {
    const bottomNav = page.locator('nav.fixed')

    await bottomNav.getByRole('link', { name: 'Transactions' }).click()
    await page.waitForURL('/transactions')
    expect(page.url()).toContain('/transactions')

    await bottomNav.getByRole('link', { name: 'Accounts' }).click()
    await page.waitForURL('/accounts')
    expect(page.url()).toContain('/accounts')

    await bottomNav.getByRole('link', { name: 'Investments' }).click()
    await page.waitForURL('/investments')
    expect(page.url()).toContain('/investments')

    await bottomNav.getByRole('link', { name: 'Settings' }).click()
    await page.waitForURL('/settings')
    expect(page.url()).toContain('/settings')

    await bottomNav.getByRole('link', { name: 'Dashboard' }).click()
    await page.waitForURL('/')
  })

  test('mobile: content has bottom padding', async ({ page }) => {
    const contentWrapper = page.locator('main .mx-auto')
    await expect(contentWrapper).toHaveClass(/pb-16/)
  })
})

test.describe('desktop viewport', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await page.goto('/')
  })

  test('desktop: sidebar is visible, bottom nav is hidden', async ({ page }) => {
    const sidebar = page.locator('aside').first()
    await expect(sidebar).toBeVisible()

    const bottomNav = page.locator('nav.fixed')
    await expect(bottomNav).not.toBeVisible()
  })
})
