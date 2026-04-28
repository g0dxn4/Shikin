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

  if (transaction) {
    db.prepare(
      `INSERT INTO transactions
         (id, account_id, category_id, type, amount, currency, description, notes, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      transaction.id,
      'acct-1',
      null,
      transaction.type,
      transaction.amount,
      'USD',
      transaction.description,
      transaction.notes ?? null,
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

async function loadToolsWithRealDatabaseFailure({
  tempHome,
  failOnExecuteCall,
}: {
  tempHome: string
  failOnExecuteCall: number
}) {
  const dbPath = getDbPath(tempHome)

  vi.resetModules()
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
  vi.resetModules()

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('CLI tools SQLite transaction rollback', () => {
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
  })

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
    const { tools } = await loadToolsWithRealDatabaseFailure({ tempHome, failOnExecuteCall: 3 })
    const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      amount: 12,
      description: 'Lunch',
    })

    await expect(updateTransaction.execute(input)).rejects.toThrow(
      'Injected execute failure on call 3'
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
})
