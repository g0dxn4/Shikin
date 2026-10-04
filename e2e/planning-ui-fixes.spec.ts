import { test, expect, type Locator } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

const GOAL_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 844 },
  { width: 390, height: 480 },
] as const

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

async function expectInViewport(locator: Locator, viewportHeight: number) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight + 1)
}

test.describe('planning UI mobile fixes', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  for (const viewport of GOAL_VIEWPORTS) {
    test(`goal dialog stays reachable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/goals')
      await expect(page.locator('[data-startup-state]')).toHaveAttribute(
        'data-startup-state',
        'ready'
      )
      await page.getByRole('button', { name: 'Add Goal', exact: true }).first().click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect
        .poll(async () =>
          dialog.evaluate((element) => {
            const style = getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            return {
              overflowY: style.overflowY,
              top: rect.top,
              bottom: rect.bottom,
              focusInside: Boolean(element.contains(document.activeElement)),
            }
          })
        )
        .toMatchObject({
          overflowY: expect.stringMatching(/auto|scroll/),
          focusInside: true,
        })

      const geometry = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { top: rect.top, bottom: rect.bottom }
      })
      expect(geometry.top).toBeGreaterThanOrEqual(-1)
      expect(geometry.bottom).toBeLessThanOrEqual(viewport.height + 1)

      await expectInViewport(dialog.getByRole('button', { name: 'Close' }), viewport.height)
      await expectInViewport(dialog.getByRole('button', { name: 'Save' }), viewport.height)

      await page.getByLabel('Goal Name').fill('Viewport Goal')
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(page.getByRole('dialog', { name: /discard/i })).toBeVisible()
    })
  }

  test('heatmap range controls do not overlap the description at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/spending-heatmap')
    await expect(page.getByText('Daily Spending Activity')).toBeVisible({ timeout: 15000 })

    const description = page.getByText('Calendar intensity by day')
    const rangeGroup = page.getByRole('group', { name: 'Time range' })
    const descriptionBox = await description.boundingBox()
    const rangeBox = await rangeGroup.boundingBox()
    expect(descriptionBox).not.toBeNull()
    expect(rangeBox).not.toBeNull()
    expect(rectsOverlap(descriptionBox!, rangeBox!)).toBe(false)
  })

  test('selecting the active heatmap range does not stick on loading', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/spending-heatmap')
    await expect(page.getByText('Daily Spending Activity')).toBeVisible({ timeout: 15000 })

    const active = page.getByRole('button', { name: '3 Months' })
    await expect(active).toHaveAttribute('aria-pressed', 'true')
    await active.click()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Daily Spending Activity')).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
  })
})
