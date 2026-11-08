// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  id: 0,
  beforeBegin: null as (() => void) | null,
  failSql: null as string | null,
  trace: [] as unknown[],
}))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) => {
    state.trace.push(['query', sql, params])
    return state.db!.prepare(sql.replace(/\$\d+/g, '?')).all(...params)
  },
  execute: (sql: string, params: unknown[] = []) => {
    state.trace.push(['execute', sql, params])
    if (state.failSql && sql.includes(state.failSql)) throw new Error('injected inverse failure')
    return { rowsAffected: state.db!.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes }
  },
  transaction: (fn: () => unknown) => {
    const beforeBegin = state.beforeBegin
    state.beforeBegin = null
    beforeBegin?.()
    state.trace.push(['begin'])
    try {
      const result = state.db!.transaction(fn).immediate()
      state.trace.push(['commit'])
      return result
    } catch (error) {
      state.trace.push(['rollback'])
      throw error
    }
  },
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))
vi.mock('./ulid.js', () => ({ generateId: () => `fixed-${++state.id}` }))
vi.mock('./notebook.js', () => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  appendNote: vi.fn(),
  noteExists: vi.fn(),
  listNotes: vi.fn(),
}))
import { builtInTools as tools } from './tools/index.js'
const run = (name: string, input: Record<string, unknown>) => {
  const tool = tools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const stamp = '2026-01-15T12:00:00.000Z'
function resetDatabase() {
  state.db?.close()
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  state.db.function('strftime', { varargs: true }, () => stamp)
  state.db.function('randomblob', (size: number) => Buffer.alloc(size))
  runHostedTestMigrations(state.db)
  state.db.exec(
    "INSERT INTO accounts (id,name,type,currency,balance) VALUES ('a','Bank','checking','USD',1000),('b','Card','credit_card','USD',2000)"
  )
  state.id = 0
  state.beforeBegin = null
  state.failSql = null
  state.trace = []
}
function dump() {
  return (
    state.db!.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string
    }[]
  ).map(({ name }) => [name, state.db!.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])
}
function tx(overrides: Record<string, unknown> = {}) {
  return {
    id: 't',
    accountId: 'a',
    categoryId: null,
    transferToAccountId: null,
    type: 'expense',
    amountCentavos: 100,
    currency: 'USD',
    description: 'Meal',
    notes: null,
    status: 'posted',
    source: null,
    note: null,
    recurringRuleId: null,
    tags: [],
    isPlaceholder: false,
    placeholderStatus: null,
    resolvedAt: null,
    resolvedByTransactionId: null,
    placeholderReason: null,
    placeholderParentTransactionId: null,
    date: '2026-01-10',
    ...overrides,
  }
}
function statement(overrides: Record<string, unknown> = {}) {
  return {
    id: 's',
    accountId: 'b',
    statementStartDate: null,
    statementEndDate: '2026-01-10',
    dueDate: '2026-02-10',
    statementBalanceCentavos: 1000,
    minimumPaymentCentavos: 100,
    paidAmountCentavos: 25,
    currency: 'USD',
    status: 'open',
    source: null,
    note: null,
    ...overrides,
  }
}
function liveTransaction(value = tx()) {
  state
    .db!.prepare(
      `INSERT INTO transactions (id,account_id,category_id,transfer_to_account_id,type,amount,currency,description,notes,status,source,note,recurring_rule_id,tags,is_placeholder,placeholder_status,resolved_at,resolved_by_transaction_id,placeholder_reason,placeholder_parent_transaction_id,date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      value.id,
      value.accountId,
      value.categoryId,
      value.transferToAccountId,
      value.type,
      value.amountCentavos,
      value.currency,
      value.description,
      value.notes,
      value.status,
      value.source,
      value.note,
      value.recurringRuleId,
      JSON.stringify(value.tags),
      value.isPlaceholder ? 1 : 0,
      value.placeholderStatus,
      value.resolvedAt,
      value.resolvedByTransactionId,
      value.placeholderReason,
      value.placeholderParentTransactionId,
      value.date
    )
}
function liveStatement(value = statement()) {
  state
    .db!.prepare(
      `INSERT INTO credit_card_statements (id,account_id,statement_start_date,statement_end_date,due_date,statement_balance,minimum_payment,paid_amount,unattributed_paid_amount,currency,status,source,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      value.id,
      value.accountId,
      value.statementStartDate,
      value.statementEndDate,
      value.dueDate,
      value.statementBalanceCentavos,
      value.minimumPaymentCentavos,
      value.paidAmountCentavos,
      value.paidAmountCentavos,
      value.currency,
      value.status,
      value.source,
      value.note
    )
}
function audit(entity: string, action: string, before: unknown, after: unknown, id = 'audit') {
  state
    .db!.prepare(
      'INSERT INTO audit_log (id,entity,entity_id,action,before_json,after_json,source,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(
      id,
      entity,
      entity === 'transaction' ? 't' : 's',
      action,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      'fixture',
      null,
      '2026-01-11T00:00:00.000Z'
    )
}
function financialRows() {
  return Object.fromEntries(
    ['transactions', 'credit_card_statements', 'accounts', 'audit_log', 'app_data_state'].map(
      (table) => [table, state.db!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]
    )
  )
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(stamp))
  resetDatabase()
})
afterEach(() => {
  state.db?.close()
  state.db = null
  vi.useRealTimers()
})

