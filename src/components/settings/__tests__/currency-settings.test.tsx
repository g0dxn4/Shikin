import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'
import { CurrencySettings } from '../currency-settings'

const { state, mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  state: {
    mainCurrency: null as string | null,
    preferredCurrency: 'USD',
    manualRates: [] as DatedExchangeRate[],
    isLoading: false,
    error: null as string | null,
    setPreferredCurrency: vi.fn(),
    saveExchangeRate: vi.fn(),
  },
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => state,
}))

function rate(
  id: string,
  rateDecimal: string,
  supersedesRateId: string | null = null
): DatedExchangeRate {
  return {
    id,
    fromCurrency: 'USD',
    toCurrency: 'MXN',
    rateDecimal,
    effectiveFrom: '2025-09-14',
    supersedesRateId,
    createdAt: `2025-09-14T0${supersedesRateId ? '2' : '1'}:00:00Z`,
    sourceNote: supersedesRateId ? 'Corrected quote' : 'Original quote',
  }
}

describe('CurrencySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.mainCurrency = null
    state.preferredCurrency = 'USD'
    state.manualRates = []
    state.isLoading = false
    state.error = null
    state.setPreferredCurrency.mockResolvedValue(undefined)
    state.saveExchangeRate.mockResolvedValue(undefined)
  })

  it('shows unconfigured guidance and requires an explicit main-currency save', async () => {
    const user = userEvent.setup()
    render(<CurrencySettings />)

    expect(screen.getByText('currency.setupRequiredTitle')).toBeInTheDocument()
    expect(screen.getByText('currency.mainChangeWarning')).toBeInTheDocument()
    expect(state.setPreferredCurrency).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByLabelText('currency.mainCurrency'), 'MXN')
    await user.click(screen.getByRole('button', { name: 'currency.saveMain' }))

    await waitFor(() => expect(state.setPreferredCurrency).toHaveBeenCalledWith('MXN'))
    expect(mockToastSuccess).toHaveBeenCalledWith('currency.mainSaved')
  })

  it('requires acknowledgement and an audit note for a backdated rate', async () => {
    const user = userEvent.setup()
    state.mainCurrency = 'MXN'
    state.preferredCurrency = 'MXN'
    render(<CurrencySettings />)

    await user.type(screen.getByLabelText('currency.rateDecimal'), '17')
    await user.clear(screen.getByLabelText('currency.effectiveFrom'))
    await user.type(screen.getByLabelText('currency.effectiveFrom'), '2020-01-01')

    expect(screen.getByText('currency.historicalWarning')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'currency.saveRate' })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText('currency.auditNote'), 'Historical statement quote')
    await user.click(screen.getByText('currency.acknowledgeHistorical'))
    await user.click(save)

    await waitFor(() =>
      expect(state.saveExchangeRate).toHaveBeenCalledWith({
        fromCurrency: 'USD',
        toCurrency: 'MXN',
        rateDecimal: '17',
        effectiveFrom: '2020-01-01',
        replacesRateId: null,
        sourceNote: null,
        auditNote: 'Historical statement quote',
        acknowledgeHistoricalChange: true,
      })
    )
    expect(state.saveExchangeRate.mock.calls[0]?.[0]).not.toHaveProperty('today')
  })

  it('shows every immutable row with clear current/corrected status and corrects only the leaf', async () => {
    const user = userEvent.setup()
    const original = rate('original', '17')
    const corrected = rate('correction', '17.25', original.id)
    state.mainCurrency = 'MXN'
    state.preferredCurrency = 'MXN'
    state.manualRates = [original, corrected]
    render(<CurrencySettings />)

    expect(screen.getAllByText('USD → MXN')).toHaveLength(2)
    expect(screen.getByText('currency.statusCorrected')).toBeInTheDocument()
    expect(screen.getByText('currency.statusCurrent')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'currency.correct' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'currency.correct' }))
    const rateInput = screen.getByLabelText('currency.rateDecimal')
    await user.clear(rateInput)
    await user.type(rateInput, '17.5')
    await user.type(screen.getByLabelText('currency.auditNote'), 'Correct decimal transcription')
    await user.click(screen.getByText('currency.acknowledgeHistorical'))
    await user.click(screen.getByRole('button', { name: 'currency.saveCorrection' }))

    await waitFor(() =>
      expect(state.saveExchangeRate).toHaveBeenCalledWith(
        expect.objectContaining({
          fromCurrency: 'USD',
          toCurrency: 'MXN',
          effectiveFrom: '2025-09-14',
          rateDecimal: '17.5',
          replacesRateId: 'correction',
          auditNote: 'Correct decimal transcription',
          acknowledgeHistoricalChange: true,
        })
      )
    )
  })

  it('saves a future direct rate without historical acknowledgement', async () => {
    const user = userEvent.setup()
    state.mainCurrency = 'MXN'
    state.preferredCurrency = 'MXN'
    render(<CurrencySettings />)

    await user.type(screen.getByLabelText('currency.rateDecimal'), '18.125')
    await user.clear(screen.getByLabelText('currency.effectiveFrom'))
    await user.type(screen.getByLabelText('currency.effectiveFrom'), '2099-01-01')
    await user.type(screen.getByLabelText('currency.sourceNote'), 'Manual planning quote')
    await user.click(screen.getByRole('button', { name: 'currency.saveRate' }))

    await waitFor(() =>
      expect(state.saveExchangeRate).toHaveBeenCalledWith(
        expect.objectContaining({
          rateDecimal: '18.125',
          effectiveFrom: '2099-01-01',
          sourceNote: 'Manual planning quote',
          auditNote: null,
          acknowledgeHistoricalChange: false,
        })
      )
    )
    expect(screen.queryByText('currency.historicalWarning')).not.toBeInTheDocument()
  })
})
