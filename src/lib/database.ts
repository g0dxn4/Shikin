import Database from '@tauri-apps/plugin-sql'

let db: Database | null = null

export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:valute.db')
  }
  return db
}

export async function query<T>(sql: string, bindValues?: unknown[]): Promise<T[]> {
  const database = await getDb()
  return database.select<T[]>(sql, bindValues)
}

export async function execute(sql: string, bindValues?: unknown[]) {
  const database = await getDb()
  return database.execute(sql, bindValues)
}
