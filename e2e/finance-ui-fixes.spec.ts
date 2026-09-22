import { test, expect, type Locator } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 480 },
] as const

async function expectInViewport(locator: Locator, viewport: { width: number; height: number }) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function expectNoHorizontalOverflow(locator: Locator) {
  const metrics = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      left: rect.left,
      right: rect.right,
    }
  })
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  return metrics
}

test.describe('finance UI layout fixes', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`investment dialog stays reachable at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/investments')
      await expect(page.locator('[data-startup-state]')).toHaveAttribute(
        'data-startup-state',
        'ready'
      )
      await page.getByRole('button', { name: 'Add Investment' }).first().click()

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

      await expectInViewport(dialog.getByRole('button', { name: 'Close' }), viewport)
      await expectInViewport(dialog.getByRole('button', { name: 'Save' }), viewport)
    })

    test(`investment gain metric keeps full values inside the strip at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/investments')
      await expect(page.locator('[data-startup-state]')).toHaveAttribute(
        'data-startup-state',
        'ready'
      )
      await expect(page.getByText('Total Gain/Loss')).toBeVisible({ timeout: 15000 })

      const strip = page.locator('.metric-strip').first()
      const gainItem = page.locator('.metric-item', { hasText: 'Total Gain/Loss' })
      const stripBox = await strip.boundingBox()
      const gainBox = await gainItem.boundingBox()
      expect(stripBox).not.toBeNull()
      expect(gainBox).not.toBeNull()
      expect(gainBox!.x + gainBox!.width).toBeLessThanOrEqual(stripBox!.x + stripBox!.width + 1)

      const gainText = (await gainItem.innerText()).replace(/\s+/g, '')
      expect(gainText).toMatch(/[+\-]\$[\d,]+(?:\.\d{2})?/)
      if (/\(/.test(gainText)) {
        expect(gainText).toMatch(/\([+\-]?\d+\.\d{2}%\)/)
      }

      const overflow = await strip.evaluate((element) => ({
        overflowX: getComputedStyle(element).overflowX,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      expect(overflow.overflowX).toBe('hidden')
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
    })
  }
})

test.describe('finance nested dialog wrapping', () => {
  test.beforeEach(async ({ page }) => {
    await mockTauri(page)
  })

  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 480 },
  ] as const) {
    test(`classification and identity dialogs fit at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport.width === 320 ? { width: 390, height: 844 } : viewport)
      await page.goto('/transactions')
      await expect(page.locator('[data-startup-state]')).toHaveAttribute(
        'data-startup-state',
        'ready'
      )
      const staged = page.getByRole('button', {
        name: /QA staged legacy transaction with deliberately verbose/,
      })
      if ((await staged.count()) === 0) {
        test.skip()
        return
      }

      await staged.first().click()
      const classify = page.getByRole('button', { name: /Classify consumption/ })
      await expect(classify).toBeVisible()
      await classify.click()
      const classification = page.getByRole('dialog').last()
      await expect(classification).toBeVisible()
      if (viewport.width === 320) await page.setViewportSize(viewport)
      await expectNoHorizontalOverflow(classification)
      await expectInViewport(classification.getByRole('button', { name: 'Close' }), viewport)
      await expectInViewport(
        classification.getByRole('button', { name: /Save role|Done/ }).last(),
        viewport
      )
      await page.keyboard.press('Escape')
      if (viewport.width === 320) await page.setViewportSize({ width: 390, height: 844 })

      await staged.first().click()
      const bind = page.getByRole('button', { name: 'Bind verified ID' })
      if ((await bind.count()) === 0) {
        return
      }
      await bind.click()
      const identity = page.getByRole('dialog').last()
      await expect(identity).toBeVisible()
      if (viewport.width === 320) await page.setViewportSize(viewport)
      await expectNoHorizontalOverflow(identity)
      const source = identity.getByLabel('Source namespace')
      const external = identity.getByLabel('Exact external ID')
      await source.fill('qa-verified-bank-unbroken-source-namespace-layout-stress')
      await external.fill('QA-EXT-UNBROKENLONGEXTERNALIDENTIFIERLAYOUTSTRESS')
      expect(await source.inputValue()).toContain('unbroken-source-namespace')
      expect(await external.inputValue()).toContain('UNBROKENLONGEXTERNALIDENTIFIER')
      await expect(identity.getByRole('checkbox')).toBeEnabled()
      await expectInViewport(identity.getByRole('button', { name: 'Close' }), viewport)
      await expectInViewport(
        identity.getByRole('button', { name: /Review identity binding|Cancel/ }).first(),
        viewport
      )
    })
  }
})
