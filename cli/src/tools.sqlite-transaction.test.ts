// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
  db.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense'
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      category_id TEXT,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      notes TEXT,
      date TEXT NOT NULL,
     updated_at TEXT
    );
  `)

  db.prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)').run(1, '001_core_tables')

  db.prepare('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)').run(
    'acct-1',
    'Primary',
    accountBalance
  )

  if (transaction) {
    db.prepare(
      `INSERT INTO transactions
         (id, account_id, category_id, type, amount, description, notes, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      transaction.id,
      'acct-1',
      null,
      transaction.type,
      transaction.amount,
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
    const actual = await vi.importActual<typeof import('node:os')>('node:os')
    return {
      ...actual,
      homedir: () => tempHome,
    }
  })
  vi.doMock('./ulid.js', () => ({
    generateId: () => 'tx_sqlite_rollback',
  }))
  vi.doMock('./database.js', async () => {
    const actual = await vi.importActual<typeof import('./database.js')>('./database.js')
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
})
