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

    await expect(
      page.locator('#overview-summary-panel').getByText('Net worth', { exact: true })
    ).toBeVisible()
    await expect(page.getByText('Income').first()).toBeVisible()
    await expect(page.getByText('Spent').first()).toBeVisible()
    await expect(page.getByRole('img', { name: 'Net worth over time' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByText('Net worth history')).toBeVisible()

    await page.getByRole('tab', { name: 'Compare accounts' }).click()
    await expect(page.getByText('Add accounts to compare their recorded balances.')).toBeVisible()
    await expect(page.getByLabel('First account')).toHaveCount(0)
    await expect(page.getByLabel('Second account')).toHaveCount(0)
  })

  test('keeps the finance panel and following content stationary across tabs on desktop and mobile', async ({
    page,
  }) => {
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')
      const measures = []
      for (const tab of ['Summary', 'History', 'Compare accounts']) {
        await page.getByRole('tab', { name: tab }).click()
        measures.push(
          await page.locator('#overview-summary-panel').evaluate((summary) => {
            const panels = ['summary', 'history', 'comparison'].map(
              (name) => document.getElementById(`overview-${name}-panel`)!
            )
            const card = summary.closest('.native-panel')!
            const following = card.nextElementSibling!
            return {
              card: [card.getBoundingClientRect().width, card.getBoundingClientRect().height],
              panels: panels.map((panel) => [
                panel.getBoundingClientRect().width,
                panel.getBoundingClientRect().height,
              ]),
              followingTop: following.getBoundingClientRect().top,
              hiddenInert: panels
                .filter((panel) => panel.getAttribute('aria-hidden') === 'true')
                .every((panel) => panel.hasAttribute('inert')),
            }
          })
        )
      }
      expect(measures[0].card).toEqual(measures[1].card)
      expect(measures[1].card).toEqual(measures[2].card)
      expect(measures[0].followingTop).toBe(measures[1].followingTop)
      expect(measures[1].followingTop).toBe(measures[2].followingTop)
      for (const measure of measures) {
        expect(measure.panels[0]).toEqual(measure.panels[1])
        expect(measure.panels[1]).toEqual(measure.panels[2])
        expect(measure.hiddenInert).toBe(true)
      }
    }
  })

  test('metric cards display values', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('#overview-summary-panel').getByText('$0.00').first()).toBeVisible()
  })

  test('has correct page structure', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.page-content')).toBeVisible()
    await expect(page.locator('.native-panel').first()).toBeVisible()
  })
})
