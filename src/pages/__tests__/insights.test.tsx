import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InsightsPage } from '../insights'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

describe('InsightsPage', () => {
  it('renders compact links to every insight destination', () => {
    render(<InsightsPage />)

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByText('description')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sections.reports.title/i })).toHaveAttribute(
      'href',
      '/reports'
    )
    expect(screen.getByRole('link', { name: /sections.spendingInsights.title/i })).toHaveAttribute(
      'href',
      '/spending-insights'
    )
    expect(screen.getByRole('link', { name: /sections.netWorth.title/i })).toHaveAttribute(
      'href',
      '/net-worth'
    )
    expect(screen.getByRole('link', { name: /sections.spendingHeatmap.title/i })).toHaveAttribute(
      'href',
      '/spending-heatmap'
    )
    expect(screen.getByRole('link', { name: /sections.forecast.title/i })).toHaveAttribute(
      'href',
      '/forecast'
    )
  })
})
