import { type Page } from '@playwright/test'

/**
 * Sets up the page for e2e testing.
 * In browser mode, the app uses the data server at localhost:1480
 * so no Tauri mocking is needed — just ensure the page is ready.
 */
export async function mockTauri(page: Page, _options?: { mockData?: MockData }) {
  // No-op: the app detects browser mode (no __TAURI_INTERNALS__)
  // and uses the data server at localhost:1480 for persistence.
  // The data server must be running (started by `pnpm dev`).
}

export interface MockData {
  accounts?: Record<string, unknown>[]
  transactions?: Record<string, unknown>[]
  budgets?: Record<string, unknown>[]
  categories?: Record<string, unknown>[]
}
