// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as DatabaseModule from './database.js'
import type * as OsModule from 'node:os'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'
import { applyFinancialSemanticsTestSchema } from './financial-semantics-test-schema.js'

const tempDirs = new Set<string>()
const cleanupCallbacks = new Set<() => void>()

function seedTransactionStatusTriggers(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER trg_transactions_status_insert_valid
    BEFORE INSERT ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NOT NULL AND TRIM(NEW.status) != '' AND NEW.status NOT IN ('pending', 'posted', 'cleared')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid transaction status');
    END;
    CREATE TRIGGER trg_transactions_status_insert_default
    AFTER INSERT ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NULL OR TRIM(NEW.status) = ''
    BEGIN
      UPDATE transactions SET status = 'posted' WHERE id = NEW.id;
    END;
    CREATE TRIGGER trg_transactions_status_update_valid
    BEFORE UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NOT NULL AND TRIM(NEW.status) != '' AND NEW.status NOT IN ('pending', 'posted', 'cleared')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid transaction status');
    END;
    CREATE TRIGGER trg_transactions_status_update_default
    AFTER UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NULL OR TRIM(NEW.status) = ''
    BEGIN
      UPDATE transactions SET status = 'posted' WHERE id = NEW.id;
    END;
  `)
}

function createTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shikin-tools-sqlite-'))
  tempDirs.add(dir)
  return dir
}

function getDbPath(tempHome: string): string {
  return join(tempHome, '.local', 'share', 'com.asf.shikin', 'shikin.db')
}

function seedDatabase({
  tempHome,
  accountBalance,
  transaction,
}: {
  tempHome: string
  accountBalance: number
  transaction?: {
    id: string
    type: 'expense' | 'income' | 'transfer'
    amount: number
    description: string
    date: string
    notes?: string | null
    status?: 'pending' | 'posted' | 'cleared'
    source?: string | null
    note?: string | null
    recurringRuleId?: string | null
  }
}): string {
  const dbPath = getDbPath(tempHome)
  mkdirSync(join(tempHome, '.local', 'share', 'com.asf.shikin'), { recursive: true })

  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other')),
      currency TEXT NOT NULL DEFAULT 'USD',
      balance INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      credit_limit INTEGER,
      statement_closing_day INTEGER,
      payment_due_day INTEGER,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      icon TEXT,
      color TEXT,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE subcategories (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE recurring_rules (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
      next_date TEXT NOT NULL,
      end_date TEXT,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      to_account_id TEXT REFERENCES accounts(id),
      category_id TEXT REFERENCES categories(id),
      subcategory_id TEXT REFERENCES subcategories(id),
      tags TEXT DEFAULT '',
      notes TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      subcategory_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      description TEXT NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      transfer_to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'posted',
      source TEXT,
      note TEXT,
      recurring_rule_id TEXT,
      is_placeholder INTEGER NOT NULL DEFAULT 0,
      placeholder_status TEXT,
      resolved_at TEXT,
      resolved_by_transaction_id TEXT,
      placeholder_reason TEXT,
      placeholder_parent_transaction_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE account_balance_history (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      balance INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(account_id, date)
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE cashflow_buckets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      target_amount INTEGER,
      balance INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE cashflow_bucket_allocations (
      id TEXT PRIMARY KEY,
      bucket_id TEXT NOT NULL,
      transaction_id TEXT,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      allocation_date TEXT NOT NULL,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE category_suggestions (
      id TEXT PRIMARY KEY,
      transaction_id TEXT,
      description TEXT NOT NULL,
      suggested_category_id TEXT,
      suggested_subcategory_id TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      reviewed_at TEXT
    );
    CREATE TABLE credit_card_statements (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      statement_start_date TEXT,
      statement_end_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      statement_balance INTEGER NOT NULL DEFAULT 0,
      minimum_payment INTEGER NOT NULL DEFAULT 0,
      paid_amount INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE transaction_splits (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id),
      subcategory_id TEXT REFERENCES subcategories(id),
      amount INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `)

  seedTransactionStatusTriggers(db)
  applyFinancialSemanticsTestSchema(db)

  for (const migration of CLI_DATABASE_MIGRATIONS) {
    db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(
      Number(migration.slice(0, 3)),
      migration
    )
  }

  db.prepare(
    `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('acct-1', 'Primary', 'checking', 'USD', accountBalance, 0)

  db.prepare(
    `INSERT INTO categories (id, name, icon, color, type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('cat-1', 'Food', null, null, 'expense', 1)
  db.prepare(
    `INSERT INTO categories (id, name, icon, color, type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('cat-2', 'Transport', null, null, 'expense', 2)
  db.prepare(
    `INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, account_id, category_id, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'rule-pending',
    'Pending coffee rule',
    1000,
    'USD',
    'expense',
    'monthly',
    '2026-04-14',
    'acct-1',
    'cat-1',
    1
  )

  if (transaction) {
    db.prepare(
      `INSERT INTO transactions
         (id, account_id, category_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      transaction.id,
      'acct-1',
      null,
      transaction.type,
      transaction.amount,
      'USD',
      transaction.description,
      transaction.notes ?? null,
      transaction.status ?? 'posted',
      transaction.source ?? null,
      transaction.note ?? null,
      transaction.recurringRuleId ?? null,
      transaction.date
    )
  }

  db.close()
  return dbPath
}

function readDatabaseState(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const account = db.prepare('SELECT balance FROM accounts WHERE id = ?').get('acct-1') as {
      balance: number
    }
    const transactions = db
      .prepare('SELECT id, type, amount, description, date FROM transactions ORDER BY id')
      .all() as Array<{
      id: string
      type: string
      amount: number
      description: string
      date: string
    }>

    return {
      balance: account.balance,
      transactions,
    }
  } finally {
    db.close()
  }
}

function readAccountBalances(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db.prepare('SELECT id, balance FROM accounts ORDER BY id').all() as Array<{
      id: string
      balance: number
    }>
  } finally {
    db.close()
  }
}

function readAccounts(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db
      .prepare('SELECT id, name, type, currency, balance FROM accounts ORDER BY id')
      .all() as Array<{
      id: string
      name: string
      type: string
      currency: string
      balance: number
    }>
  } finally {
    db.close()
  }
}

function readAuditLog(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db
      .prepare(
        'SELECT entity, entity_id, action, before_json, after_json FROM audit_log ORDER BY created_at, id'
      )
      .all() as Array<{
      entity: string
      entity_id: string | null
      action: string
      before_json: string | null
      after_json: string | null
    }>
  } finally {
    db.close()
  }
}

function readTransactionDetails(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db
      .prepare(
        `SELECT id, type, amount, description, notes, status, source, note, recurring_rule_id, date
         FROM transactions ORDER BY id`
      )
      .all() as Array<{
      id: string
      type: string
      amount: number
      description: string
      notes: string | null
      status: string
      source: string | null
      note: string | null
      recurring_rule_id: string | null
      date: string
    }>
  } finally {
    db.close()
  }
}

function readTransactionSplits(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db
      .prepare(
        `SELECT transaction_id, category_id, subcategory_id, amount, notes
         FROM transaction_splits ORDER BY amount DESC`
      )
      .all() as Array<{
      transaction_id: string
      category_id: string
      subcategory_id: string | null
      amount: number
      notes: string | null
    }>
  } finally {
    db.close()
  }
}

function readCashflowState(dbPath: string) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return {
      buckets: db
        .prepare('SELECT id, name, balance FROM cashflow_buckets ORDER BY id')
        .all() as Array<{ id: string; name: string; balance: number }>,
      allocations: db
        .prepare(
          'SELECT bucket_id, transaction_id, amount FROM cashflow_bucket_allocations ORDER BY id'
        )
        .all() as Array<{ bucket_id: string; transaction_id: string | null; amount: number }>,
    }
  } finally {
    db.close()
  }
}

async function loadToolsWithRealDatabaseFailure({
  tempHome,
  failOnExecuteCall,
}: {
  tempHome: string
  failOnExecuteCall: number
}) {
  const dbPath = getDbPath(tempHome)

  vi.resetModules()
  vi.stubEnv('HOME', tempHome)
  vi.stubEnv('XDG_DATA_HOME', '')
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof OsModule>('node:os')
    return {
      ...actual,
      homedir: () => tempHome,
    }
  })
  vi.doMock('./ulid.js', () => ({
    generateId: () => 'tx_sqlite_rollback',
  }))
  vi.doMock('./database.js', async () => {
    const actual = await vi.importActual<typeof DatabaseModule>('./database.js')
    let executeCalls = 0

    return {
      ...actual,
      execute: (sql: string, params?: unknown[]) => {
        executeCalls += 1
        if (executeCalls === failOnExecuteCall) {
          throw new Error(`Injected execute failure on call ${executeCalls}`)
        }
        return actual.execute(sql, params)
      },
    }
  })

  const toolsModule = await import('./tools.js')
  const databaseModule = await import('./database.js')
  cleanupCallbacks.add(() => databaseModule.close())

  return {
    dbPath,
    tools: toolsModule.tools,
  }
}

async function loadToolsWithRealDatabase(tempHome: string) {
  let generatedId = 0
  vi.resetModules()
  vi.stubEnv('HOME', tempHome)
  vi.stubEnv('XDG_DATA_HOME', '')
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof OsModule>('node:os')
    return {
      ...actual,
      homedir: () => tempHome,
    }
  })
  vi.doMock('./ulid.js', () => ({
    generateId: () => `tx_sqlite_${++generatedId}`,
  }))

  const toolsModule = await import('./tools.js')
  const databaseModule = await import('./database.js')
  cleanupCallbacks.add(() => databaseModule.close())

  return {
    tools: toolsModule.tools,
  }
}

afterEach(() => {
  for (const cleanup of cleanupCallbacks) cleanup()
  cleanupCallbacks.clear()

  vi.doUnmock('./database.js')
  vi.doUnmock('./ulid.js')
  vi.doUnmock('node:os')
  vi.unstubAllEnvs()
  vi.resetModules()

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('CLI tools SQLite transaction rollback', () => {
  it('keeps pending transactions out of balances while posted and cleared transactions apply', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 10_000 })
    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const addTransaction = tools.find((tool) => tool.name === 'add-transaction')!
    const queryTransactions = tools.find((tool) => tool.name === 'query-transactions')!

    await addTransaction.execute(
      addTransaction.schema.parse({
        amount: 10,
        type: 'expense',
        description: 'Pending coffee',
        accountId: 'acct-1',
        notes: 'user note',
        status: 'pending',
        source: 'sqlite-test',
        note: 'metadata note',
        recurringRuleId: 'rule-pending',
      })
    )
    await addTransaction.execute(
      addTransaction.schema.parse({
        amount: 5,
        type: 'expense',
        description: 'Posted snack',
        accountId: 'acct-1',
        status: 'posted',
      })
    )
    await addTransaction.execute(
      addTransaction.schema.parse({
        amount: 2,
        type: 'income',
        description: 'Cleared rebate',
        accountId: 'acct-1',
        status: 'cleared',
      })
    )

    expect(readAccountBalances(dbPath)).toEqual([{ id: 'acct-1', balance: 9_700 }])
    expect(readTransactionDetails(dbPath)).toEqual([
      expect.objectContaining({
        description: 'Pending coffee',
        amount: 1000,
        notes: 'user note',
        status: 'pending',
        source: 'sqlite-test',
        note: 'metadata note',
        recurring_rule_id: 'rule-pending',
      }),
      expect.objectContaining({ description: 'Posted snack', amount: 500, status: 'posted' }),
      expect.objectContaining({ description: 'Cleared rebate', amount: 200, status: 'cleared' }),
    ])

    const pendingResult = await queryTransactions.execute(
      queryTransactions.schema.parse({ status: 'pending', limit: 10 })
    )
    expect(pendingResult).toMatchObject({
      count: 1,
      totalMatched: 1,
      transactions: [
        expect.objectContaining({
          description: 'Pending coffee',
          status: 'pending',
          source: 'sqlite-test',
          note: 'metadata note',
          recurringRuleId: 'rule-pending',
          notes: 'user note',
        }),
      ],
    })
  }, 10_000)

  it('applies the balance delta when a pending transaction is posted', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 10_000,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        amount: 1_000,
        description: 'Coffee hold',
        date: '2026-04-14',
        status: 'pending',
      },
    })
    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!

    await expect(
      updateTransaction.execute(
        updateTransaction.schema.parse({ transactionId: 'tx-1', status: 'posted' })
      )
    ).resolves.toMatchObject({ success: true, transaction: { status: 'posted' } })

    expect(readAccountBalances(dbPath)).toEqual([{ id: 'acct-1', balance: 9_000 }])
  }, 10_000)

  it('reverses posted balance impact when deleting a transaction', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 9_000,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        amount: 1_000,
        description: 'Posted coffee',
        date: '2026-04-14',
        status: 'posted',
      },
    })
    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!

    await expect(
      deleteTransaction.execute(deleteTransaction.schema.parse({ transactionId: 'tx-1' }))
    ).resolves.toMatchObject({ success: true })

    expect(readAccountBalances(dbPath)).toEqual([{ id: 'acct-1', balance: 10_000 }])
    expect(readTransactionDetails(dbPath)).toEqual([])
  }, 10_000)

  it('rolls back add-transaction when the later balance write fails', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 10_000 })
    const { tools } = await loadToolsWithRealDatabaseFailure({ tempHome, failOnExecuteCall: 2 })
    const addTransaction = tools.find((tool) => tool.name === 'add-transaction')!

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
    })

    await expect(addTransaction.execute(input)).rejects.toThrow(
      'Injected execute failure on call 2'
    )
    expect(readDatabaseState(dbPath)).toEqual({
      balance: 10_000,
      transactions: [],
    })
  }, 10_000)

  it('rolls back update-transaction when the final row update fails', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 9_000,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        amount: 1_000,
        description: 'Coffee',
        date: '2026-04-14',
        notes: 'old notes',
      },
    })
    const { tools } = await loadToolsWithRealDatabaseFailure({ tempHome, failOnExecuteCall: 2 })
    const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      amount: 12,
      description: 'Lunch',
    })

    await expect(updateTransaction.execute(input)).rejects.toThrow(
      'Injected execute failure on call 2'
    )
    expect(readDatabaseState(dbPath)).toEqual({
      balance: 9_000,
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          amount: 1_000,
          description: 'Coffee',
          date: '2026-04-14',
        },
      ],
    })
  })

  it('rolls back delete-transaction when the later delete write fails', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 9_000,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        amount: 1_000,
        description: 'Coffee',
        date: '2026-04-14',
      },
    })
    const { tools } = await loadToolsWithRealDatabaseFailure({ tempHome, failOnExecuteCall: 2 })
    const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!

    const input = deleteTransaction.schema.parse({
      transactionId: 'tx-1',
    })

    await expect(deleteTransaction.execute(input)).rejects.toThrow(
      'Injected execute failure on call 2'
    )
    expect(readDatabaseState(dbPath)).toEqual({
      balance: 9_000,
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          amount: 1_000,
          description: 'Coffee',
          date: '2026-04-14',
        },
      ],
    })
  })

  it('updates an account through upsert-account and persists the audit row in SQLite', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 10_000 })
    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const upsertAccount = tools.find((tool) => tool.name === 'upsert-account')!

    await expect(
      upsertAccount.execute(
        upsertAccount.schema.parse({ accountId: 'acct-1', name: 'Renamed Primary' })
      )
    ).resolves.toMatchObject({ success: true, action: 'updated' })

    expect(readAccounts(dbPath)).toEqual([
      expect.objectContaining({ id: 'acct-1', name: 'Renamed Primary', balance: 10_000 }),
    ])
    const auditRows = readAuditLog(dbPath)
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({
      entity: 'account',
      entity_id: 'acct-1',
      action: 'update',
    })
    expect(JSON.parse(auditRows[0].before_json ?? '{}').account.name).toBe('Primary')
    expect(JSON.parse(auditRows[0].after_json ?? '{}').account.name).toBe('Renamed Primary')
  }, 10_000)

  it('rolls back update-transaction on a real SQLite abort while moving accounts and flipping type', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 9_000,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        amount: 1_000,
        description: 'Coffee',
        date: '2026-04-14',
      },
    })

    const db = new Database(dbPath)
    try {
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('acct-2', 'Savings', 'savings', 'USD', 5_000, 0)
      db.exec(`
        CREATE TRIGGER abort_transaction_update
        BEFORE UPDATE ON transactions
        WHEN NEW.id = 'tx-1'
        BEGIN
          SELECT RAISE(ABORT, 'Injected sqlite trigger failure');
        END;
      `)
    } finally {
      db.close()
    }

    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      type: 'income',
      amount: 12,
      description: 'Refund',
      accountId: 'acct-2',
    })

    await expect(updateTransaction.execute(input)).rejects.toThrow(
      'Injected sqlite trigger failure'
    )
    expect(readAccountBalances(dbPath)).toEqual([
      { id: 'acct-1', balance: 9_000 },
      { id: 'acct-2', balance: 5_000 },
    ])
    expect(readDatabaseState(dbPath)).toEqual({
      balance: 9_000,
      transactions: [
        {
          id: 'tx-1',
          type: 'expense',
          amount: 1_000,
          description: 'Coffee',
          date: '2026-04-14',
        },
      ],
    })
  })

  it('creates split rows using the frontend transaction_splits schema', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 9_000,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        amount: 1_000,
        description: 'Groceries and bus fare',
        date: '2026-04-14',
      },
    })

    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const splitTransaction = tools.find((tool) => tool.name === 'split-transaction')!

    const input = splitTransaction.schema.parse({
      transactionId: 'tx-1',
      splits: [
        { categoryId: 'cat-1', amount: 7, notes: 'groceries' },
        { categoryId: 'cat-2', amount: 3, notes: 'bus' },
      ],
    })

    await expect(splitTransaction.execute(input)).resolves.toMatchObject({
      success: true,
      transactionId: 'tx-1',
      splitCount: 2,
    })
    expect(readTransactionSplits(dbPath)).toEqual([
      {
        transaction_id: 'tx-1',
        category_id: 'cat-1',
        subcategory_id: null,
        amount: 700,
        notes: 'groceries',
      },
      {
        transaction_id: 'tx-1',
        category_id: 'cat-2',
        subcategory_id: null,
        amount: 300,
        notes: 'bus',
      },
    ])
  })

  it('rolls back split-transaction when an insert fails after deleting existing splits', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 9_000,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        amount: 1_000,
        description: 'Groceries and bus fare',
        date: '2026-04-14',
      },
    })

    const db = new Database(dbPath)
    try {
      db.prepare(
        `INSERT INTO transaction_splits (id, transaction_id, category_id, subcategory_id, amount, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('split-existing', 'tx-1', 'cat-1', null, 1_000, 'existing split')
    } finally {
      db.close()
    }

    const { tools } = await loadToolsWithRealDatabaseFailure({ tempHome, failOnExecuteCall: 2 })
    const splitTransaction = tools.find((tool) => tool.name === 'split-transaction')!

    const input = splitTransaction.schema.parse({
      transactionId: 'tx-1',
      splits: [
        { categoryId: 'cat-1', amount: 7, notes: 'groceries' },
        { categoryId: 'cat-2', amount: 3, notes: 'bus' },
      ],
    })

    await expect(splitTransaction.execute(input)).rejects.toThrow(
      'Injected execute failure on call 2'
    )
    expect(readTransactionSplits(dbPath)).toEqual([
      {
        transaction_id: 'tx-1',
        category_id: 'cat-1',
        subcategory_id: null,
        amount: 1000,
        notes: 'existing split',
      },
    ])
  })

  it('rolls back allocate-income when the bucket balance update fails', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 10_000,
      transaction: {
        id: 'tx-income',
        type: 'income',
        amount: 10_000,
        description: 'Paycheck',
        date: '2026-05-01',
        status: 'posted',
      },
    })

    const db = new Database(dbPath)
    try {
      db.prepare(
        `INSERT INTO cashflow_buckets (id, name, description, target_amount, balance, currency, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run('bucket-1', 'Rent', null, null, 0, 'USD', 0, 1)
    } finally {
      db.close()
    }

    const { tools } = await loadToolsWithRealDatabaseFailure({ tempHome, failOnExecuteCall: 2 })
    const allocateIncome = tools.find((tool) => tool.name === 'allocate-income')!

    await expect(
      allocateIncome.execute(
        allocateIncome.schema.parse({
          bucketId: 'bucket-1',
          transactionId: 'tx-income',
          amount: 50,
          allocationDate: '2026-05-02',
        })
      )
    ).rejects.toThrow('Injected execute failure on call 2')

    expect(readCashflowState(dbPath)).toEqual({
      buckets: [{ id: 'bucket-1', name: 'Rent', balance: 0 }],
      allocations: [],
    })
  }, 10_000)

  it('rejects transaction ledger writes for snapshot-only accounts', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 110_225 })
    const db = new Database(dbPath)
    try {
      db.prepare("UPDATE accounts SET account_mode = 'snapshot_only' WHERE id = 'acct-1'").run()
    } finally {
      db.close()
    }

    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const addTransaction = tools.find((tool) => tool.name === 'add-transaction')!
    await expect(
      addTransaction.execute(
        addTransaction.schema.parse({
          accountId: 'acct-1',
          amount: 10,
          type: 'expense',
          description: 'Should not write',
          dryRun: true,
        })
      )
    ).resolves.toMatchObject({ success: false, reason: 'snapshot_only_account' })

    const guarded = new Database(dbPath)
    try {
      expect(() =>
        guarded
          .prepare(
            `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
             VALUES ('blocked-snapshot-row', 'acct-1', 'expense', 100, 'USD', 'Blocked', '2026-06-01')`
          )
          .run()
      ).toThrow('Snapshot-only accounts cannot accept transaction ledger rows')
      guarded
        .prepare(
          `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
           VALUES ('acct-with-history', 'History', 'checking', 'USD', 0, 0)`
        )
        .run()
      guarded
        .prepare(
          `INSERT INTO transactions (id, account_id, type, amount, currency, description, date)
           VALUES ('history-row', 'acct-with-history', 'expense', 100, 'USD', 'History', '2026-06-01')`
        )
        .run()
      expect(() =>
        guarded
          .prepare(
            "UPDATE accounts SET account_mode = 'snapshot_only' WHERE id = 'acct-with-history'"
          )
          .run()
      ).toThrow('Accounts with transaction history cannot become snapshot-only')
    } finally {
      guarded.close()
    }
  })

  it('reconciles from the effective ledger even when the stored balance already matches', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 110_225 })
    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const reconcile = tools.find((tool) => tool.name === 'reconcile')!

    await expect(
      reconcile.execute(reconcile.schema.parse({ accountId: 'acct-1', actualBalance: 1102.25 }))
    ).resolves.toMatchObject({
      dryRun: true,
      storedBalanceCentavos: 110_225,
      ledgerBalanceCentavos: 0,
      differenceCentavos: 110_225,
      applyRequired: true,
    })

    await expect(
      reconcile.execute(
        reconcile.schema.parse({
          accountId: 'acct-1',
          actualBalance: 1102.25,
          date: '2026-05-31',
          basis: 'effective_ledger',
          apply: true,
        })
      )
    ).resolves.toMatchObject({
      success: true,
      dryRun: false,
      verifiedLedgerBalanceCentavos: 110_225,
    })

    const db = new Database(dbPath, { readonly: true })
    try {
      expect(
        db
          .prepare(
            `SELECT amount, reporting_treatment, transaction_kind, category_id
             FROM transactions WHERE transaction_kind = 'reconciliation_bridge'`
          )
          .get()
      ).toEqual({
        amount: 110_225,
        reporting_treatment: 'exclude_from_cashflow',
        transaction_kind: 'reconciliation_bridge',
        category_id: null,
      })
      expect(
        db
          .prepare(
            'SELECT actual_balance, stored_balance_before, ledger_balance_before, ledger_balance_after FROM account_reconciliations'
          )
          .get()
      ).toEqual({
        actual_balance: 110_225,
        stored_balance_before: 110_225,
        ledger_balance_before: 0,
        ledger_balance_after: 110_225,
      })
    } finally {
      db.close()
    }

    const guardDb = new Database(dbPath, { readonly: true })
    const adjustmentId = (
      guardDb
        .prepare("SELECT id FROM transactions WHERE transaction_kind = 'reconciliation_bridge'")
        .get() as { id: string }
    ).id
    guardDb.close()
    const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!
    const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!
    await expect(
      updateTransaction.execute(
        updateTransaction.schema.parse({ transactionId: adjustmentId, amount: 1 })
      )
    ).resolves.toMatchObject({ success: false, reason: 'protected_transaction_kind' })
    await expect(
      deleteTransaction.execute(deleteTransaction.schema.parse({ transactionId: adjustmentId }))
    ).resolves.toMatchObject({ success: false, reason: 'protected_transaction_kind' })
  })

  it('finalizes a staged statement batch and reconciliation bridge in one transaction', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 110_225 })
    const db = new Database(dbPath)
    try {
      const insert = db.prepare(
        `INSERT INTO transactions (
           id, account_id, type, amount, currency, description, date, status,
           ledger_treatment, reporting_treatment, staging_batch_id
         ) VALUES (?, 'acct-1', ?, ?, 'USD', ?, ?, 'posted',
           'staged_no_balance_impact', 'normal', 'statement-2026-05')`
      )
      insert.run('staged-1', 'expense', 10_000, 'Purchase', '2026-05-05')
      insert.run('staged-2', 'income', 25_000, 'Deposit', '2026-05-20')
    } finally {
      db.close()
    }

    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const finalize = tools.find((tool) => tool.name === 'finalize-staged-statement-history')!
    const input = {
      accountId: 'acct-1',
      stagingBatchId: 'statement-2026-05',
      statementStartDate: '2026-05-01',
      statementEndDate: '2026-05-31',
      actualBalance: 1102.25,
    }

    await expect(finalize.execute(finalize.schema.parse(input))).resolves.toMatchObject({
      dryRun: true,
      transactionCount: 2,
      stagedBalanceEffectCentavos: 15_000,
      reconciliationBridgeCentavos: 95_225,
    })
    await expect(
      finalize.execute(finalize.schema.parse({ ...input, apply: true }))
    ).resolves.toMatchObject({
      success: true,
      dryRun: false,
      verifiedLedgerBalanceCentavos: 110_225,
    })

    const verified = new Database(dbPath, { readonly: true })
    try {
      expect(
        verified
          .prepare(
            `SELECT id, status, ledger_treatment
             FROM transactions WHERE staging_batch_id = 'statement-2026-05' ORDER BY id`
          )
          .all()
      ).toEqual([
        { id: 'staged-1', status: 'cleared', ledger_treatment: 'normal' },
        { id: 'staged-2', status: 'cleared', ledger_treatment: 'normal' },
      ])
      expect(
        verified
          .prepare('SELECT staging_batch_id, adjustment_amount FROM account_reconciliations')
          .get()
      ).toEqual({ staging_batch_id: 'statement-2026-05', adjustment_amount: 95_225 })
    } finally {
      verified.close()
    }

    const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!
    const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!
    await expect(
      updateTransaction.execute(
        updateTransaction.schema.parse({ transactionId: 'staged-1', amount: 101 })
      )
    ).resolves.toMatchObject({ success: false, reason: 'finalized_statement_transaction' })
    await expect(
      deleteTransaction.execute(deleteTransaction.schema.parse({ transactionId: 'staged-1' }))
    ).resolves.toMatchObject({ success: false, reason: 'finalized_statement_transaction' })
  })

  it('matches an exact transfer pair while preserving the imported mirror', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 9_500 })
    const db = new Database(dbPath)
    try {
      db.prepare(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
         VALUES ('acct-2', 'Credit Card', 'credit_card', 'USD', 700, 0)`
      ).run()
      const insert = db.prepare(
        `INSERT INTO transactions (
           id, account_id, type, amount, currency, description, date, status,
           ledger_treatment, reporting_treatment
         ) VALUES (?, ?, ?, 500, 'USD', ?, ?, 'posted', 'normal', 'normal')`
      )
      insert.run('funding-row', 'acct-1', 'expense', 'Card payment', '2026-05-10')
      insert.run('mirror-row', 'acct-2', 'income', 'Payment received', '2026-05-11')
    } finally {
      db.close()
    }

    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const matchTransfer = tools.find((tool) => tool.name === 'match-transfer-transactions')!
    const input = {
      sourceTransactionId: 'funding-row',
      mirrorTransactionId: 'mirror-row',
    }
    await expect(matchTransfer.execute(matchTransfer.schema.parse(input))).resolves.toMatchObject({
      success: true,
      dryRun: true,
      wouldMatch: { matchEvidence: { exactAmount: true, daysApart: 1 } },
    })
    await expect(
      matchTransfer.execute(matchTransfer.schema.parse({ ...input, apply: true }))
    ).resolves.toMatchObject({ success: true, dryRun: false })
    const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!
    await expect(
      deleteTransaction.execute(deleteTransaction.schema.parse({ transactionId: 'funding-row' }))
    ).resolves.toMatchObject({ success: false, reason: 'matched_transaction' })
    await expect(
      deleteTransaction.execute(deleteTransaction.schema.parse({ transactionId: 'mirror-row' }))
    ).resolves.toMatchObject({ success: false, reason: 'archived_transaction' })

    const verified = new Database(dbPath, { readonly: true })
    try {
      expect(
        verified
          .prepare(
            'SELECT id, type, transfer_to_account_id, matched_transaction_id, is_archived, transaction_kind, reporting_treatment FROM transactions ORDER BY id'
          )
          .all()
      ).toEqual([
        {
          id: 'funding-row',
          type: 'transfer',
          transfer_to_account_id: 'acct-2',
          matched_transaction_id: 'mirror-row',
          is_archived: 0,
          transaction_kind: 'standard',
          reporting_treatment: 'exclude_from_cashflow',
        },
        {
          id: 'mirror-row',
          type: 'income',
          transfer_to_account_id: null,
          matched_transaction_id: 'funding-row',
          is_archived: 1,
          transaction_kind: 'archived_transfer_mirror',
          reporting_treatment: 'exclude_from_cashflow',
        },
      ])
      expect(verified.prepare('SELECT id, balance FROM accounts ORDER BY id').all()).toEqual([
        { id: 'acct-1', balance: 9_500 },
        { id: 'acct-2', balance: 700 },
      ])
    } finally {
      verified.close()
    }

    const unmatchTransfer = tools.find((tool) => tool.name === 'unmatch-transfer-transactions')!
    await expect(
      unmatchTransfer.execute(unmatchTransfer.schema.parse({ sourceTransactionId: 'funding-row' }))
    ).resolves.toMatchObject({ success: true, dryRun: true })
    await expect(
      unmatchTransfer.execute(
        unmatchTransfer.schema.parse({ sourceTransactionId: 'funding-row', apply: true })
      )
    ).resolves.toMatchObject({ success: true, dryRun: false })
    const restored = new Database(dbPath, { readonly: true })
    try {
      expect(
        restored
          .prepare(
            'SELECT id, type, transfer_to_account_id, matched_transaction_id, is_archived, transaction_kind, reporting_treatment FROM transactions ORDER BY id'
          )
          .all()
      ).toEqual([
        {
          id: 'funding-row',
          type: 'expense',
          transfer_to_account_id: null,
          matched_transaction_id: null,
          is_archived: 0,
          transaction_kind: 'standard',
          reporting_treatment: 'normal',
        },
        {
          id: 'mirror-row',
          type: 'income',
          transfer_to_account_id: null,
          matched_transaction_id: null,
          is_archived: 0,
          transaction_kind: 'standard',
          reporting_treatment: 'normal',
        },
      ])
    } finally {
      restored.close()
    }
  })

  it('tracks and matches receivables independently from pending transactions', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({
      tempHome,
      accountBalance: 50_000,
      transaction: {
        id: 'client-payment',
        type: 'income',
        amount: 25_000,
        description: 'Client invoice paid',
        date: '2026-05-20',
        status: 'cleared',
      },
    })
    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const manage = tools.find((tool) => tool.name === 'manage-receivable')!
    const match = tools.find((tool) => tool.name === 'match-receivable')!

    const largerReceivable = (await manage.execute(
      manage.schema.parse({
        action: 'create',
        payer: 'Client B',
        amount: 300,
        dueDate: '2026-05-20',
        currency: 'USD',
        accountId: 'acct-1',
        apply: true,
      })
    )) as { receivable: { id: string } }
    await expect(
      match.execute(
        match.schema.parse({
          receivableId: largerReceivable.receivable.id,
          transactionId: 'client-payment',
          apply: true,
        })
      )
    ).resolves.toMatchObject({ success: false, reason: 'payment_amount_mismatch' })

    const created = (await manage.execute(
      manage.schema.parse({
        action: 'create',
        payer: 'Client A',
        amount: 250,
        dueDate: '2026-05-20',
        currency: 'USD',
        accountId: 'acct-1',
        invoiceReference: 'INV-42',
        apply: true,
      })
    )) as { receivable: { id: string } }
    await expect(
      match.execute(
        match.schema.parse({
          receivableId: created.receivable.id,
          transactionId: 'client-payment',
          apply: true,
        })
      )
    ).resolves.toMatchObject({ success: true, dryRun: false })

    const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!
    await expect(
      deleteTransaction.execute(deleteTransaction.schema.parse({ transactionId: 'client-payment' }))
    ).resolves.toMatchObject({ success: false, reason: 'referenced_financial_transaction' })

    const db = new Database(dbPath, { readonly: true })
    try {
      expect(
        db
          .prepare(
            'SELECT payer, amount, received_amount, status, matched_transaction_id FROM receivables WHERE id = ?'
          )
          .get(created.receivable.id)
      ).toEqual({
        payer: 'Client A',
        amount: 25_000,
        received_amount: 25_000,
        status: 'received',
        matched_transaction_id: 'client-payment',
      })
    } finally {
      db.close()
    }

    const unmatch = tools.find((tool) => tool.name === 'unmatch-receivable')!
    await expect(
      unmatch.execute(unmatch.schema.parse({ receivableId: created.receivable.id, apply: true }))
    ).resolves.toMatchObject({ success: true, dryRun: false })
    const restored = new Database(dbPath, { readonly: true })
    try {
      expect(
        restored
          .prepare(
            'SELECT received_amount, status, matched_transaction_id FROM receivables WHERE id = ?'
          )
          .get(created.receivable.id)
      ).toEqual({ received_amount: 0, status: 'open', matched_transaction_id: null })
    } finally {
      restored.close()
    }
  })

  it('rejects generic undo after a transaction becomes a matched receivable payment', async () => {
    const tempHome = createTempHome()
    const dbPath = seedDatabase({ tempHome, accountBalance: 0 })
    const { tools } = await loadToolsWithRealDatabase(tempHome)
    const addTransaction = tools.find((tool) => tool.name === 'add-transaction')!
    const manageReceivable = tools.find((tool) => tool.name === 'manage-receivable')!
    const matchReceivable = tools.find((tool) => tool.name === 'match-receivable')!
    const undo = tools.find((tool) => tool.name === 'undo')!

    const added = (await addTransaction.execute(
      addTransaction.schema.parse({
        accountId: 'acct-1',
        type: 'income',
        amount: 250,
        currency: 'USD',
        description: 'Audited client payment',
        date: '2026-06-15',
      })
    )) as { transaction: { id: string } }
    const created = (await manageReceivable.execute(
      manageReceivable.schema.parse({
        action: 'create',
        payer: 'Undo Guard Client',
        amount: 250,
        currency: 'USD',
        dueDate: '2026-06-15',
        accountId: 'acct-1',
        apply: true,
      })
    )) as { receivable: { id: string } }
    await matchReceivable.execute(
      matchReceivable.schema.parse({
        receivableId: created.receivable.id,
        transactionId: added.transaction.id,
        apply: true,
      })
    )

    await expect(
      undo.execute(
        undo.schema.parse({
          transactionId: added.transaction.id,
          apply: true,
          allowDependentWrites: true,
        })
      )
    ).rejects.toThrow('linked financial provenance')

    const db = new Database(dbPath, { readonly: true })
    try {
      expect(
        db.prepare('SELECT amount FROM transactions WHERE id = ?').get(added.transaction.id)
      ).toEqual({ amount: 25_000 })
    } finally {
      db.close()
    }
  }, 10_000)
})
