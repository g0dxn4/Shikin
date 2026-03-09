import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Budgets } from '../budgets'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    openBudgetDialog: vi.fn(),
  }),
}))

vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: () => ({
    budgets: [],
    isLoading: false,
    fetch: vi.fn(),
  }),
}))

describe('Budgets', () => {
  it('renders title', () => {
    render(<Budgets />)

    expect(screen.getByText('title')).toBeInTheDocument()
  })

  it('renders empty state text', () => {
    render(<Budgets />)

    expect(screen.getByText('empty.title')).toBeInTheDocument()
  })
})
