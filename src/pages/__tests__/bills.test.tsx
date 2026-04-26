import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BillsPage } from '../bills'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

describe('BillsPage', () => {
  it('renders without crashing', () => {
    render(<BillsPage />)
    expect(screen.getAllByText('nav.bills').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('status.empty')).toBeInTheDocument()
  })
})
