// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type * as DatabaseModule from './database.js'
import type * as OsModule from 'node:os'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'

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
})
