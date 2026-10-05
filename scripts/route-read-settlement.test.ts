// @vitest-environment node
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'vitest'
import type { Page, Request } from '@playwright/test'
import { RouteReadSettlement } from '../e2e/fixtures/route-read-settlement'

const empty = { pending: [], active: [], unmatched: [], errors: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function harness() {
  const page = Object.assign(new EventEmitter(), { url: () => 'http://e2e.test/reports' })
  const reads = new RouteReadSettlement(page as unknown as Page)
  const finish = (request: Request) =>
    Promise.all(page.listeners('requestfinished').map((listener) => listener(request)))
  function request(
    body: Record<string, unknown>,
    responseBody: unknown,
    status = 200,
    path = '/api/db/transaction'
  ) {
    const request = {
      url: () => `http://e2e.test${path}`,
      method: () => 'POST',
      postDataJSON: () => body,
      failure: () => ({ errorText: 'net::ERR_ABORTED' }),
      response: async () => ({
        ok: () => status >= 200 && status < 300,
        status: () => status,
        json: async () => responseBody,
      }),
    } as unknown as Request
    page.emit('request', request)
    return request
  }
  return { page, reads, finish, request }
}

test('tracks every begin and terminal, not just one commit or response headers', async () => {
  const h = harness()
  const first = h.request({ action: 'begin' }, { transactionId: 'first' })
  const second = h.request({ action: 'begin' }, { transactionId: 'second' })
  assert.equal(h.reads.snapshot().pending.length, 2)
  await h.finish(first)
  await h.finish(second)
  const commit = h.request(
    { action: 'commit', transactionId: 'first' },
    { ok: true, status: 'committed' }
  )
  h.page.emit('response', await commit.response())
  assert.equal(h.reads.snapshot().active.length, 2)
  await h.finish(commit)
  assert.match(h.reads.snapshot().active[0], /\/reports:.*id=second/)
  assert.equal(h.reads.snapshot().active.length, 1)
  const rollback = h.request(
    { action: 'rollback', transactionId: 'second' },
    { ok: true, status: 'rolled_back' }
  )
  await h.finish(rollback)
  assert.deepEqual(h.reads.snapshot(), empty)
  h.reads.dispose()
  assert.equal(h.page.listenerCount('request'), 0)
  assert.equal(h.page.listenerCount('requestfinished'), 0)
  assert.equal(h.page.listenerCount('requestfailed'), 0)
})

test('a pending begin body prevents success even if its commit is processed first', async () => {
  const h = harness()
  const body = deferred<{ transactionId: string }>()
  const begin = h.request({ action: 'begin' }, body.promise)
  const processingBegin = h.finish(begin)
  const commit = h.request(
    { action: 'commit', transactionId: 'late-begin' },
    { ok: true, status: 'committed' }
  )
  await h.finish(commit)
  assert.equal(h.reads.snapshot().pending.length, 1)
  assert.match(h.reads.snapshot().unmatched[0], /late-begin/)
  body.resolve({ transactionId: 'late-begin' })
  await processingBegin
  assert.deepEqual(h.reads.snapshot(), empty)
})

test('terminal body processing stays pending until its actual result is known', async () => {
  const h = harness()
  await h.finish(h.request({ action: 'begin' }, { transactionId: 'held' }))
  const body = deferred<{ ok: boolean; status: string }>()
  const commit = h.request({ action: 'commit', transactionId: 'held' }, body.promise)
  const processingCommit = h.finish(commit)
  assert.equal(h.reads.snapshot().pending.length, 1)
  assert.match(h.reads.snapshot().active[0], /held/)
  body.resolve({ ok: true, status: 'committed' })
  await processingCommit
  assert.deepEqual(h.reads.snapshot(), empty)
})

test('an unrelated terminal cannot settle an active transaction', async () => {
  const h = harness()
  await h.finish(h.request({ action: 'begin' }, { transactionId: 'real-id' }))
  await h.finish(
    h.request({ action: 'commit', transactionId: 'other-id' }, { ok: true, status: 'committed' })
  )
  assert.match(h.reads.snapshot().active[0], /real-id/)
  assert.match(h.reads.snapshot().unmatched[0], /other-id/)
})

test('failed begin and missing IDs cannot be mistaken for zero active transactions', async () => {
  for (const status of [200, 503]) {
    const h = harness()
    await h.finish(h.request({ action: 'begin' }, {}, status))
    assert.equal(h.reads.snapshot().errors.length, 1)
    assert.match(h.reads.snapshot().errors[0], /\/reports:.*begin/)
  }
  const h = harness()
  h.page.emit('requestfailed', h.request({ action: 'begin' }, {}))
  assert.match(h.reads.snapshot().errors[0], /begin.*ERR_ABORTED/)
})

test('non-2xx, failed, expired and unfinished terminals never count as successful settlement', async () => {
  for (const [status, result] of [
    [500, { ok: true, status: 'committed' }],
    [200, { ok: false, status: 'committed' }],
    [200, { ok: true, status: 'expired_rolled_back' }],
    [200, { ok: true, status: 'commit_failed' }],
  ] as const) {
    const h = harness()
    await h.finish(h.request({ action: 'begin' }, { transactionId: 'bad-terminal' }))
    await h.finish(h.request({ action: 'commit', transactionId: 'bad-terminal' }, result, status))
    assert.match(h.reads.snapshot().active[0], /bad-terminal/)
    assert.match(h.reads.snapshot().errors[0], /\/reports:.*commit id=bad-terminal/)
  }
  const h = harness()
  await h.finish(h.request({ action: 'begin' }, { transactionId: 'unfinished' }))
  const commit = h.request(
    { action: 'commit', transactionId: 'unfinished' },
    { ok: true, status: 'committed' }
  )
  assert.match(h.reads.snapshot().pending[0], /unfinished/)
  h.page.emit('requestfailed', commit)
  assert.match(h.reads.snapshot().errors[0], /unfinished.*ERR_ABORTED/)
  assert.match(h.reads.snapshot().active[0], /unfinished/)
})

test('a failed transaction query remains a failure after a successful rollback', async () => {
  for (const requestFailed of [true, false]) {
    const h = harness()
    await h.finish(h.request({ action: 'begin' }, { transactionId: 'query-failed' }))
    const query = h.request(
      { transactionId: 'query-failed', sql: 'SELECT 1' },
      {},
      500,
      '/api/db/query'
    )
    if (requestFailed) h.page.emit('requestfailed', query)
    else await h.finish(query)
    await h.finish(
      h.request(
        { action: 'rollback', transactionId: 'query-failed' },
        { ok: true, status: 'rolled_back' }
      )
    )
    assert.equal(h.reads.snapshot().active.length, 0)
    assert.match(h.reads.snapshot().errors[0], /\/reports:.*query.*query-failed/)
  }
})

test('dashboard requires mounted loaded DOM and document drain before accepting an empty tracker', async () => {
  const h = harness()
  const mounted = deferred<void>()
  const mountEntered = deferred<'mount'>()
  const idle = deferred<void>()
  const idleEntered = deferred<'idle'>()
  const calls: string[] = []
  // Exercise the real Playwright matchers without launching a browser. Their Locator
  // protocol delegates the DOM assertion to _expect; each completion is test-controlled.
  class Locator {
    constructor(private selector: string) {}
    async _expect(expression: string) {
      calls.push(`${this.selector}: ${expression}`)
      if (this.selector === '#overview-finance-heading') {
        assert.equal(expression, 'to.be.visible')
        mountEntered.resolve('mount')
        await mounted.promise
      }
      return { matches: true }
    }
  }
  Object.assign(h.page, {
    url: () => 'http://e2e.test/',
    locator: (selector: string) => new Locator(selector),
    waitForLoadState: async (state: string, options: { timeout: number }) => {
      assert.equal(state, 'networkidle')
      assert.equal(options.timeout, 5000)
      idleEntered.resolve('idle')
      await idle.promise
    },
  })
  let crossed = false
  const boundary = h.reads.wait().then(() => {
    crossed = true
    return 'crossed' as const
  })
  assert.equal(await Promise.race([mountEntered.promise, boundary]), 'mount')
  assert.deepEqual(h.reads.snapshot(), empty) // Startup-only/zero-sample would leave here.
  mounted.resolve()
  assert.equal(await Promise.race([idleEntered.promise, boundary]), 'idle')
  assert.deepEqual(calls, [
    '[data-startup-state]: to.have.attribute.value',
    '#overview-finance-heading: to.be.visible',
    '#spending-pace-tab: to.be.enabled',
  ])
  // As in the trace, another read starts after the earlier empty snapshot.
  const goals = h.request({ sql: 'SELECT g.* FROM goals g', params: [] }, [], 200, '/api/db/query')
  assert.equal(h.reads.snapshot().pending.length, 1)
  await h.finish(goals)
  assert.deepEqual(h.reads.snapshot(), empty)
  assert.equal(crossed, false)
  idle.resolve()
  assert.equal(await boundary, 'crossed')
  h.reads.dispose()
})

test('non-dashboard post-filter gap drains document activity before accepting an empty tracker', async () => {
  const h = harness()
  const idle = deferred<void>()
  const idleEntered = deferred<'idle'>()
  class Locator {
    async _expect(expression: string) {
      assert.equal(expression, 'to.have.attribute.value')
      return { matches: true }
    }
  }
  Object.assign(h.page, {
    url: () => 'http://e2e.test/transactions?currency=USD&status=pending&view=review',
    locator: () => new Locator(),
    waitForLoadState: async (state: string, options: { timeout: number }) => {
      assert.equal(state, 'networkidle')
      assert.equal(options.timeout, 5000)
      idleEntered.resolve('idle')
      await idle.promise
    },
  })
  let crossed = false
  const boundary = h.reads.wait().then(() => {
    crossed = true
    return 'crossed' as const
  })
  try {
    // Earlier filter requests have finished; the next read has not started yet.
    assert.deepEqual(h.reads.snapshot(), empty)
    assert.equal(await Promise.race([idleEntered.promise, boundary]), 'idle')
    const query = h.request(
      { sql: 'SELECT * FROM transactions WHERE status = ?', params: ['pending'] },
      [],
      200,
      '/api/db/query'
    )
    assert.equal(h.reads.snapshot().pending.length, 1)
    assert.equal(crossed, false)
    await h.finish(query)
    assert.deepEqual(h.reads.snapshot(), empty)
    assert.equal(crossed, false)
    idle.resolve()
    assert.equal(await boundary, 'crossed')
  } finally {
    idle.resolve()
    await boundary
    h.reads.dispose()
  }
})
