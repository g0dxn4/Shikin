import { type Page } from '@playwright/test'

/**
 * Injects a mock Tauri IPC bridge so the app can run in a regular browser.
 * Call this before navigating to any page.
 */
export async function mockTauri(page: Page, options?: { mockData?: MockData }) {
  const data = options?.mockData ?? {}

  await page.addInitScript((serializedData) => {
    const mockData = serializedData as Record<string, unknown[]>

    // Mock the Tauri core invoke
    ;(window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, _args?: any) => {
        // plugin:sql — database queries
        if (cmd === 'plugin:sql|load') {
          return '' // Return empty string as DB path
        }
        if (cmd === 'plugin:sql|select') {
          const sql = _args?.query as string
          if (sql && mockData) {
            // Match common queries to mock data
            if (sql.includes('accounts') && mockData.accounts) return mockData.accounts
            if (sql.includes('transactions') && mockData.transactions)
              return mockData.transactions
            if (sql.includes('budgets') && mockData.budgets) return mockData.budgets
            if (sql.includes('categories') && mockData.categories) return mockData.categories
          }
          return []
        }
        if (cmd === 'plugin:sql|execute') {
          return { rowsAffected: 0, lastInsertId: 0 }
        }

        // plugin:store — settings store
        if (cmd === 'plugin:store|load') return true
        if (cmd === 'plugin:store|get') return null
        if (cmd === 'plugin:store|set') return null
        if (cmd === 'plugin:store|save') return null
        if (cmd === 'plugin:store|entries') return []

        // plugin:fs — notebook filesystem
        if (cmd === 'plugin:fs|read_dir') return []
        if (cmd === 'plugin:fs|read_text_file') return ''
        if (cmd === 'plugin:fs|create_dir') return null
        if (cmd === 'plugin:fs|write_text_file') return null
        if (cmd === 'plugin:fs|exists') return false

        // app plugin
        if (cmd === 'plugin:app|app_data_dir') return '/mock/app-data'

        // Default: return null for unknown commands
        return null
      },
      convertFileSrc: (path: string) => path,
    }

    // Mock Tauri event system
    ;(window as any).__TAURI_INTERNALS__.metadata = {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    }
  }, data)
}

export interface MockData {
  accounts?: Record<string, unknown>[]
  transactions?: Record<string, unknown>[]
  budgets?: Record<string, unknown>[]
  categories?: Record<string, unknown>[]
}
