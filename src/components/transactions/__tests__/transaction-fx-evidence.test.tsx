import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TransactionFxEvidenceDetails } from '../transaction-fx-evidence'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/transaction-fx', () => ({
  getLatestTransactionFxEvidence: vi.fn().mockResolvedValue({
    id: 'evidence',
    transaction_id: 'transaction',
    original_transaction_id: 'transaction',
    original_account_id: 'account',
    transaction_type: 'expense',
    status: 'posted',
    ledger_treatment: 'normal',
    input_amount_centavos: 1000,
    input_currency: 'EUR',
    account_amount_centavos: 17000,
    account_currency: 'MXN',
    account_balance_delta_centavos: -17000,
    transaction_date: '2026-09-14',
    rate_id: 'rate-17',
    rate_decimal: '17',
    created_at: '2026-09-14T12:00:00Z',
  }),
}))

describe('TransactionFxEvidenceDetails', () => {
  it('shows immutable original input, accepted account amount, rate/date, and signed contribution', async () => {
    render(<TransactionFxEvidenceDetails transactionId="transaction" />)
    expect(await screen.findByText('fx.evidenceTitle')).toBeInTheDocument()
    expect(screen.getByText('€10.00')).toBeInTheDocument()
    expect(screen.getByText('MX$170.00')).toBeInTheDocument()
    expect(screen.getByText('EUR->MXN · 17')).toBeInTheDocument()
    expect(screen.getByText('2026-09-14')).toBeInTheDocument()
    expect(screen.getByText('-MX$170.00')).toBeInTheDocument()
  })
})
