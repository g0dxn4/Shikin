import { test, expect, type Locator } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

async function expectClippedTableWrapper(table: Locator, caption: string) {
  await expect(table).toHaveCount(1)
  await expect(table).toHaveAccessibleName(caption)

  const geometry = await table.evaluate((element) => {
    const wrapper = element.parentElement
    if (!wrapper) throw new Error('Expected the accessible table to have a wrapper')

    const wrapperRect = wrapper.getBoundingClientRect()
    const wrapperStyle = getComputedStyle(wrapper)
    const tableStyle = getComputedStyle(element)

    return {
      tableHasSrOnly: element.classList.contains('sr-only'),
      tableAriaHidden: element.getAttribute('aria-hidden'),
      tableDisplay: tableStyle.display,
      wrapperTag: wrapper.tagName,
      wrapperHasSrOnly: wrapper.classList.contains('sr-only'),
      wrapperAriaHidden: wrapper.getAttribute('aria-hidden'),
      wrapperDisplay: wrapperStyle.display,
      wrapperOverflow: wrapperStyle.overflow,
      width: wrapperRect.width,
      height: wrapperRect.height,
    }
  })

  expect(geometry).toMatchObject({
    tableHasSrOnly: false,
    tableAriaHidden: null,
    wrapperTag: 'DIV',
    wrapperHasSrOnly: true,
    wrapperAriaHidden: null,
    wrapperOverflow: 'hidden',
  })
  expect(geometry.tableDisplay).not.toBe('none')
  expect(geometry.wrapperDisplay).not.toBe('none')
  expect(geometry.width).toBeLessThanOrEqual(1)
  expect(geometry.height).toBeLessThanOrEqual(1)
}

test.describe('accessible chart data tables', () => {
  test.skip(({ isMobile }) => isMobile, 'Scroll geometry regression uses the desktop dashboard')

  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
    await page.addInitScript(() => {
      window.localStorage.removeItem('shikin_dashboard_spending_mode')
    })
  })

  test('keeps chart tables semantic and clips their wrappers while the dashboard scrolls', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const cashFlowTable = page.locator('#overview-cashflow-data')
    const paceTable = page.locator('#spending-pace-data')

    await expect(page.locator('[aria-describedby="overview-cashflow-data"]')).toHaveCount(0)
    await expect(page.locator('[aria-describedby="spending-pace-data"]')).toHaveCount(1)
    await expectClippedTableWrapper(paceTable, 'Cumulative spending pace for current month')

    const main = page.getByRole('main')
    await main.evaluate((element) => {
      element.scrollTo(0, Math.min(300, element.scrollHeight - element.clientHeight))
    })
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

    await expectClippedTableWrapper(paceTable, 'Cumulative spending pace for current month')

    await page.getByRole('tab', { name: 'Trend' }).click()
    const trendTable = page.locator('#spending-trend-data')
    await expect(page.locator('[aria-describedby="spending-trend-data"]')).toHaveCount(1)
    await expectClippedTableWrapper(
      trendTable,
      'Income, expenses, and net trend over the last 12 months'
    )

    await page.getByRole('tab', { name: 'Categories' }).click()
    const categoriesTable = page.locator('#spending-categories-data')
    await expect(page.locator('[aria-describedby="spending-categories-data"]')).toHaveCount(1)
    await expectClippedTableWrapper(categoriesTable, 'Monthly spending composition by category')

    await page.getByRole('tab', { name: 'Cash flow' }).click()
    await expect(page.locator('[aria-describedby="overview-cashflow-data"]')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Cash flow', exact: true })).toHaveCount(1)
    await expectClippedTableWrapper(cashFlowTable, 'Cash flow')
    await main.evaluate((element) => element.scrollTo(0, 150))
    await expectClippedTableWrapper(cashFlowTable, 'Cash flow')
  })
})
