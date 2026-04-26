import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Subscriptions } from '../subscriptions'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('@/stores/subscription-store', () => ({
  useSubscriptionStore: () => ({
    subscriptions: [],
    upcomingPayments: [],
    monthlyTotal: 0,
    isLoading: false,
    isConnected: false,
    error: null,
    fetch: vi.fn(),
  }),
}))

describe('Subscriptions', () => {
  it('renders setup guide when not connected', () => {
    render(<Subscriptions />)

    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByText('connection.setupTitle')).toBeInTheDocument()
  })
})
