import { expect, type Request } from '@playwright/test'
import { test } from './fixtures/route-read-settlement'
import { mockTauri } from './fixtures/tauri-mock'

// Uses the real backend and real report SQL. No response or transaction is fabricated.
test('report hard-navigation waits for a held commit to reach the backend and finish', async ({
  page,
  routeReads,
}) => {
  await mockTauri(page)
  const reportIds = new Set<string>()
  const identifyReport = (request: Request) => {
    if (new URL(request.url()).pathname !== '/api/db/query' || request.method() !== 'POST') return
    const body = request.postDataJSON()
    if (body.transactionId && body.sql.includes('FROM transaction_consumption_classifications')) {
      reportIds.add(body.transactionId)
    }
  }
  page.on('request', identifyReport)

  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reportHeld!: (id: string) => void
  const held = new Promise<string>((resolve) => {
    reportHeld = resolve
  })
  let heldId: string | undefined
  let forwarded = false
  let terminalFinished = false
  const observeTerminal = (request: Request) => {
    if (new URL(request.url()).pathname !== '/api/db/transaction') return
    const body = request.postDataJSON()
    if (body.action === 'commit' && body.transactionId === heldId) terminalFinished = true
  }
  page.on('requestfinished', observeTerminal)
  await page.route('**/api/db/transaction', async (route) => {
    const body = route.request().postDataJSON()
    if (body.action === 'commit' && reportIds.has(body.transactionId) && !heldId) {
      heldId = body.transactionId
      reportHeld(body.transactionId)
      // Unlike route.fetch(), this has NOT sent COMMIT to the server yet.
      await gate
      forwarded = true
    }
    await route.continue()
  })

  let boundary: Promise<void> | undefined
  try {
    await page.goto('/insights')
    await page.waitForURL('/reports')
    const id = await held

    // The old history-tail predicate is already satisfied while the real lease is held.
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toHaveClass(/sr-only/)
    expect(forwarded).toBe(false)
    expect(terminalFinished).toBe(false)
    expect(routeReads.snapshot().pending.some((entry) => entry.includes(`commit id=${id}`))).toBe(
      true
    )

    let crossedBoundary = false
    boundary = routeReads.wait().then(async () => {
      expect(forwarded).toBe(true)
      expect(terminalFinished).toBe(true)
      expect(routeReads.snapshot()).toEqual({ pending: [], active: [], unmatched: [], errors: [] })
      crossedBoundary = true
      await page.goto('/transactions')
    })
    // Attach a rejection handler immediately, but propagate it below after releasing.
    void boundary.catch(() => {})
    await expect(page.locator('.native-panel[aria-busy]')).toHaveAttribute('aria-busy', 'true')
    expect(crossedBoundary).toBe(false)
    expect(terminalFinished).toBe(false)
    await expect(page).toHaveURL(/\/reports$/)

    release()
    await boundary
    await expect(page).toHaveURL(/\/transactions$/)
    await routeReads.wait()
  } finally {
    release()
    // Never leave our intentionally held lease behind, even on an assertion failure.
    try {
      if (boundary) await boundary
      await routeReads.wait()
    } finally {
      page.off('request', identifyReport)
      page.off('requestfinished', observeTerminal)
      await page.unroute('**/api/db/transaction')
    }
  }
})