describe('public audit replay protocol', () => {
  it('pins legacy decoding without writer normalization', async () => {
    audit(
      'transaction',
      'delete',
      {
        transaction: {
          id: 't',
          accountId: 'a',
          type: 'expense',
          amountCentavos: 100.5,
          currency: ' usd ',
          description: 'x',
          date: 'not-a-date',
          status: 'CLEARED',
          tags: ['Work', 8, ''],
          isPlaceholder: '0',
        },
      },
      null
    )
    const before = dump()
    expect(await run('undo', { auditId: 'audit' })).toMatchInlineSnapshot(`
      {
        "message": "Invalid ledger transaction t: amountCentavos must be a non-negative safe integer. Use an audited financial correction before undo; no historical inverse was inferred.",
        "reason": "invalid_ledger_evidence",
        "success": false,
      }
    `)
    expect(dump()).toEqual(before)
  })

  it('pins legacy statement baseline and uppercase status fallback', async () => {
    audit('credit_card_statement', 'delete', { statement: statement({ status: 'PAID' }) }, null)
    expect(await run('undo', { auditId: 'audit' })).toMatchInlineSnapshot(`
      {
        "auditEntry": {
          "action": "delete",
          "after": null,
          "before": {
            "statement": {
              "accountId": "b",
              "currency": "USD",
              "dueDate": "2026-02-10",
              "id": "s",
              "minimumPaymentCentavos": 100,
              "note": null,
              "paidAmountCentavos": 25,
              "source": null,
              "statementBalanceCentavos": 1000,
              "statementEndDate": "2026-01-10",
              "statementStartDate": null,
              "status": "PAID",
            },
          },
          "createdAt": "2026-01-11T00:00:00.000Z",
          "entity": "credit_card_statement",
          "entityId": "s",
          "id": "audit",
          "note": null,
          "source": "fixture",
        },
        "dependentWrites": [],
        "dryRun": true,
        "message": "Dry run: audit entry audit would be undone with inverse action create.",
        "requiresApply": true,
        "success": true,
        "wouldUndo": {
          "action": "delete",
          "afterUndo": {
            "accountId": "b",
            "currency": "USD",
            "dueDate": "2026-02-10",
            "id": "s",
            "minimumPayment": 1,
            "minimumPaymentCentavos": 100,
            "note": null,
            "paidAmount": 0.25,
            "paidAmountCentavos": 25,
            "source": null,
            "statementBalance": 10,
            "statementBalanceCentavos": 1000,
            "statementEndDate": "2026-01-10",
            "statementStartDate": null,
            "status": "open",
            "unattributedPaidAmountCentavos": 25,
          },
          "balanceImpact": {
            "accounts": [],
            "affectsBalances": false,
            "deltas": [],
          },
          "beforeUndo": null,
          "entity": "credit_card_statement",
          "entityId": "s",
          "inverseAction": "create",
        },
      }
    `)
  })

  it('pins complete producer audit bytes and transaction inverse write ordering', async () => {
    await run('add-transaction', {
      accountId: 'a',
      type: 'expense',
      amount: 1,
      description: 'Meal',
      date: '2026-01-10',
      source: 'test',
      note: 'memo',
    })
    expect(state.db!.prepare('SELECT * FROM audit_log').all()).toMatchInlineSnapshot(`
      [
        {
          "action": "create",
          "after_json": "{"transaction":{"id":"fixed-1","accountId":"a","categoryId":null,"transferToAccountId":null,"type":"expense","amount":1,"amountCentavos":100,"currency":"USD","description":"Meal","notes":null,"status":"posted","source":"test","note":"memo","recurringRuleId":null,"ledgerTreatment":"normal","reportingTreatment":"normal","transactionKind":"standard","stagingBatchId":null,"finalizationId":null,"importSource":null,"importExternalId":null,"importFingerprint":null,"importContentFingerprint":null,"reconciliationId":null,"matchedTransactionId":null,"isArchived":false,"tags":[],"tagDetails":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10"},"fxEvidence":null,"balanceChanges":[{"accountId":"a","deltaCentavos":-100,"previousBalanceCentavos":1000,"newBalanceCentavos":900,"previousBalance":10,"newBalance":9}],"balances":[{"accountId":"a","balanceCentavos":900,"balance":9}]}",
          "before_json": "null",
          "created_at": "2026-01-15T12:00:00.000Z",
          "entity": "transaction",
          "entity_id": "fixed-1",
          "id": "fixed-2",
          "note": "memo",
          "source": "test",
        },
      ]
    `)
    state.trace = []
    expect(await run('undo', { auditId: 'fixed-2', apply: true, note: 'revert' }))
      .toMatchInlineSnapshot(`
      {
        "auditEntry": {
          "action": "create",
          "after": {
            "balanceChanges": [
              {
                "accountId": "a",
                "deltaCentavos": -100,
                "newBalance": 9,
                "newBalanceCentavos": 900,
                "previousBalance": 10,
                "previousBalanceCentavos": 1000,
              },
            ],
            "balances": [
              {
                "accountId": "a",
                "balance": 9,
                "balanceCentavos": 900,
              },
            ],
            "fxEvidence": null,
            "transaction": {
              "accountId": "a",
              "amount": 1,
              "amountCentavos": 100,
              "categoryId": null,
              "currency": "USD",
              "date": "2026-01-10",
              "description": "Meal",
              "finalizationId": null,
              "id": "fixed-1",
              "importContentFingerprint": null,
              "importExternalId": null,
              "importFingerprint": null,
              "importSource": null,
              "isArchived": false,
              "isPlaceholder": false,
              "ledgerTreatment": "normal",
              "matchedTransactionId": null,
              "note": "memo",
              "notes": null,
              "placeholderParentTransactionId": null,
              "placeholderReason": null,
              "placeholderStatus": null,
              "reconciliationId": null,
              "recurringRuleId": null,
              "reportingTreatment": "normal",
              "resolvedAt": null,
              "resolvedByTransactionId": null,
              "source": "test",
              "stagingBatchId": null,
              "status": "posted",
              "tagDetails": [],
              "tags": [],
              "transactionKind": "standard",
              "transferToAccountId": null,
              "type": "expense",
            },
          },
          "before": null,
          "createdAt": "2026-01-15T12:00:00.000Z",
          "entity": "transaction",
          "entityId": "fixed-1",
          "id": "fixed-2",
          "note": "memo",
          "source": "test",
        },
        "dependentWrites": [],
        "dryRun": false,
        "message": "Undid audit entry fixed-2 with inverse action delete.",
        "success": true,
        "undone": {
          "action": "create",
          "afterUndo": null,
          "balanceImpact": {
            "accounts": [
              {
                "accountId": "a",
                "accountName": "Bank",
                "delta": 1,
                "deltaCentavos": 100,
                "newBalance": 10,
                "newBalanceCentavos": 1000,
                "previousBalance": 9,
                "previousBalanceCentavos": 900,
              },
            ],
            "affectsBalances": true,
            "deltas": [
              {
                "accountId": "a",
                "accountName": "Bank",
                "delta": 1,
                "deltaCentavos": 100,
                "newBalance": 10,
                "newBalanceCentavos": 1000,
                "previousBalance": 9,
                "previousBalanceCentavos": 900,
              },
            ],
          },
          "beforeUndo": {
            "accountId": "a",
            "amount": 1,
            "amountCentavos": 100,
            "categoryId": null,
            "currency": "USD",
            "date": "2026-01-10",
            "description": "Meal",
            "id": "fixed-1",
            "isPlaceholder": false,
            "note": "memo",
            "notes": null,
            "placeholderParentTransactionId": null,
            "placeholderReason": null,
            "placeholderStatus": null,
            "recurringRuleId": null,
            "resolvedAt": null,
            "resolvedByTransactionId": null,
            "source": "test",
            "status": "posted",
            "tags": [],
            "transferToAccountId": null,
            "type": "expense",
          },
          "entity": "transaction",
          "entityId": "fixed-1",
          "inverseAction": "delete",
        },
      }
    `)
    expect(state.trace).toMatchInlineSnapshot(`
      [
        [
          "query",
          "SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
           FROM audit_log
           WHERE entity IN ('transaction', 'credit_card_statement') AND action IN ('create', 'update', 'delete') AND id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2",
          [
            "fixed-2",
            1,
          ],
        ],
        [
          "query",
          "SELECT account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT id, currency, account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT id FROM transactions WHERE id = $1 LIMIT 1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT id, currency, account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT id, name, balance FROM accounts WHERE id IN ($1)",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT * FROM transactions WHERE id = $1 LIMIT 1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT id, currency, account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT l.id
               FROM card_statement_payment_links l
               LEFT JOIN transactions linked ON linked.id = l.transaction_id
               WHERE l.voided_at IS NULL
                 AND (l.transaction_id = $1 OR linked.matched_transaction_id = $2)
               LIMIT 1",
          [
            "fixed-1",
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT COALESCE(SUM(amount), 0) AS total FROM cashflow_bucket_allocations WHERE transaction_id = $1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT * FROM transactions",
          [],
        ],
        [
          "query",
          "SELECT id, type, currency, account_mode, is_archived FROM accounts",
          [],
        ],
        [
          "query",
          "SELECT * FROM transactions",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_splits",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_consumption_classifications",
          [],
        ],
        [
          "query",
          "SELECT * FROM classification_type_revisions",
          [],
        ],
        [
          "query",
          "SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL",
          [],
        ],
        [
          "query",
          "SELECT DISTINCT l.transaction_id, s.account_id
           FROM card_statement_payment_links l
           JOIN credit_card_statements s ON s.id = l.statement_id
           WHERE l.voided_at IS NULL",
          [],
        ],
        [
          "query",
          "SELECT * FROM transactions",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_splits",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_consumption_classifications",
          [],
        ],
        [
          "query",
          "SELECT * FROM classification_type_revisions",
          [],
        ],
        [
          "query",
          "SELECT id FROM transaction_splits WHERE transaction_id = $1 LIMIT 1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT
               (SELECT COUNT(*) FROM account_reconciliations WHERE adjustment_transaction_id = $1) AS reconciliation_count,
               (SELECT COUNT(*) FROM receivables WHERE matched_transaction_id = $2) AS receivable_count,
               (SELECT COUNT(*) FROM account_reconciliations
                WHERE account_id = $3 AND staging_batch_id = $4 AND selection_mode = 'legacy_batch') AS finalized_statement_count",
          [
            "fixed-1",
            "fixed-1",
            "a",
            null,
          ],
        ],
        [
          "query",
          "SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
           FROM audit_log
           WHERE entity = $1 AND entity_id = $2 AND created_at > $3 AND id <> $4
           ORDER BY created_at DESC, id DESC
           LIMIT $5",
          [
            "transaction",
            "fixed-1",
            "2026-01-15T12:00:00.000Z",
            "fixed-2",
            5,
          ],
        ],
        [
          "begin",
        ],
        [
          "query",
          "SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
               FROM audit_log WHERE id = $1 LIMIT 1",
          [
            "fixed-2",
          ],
        ],
        [
          "query",
          "SELECT account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT id, currency, account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT id FROM transactions WHERE id = $1 LIMIT 1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT id, currency, account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT id, name, balance FROM accounts WHERE id IN ($1)",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
           FROM audit_log
           WHERE entity = $1 AND entity_id = $2 AND created_at > $3 AND id <> $4
           ORDER BY created_at DESC, id DESC
           LIMIT $5",
          [
            "transaction",
            "fixed-1",
            "2026-01-15T12:00:00.000Z",
            "fixed-2",
            5,
          ],
        ],
        [
          "query",
          "SELECT * FROM transactions WHERE id = $1 LIMIT 1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT id, currency, account_mode FROM accounts WHERE id = $1 LIMIT 1",
          [
            "a",
          ],
        ],
        [
          "query",
          "SELECT l.id
               FROM card_statement_payment_links l
               LEFT JOIN transactions linked ON linked.id = l.transaction_id
               WHERE l.voided_at IS NULL
                 AND (l.transaction_id = $1 OR linked.matched_transaction_id = $2)
               LIMIT 1",
          [
            "fixed-1",
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT COALESCE(SUM(amount), 0) AS total FROM cashflow_bucket_allocations WHERE transaction_id = $1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT * FROM transactions",
          [],
        ],
        [
          "query",
          "SELECT id, type, currency, account_mode, is_archived FROM accounts",
          [],
        ],
        [
          "query",
          "SELECT * FROM transactions",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_splits",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_consumption_classifications",
          [],
        ],
        [
          "query",
          "SELECT * FROM classification_type_revisions",
          [],
        ],
        [
          "query",
          "SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL",
          [],
        ],
        [
          "query",
          "SELECT DISTINCT l.transaction_id, s.account_id
           FROM card_statement_payment_links l
           JOIN credit_card_statements s ON s.id = l.statement_id
           WHERE l.voided_at IS NULL",
          [],
        ],
        [
          "query",
          "SELECT * FROM transactions",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_splits",
          [],
        ],
        [
          "query",
          "SELECT * FROM transaction_consumption_classifications",
          [],
        ],
        [
          "query",
          "SELECT * FROM classification_type_revisions",
          [],
        ],
        [
          "query",
          "SELECT id FROM transaction_splits WHERE transaction_id = $1 LIMIT 1",
          [
            "fixed-1",
          ],
        ],
        [
          "query",
          "SELECT
               (SELECT COUNT(*) FROM account_reconciliations WHERE adjustment_transaction_id = $1) AS reconciliation_count,
               (SELECT COUNT(*) FROM receivables WHERE matched_transaction_id = $2) AS receivable_count,
               (SELECT COUNT(*) FROM account_reconciliations
                WHERE account_id = $3 AND staging_batch_id = $4 AND selection_mode = 'legacy_batch') AS finalized_statement_count",
          [
            "fixed-1",
            "fixed-1",
            "a",
            null,
          ],
        ],
        [
          "execute",
          "DELETE FROM transactions WHERE id = $1",
          [
            "fixed-1",
          ],
        ],
        [
          "execute",
          "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
          [
            100,
            "a",
          ],
        ],
        [
          "execute",
          "INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [
            "fixed-3",
            "transaction",
            "fixed-1",
            "undo",
            "{"auditEntryId":"fixed-2","originalAction":"create","beforeUndo":{"id":"fixed-1","accountId":"a","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":100,"currency":"USD","description":"Meal","notes":null,"status":"posted","source":"test","note":"memo","recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10","amount":1}}",
            "{"auditEntryId":"fixed-2","undoAction":"delete","afterUndo":null,"balanceImpact":{"affectsBalances":true,"accounts":[{"accountId":"a","accountName":"Bank","previousBalance":9,"newBalance":10,"delta":1,"previousBalanceCentavos":900,"newBalanceCentavos":1000,"deltaCentavos":100}],"deltas":[{"accountId":"a","accountName":"Bank","previousBalance":9,"newBalance":10,"delta":1,"previousBalanceCentavos":900,"newBalanceCentavos":1000,"deltaCentavos":100}]}}",
            "undo",
            "revert",
            "2026-01-15T12:00:00.000Z",
          ],
        ],
        [
          "commit",
        ],
      ]
    `)
    expect(JSON.stringify(financialRows())).toMatchInlineSnapshot(
      `"{"transactions":[],"credit_card_statements":[],"accounts":[{"id":"a","name":"Bank","type":"checking","currency":"USD","balance":1000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"},{"id":"b","name":"Card","type":"credit_card","currency":"USD","balance":2000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"}],"audit_log":[{"id":"fixed-2","entity":"transaction","entity_id":"fixed-1","action":"create","before_json":"null","after_json":"{\\"transaction\\":{\\"id\\":\\"fixed-1\\",\\"accountId\\":\\"a\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amount\\":1,\\"amountCentavos\\":100,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"posted\\",\\"source\\":\\"test\\",\\"note\\":\\"memo\\",\\"recurringRuleId\\":null,\\"ledgerTreatment\\":\\"normal\\",\\"reportingTreatment\\":\\"normal\\",\\"transactionKind\\":\\"standard\\",\\"stagingBatchId\\":null,\\"finalizationId\\":null,\\"importSource\\":null,\\"importExternalId\\":null,\\"importFingerprint\\":null,\\"importContentFingerprint\\":null,\\"reconciliationId\\":null,\\"matchedTransactionId\\":null,\\"isArchived\\":false,\\"tags\\":[],\\"tagDetails\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\"},\\"fxEvidence\\":null,\\"balanceChanges\\":[{\\"accountId\\":\\"a\\",\\"deltaCentavos\\":-100,\\"previousBalanceCentavos\\":1000,\\"newBalanceCentavos\\":900,\\"previousBalance\\":10,\\"newBalance\\":9}],\\"balances\\":[{\\"accountId\\":\\"a\\",\\"balanceCentavos\\":900,\\"balance\\":9}]}","source":"test","note":"memo","created_at":"2026-01-15T12:00:00.000Z"},{"id":"fixed-3","entity":"transaction","entity_id":"fixed-1","action":"undo","before_json":"{\\"auditEntryId\\":\\"fixed-2\\",\\"originalAction\\":\\"create\\",\\"beforeUndo\\":{\\"id\\":\\"fixed-1\\",\\"accountId\\":\\"a\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":100,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"posted\\",\\"source\\":\\"test\\",\\"note\\":\\"memo\\",\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\",\\"amount\\":1}}","after_json":"{\\"auditEntryId\\":\\"fixed-2\\",\\"undoAction\\":\\"delete\\",\\"afterUndo\\":null,\\"balanceImpact\\":{\\"affectsBalances\\":true,\\"accounts\\":[{\\"accountId\\":\\"a\\",\\"accountName\\":\\"Bank\\",\\"previousBalance\\":9,\\"newBalance\\":10,\\"delta\\":1,\\"previousBalanceCentavos\\":900,\\"newBalanceCentavos\\":1000,\\"deltaCentavos\\":100}],\\"deltas\\":[{\\"accountId\\":\\"a\\",\\"accountName\\":\\"Bank\\",\\"previousBalance\\":9,\\"newBalance\\":10,\\"delta\\":1,\\"previousBalanceCentavos\\":900,\\"newBalanceCentavos\\":1000,\\"deltaCentavos\\":100}]}}","source":"undo","note":"revert","created_at":"2026-01-15T12:00:00.000Z"}],"app_data_state":[{"id":1,"database_id":"00000000000000000000000000000000","data_revision":6,"last_financial_write_at":"2026-01-15T12:00:00.000Z"}]}"`
    )
  })

  it('pins complete display-derived statement producer audit bytes', async () => {
    expect(
      await run('create-credit-card-statement', {
        accountId: 'b',
        statementEndDate: '2026-01-10',
        dueDate: '2026-02-10',
        statementBalance: 10,
        minimumPayment: 1,
        paidAmount: 0.25,
        source: 'test',
        note: 'memo',
      })
    ).toMatchInlineSnapshot(`
      {
        "action": "created",
        "message": "Created statement for Card ending 2026-01-10.",
        "statement": {
          "accountId": "b",
          "accountName": "Card",
          "amountToPay": 9.75,
          "amountToPayCentavos": 975,
          "closingDate": "2026-01-10",
          "createdAt": null,
          "currency": "USD",
          "dueDate": "2026-02-10",
          "id": "fixed-1",
          "legacyOverpaid": false,
          "linkedPaidAmount": 0,
          "linkedPaidAmountCentavos": 0,
          "minimumPayment": 1,
          "minimumPaymentCentavos": 100,
          "minimumPaymentDue": 0.75,
          "minimumPaymentDueCentavos": 75,
          "note": "memo",
          "paidAmount": 0.25,
          "paidAmountCentavos": 25,
          "paymentStatus": "partial",
          "source": "test",
          "statementBalance": 10,
          "statementBalanceCentavos": 1000,
          "statementEndDate": "2026-01-10",
          "statementPeriod": {
            "closingDate": "2026-01-10",
            "endDate": "2026-01-10",
            "startDate": null,
          },
          "statementStartDate": null,
          "status": "partial",
          "unattributedPaidAmount": 0.25,
          "unattributedPaidAmountCentavos": 25,
          "updatedAt": null,
        },
        "success": true,
      }
    `)
    expect(state.db!.prepare('SELECT * FROM audit_log').all()).toMatchInlineSnapshot(`
      [
        {
          "action": "create",
          "after_json": "{"statement":{"id":"fixed-1","accountId":"b","accountName":"Card","statementPeriod":{"startDate":null,"endDate":"2026-01-10","closingDate":"2026-01-10"},"statementStartDate":null,"statementEndDate":"2026-01-10","closingDate":"2026-01-10","dueDate":"2026-02-10","statementBalance":10,"statementBalanceCentavos":1000,"minimumPayment":1,"minimumPaymentCentavos":100,"paidAmount":0.25,"paidAmountCentavos":25,"unattributedPaidAmount":0.25,"unattributedPaidAmountCentavos":25,"linkedPaidAmount":0,"linkedPaidAmountCentavos":0,"legacyOverpaid":false,"amountToPayCentavos":975,"amountToPay":9.75,"minimumPaymentDueCentavos":75,"minimumPaymentDue":0.75,"currency":"USD","status":"partial","paymentStatus":"partial","source":"test","note":"memo","createdAt":null,"updatedAt":null}}",
          "before_json": "null",
          "created_at": "2026-01-15T12:00:00.000Z",
          "entity": "credit_card_statement",
          "entity_id": "fixed-1",
          "id": "fixed-2",
          "note": "memo",
          "source": "test",
        },
      ]
    `)
  })

  it('pins all six inverses with cross-account pending and cleared transaction updates', async () => {
    const outcomes = []
    for (const entity of ['transaction', 'credit_card_statement']) {
      for (const action of ['create', 'update', 'delete']) {
        resetDatabase()
        const key = entity === 'transaction' ? 'transaction' : 'statement'
        const before =
          entity === 'transaction'
            ? tx({ accountId: 'b', amountCentavos: 200, status: 'pending' })
            : statement({ paidAmountCentavos: 0 })
        const after = entity === 'transaction' ? tx({ status: 'cleared' }) : statement()
        if (action !== 'delete') {
          if (entity === 'transaction') liveTransaction(after as ReturnType<typeof tx>)
          else liveStatement(after as ReturnType<typeof statement>)
        }
        audit(
          entity,
          action,
          action === 'create' ? null : { [key]: before },
          action === 'delete' ? null : { [key]: after }
        )
        outcomes.push({
          entity,
          action,
          result: await run('undo', { auditId: 'audit', apply: true }),
          rows: financialRows(),
        })
      }
    }
    expect(JSON.stringify(outcomes)).toMatchInlineSnapshot(
      `"[{"entity":"transaction","action":"create","result":{"success":true,"dryRun":false,"auditEntry":{"id":"audit","entity":"transaction","entityId":"t","action":"create","before":null,"after":{"transaction":{"id":"t","accountId":"a","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":100,"currency":"USD","description":"Meal","notes":null,"status":"cleared","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10"}},"source":"fixture","note":null,"createdAt":"2026-01-11T00:00:00.000Z"},"undone":{"entity":"transaction","entityId":"t","action":"create","inverseAction":"delete","beforeUndo":{"id":"t","accountId":"a","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":100,"currency":"USD","description":"Meal","notes":null,"status":"cleared","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10","amount":1},"afterUndo":null,"balanceImpact":{"affectsBalances":true,"accounts":[{"accountId":"a","accountName":"Bank","previousBalance":10,"newBalance":11,"delta":1,"previousBalanceCentavos":1000,"newBalanceCentavos":1100,"deltaCentavos":100}],"deltas":[{"accountId":"a","accountName":"Bank","previousBalance":10,"newBalance":11,"delta":1,"previousBalanceCentavos":1000,"newBalanceCentavos":1100,"deltaCentavos":100}]}},"dependentWrites":[],"message":"Undid audit entry audit with inverse action delete."},"rows":{"transactions":[],"credit_card_statements":[],"accounts":[{"id":"a","name":"Bank","type":"checking","currency":"USD","balance":1100,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"},{"id":"b","name":"Card","type":"credit_card","currency":"USD","balance":2000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"}],"audit_log":[{"id":"audit","entity":"transaction","entity_id":"t","action":"create","before_json":null,"after_json":"{\\"transaction\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"a\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":100,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"cleared\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\"}}","source":"fixture","note":null,"created_at":"2026-01-11T00:00:00.000Z"},{"id":"fixed-1","entity":"transaction","entity_id":"t","action":"undo","before_json":"{\\"auditEntryId\\":\\"audit\\",\\"originalAction\\":\\"create\\",\\"beforeUndo\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"a\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":100,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"cleared\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\",\\"amount\\":1}}","after_json":"{\\"auditEntryId\\":\\"audit\\",\\"undoAction\\":\\"delete\\",\\"afterUndo\\":null,\\"balanceImpact\\":{\\"affectsBalances\\":true,\\"accounts\\":[{\\"accountId\\":\\"a\\",\\"accountName\\":\\"Bank\\",\\"previousBalance\\":10,\\"newBalance\\":11,\\"delta\\":1,\\"previousBalanceCentavos\\":1000,\\"newBalanceCentavos\\":1100,\\"deltaCentavos\\":100}],\\"deltas\\":[{\\"accountId\\":\\"a\\",\\"accountName\\":\\"Bank\\",\\"previousBalance\\":10,\\"newBalance\\":11,\\"delta\\":1,\\"previousBalanceCentavos\\":1000,\\"newBalanceCentavos\\":1100,\\"deltaCentavos\\":100}]}}","source":"undo","note":null,"created_at":"2026-01-15T12:00:00.000Z"}],"app_data_state":[{"id":1,"database_id":"00000000000000000000000000000000","data_revision":5,"last_financial_write_at":"2026-01-15T12:00:00.000Z"}]}},{"entity":"transaction","action":"update","result":{"success":true,"dryRun":false,"auditEntry":{"id":"audit","entity":"transaction","entityId":"t","action":"update","before":{"transaction":{"id":"t","accountId":"b","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":200,"currency":"USD","description":"Meal","notes":null,"status":"pending","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10"}},"after":{"transaction":{"id":"t","accountId":"a","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":100,"currency":"USD","description":"Meal","notes":null,"status":"cleared","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10"}},"source":"fixture","note":null,"createdAt":"2026-01-11T00:00:00.000Z"},"undone":{"entity":"transaction","entityId":"t","action":"update","inverseAction":"update","beforeUndo":{"id":"t","accountId":"a","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":100,"currency":"USD","description":"Meal","notes":null,"status":"cleared","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10","amount":1},"afterUndo":{"id":"t","accountId":"b","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":200,"currency":"USD","description":"Meal","notes":null,"status":"pending","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10","amount":2},"balanceImpact":{"affectsBalances":true,"accounts":[{"accountId":"a","accountName":"Bank","previousBalance":10,"newBalance":11,"delta":1,"previousBalanceCentavos":1000,"newBalanceCentavos":1100,"deltaCentavos":100}],"deltas":[{"accountId":"a","accountName":"Bank","previousBalance":10,"newBalance":11,"delta":1,"previousBalanceCentavos":1000,"newBalanceCentavos":1100,"deltaCentavos":100}]}},"dependentWrites":[],"message":"Undid audit entry audit with inverse action update."},"rows":{"transactions":[{"id":"t","account_id":"b","category_id":null,"subcategory_id":null,"type":"expense","amount":200,"currency":"USD","description":"Meal","notes":null,"date":"2026-01-10","tags":"[]","is_recurring":0,"transfer_to_account_id":null,"import_source":null,"import_external_id":null,"import_fingerprint":null,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","status":"pending","source":null,"note":null,"recurring_rule_id":null,"is_placeholder":0,"placeholder_status":null,"resolved_at":null,"resolved_by_transaction_id":null,"placeholder_reason":null,"placeholder_parent_transaction_id":null,"ledger_treatment":"normal","reporting_treatment":"normal","transaction_kind":"standard","staging_batch_id":null,"reconciliation_id":null,"matched_transaction_id":null,"is_archived":0,"finalization_id":null,"import_content_fingerprint":null}],"credit_card_statements":[],"accounts":[{"id":"a","name":"Bank","type":"checking","currency":"USD","balance":1100,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"},{"id":"b","name":"Card","type":"credit_card","currency":"USD","balance":2000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"}],"audit_log":[{"id":"audit","entity":"transaction","entity_id":"t","action":"update","before_json":"{\\"transaction\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"b\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":200,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"pending\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\"}}","after_json":"{\\"transaction\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"a\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":100,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"cleared\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\"}}","source":"fixture","note":null,"created_at":"2026-01-11T00:00:00.000Z"},{"id":"fixed-1","entity":"transaction","entity_id":"t","action":"undo","before_json":"{\\"auditEntryId\\":\\"audit\\",\\"originalAction\\":\\"update\\",\\"beforeUndo\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"a\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":100,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"cleared\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\",\\"amount\\":1}}","after_json":"{\\"auditEntryId\\":\\"audit\\",\\"undoAction\\":\\"update\\",\\"afterUndo\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"b\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":200,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"pending\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\",\\"amount\\":2},\\"balanceImpact\\":{\\"affectsBalances\\":true,\\"accounts\\":[{\\"accountId\\":\\"a\\",\\"accountName\\":\\"Bank\\",\\"previousBalance\\":10,\\"newBalance\\":11,\\"delta\\":1,\\"previousBalanceCentavos\\":1000,\\"newBalanceCentavos\\":1100,\\"deltaCentavos\\":100}],\\"deltas\\":[{\\"accountId\\":\\"a\\",\\"accountName\\":\\"Bank\\",\\"previousBalance\\":10,\\"newBalance\\":11,\\"delta\\":1,\\"previousBalanceCentavos\\":1000,\\"newBalanceCentavos\\":1100,\\"deltaCentavos\\":100}]}}","source":"undo","note":null,"created_at":"2026-01-15T12:00:00.000Z"}],"app_data_state":[{"id":1,"database_id":"00000000000000000000000000000000","data_revision":5,"last_financial_write_at":"2026-01-15T12:00:00.000Z"}]}},{"entity":"transaction","action":"delete","result":{"success":true,"dryRun":false,"auditEntry":{"id":"audit","entity":"transaction","entityId":"t","action":"delete","before":{"transaction":{"id":"t","accountId":"b","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":200,"currency":"USD","description":"Meal","notes":null,"status":"pending","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10"}},"after":null,"source":"fixture","note":null,"createdAt":"2026-01-11T00:00:00.000Z"},"undone":{"entity":"transaction","entityId":"t","action":"delete","inverseAction":"create","beforeUndo":null,"afterUndo":{"id":"t","accountId":"b","categoryId":null,"transferToAccountId":null,"type":"expense","amountCentavos":200,"currency":"USD","description":"Meal","notes":null,"status":"pending","source":null,"note":null,"recurringRuleId":null,"tags":[],"isPlaceholder":false,"placeholderStatus":null,"resolvedAt":null,"resolvedByTransactionId":null,"placeholderReason":null,"placeholderParentTransactionId":null,"date":"2026-01-10","amount":2},"balanceImpact":{"affectsBalances":false,"accounts":[],"deltas":[]}},"dependentWrites":[],"message":"Undid audit entry audit with inverse action create."},"rows":{"transactions":[{"id":"t","account_id":"b","category_id":null,"subcategory_id":null,"type":"expense","amount":200,"currency":"USD","description":"Meal","notes":null,"date":"2026-01-10","tags":"[]","is_recurring":0,"transfer_to_account_id":null,"import_source":null,"import_external_id":null,"import_fingerprint":null,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","status":"pending","source":null,"note":null,"recurring_rule_id":null,"is_placeholder":0,"placeholder_status":null,"resolved_at":null,"resolved_by_transaction_id":null,"placeholder_reason":null,"placeholder_parent_transaction_id":null,"ledger_treatment":"normal","reporting_treatment":"normal","transaction_kind":"standard","staging_batch_id":null,"reconciliation_id":null,"matched_transaction_id":null,"is_archived":0,"finalization_id":null,"import_content_fingerprint":null}],"credit_card_statements":[],"accounts":[{"id":"a","name":"Bank","type":"checking","currency":"USD","balance":1000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"},{"id":"b","name":"Card","type":"credit_card","currency":"USD","balance":2000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"}],"audit_log":[{"id":"audit","entity":"transaction","entity_id":"t","action":"delete","before_json":"{\\"transaction\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"b\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":200,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"pending\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\"}}","after_json":null,"source":"fixture","note":null,"created_at":"2026-01-11T00:00:00.000Z"},{"id":"fixed-1","entity":"transaction","entity_id":"t","action":"undo","before_json":"{\\"auditEntryId\\":\\"audit\\",\\"originalAction\\":\\"delete\\",\\"beforeUndo\\":null}","after_json":"{\\"auditEntryId\\":\\"audit\\",\\"undoAction\\":\\"create\\",\\"afterUndo\\":{\\"id\\":\\"t\\",\\"accountId\\":\\"b\\",\\"categoryId\\":null,\\"transferToAccountId\\":null,\\"type\\":\\"expense\\",\\"amountCentavos\\":200,\\"currency\\":\\"USD\\",\\"description\\":\\"Meal\\",\\"notes\\":null,\\"status\\":\\"pending\\",\\"source\\":null,\\"note\\":null,\\"recurringRuleId\\":null,\\"tags\\":[],\\"isPlaceholder\\":false,\\"placeholderStatus\\":null,\\"resolvedAt\\":null,\\"resolvedByTransactionId\\":null,\\"placeholderReason\\":null,\\"placeholderParentTransactionId\\":null,\\"date\\":\\"2026-01-10\\",\\"amount\\":2},\\"balanceImpact\\":{\\"affectsBalances\\":false,\\"accounts\\":[],\\"deltas\\":[]}}","source":"undo","note":null,"created_at":"2026-01-15T12:00:00.000Z"}],"app_data_state":[{"id":1,"database_id":"00000000000000000000000000000000","data_revision":3,"last_financial_write_at":"2026-01-15T12:00:00.000Z"}]}},{"entity":"credit_card_statement","action":"create","result":{"success":true,"dryRun":false,"auditEntry":{"id":"audit","entity":"credit_card_statement","entityId":"s","action":"create","before":null,"after":{"statement":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":25,"currency":"USD","status":"open","source":null,"note":null}},"source":"fixture","note":null,"createdAt":"2026-01-11T00:00:00.000Z"},"undone":{"entity":"credit_card_statement","entityId":"s","action":"create","inverseAction":"delete","beforeUndo":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":25,"unattributedPaidAmountCentavos":25,"currency":"USD","status":"open","source":null,"note":null,"statementBalance":10,"minimumPayment":1,"paidAmount":0.25},"afterUndo":null,"balanceImpact":{"affectsBalances":false,"accounts":[],"deltas":[]}},"dependentWrites":[],"message":"Undid audit entry audit with inverse action delete."},"rows":{"transactions":[],"credit_card_statements":[],"accounts":[{"id":"a","name":"Bank","type":"checking","currency":"USD","balance":1000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"},{"id":"b","name":"Card","type":"credit_card","currency":"USD","balance":2000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"}],"audit_log":[{"id":"audit","entity":"credit_card_statement","entity_id":"s","action":"create","before_json":null,"after_json":"{\\"statement\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":25,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null}}","source":"fixture","note":null,"created_at":"2026-01-11T00:00:00.000Z"},{"id":"fixed-1","entity":"credit_card_statement","entity_id":"s","action":"undo","before_json":"{\\"auditEntryId\\":\\"audit\\",\\"originalAction\\":\\"create\\",\\"beforeUndo\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":25,\\"unattributedPaidAmountCentavos\\":25,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null,\\"statementBalance\\":10,\\"minimumPayment\\":1,\\"paidAmount\\":0.25}}","after_json":"{\\"auditEntryId\\":\\"audit\\",\\"undoAction\\":\\"delete\\",\\"afterUndo\\":null,\\"balanceImpact\\":{\\"affectsBalances\\":false,\\"accounts\\":[],\\"deltas\\":[]}}","source":"undo","note":null,"created_at":"2026-01-15T12:00:00.000Z"}],"app_data_state":[{"id":1,"database_id":"00000000000000000000000000000000","data_revision":4,"last_financial_write_at":"2026-01-15T12:00:00.000Z"}]}},{"entity":"credit_card_statement","action":"update","result":{"success":true,"dryRun":false,"auditEntry":{"id":"audit","entity":"credit_card_statement","entityId":"s","action":"update","before":{"statement":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":0,"currency":"USD","status":"open","source":null,"note":null}},"after":{"statement":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":25,"currency":"USD","status":"open","source":null,"note":null}},"source":"fixture","note":null,"createdAt":"2026-01-11T00:00:00.000Z"},"undone":{"entity":"credit_card_statement","entityId":"s","action":"update","inverseAction":"update","beforeUndo":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":25,"unattributedPaidAmountCentavos":25,"currency":"USD","status":"open","source":null,"note":null,"statementBalance":10,"minimumPayment":1,"paidAmount":0.25},"afterUndo":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":0,"unattributedPaidAmountCentavos":0,"currency":"USD","status":"open","source":null,"note":null,"statementBalance":10,"minimumPayment":1,"paidAmount":0},"balanceImpact":{"affectsBalances":false,"accounts":[],"deltas":[]}},"dependentWrites":[],"message":"Undid audit entry audit with inverse action update."},"rows":{"transactions":[],"credit_card_statements":[{"id":"s","account_id":"b","statement_start_date":null,"statement_end_date":"2026-01-10","due_date":"2026-02-10","statement_balance":1000,"minimum_payment":100,"paid_amount":0,"currency":"USD","status":"open","source":null,"note":null,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","unattributed_paid_amount":0}],"accounts":[{"id":"a","name":"Bank","type":"checking","currency":"USD","balance":1000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"},{"id":"b","name":"Card","type":"credit_card","currency":"USD","balance":2000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"}],"audit_log":[{"id":"audit","entity":"credit_card_statement","entity_id":"s","action":"update","before_json":"{\\"statement\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":0,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null}}","after_json":"{\\"statement\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":25,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null}}","source":"fixture","note":null,"created_at":"2026-01-11T00:00:00.000Z"},{"id":"fixed-1","entity":"credit_card_statement","entity_id":"s","action":"undo","before_json":"{\\"auditEntryId\\":\\"audit\\",\\"originalAction\\":\\"update\\",\\"beforeUndo\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":25,\\"unattributedPaidAmountCentavos\\":25,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null,\\"statementBalance\\":10,\\"minimumPayment\\":1,\\"paidAmount\\":0.25}}","after_json":"{\\"auditEntryId\\":\\"audit\\",\\"undoAction\\":\\"update\\",\\"afterUndo\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":0,\\"unattributedPaidAmountCentavos\\":0,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null,\\"statementBalance\\":10,\\"minimumPayment\\":1,\\"paidAmount\\":0},\\"balanceImpact\\":{\\"affectsBalances\\":false,\\"accounts\\":[],\\"deltas\\":[]}}","source":"undo","note":null,"created_at":"2026-01-15T12:00:00.000Z"}],"app_data_state":[{"id":1,"database_id":"00000000000000000000000000000000","data_revision":4,"last_financial_write_at":"2026-01-15T12:00:00.000Z"}]}},{"entity":"credit_card_statement","action":"delete","result":{"success":true,"dryRun":false,"auditEntry":{"id":"audit","entity":"credit_card_statement","entityId":"s","action":"delete","before":{"statement":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":0,"currency":"USD","status":"open","source":null,"note":null}},"after":null,"source":"fixture","note":null,"createdAt":"2026-01-11T00:00:00.000Z"},"undone":{"entity":"credit_card_statement","entityId":"s","action":"delete","inverseAction":"create","beforeUndo":null,"afterUndo":{"id":"s","accountId":"b","statementStartDate":null,"statementEndDate":"2026-01-10","dueDate":"2026-02-10","statementBalanceCentavos":1000,"minimumPaymentCentavos":100,"paidAmountCentavos":0,"unattributedPaidAmountCentavos":0,"currency":"USD","status":"open","source":null,"note":null,"statementBalance":10,"minimumPayment":1,"paidAmount":0},"balanceImpact":{"affectsBalances":false,"accounts":[],"deltas":[]}},"dependentWrites":[],"message":"Undid audit entry audit with inverse action create."},"rows":{"transactions":[],"credit_card_statements":[{"id":"s","account_id":"b","statement_start_date":null,"statement_end_date":"2026-01-10","due_date":"2026-02-10","statement_balance":1000,"minimum_payment":100,"paid_amount":0,"currency":"USD","status":"open","source":null,"note":null,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","unattributed_paid_amount":0}],"accounts":[{"id":"a","name":"Bank","type":"checking","currency":"USD","balance":1000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"},{"id":"b","name":"Card","type":"credit_card","currency":"USD","balance":2000,"icon":null,"color":null,"is_archived":0,"is_primary":0,"created_at":"2026-01-15T12:00:00.000Z","updated_at":"2026-01-15T12:00:00.000Z","credit_limit":null,"statement_closing_day":null,"payment_due_day":null,"account_mode":"transactional","valuation_mode":"unresolved"}],"audit_log":[{"id":"audit","entity":"credit_card_statement","entity_id":"s","action":"delete","before_json":"{\\"statement\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":0,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null}}","after_json":null,"source":"fixture","note":null,"created_at":"2026-01-11T00:00:00.000Z"},{"id":"fixed-1","entity":"credit_card_statement","entity_id":"s","action":"undo","before_json":"{\\"auditEntryId\\":\\"audit\\",\\"originalAction\\":\\"delete\\",\\"beforeUndo\\":null}","after_json":"{\\"auditEntryId\\":\\"audit\\",\\"undoAction\\":\\"create\\",\\"afterUndo\\":{\\"id\\":\\"s\\",\\"accountId\\":\\"b\\",\\"statementStartDate\\":null,\\"statementEndDate\\":\\"2026-01-10\\",\\"dueDate\\":\\"2026-02-10\\",\\"statementBalanceCentavos\\":1000,\\"minimumPaymentCentavos\\":100,\\"paidAmountCentavos\\":0,\\"unattributedPaidAmountCentavos\\":0,\\"currency\\":\\"USD\\",\\"status\\":\\"open\\",\\"source\\":null,\\"note\\":null,\\"statementBalance\\":10,\\"minimumPayment\\":1,\\"paidAmount\\":0},\\"balanceImpact\\":{\\"affectsBalances\\":false,\\"accounts\\":[],\\"deltas\\":[]}}","source":"undo","note":null,"created_at":"2026-01-15T12:00:00.000Z"}],"app_data_state":[{"id":1,"database_id":"00000000000000000000000000000000","data_revision":3,"last_financial_write_at":"2026-01-15T12:00:00.000Z"}]}}]"`
    )
  })

  it.each([
    'ledgerTreatment',
    'reportingTreatment',
    'transactionKind',
    'stagingBatchId',
    'reconciliationId',
    'matchedTransactionId',
    'isArchived',
  ])('keeps raw %s protection before missing-target errors', async (key) => {
    audit('transaction', 'create', null, {
      transaction: tx({ [key]: key === 'isArchived' ? true : 'protected' }),
    })
    expect(await run('undo', { auditId: 'audit' })).toEqual({
      success: false,
      reason: 'dedicated_financial_undo_required',
      message:
        'This transaction uses staging, reconciliation, matching, archive, or reporting semantics and cannot be restored through generic undo. Use its dedicated reversal or unmatch workflow.',
    })
  })

  it.each([
    'importSource',
    'importExternalId',
    'importFingerprint',
    'importContentFingerprint',
    'finalizationId',
    'import_source',
    'import_external_id',
    'import_fingerprint',
    'import_content_fingerprint',
    'finalization_id',
  ])('keeps raw %s evidence absent from the replay subset', async (key) => {
    audit('transaction', 'delete', { transaction: tx({ [key]: 'evidence' }) }, null)
    const before = dump()
    for (const apply of [false, true])
      await expect(run('undo', { auditId: 'audit', apply })).rejects.toThrow(
        'Imported or finalized evidence cannot be restored by generic undo.'
      )
    expect(dump()).toEqual(before)
  })

  it('pins malformed JSON and missing nesting refusal envelopes', async () => {
    audit('transaction', 'delete', {}, null)
    expect(await run('undo', { auditId: 'audit' })).toEqual({
      success: false,
      reason: 'unsupported_undo_snapshot',
      message: 'Audit entry audit does not contain the transaction snapshot required for undo.',
    })
    state.db!.exec("UPDATE audit_log SET before_json='{broken'")
    expect(await run('undo', { auditId: 'audit' })).toEqual({
      success: false,
      reason: 'unsupported_undo_snapshot',
      message: 'Audit entry audit does not contain the transaction snapshot required for undo.',
    })
  })

  it('pins snapshot-only refusal before malformed snapshot decoding', async () => {
    state.db!.exec("UPDATE accounts SET account_mode='snapshot_only' WHERE id='a'")
    audit('transaction', 'delete', { transaction: { accountId: 'a' } }, null)
    expect(await run('undo', { auditId: 'audit' })).toEqual({
      success: false,
      reason: 'snapshot_only_account',
      message: 'Generic undo cannot mutate transaction history for snapshot-only account a.',
    })
  })

  it('pins stale transaction preview precedence over dependent writes', async () => {
    liveTransaction(tx({ description: 'Changed' }))
    audit('transaction', 'create', null, { transaction: tx() })
    audit('transaction', 'update', { transaction: tx() }, { transaction: tx() }, 'later')
    state.db!.exec("UPDATE audit_log SET created_at='2026-01-12T00:00:00.000Z' WHERE id='later'")
    await expect(run('undo', { auditId: 'audit' })).rejects.toThrow(
      'Transaction t changed after audit entry audit; refresh the undo preview.'
    )
  })

  it('keeps statement current-state checks apply-only', async () => {
    liveStatement(statement({ paidAmountCentavos: 50 }))
    audit('credit_card_statement', 'create', null, { statement: statement() })
    expect(await run('undo', { auditId: 'audit' })).toMatchInlineSnapshot(`
      {
        "auditEntry": {
          "action": "create",
          "after": {
            "statement": {
              "accountId": "b",
              "currency": "USD",
              "dueDate": "2026-02-10",
              "id": "s",
              "minimumPaymentCentavos": 100,
              "note": null,
              "paidAmountCentavos": 25,
              "source": null,
              "statementBalanceCentavos": 1000,
              "statementEndDate": "2026-01-10",
              "statementStartDate": null,
              "status": "open",
            },
          },
          "before": null,
          "createdAt": "2026-01-11T00:00:00.000Z",
          "entity": "credit_card_statement",
          "entityId": "s",
          "id": "audit",
          "note": null,
          "source": "fixture",
        },
        "dependentWrites": [],
        "dryRun": true,
        "message": "Dry run: audit entry audit would be undone with inverse action delete.",
        "requiresApply": true,
        "success": true,
        "wouldUndo": {
          "action": "create",
          "afterUndo": null,
          "balanceImpact": {
            "accounts": [],
            "affectsBalances": false,
            "deltas": [],
          },
          "beforeUndo": {
            "accountId": "b",
            "currency": "USD",
            "dueDate": "2026-02-10",
            "id": "s",
            "minimumPayment": 1,
            "minimumPaymentCentavos": 100,
            "note": null,
            "paidAmount": 0.25,
            "paidAmountCentavos": 25,
            "source": null,
            "statementBalance": 10,
            "statementBalanceCentavos": 1000,
            "statementEndDate": "2026-01-10",
            "statementStartDate": null,
            "status": "open",
            "unattributedPaidAmountCentavos": 25,
          },
          "entity": "credit_card_statement",
          "entityId": "s",
          "inverseAction": "delete",
        },
      }
    `)
    const before = dump()
    await expect(run('undo', { auditId: 'audit', apply: true })).rejects.toThrow(
      'Statement s changed after audit entry audit; refresh the undo preview.'
    )
    expect(dump()).toEqual(before)
  })

  it.each(['transaction', 'credit_card_statement'])(
    'pins missing and recreated %s conflicts',
    async (entity) => {
      const key = entity === 'transaction' ? 'transaction' : 'statement'
      const value = entity === 'transaction' ? tx() : statement()
      audit(entity, 'create', null, { [key]: value })
      const missing = await run('undo', { auditId: 'audit' })
      expect(missing).toEqual(
        entity === 'transaction'
          ? {
              success: false,
              reason: 'undo_conflict_transaction_missing',
              message: 'Transaction t no longer exists; audit audit cannot be undone safely.',
            }
          : {
              success: false,
              reason: 'undo_conflict_statement_missing',
              message:
                'Credit-card statement s no longer exists; audit audit cannot be undone safely.',
            }
      )
      state.db!.exec('DELETE FROM audit_log')
      audit(entity, 'delete', { [key]: value }, null)
      if (entity === 'transaction') liveTransaction()
      else liveStatement()
      expect(await run('undo', { auditId: 'audit' })).toEqual(
        entity === 'transaction'
          ? {
              success: false,
              reason: 'undo_conflict_transaction_exists',
              message:
                'Transaction t already exists; undoing delete audit audit would overwrite data.',
            }
          : {
              success: false,
              reason: 'undo_conflict_statement_exists',
              message:
                'Credit-card statement s already exists; undoing delete audit audit would overwrite data.',
            }
      )
    }
  )

  it('compares raw audit bytes again under the write lock', async () => {
    liveTransaction()
    audit('transaction', 'create', null, { transaction: tx() })
    state.beforeBegin = () => state.db!.exec("UPDATE audit_log SET after_json=after_json || ' '")
    await expect(run('undo', { auditId: 'audit', apply: true })).rejects.toThrow(
      'Audit entry audit changed; refresh the undo preview.'
    )
    expect(state.db!.prepare('SELECT id FROM transactions').all()).toEqual([{ id: 't' }])
    expect(state.db!.prepare("SELECT balance FROM accounts WHERE id='a'").get()).toEqual({
      balance: 1000,
    })
    expect(state.db!.prepare('SELECT id FROM audit_log').all()).toEqual([{ id: 'audit' }])
  })

  it('rechecks live rows after acquiring the write lock', async () => {
    liveTransaction()
    audit('transaction', 'create', null, { transaction: tx() })
    state.beforeBegin = () => state.db!.exec("UPDATE transactions SET amount=101 WHERE id='t'")
    await expect(run('undo', { auditId: 'audit', apply: true })).rejects.toThrow(
      'Transaction t changed after audit entry audit; refresh the undo preview.'
    )
    expect(state.db!.prepare('SELECT id FROM audit_log').all()).toEqual([{ id: 'audit' }])
  })

  it('rechecks dependent writes after acquiring the write lock', async () => {
    liveTransaction()
    audit('transaction', 'create', null, { transaction: tx() })
    state.beforeBegin = () => {
      audit('transaction', 'update', { transaction: tx() }, { transaction: tx() }, 'later')
      state.db!.exec("UPDATE audit_log SET created_at='2026-01-12T00:00:00.000Z' WHERE id='later'")
    }
    await expect(run('undo', { auditId: 'audit', apply: true })).rejects.toThrow(
      'Audit entry audit now has later dependent writes; refresh the preview.'
    )
    expect(state.db!.prepare('SELECT id FROM transactions').all()).toEqual([{ id: 't' }])
  })

  it.each(['DELETE FROM transactions', 'UPDATE accounts SET balance', 'INSERT INTO audit_log'])(
    'rolls back entity, balances, revisions and audit on %s failure',
    async (sql) => {
      liveTransaction()
      audit('transaction', 'create', null, { transaction: tx() })
      const before = dump()
      state.failSql = sql
      await expect(run('undo', { auditId: 'audit', apply: true })).rejects.toThrow(
        'injected inverse failure'
      )
      expect(dump()).toEqual(before)
      expect(state.trace.at(-1)).toEqual(['rollback'])
    }
  )
})
