// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
  beforeTransaction: null as (() => void) | null,
  beforeWrite: null as (() => void) | null,
}))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => {
    const hook = state.beforeWrite
    state.beforeWrite = null
    hook?.()
    return { rowsAffected: state.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes }
  },
  transaction: (fn: () => unknown) => {
    const hook = state.beforeTransaction
    state.beforeTransaction = null
    hook?.()
    return state.db.transaction(fn).immediate()
  },
}))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => {
    const hook = state.beforeWrite
    state.beforeWrite = null
    hook?.()
    return { rowsAffected: state.db.prepare(sql).run(...params).changes }
  }
  return {
    query,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const hook = state.beforeTransaction
      state.beforeTransaction = null
      hook?.()
      state.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({ query, execute })
        state.db.exec('COMMIT')
        return result
      } catch (error) {
        state.db.exec('ROLLBACK')
        throw error
      }
    },
  }
})
import { receivablesTools } from './tools/receivables.js'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest resolves this import.
import { useReceivableStore } from '@/stores/receivable-store'

const run = (input: Record<string, unknown>, name = 'manage-receivable') => {
  const tool = receivablesTools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const form = {
  payer: 'Edited',
  amount: 1,
  currency: 'USD',
  dueDate: '2026-12-31',
  projectReference: null,
  invoiceReference: null,
  accountId: null,
  notes: null,
}
const row = () =>
  state.db.prepare("SELECT * FROM receivables WHERE id='r'").get() as Record<string, unknown>
const auditCount = () =>
  state.db.prepare<[], { n: number }>('SELECT count(*) AS n FROM audit_log').get()!.n
const snapshot = () => ({
  receivables: state.db.prepare('SELECT * FROM receivables ORDER BY id').all(),
  transactions: state.db.prepare('SELECT * FROM transactions ORDER BY id').all(),
  accounts: state.db.prepare('SELECT * FROM accounts ORDER BY id').all(),
  audits: state.db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  revision: state.db.prepare('SELECT * FROM app_data_state').all(),
})
beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT INTO accounts (id,name,type,currency) VALUES ('bank','Bank','checking','USD');
    INSERT INTO transactions (id,account_id,amount,currency,type,status,description,date)
      VALUES ('t','bank',100,'USD','income','posted','Payment','2026-01-01');
    INSERT INTO receivables (id,payer,amount,currency,due_date,status,created_at,updated_at)
      VALUES ('r','Client',100,'USD','2026-12-31','open','2020-01-01','2020-01-01');
  `)
  state.beforeTransaction = null
  state.beforeWrite = null
  useReceivableStore.setState({ error: null, fetch: async () => {} })
})
afterEach(() => state.db.close())

describe('receivable maintenance literal parent pins', () => {
  it('pins CLI partial cancellation and its audit', async () => {
    state.db.exec(
      "UPDATE receivables SET received_amount=50,status='partial',matched_transaction_id='t'"
    )
    const before = snapshot()
    expect(await run({ action: 'cancel', receivableId: 'r', apply: true })).toMatchObject({
      success: false,
      reason: 'receivable_has_receipts',
    })
    expect(row()).toMatchObject({
      amount: 100,
      received_amount: 50,
      status: 'partial',
      matched_transaction_id: 't',
    })
    expect(auditCount()).toBe(0)
    expect(snapshot()).toEqual(before)
  })
  it('pins already-cancelled zero/unlinked cancellation', async () => {
    state.db.exec("UPDATE receivables SET status='cancelled'")
    const before = snapshot()
    expect(await run({ action: 'cancel', receivableId: 'r', apply: true })).toMatchObject({
      success: true,
      changed: false,
    })
    await useReceivableStore.getState().cancel('r')
    expect(snapshot()).toEqual(before)
  })
  it('pins cancelled receipt guard precedence', async () => {
    state.db.exec(
      "UPDATE receivables SET received_amount=50,status='cancelled',matched_transaction_id='t'"
    )
    const before = snapshot()
    expect(await run({ action: 'cancel', receivableId: 'r', apply: true })).toMatchObject({
      success: false,
      reason: 'receivable_has_receipts',
    })
    await expect(useReceivableStore.getState().cancel('r')).rejects.toThrow(
      'A receivable with recorded receipts cannot be cancelled.'
    )
    expect(snapshot()).toEqual(before)
  })
  it('pins linked zero-receipt cancellation', async () => {
    state.db.exec("UPDATE receivables SET matched_transaction_id='t'")
    const before = snapshot()
    await expect(useReceivableStore.getState().cancel('r')).rejects.toThrow(
      'A receivable with recorded receipts cannot be cancelled.'
    )
    expect(await run({ action: 'cancel', receivableId: 'r', apply: true })).toMatchObject({
      success: false,
      reason: 'receivable_has_receipts',
    })
    expect(row().status).toBe('open')
    expect(snapshot()).toEqual(before)
  })
  it('pins receipt immutability before below-received and currency checks', async () => {
    state.db.exec("UPDATE receivables SET received_amount=50,status='partial',account_id='bank'")
    const before = snapshot()
    expect(
      await run({ action: 'update', receivableId: 'r', amount: 0.25, apply: true })
    ).toMatchObject({ success: false, reason: 'receivable_has_receipts' })
    expect(
      await run({ action: 'update', receivableId: 'r', currency: 'EUR', apply: true })
    ).toMatchObject({ success: false, reason: 'receivable_has_receipts' })
    await expect(
      useReceivableStore.getState().update('r', { ...form, amount: 0.25, accountId: 'bank' })
    ).rejects.toThrow('Amount, currency, and account cannot change after a receipt is recorded.')
    expect(snapshot()).toEqual(before)
  })
  it('pins legacy currency metadata updates without receipt loss', async () => {
    state.db.exec("UPDATE receivables SET currency=' usd ',received_amount=50,status='partial'")
    expect(
      await run({ action: 'update', receivableId: 'r', payer: 'Edited', apply: true })
    ).toMatchObject({ success: true })
    await useReceivableStore.getState().update('r', form)
    expect(row()).toMatchObject({
      payer: 'Edited',
      currency: ' usd ',
      received_amount: 50,
      status: 'partial',
    })
  })
  it.each(['archived', 'missing'])('pins omitted %s linked account', async (kind) => {
    state.db.exec("UPDATE receivables SET account_id='bank'")
    if (kind === 'archived') state.db.exec('UPDATE accounts SET is_archived=1')
    else {
      state.db.pragma('foreign_keys = OFF')
      state.db.exec('DELETE FROM accounts')
    }
    await expect(
      useReceivableStore.getState().update('r', { ...form, accountId: 'bank' })
    ).rejects.toThrow('The linked account is unavailable or archived.')
    const before = snapshot()
    expect(
      await run({ action: 'update', receivableId: 'r', payer: 'Edited', apply: true })
    ).toMatchObject({ success: false, reason: 'account_unavailable' })
    expect(auditCount()).toBe(0)
    expect(snapshot()).toEqual(before)
  })
  it('pins invalid stored amount before status derivation', async () => {
    state.db.pragma('ignore_check_constraints = ON')
    state.db.exec('UPDATE receivables SET amount=0')
    const before = snapshot()
    expect(
      await run({ action: 'update', receivableId: 'r', payer: 'Edited', apply: true })
    ).toMatchObject({ success: false, reason: 'invalid_receivable_amount' })
    await expect(useReceivableStore.getState().update('r', { ...form, amount: 0 })).rejects.toThrow(
      'Receivable amount must be a positive safe integer number of centavos.'
    )
    expect(row().status).toBe('open')
    expect(snapshot()).toEqual(before)
  })
  it('pins delete advice while preserving receipts', async () => {
    state.db.exec("UPDATE receivables SET received_amount=50,status='partial'")
    const before = snapshot()
    expect(await run({ action: 'delete', receivableId: 'r', apply: true })).toMatchObject({
      success: false,
      reason: 'receivable_has_receipts',
      message: 'Receivables with recorded receipts cannot be deleted.',
    })
    expect(snapshot()).toEqual(before)
  })
  it('pins full matching and unmatching independently from maintenance', async () => {
    const before = snapshot()
    expect(await run({ receivableId: 'r', transactionId: 't' }, 'match-receivable')).toMatchObject({
      success: true,
      dryRun: true,
    })
    expect(snapshot()).toEqual(before)
    expect(
      await run({ receivableId: 'r', transactionId: 't', apply: true }, 'match-receivable')
    ).toMatchObject({ success: true })
    expect(row()).toMatchObject({
      received_amount: 100,
      status: 'received',
      matched_transaction_id: 't',
    })
    expect(await run({ action: 'cancel', receivableId: 'r', apply: true })).toMatchObject({
      success: false,
      reason: 'receivable_has_receipts',
    })
    expect(await run({ action: 'delete', receivableId: 'r', apply: true })).toMatchObject({
      success: false,
      reason: 'receivable_has_receipts',
    })
    expect(
      await run({ action: 'update', receivableId: 'r', payer: 'Edited', apply: true })
    ).toMatchObject({ success: true })
    await useReceivableStore.getState().update('r', form)
    await expect(useReceivableStore.getState().cancel('r')).rejects.toThrow(
      'A receivable with recorded receipts cannot be cancelled.'
    )
    await expect(useReceivableStore.getState().remove('r')).rejects.toThrow(
      'Receivables with recorded receipts cannot be deleted.'
    )
    expect(await run({ receivableId: 'r', apply: true }, 'unmatch-receivable')).toMatchObject({
      success: true,
    })
    expect(row()).toMatchObject({
      received_amount: 0,
      status: 'open',
      matched_transaction_id: null,
    })
    expect(auditCount()).toBe(3)
    expect(snapshot().transactions).toEqual(before.transactions)
    expect(snapshot().accounts).toEqual(before.accounts)
  })
  it.each(['update', 'cancel', 'delete'])(
    'pins no-write %s preview and stale-link CAS rollback',
    async (action) => {
      const before = snapshot()
      const input = { action, receivableId: 'r', payer: 'Edited' }
      expect(await run(input)).toMatchObject({ success: true, dryRun: true })
      expect(snapshot()).toEqual(before)
      state.beforeWrite = () => state.db.exec("UPDATE receivables SET matched_transaction_id='t'")
      await expect(run({ ...input, apply: true })).rejects.toThrow('safely')
      expect(snapshot()).toEqual(before)
    }
  )
  it('pins account availability checking inside the apply transaction', async () => {
    state.db.exec("UPDATE receivables SET account_id='bank'")
    state.beforeTransaction = () => state.db.exec('UPDATE accounts SET is_archived=1')
    expect(
      await run({ action: 'update', receivableId: 'r', payer: 'Edited', apply: true })
    ).toMatchObject({ success: false, reason: 'account_unavailable' })
    expect(row().payer).toBe('Client')
    expect(auditCount()).toBe(0)
  })
  it.each(['update', 'cancel', 'delete'])(
    'rechecks %s after a dry run when payment evidence arrives',
    async (action) => {
      const input = { action, receivableId: 'r', amount: 2 }
      const before = snapshot()
      expect(await run(input)).toMatchObject({ success: true, dryRun: true })
      expect(snapshot()).toEqual(before)
      expect(
        await run({ receivableId: 'r', transactionId: 't', apply: true }, 'match-receivable')
      ).toMatchObject({ success: true })
      const matched = snapshot()
      expect(await run({ ...input, apply: true })).toMatchObject({
        success: false,
        reason: 'receivable_has_receipts',
      })
      expect(snapshot()).toEqual(matched)
    }
  )
  it.each(['cancel', 'delete'])(
    'checks newly linked evidence inside the %s transaction',
    async (action) => {
      state.beforeTransaction = () =>
        state.db.exec("UPDATE receivables SET matched_transaction_id='t'")
      expect(await run({ action, receivableId: 'r', apply: true })).toMatchObject({
        success: false,
        reason: 'receivable_has_receipts',
      })
      expect(row()).toMatchObject({ status: 'open', matched_transaction_id: 't' })
      expect(auditCount()).toBe(0)
    }
  )
  it.each(['update', 'cancel', 'delete'] as const)(
    'keeps frontend %s stale-link checks and rollback atomic',
    async (action) => {
      const before = snapshot()
      state.beforeWrite = () => state.db.exec("UPDATE receivables SET matched_transaction_id='t'")
      const store = useReceivableStore.getState()
      await expect(
        action === 'update'
          ? store.update('r', form)
          : action === 'cancel'
            ? store.cancel('r')
            : store.remove('r')
      ).rejects.toThrow('Receivable changed')
      expect(snapshot()).toEqual(before)
    }
  )
  it.each(['update', 'cancel', 'delete'])(
    'rolls back %s when audit insertion fails',
    async (action) => {
      state.db.exec(
        "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'audit failed'); END"
      )
      const before = snapshot()
      await expect(
        run({ action, receivableId: 'r', payer: 'Edited', apply: true })
      ).rejects.toThrow('audit failed')
      expect(snapshot()).toEqual(before)
    }
  )
  it.each([true, false])('keeps idempotent cancel byte-exact with apply=%s', async (apply) => {
    state.db.exec("UPDATE receivables SET status='cancelled'")
    const before = snapshot()
    expect(await run({ action: 'cancel', receivableId: 'r', apply })).toMatchObject({
      success: true,
      dryRun: !apply,
      changed: false,
      receivable: { updatedAt: '2020-01-01' },
    })
    expect(snapshot()).toEqual(before)
  })
  it.each(['cancel', 'delete'])(
    'rejects even empty-string link evidence before %s CAS',
    async (action) => {
      state.db.pragma('foreign_keys = OFF')
      state.db.exec("UPDATE receivables SET matched_transaction_id=''")
      const before = snapshot()
      expect(await run({ action, receivableId: 'r', apply: true })).toMatchObject({
        success: false,
        reason: 'receivable_has_receipts',
      })
      await expect(
        action === 'cancel'
          ? useReceivableStore.getState().cancel('r')
          : useReceivableStore.getState().remove('r')
      ).rejects.toThrow('recorded receipts')
      expect(snapshot()).toEqual(before)
    }
  )
  it.each([0.001, 0.004])(
    'rejects tiny accepted public amounts %s before any write',
    async (amount) => {
      const before = snapshot()
      for (const action of ['create', 'update']) {
        expect(
          await run({
            action,
            receivableId: 'r',
            payer: 'Client',
            amount,
            dueDate: '2026-12-31',
            apply: true,
          })
        ).toMatchObject({ success: false, reason: 'invalid_receivable_amount' })
      }
      await expect(useReceivableStore.getState().create({ ...form, amount })).rejects.toThrow(
        'positive safe integer'
      )
      await expect(useReceivableStore.getState().update('r', { ...form, amount })).rejects.toThrow(
        'positive safe integer'
      )
      expect(snapshot()).toEqual(before)
    }
  )
  it('pins unchanged public schemas for alternate input formats', () => {
    const tool = receivablesTools.find((item) => item.name === 'manage-receivable')!
    for (const currency of ['usd', ' usd ', 'UsD', 'USD']) {
      expect(tool.schema.parse({ action: 'create', currency }).currency).toBe('USD')
    }
    for (const amount of ['1', null, 0, -1, NaN, Infinity]) {
      expect(tool.schema.safeParse({ action: 'create', amount }).success).toBe(false)
    }
    for (const action of ['CREATE', ' create ', '', null]) {
      expect(tool.schema.safeParse({ action }).success).toBe(false)
    }
    for (const currency of ['', 'US', 'USDD', '123', null]) {
      expect(tool.schema.safeParse({ action: 'create', currency }).success).toBe(false)
    }
    expect(
      tool.schema.parse({ action: 'update', receivableId: ' r ', accountId: ' ', notes: ' note ' })
    ).toMatchObject({ receivableId: 'r', accountId: '', notes: 'note', apply: false })
  })
  it('persists the same metadata, financial evidence and revision in both clients', async () => {
    state.db.exec(
      "UPDATE receivables SET currency=' usd ',received_amount=50,status='partial',matched_transaction_id='t'"
    )
    const baseline = state.db.serialize()
    state.db.function('strftime', { varargs: true }, () => '2026-01-20T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-20T12:00:00.000Z'))
    try {
      expect(
        await run({ action: 'update', receivableId: 'r', payer: 'Edited', apply: true })
      ).toMatchObject({ success: true, receivable: { currency: ' usd ' } })
      const cliRow = row()
      const cliRevision = snapshot().revision
      const audit = state.db
        .prepare<
          [],
          { action: string; before_json: string; after_json: string }
        >('SELECT action,before_json,after_json FROM audit_log')
        .get()!
      expect(audit.action).toBe('update')
      expect(JSON.parse(audit.before_json).receivable).toMatchObject({
        payer: 'Client',
        currency: ' usd ',
        receivedAmountCentavos: 50,
        matchedTransactionId: 't',
      })
      expect(JSON.parse(audit.after_json).receivable).toMatchObject({
        payer: 'Edited',
        currency: ' usd ',
        receivedAmountCentavos: 50,
        matchedTransactionId: 't',
      })
      state.db.close()
      state.db = new Database(baseline)
      state.db.function('strftime', { varargs: true }, () => '2026-01-20T12:00:00.000Z')
      await useReceivableStore.getState().update('r', form)
      expect(row()).toEqual(cliRow)
      expect(snapshot().revision).toEqual(cliRevision)
      expect(auditCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['update', 'cancel', 'remove'] as const)(
    'keeps a committed frontend %s successful when refresh fails',
    async (action) => {
      useReceivableStore.setState({
        fetch: async () => {
          throw new Error('Refresh failed')
        },
      })
      const store = useReceivableStore.getState()
      await expect(
        action === 'update' ? store.update('r', form) : store[action]('r')
      ).resolves.toBeUndefined()
      expect(useReceivableStore.getState().error).toBeNull()
      if (action === 'remove') expect(row()).toBeUndefined()
      else
        expect(row()).toMatchObject(
          action === 'update' ? { payer: 'Edited' } : { status: 'cancelled' }
        )
    }
  )
})
