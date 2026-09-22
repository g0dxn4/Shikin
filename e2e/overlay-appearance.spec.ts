import { expect, test, type Locator, type Page } from '@playwright/test'
import { mockTauri } from './fixtures/tauri-mock'

const APPEARANCES = ['native-light', 'native-dark'] as const
type Appearance = (typeof APPEARANCES)[number]

const overlayLocator = (page: Page) => page.locator('[class*="bg-black/"]')

async function waitForApp(page: Page, path: string) {
  await mockTauri(page)
  await page.goto(path)
  await expect(page.locator('[data-startup-state]')).toHaveAttribute('data-startup-state', 'ready')
}

/** Apply appearance in the document only — never persist through settings/storage. */
async function applyAppearance(page: Page, appearance: Appearance) {
  await page.evaluate((next) => {
    const root = document.documentElement
    root.dataset.appearance = next
    root.style.colorScheme = next === 'native-dark' ? 'dark' : 'light'
    root.classList.toggle('dark', next === 'native-dark')
  }, appearance)
  await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance)
}

async function readOverlayPaint(overlay: Locator) {
  return overlay.evaluate((el) => {
    const color = getComputedStyle(el).backgroundColor
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d canvas context unavailable')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a, alpha: a / 255, color }
  })
}

async function expectTranslucentScrim(page: Page, overlay: Locator) {
  await expect(overlay).toHaveCount(1)
  const box = await overlay.boundingBox()
  const viewport = page.viewportSize()
  expect(box).toBeTruthy()
  expect(viewport).toBeTruthy()
  expect(box!.width).toBeGreaterThan(viewport!.width * 0.9)
  expect(box!.height).toBeGreaterThan(viewport!.height * 0.9)

  const paint = await readOverlayPaint(overlay)
  expect(paint.alpha).toBeGreaterThan(0)
  expect(paint.alpha).toBeLessThan(1)
  expect(paint.alpha).toBeCloseTo(0.35, 1)
  expect(paint.r).toBeLessThan(40)
  expect(paint.g).toBeLessThan(40)
  expect(paint.b).toBeLessThan(40)
}

async function expectContextLaidOut(page: Page) {
  const content = page.locator('.page-content').first()
  const box = await content.boundingBox()
  expect(box).toBeTruthy()
  expect(box!.width).toBeGreaterThan(0)
  expect(box!.height).toBeGreaterThan(0)
}

async function expectFocusInside(container: Locator) {
  await expect
    .poll(async () => container.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true)
}

test.describe('dialog overlay', () => {
  test.skip(({ isMobile }) => isMobile, 'Add Account dialog is exercised on desktop')

  for (const appearance of APPEARANCES) {
    test(`Add Account overlay stays translucent in ${appearance}`, async ({ page }) => {
      await waitForApp(page, '/accounts')
      await applyAppearance(page, appearance)

      const trigger = page.getByRole('button', { name: /Add Account/i }).first()
      await trigger.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading', { name: /Add Account/i })).toBeVisible()
      await expectFocusInside(dialog)

      const overlay = overlayLocator(page)
      await expectTranslucentScrim(page, overlay)
      await expectContextLaidOut(page)

      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(overlay).toHaveCount(0)
      await expect(trigger).toBeEnabled()
      await trigger.focus()
      await expect(trigger).toBeFocused()

      await trigger.click()
      await expect(dialog).toBeVisible()
      await expectFocusInside(dialog)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(overlay).toHaveCount(0)
    })
  }
})

test.describe('sheet overlay', () => {
  test.skip(({ isMobile }) => !isMobile, 'More sheet is exercised on mobile')

  for (const appearance of APPEARANCES) {
    test(`More sheet overlay stays translucent in ${appearance}`, async ({ page }) => {
      await waitForApp(page, '/accounts')
      await applyAppearance(page, appearance)

      const more = page.getByRole('button', { name: 'More pages' })
      await more.click()

      const sheet = page.getByRole('dialog')
      await expect(sheet).toBeVisible()
      await expect(sheet.getByRole('heading', { name: 'All destinations' })).toBeVisible()
      await expectFocusInside(sheet)

      const overlay = overlayLocator(page)
      await expectTranslucentScrim(page, overlay)
      await expectContextLaidOut(page)

      await sheet.getByRole('button', { name: 'Close' }).click()
      await expect(sheet).toHaveCount(0)
      await expect(overlay).toHaveCount(0)
      await expect(more).toBeFocused()

      await more.click()
      await expect(sheet).toBeVisible()
      await expectFocusInside(sheet)
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)
      await expect(overlay).toHaveCount(0)
      await expect(more).toBeFocused()
    })
  }
})
