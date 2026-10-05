import { expect, test as base, type Page, type Request } from '@playwright/test'

interface PendingRequest {
  label: string
  action?: string
  transactionId?: string
}

/** Observe before the first navigation; response headers alone do not release a lease. */
export class RouteReadSettlement {
  private pending = new Map<Request, PendingRequest>()
  private begun = new Map<string, string>()
  private finalized = new Map<string, string>()
  private errors: string[] = []

  constructor(private page: Page) {
    page.on('request', this.onRequest)
    page.on('requestfinished', this.onFinished)
    page.on('requestfailed', this.onFailed)
  }

  private onRequest = (request: Request) => {
    const path = new URL(request.url()).pathname
    if (request.method() !== 'POST' || !path.startsWith('/api/db/')) return
    const route = new URL(this.page.url()).pathname
    try {
      const body = request.postDataJSON()
      const action = path === '/api/db/transaction' ? body.action : undefined
      const transactionId = body.transactionId
      this.pending.set(request, {
        action,
        transactionId,
        label: `${route}: ${path} ${action ?? ''} id=${transactionId ?? '(awaiting begin response / non-transactional)'}`,
      })
    } catch (error) {
      this.errors.push(`${route}: ${path}: ${String(error)}`)
    }
  }

  private onFinished = async (request: Request) => {
    const entry = this.pending.get(request)
    if (!entry) return
    try {
      const response = await request.response()
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'}`)
      if (entry.action) {
        // Keep the request pending during asynchronous body processing. A later commit's
        // body can be processed before its begin's body, so retain both sets of IDs.
        const body = await response.json()
        if (entry.action === 'begin') {
          if (typeof body.transactionId !== 'string' || !body.transactionId) {
            throw new Error('begin returned no transaction ID')
          }
          this.begun.set(body.transactionId, entry.label)
        } else {
          const expected = entry.action === 'commit' ? 'committed' : 'rolled_back'
          if (
            !entry.transactionId ||
            !['commit', 'rollback'].includes(entry.action) ||
            body.ok !== true ||
            body.status !== expected
          ) {
            throw new Error(`invalid ${entry.action} result: ${JSON.stringify(body)}`)
          }
          this.finalized.set(entry.transactionId, entry.label)
        }
      }
    } catch (error) {
      this.errors.push(`${entry.label}: ${String(error)}`)
    } finally {
      this.pending.delete(request)
    }
  }

  private onFailed = (request: Request) => {
    const entry = this.pending.get(request)
    if (!entry) return
    this.errors.push(`${entry.label}: ${request.failure()?.errorText ?? 'request failed'}`)
    this.pending.delete(request)
  }

  snapshot() {
    return {
      pending: [...this.pending.values()].map((entry) => entry.label),
      active: [...this.begun]
        .filter(([id]) => !this.finalized.has(id))
        .map(([id, route]) => `${route}: active id=${id}`),
      unmatched: [...this.finalized]
        .filter(([id]) => !this.begun.has(id))
        .map(([id, route]) => `${route}: terminal without observed begin id=${id}`),
      errors: [...this.errors],
    }
  }

  async wait() {
    try {
      // Positive route-owned completion must precede the network drain: zero requests
      // before a lazy route/effect starts is not evidence that its reads have completed.
      await expect(this.page.locator('[data-startup-state]')).toHaveAttribute(
        'data-startup-state',
        'ready'
      )
      if (new URL(this.page.url()).pathname === '/insights') {
        await expect(this.page).toHaveURL(/\/reports$/)
      }
      const route = new URL(this.page.url()).pathname
      if (route === '/') {
        await expect(this.page.locator('#overview-finance-heading')).toBeVisible()
        await expect(this.page.locator('#spending-pace-tab')).toBeEnabled()
        // Dashboard goals/history chain more reads after currency loads, including
        // when there are no goal rows to render. A momentary empty DB tracker between
        // those requests is not completion. After the actual dashboard has mounted
        // and its transaction/split view has loaded, also drain document activity.
        // Keep the strict response/transaction checks below; idle alone is not success.
        await this.page.waitForLoadState('networkidle', { timeout: 5000 })
      } else if (route === '/settings') {
        // The disclosure can be closed. Enabled means a usable catalog AND loading=false.
        await expect(this.page.locator('#classification-type-treatment')).toBeEnabled()
        await expect(this.page.locator('#classification-types article h4').first()).toBeAttached()
        await expect(this.page.locator('#classification-types [role="alert"]')).toHaveCount(0)
      } else if (route === '/reports') {
        const result = this.page.locator('.native-panel[aria-busy]')
        await expect(result).toHaveAttribute('aria-busy', 'false')
        // A rendered incomplete financial result is valid; a loading/error state is not.
        await expect(result.getByRole('table')).toBeVisible()
        await expect(result.getByRole('alert')).toHaveCount(0)
      } else if (route === '/budgets') {
        // This report mounts even when its containing category panel is hidden.
        await expect(this.page.locator('#category-actuals-title')).toBeAttached()
        await expect(this.page.locator('.page-content [aria-busy="true"]')).toHaveCount(0)
        await expect(this.page.locator('.page-content [role="alert"]')).toHaveCount(0)
      }
      await expect
        .poll(() => this.snapshot(), { message: `DB reads must settle before leaving ${route}` })
        .toEqual({ pending: [], active: [], unmatched: [], errors: [] })
    } catch (error) {
      throw new Error(
        `Read settlement failed for ${this.page.url()}: ${JSON.stringify(this.snapshot())}`,
        { cause: error }
      )
    }
  }

  dispose() {
    this.page.off('request', this.onRequest)
    this.page.off('requestfinished', this.onFinished)
    this.page.off('requestfailed', this.onFailed)
  }
}

/** Only the intentional read/shell surveys opt into this document-disposal contract. */
export const test = base.extend<{ routeReads: RouteReadSettlement }>({
  routeReads: [
    async ({ page }, use) => {
      const reads = new RouteReadSettlement(page)
      try {
        await use(reads)
        await reads.wait() // Also drain the final route before context teardown.
      } finally {
        reads.dispose()
      }
    },
    { auto: true },
  ],
})
