import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionClient } from '@/lib/database'

const database = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/database', () => database)
vi.mock('@/lib/ulid', () => ({ generateId: vi.fn() }))

import { generateId } from '@/lib/ulid'
import { createSplits, deleteSplits } from '../split-service'
import {
  activeFrontendEvidence,
  auditFrontendCorrection,
  guardFrontendEvidence,
  readFrontendConsumptionEvidence,
  readFrontendPaymentEvidence,
} from '../transaction-evidence'
import { listEligibleCardPayments } from '../card-payment-service'

const paymentSql = [
  'SELECT id, type, currency, account_mode, is_archived FROM accounts',
  'SELECT * FROM transactions',
  'SELECT * FROM transaction_splits',
  'SELECT * FROM transaction_consumption_classifications',
  'SELECT * FROM classification_type_revisions',
  'SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL',
]
const paymentTables = [
  'accounts',
  'transactions',
  'transaction_splits',
  'transaction_consumption_classifications',
  'classification_type_revisions',
  'card_statement_payment_links',
]
const owner = { id: 'tx', type: 'expense', amount: 1000, currency: 'USD' }
const tx: TransactionClient = {
  query: database.query,
  execute: database.execute,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function ordinaryRows(sql: string) {
  if (sql === 'SELECT * FROM transactions') return [owner]
  if (sql.includes('COALESCE(SUM(amount)')) return [{ total: 0 }]
  if (sql === 'SELECT type FROM categories WHERE id = ?') return [{ type: 'expense' }]
  return []
}

function controlledPaymentRead(synchronousFailure = -1) {
  const replies = paymentSql.map(() => deferred<unknown[]>())
  const issued = paymentSql.map(() => deferred<void>())
  const calls: string[] = []
  let readingPayments = false
  // A sequential reader never observes later rejections after an earlier failure.
  for (const reply of replies) void reply.promise.catch(() => {})
  database.query.mockImplementation((sql: string) => {
    if (sql === paymentSql[0]) readingPayments = true
    if (!readingPayments) return Promise.resolve(ordinaryRows(sql))
    const index = paymentSql.indexOf(sql)
    if (index < 0) return Promise.resolve([])
    calls.push(paymentTables[index])
    issued[index].resolve()
    if (index === synchronousFailure) throw new Error(`${paymentTables[index]}-failed`)
    return replies[index].promise
  })
  return { calls, replies, issued }
}

function runService(kind: 'split' | 'card') {
  return kind === 'split' ? deleteSplits('tx') : listEligibleCardPayments('card')
}

beforeEach(() => {
  vi.resetAllMocks()
  database.query.mockImplementation(async (sql: string) => ordinaryRows(sql))
  database.execute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
  database.withTransaction.mockImplementation(async (fn: (client: TransactionClient) => unknown) =>
    fn(tx)
  )
  vi.mocked(generateId).mockReturnValue('audit-id')
})
afterEach(() => vi.useRealTimers())

describe.each(['split', 'card'] as const)('%s public payment-evidence schedule', (kind) => {
  it('preserves issued queries while accounts is held, then rejects without writes', async () => {
    const control = controlledPaymentRead()
    const result = runService(kind).catch((error: Error) => error.message)
    await control.issued[0].promise
    expect(control.calls).toEqual(kind === 'split' ? paymentTables : ['accounts'])
    control.replies[0].reject(new Error('accounts-failed'))
    expect(await result).toBe('accounts-failed')
    expect(control.calls).toEqual(kind === 'split' ? paymentTables : ['accounts'])
    expect(database.withTransaction).toHaveBeenCalledTimes(1)
    expect(database.execute).not.toHaveBeenCalled()
  })

  it('preserves competing rejection precedence', async () => {
    const control = controlledPaymentRead()
    const result = runService(kind).catch((error: Error) => error.message)
    await control.issued[0].promise
    control.replies[1].reject(new Error('transactions-failed'))
    control.replies[0].reject(new Error('accounts-failed'))
    expect(await result).toBe(kind === 'split' ? 'transactions-failed' : 'accounts-failed')
    expect(control.calls).toEqual(kind === 'split' ? paymentTables : ['accounts'])
    expect(database.execute).not.toHaveBeenCalled()
  })

  it.each(paymentTables.map((table, index) => ({ table, index })))(
    'preserves asynchronous failure at $table',
    async ({ table, index }) => {
      const control = controlledPaymentRead()
      const result = runService(kind).catch((error: Error) => error.message)
      for (let earlier = 0; earlier < index; earlier++) {
        await control.issued[earlier].promise
        control.replies[earlier].resolve([])
      }
      await control.issued[index].promise
      control.replies[index].reject(new Error(`${table}-failed`))
      expect(await result).toBe(`${table}-failed`)
      expect(control.calls).toEqual(
        kind === 'split' ? paymentTables : paymentTables.slice(0, index + 1)
      )
      expect(database.execute).not.toHaveBeenCalled()
    }
  )

  it.each(paymentTables.map((table, index) => ({ table, index })))(
    'preserves synchronous short-circuit at $table',
    async ({ table, index }) => {
      const control = controlledPaymentRead(index)
      const result = runService(kind).catch((error: Error) => error.message)
      for (let earlier = 0; earlier < index; earlier++) {
        await control.issued[earlier].promise
        control.replies[earlier].resolve([])
      }
      expect(await result).toBe(`${table}-failed`)
      expect(control.calls).toEqual(paymentTables.slice(0, index + 1))
      expect(database.execute).not.toHaveBeenCalled()
    }
  )
})

describe('frontend evidence and correction contract', () => {
  it('retains SQL, property and row order without filtering historical evidence', async () => {
    database.query.mockImplementation(async (sql: string) => {
      const table = sql.match(/FROM (\w+)/)?.[1]
      return [{ id: `${table}-z` }, { id: `${table}-a` }]
    })
    const evidence = await readFrontendPaymentEvidence(tx)
    expect(database.query.mock.calls).toEqual(paymentSql.map((sql) => [sql]))
    expect(JSON.stringify(evidence)).toBe(
      '{"accounts":[{"id":"accounts-z"},{"id":"accounts-a"}],"transactions":[{"id":"transactions-z"},{"id":"transactions-a"}],"splits":[{"id":"transaction_splits-z"},{"id":"transaction_splits-a"}],"classifications":[{"id":"transaction_consumption_classifications-z"},{"id":"transaction_consumption_classifications-a"}],"typeRevisions":[{"id":"classification_type_revisions-z"},{"id":"classification_type_revisions-a"}],"activeLinks":[{"id":"card_statement_payment_links-z"},{"id":"card_statement_payment_links-a"}]}'
    )
    database.query.mockClear()
    expect(JSON.stringify(await readFrontendConsumptionEvidence(tx))).toBe(
      '{"transactions":[{"id":"transactions-z"},{"id":"transactions-a"}],"splits":[{"id":"transaction_splits-z"},{"id":"transaction_splits-a"}],"classifications":[{"id":"transaction_consumption_classifications-z"},{"id":"transaction_consumption_classifications-a"}],"typeRevisions":[{"id":"classification_type_revisions-z"},{"id":"classification_type_revisions-a"}]}'
    )
    expect(database.query.mock.calls).toEqual(paymentSql.slice(1, 5).map((sql) => [sql]))
    expect(database.withTransaction).not.toHaveBeenCalled()
  })

  it('reads active links before bucket allocations using the original parameter shape', async () => {
    database.query.mockResolvedValueOnce([{ id: 'active' }]).mockResolvedValueOnce([{ total: 5 }])
    expect(await activeFrontendEvidence(tx, 'tx')).toEqual({ payments: true, buckets: true })
    expect(database.query.mock.calls).toEqual([
      [
        'SELECT id FROM card_statement_payment_links WHERE transaction_id = ? AND voided_at IS NULL LIMIT 1',
        ['tx'],
      ],
      [
        'SELECT COALESCE(SUM(amount), 0) AS total FROM cashflow_bucket_allocations WHERE transaction_id = ?',
        ['tx'],
      ],
    ])
  })

  it('keeps repeated payment reads and the final consumption read for financial corrections', async () => {
    await guardFrontendEvidence(tx, owner, { ...owner, amount: 1200 })
    expect(database.query.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT id FROM card_statement_payment_links WHERE transaction_id = ? AND voided_at IS NULL LIMIT 1',
      'SELECT COALESCE(SUM(amount), 0) AS total FROM cashflow_bucket_allocations WHERE transaction_id = ?',
      ...paymentSql,
      ...paymentSql,
      `SELECT DISTINCT l.transaction_id, s.account_id
       FROM card_statement_payment_links l
       JOIN credit_card_statements s ON s.id = l.statement_id
       WHERE l.voided_at IS NULL`,
      ...paymentSql.slice(1, 5),
    ])
    expect(database.withTransaction).not.toHaveBeenCalled()
    expect(database.execute).not.toHaveBeenCalled()
  })

  it('retains split write/audit order, literal JSON bytes and caller transaction ownership', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.006Z'))
    const trace: string[] = []
    vi.mocked(generateId).mockImplementationOnce(() => {
      trace.push('split-id')
      return 'split-id'
    })
    vi.mocked(generateId).mockImplementationOnce(() => {
      trace.push('audit-id')
      return 'audit-id'
    })
    database.execute.mockImplementation(async (sql: string) => {
      trace.push(sql.split(' ').slice(0, 3).join(' '))
      return { rowsAffected: 1, lastInsertId: 0 }
    })
    await createSplits('tx', [{ categoryId: 'food', amount: 1000, notes: ' café ' }], 1000, tx)
    expect(trace).toEqual([
      'DELETE FROM transaction_splits',
      'split-id',
      'INSERT INTO transaction_splits',
      'audit-id',
      'INSERT INTO audit_log',
    ])
    expect(database.execute.mock.calls).toEqual([
      ['DELETE FROM transaction_splits WHERE transaction_id = ?', ['tx']],
      [
        `INSERT INTO transaction_splits (id, transaction_id, category_id, subcategory_id, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
        ['split-id', 'tx', 'food', null, 1000, ' café '],
      ],
      [
        'INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'audit-id',
          'transaction',
          'tx',
          'replace-splits',
          '[]',
          '[{"categoryId":"food","amount":1000,"notes":" café "}]',
          'frontend-transaction-correction',
          null,
          '2026-01-02T03:04:05.006Z',
        ],
      ],
    ])
    expect(database.withTransaction).not.toHaveBeenCalled()
  })

  it('does not normalize custom audit fields or reorder payload keys', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-02T03:04:05.006Z'))
    await auditFrontendCorrection(
      tx,
      'tx',
      'custom',
      { z: 1, a: null },
      { b: ' café ', a: 2 },
      ' source ',
      ''
    )
    expect(database.execute.mock.calls[0][1]).toEqual([
      'audit-id',
      'transaction',
      'tx',
      'custom',
      '{"z":1,"a":null}',
      '{"b":" café ","a":2}',
      ' source ',
      '',
      '2026-01-02T03:04:05.006Z',
    ])
  })
})
