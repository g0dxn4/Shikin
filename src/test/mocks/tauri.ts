import { vi } from 'vitest'

const mockDb = {
  select: vi.fn().mockResolvedValue([]),
  execute: vi.fn().mockResolvedValue({ rowsAffected: 0, lastInsertId: 0 }),
  close: vi.fn().mockResolvedValue(undefined),
}

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockResolvedValue(mockDb),
  },
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  }),
}))

export { mockDb }
