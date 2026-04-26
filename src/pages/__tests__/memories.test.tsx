import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Memories } from '../memories'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'memoryCount' && options?.count !== undefined) {
        return `${options.count} memory`
      }
      return key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockQuery = vi.fn().mockResolvedValue([])
const mockExecute = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/database', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}))

vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div role="dialog">{title}</div> : null,
}))

describe('Memories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue([])
  })

  it('renders empty state when no memories', async () => {
    render(<Memories />)

    await waitFor(() => {
      expect(screen.getByText('nav.memories')).toBeInTheDocument()
    })
    expect(screen.getByText('noMemories')).toBeInTheDocument()
    expect(screen.getByText('memoriesCreatedAutomatically')).toBeInTheDocument()
  })

  it('renders search input with accessible label', async () => {
    render(<Memories />)

    await waitFor(() => {
      expect(screen.getByLabelText('searchPlaceholder')).toBeInTheDocument()
    })
  })

  it('renders category filter buttons with aria-pressed', async () => {
    render(<Memories />)

    await waitFor(() => {
      const allBtn = screen.getByRole('button', { name: 'category.all' })
      expect(allBtn).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
